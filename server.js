
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Amadeus = require('amadeus');
require('dotenv').config();

const app = express();

// --- CONFIGURATION ---
// Get port from command line arguments or environment variables
let port = 3000;
const portArgIndex = process.argv.indexOf('--port');
if (portArgIndex !== -1 && process.argv.length > portArgIndex + 1) {
    port = parseInt(process.argv[portArgIndex + 1], 10);
} else if (process.env.PORT) {
    port = parseInt(process.env.PORT, 10);
}

// --- MIDDLEWARE ---
app.use(express.static('public'));
app.use(express.json());

// --- API CLIENTS ---
// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Initialize Amadeus
const amadeus = new Amadeus({
    clientId: process.env.AMADEUS_API_KEY,
    clientSecret: process.env.AMADEUS_API_SECRET,
});

// --- API ROUTES ---
app.post('/api/search-flights', async (req, res) => {
    const { numberOfDays, departureAirport } = req.body;

    if (!numberOfDays || !departureAirport) {
        return res.status(400).json({ error: 'Number of days and departure airport are required' });
    }

    try {
        // --- Part 1: Get Destination Ideas from Gemini ---
        console.log('Asking Gemini for destination ideas...');
        const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

        const prompt = `
            Suggest 3 diverse and interesting international flight destinations for a trip of ${numberOfDays} days, departing from ${departureAirport}.\n            Provide the response as a valid JSON array of objects. Each object must have a "city" (string) and "iataCode" (string) key. The "iataCode" must be the main airport code for that city.\n            Do not include any other text or formatting outside of the JSON array.\n            Make sure the destinations are geographically diverse.\n\n            Example format:\n            [\n                { "city": "Paris, France", "iataCode": "CDG" },\n                { "city": "Tokyo, Japan", "iataCode": "HND" }\n            ]\n        `;

        const geminiResult = await model.generateContent(prompt);
        const geminiResponse = await geminiResult.response;
        const geminiText = await geminiResponse.text();
        const destinations = JSON.parse(geminiText.replace(/```json|```/g, '').trim());

        console.log('Gemini suggested:', destinations);

        // --- Part 2: Get REAL Flight Prices from Amadeus ---
        console.log('Fetching real-time prices from Amadeus...');
        const flightResults = [];

        // Set a departure date 3 months from now for better price searching
        const futureDate = new Date();
        futureDate.setMonth(futureDate.getMonth() + 3);
        const departureDate = futureDate.toISOString().split('T')[0];

        for (const destination of destinations) {
            try {
                const flightOffersResponse = await amadeus.shopping.flightOffersSearch.get({
                    originLocationCode: departureAirport,
                    destinationLocationCode: destination.iataCode,
                    departureDate: departureDate,
                    adults: '1',
                    max: 1 // We only need the top result for a price estimate
                });
                
                if (flightOffersResponse.data.length > 0) {
                    flightResults.push({
                        destination: destination.city,
                        price: parseFloat(flightOffersResponse.data[0].price.total),
                    });
                }
            } catch (amadeusError) {
                console.error(`Could not find a flight for ${destination.iataCode}:`, amadeusError.code);
                // Don't add to results if no flight is found
            }
        }
        
        console.log('Final results:', flightResults);
        res.json({ flights: flightResults });

    } catch (error) {
        console.error('Error in /api/search-flights:', error);
        res.status(500).json({ error: 'Failed to fetch flight recommendations. Please check server logs.' });
    }
});

app.get('/api/search-airports', async (req, res) => {
    const { keyword } = req.query;

    if (!keyword) {
        return res.status(400).json({ error: 'Keyword is required' });
    }

    try {
        // FINAL FIX: The Amadeus API expects a comma-separated string for multiple subTypes,
        // not an array as the documentation might suggest.
        const response = await amadeus.referenceData.locations.get({
            keyword: keyword.toUpperCase(),
            subType: 'AIRPORT,CITY', 
            page: { limit: 15 } 
        });

        res.json(response.data);
    } catch (error) {
        // Deeper error logging
        console.error('Amadeus API Error:', JSON.stringify(error, null, 2));
        res.status(500).json({ 
            error: 'Failed to fetch airport data', 
            amadeusError: error.description 
        });
    }
});


// --- SERVER START ---
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
    console.log('Please ensure your GEMINI_API_KEY, AMADEUS_API_KEY, and AMADEUS_API_SECRET are set in your .env file.');
});
