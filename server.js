
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Amadeus = require('amadeus');
const rateLimit = require('express-rate-limit');

// --- ENVIRONMENT CONFIGURATION ---
// Only load .env file in local development. In production, variables are
// injected by the cloud environment.
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}


const app = express();

// --- CONFIGURATION ---
// The PORT environment variable is provided by the Cloud Run environment.
const port = process.env.PORT || 3000;

// --- CACHING ---
// Simple in-memory cache for airport search results.
const airportCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// --- RATE LIMITING ---
// Define a rate limiter for all API routes to prevent abuse.
const apiLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // Limit each IP to 100 requests per windowMs
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
	message: 'Too many requests from this IP, please try again after 15 minutes',
});


// --- MIDDLEWARE ---
app.use(express.static('public'));
app.use(express.json());
// Apply the rate limiter to all API-bound routes.
app.use('/api/', apiLimiter);

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
            Suggest 3 diverse and interesting international flight destinations for a trip of ${numberOfDays} days, departing from ${departureAirport}.\n\n            Provide the response as a valid JSON array of objects. Each object must have a "city" (string) and "iataCode" (string) key. The "iataCode" must be the main airport code for that city.\n\n            Do not include any other text or formatting outside of the JSON array.\n\n            Make sure the destinations are geographically diverse.\n\n\n\n            Example format:\n\n            [\n\n                { "city": "Paris, France", "iataCode": "CDG" },\n\n                { "city": "Tokyo, Japan", "iataCode": "HND" }\n\n            ]\n\n        `;

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
    
    // --- CACHE LOOKUP ---
    const cacheKey = keyword.toUpperCase();
    if (airportCache.has(cacheKey)) {
        console.log(`Cache HIT for keyword: ${cacheKey}`);
        return res.json(airportCache.get(cacheKey));
    }
    console.log(`Cache MISS for keyword: ${cacheKey}`);


    try {
        const response = await amadeus.referenceData.locations.get({
            keyword: cacheKey,
            subType: 'AIRPORT,CITY', 
            page: { limit: 15 } 
        });

        const responseData = response.data;

        // --- CACHE STORE ---
        // Store the successful response in the cache
        airportCache.set(cacheKey, responseData);
        // Set a timer to clear this specific cache entry after 24 hours.
        setTimeout(() => {
            airportCache.delete(cacheKey);
            console.log(`Cache expired and cleared for keyword: ${cacheKey}`);
        }, CACHE_TTL_MS);

        res.json(responseData);
    } catch (error) {
        console.error('Amadeus API Error:', JSON.stringify(error, null, 2));
        res.status(500).json({ 
            error: 'Failed to fetch airport data', 
            amadeusError: error.description 
        });
    }
});


// --- SERVER START ---
app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on port ${port}`);
});
