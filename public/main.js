
const searchButton = document.getElementById('search-button');
const daysInput = document.getElementById('days');
const departureInput = document.getElementById('departure');
const resultsDiv = document.getElementById('results');
const departureSuggestions = document.getElementById('departure-suggestions');

// --- EVENT LISTENERS ---

// Listen for clicks on the main search button
searchButton.addEventListener('click', async () => {
    const numberOfDays = daysInput.value;
    // Use the data-iata attribute for the final search
    const departureAirport = departureInput.getAttribute('data-iata');

    if (numberOfDays && departureAirport) {
        resultsDiv.innerHTML = `<p>Searching for flights from ${departureAirport} for a ${numberOfDays}-day trip...</p>`;
        try {
            const response = await fetch('/api/search-flights', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numberOfDays, departureAirport }),
            });
            const data = await response.json();
            displayFlights(data.flights);
        } catch (error) {
            console.error('Error fetching flights:', error);
            resultsDiv.innerHTML = '<p>Sorry, something went wrong. Please try again.</p>';
        }
    } else {
        resultsDiv.innerHTML = '<p>Please select a departure airport from the suggestions and enter the number of days.</p>';
    }
});

// Listen for keyboard input in the departure airport field
departureInput.addEventListener('input', async () => {
    const keyword = departureInput.value;

    if (keyword.length > 2) { // Start searching after 3 characters
        try {
            const response = await fetch(`/api/search-airports?keyword=${keyword}`);

            // Gracefully handle server errors
            if (!response.ok) {
                const errorData = await response.json();
                console.error('Server responded with an error:', errorData);
                if (errorData.amadeusError) {
                    console.error('Underlying Amadeus API Error:', errorData.amadeusError);
                }
                departureSuggestions.style.display = 'none';
                return; // Stop processing
            }

            const data = await response.json();
            displayAirportSuggestions(data);

        } catch (error) {
            console.error('Network error fetching airport suggestions:', error);
            departureSuggestions.style.display = 'none';
        }
    } else {
        departureSuggestions.style.display = 'none';
    }
});

// --- UI FUNCTIONS ---

// Display flight results in the main results section
function displayFlights(flights) {
    resultsDiv.innerHTML = ''; // Clear previous results

    if (flights && flights.length > 0) {
        for (const flight of flights) {
            const flightCard = document.createElement('div');
            flightCard.className = 'flight-card';

            const destinationSpan = document.createElement('span');
            destinationSpan.className = 'destination';
            destinationSpan.textContent = flight.destination;

            const priceSpan = document.createElement('span');
            priceSpan.className = 'price';
            priceSpan.textContent = `$${flight.price}`;

            flightCard.appendChild(destinationSpan);
            flightCard.appendChild(priceSpan);
            resultsDiv.appendChild(flightCard);
        }
    } else {
        resultsDiv.innerHTML = '<p>No flights found for the selected criteria. Try a different departure airport or a longer trip duration.</p>';
    }
}

// Display airport suggestions in a dropdown
function displayAirportSuggestions(suggestions) {
    departureSuggestions.innerHTML = ''; // Clear previous suggestions

    // We only care about suggestions that have an IATA code for searching.
    const validSuggestions = suggestions.filter(s => s.iataCode);

    if (validSuggestions.length > 0) {
        departureSuggestions.style.display = 'block';
        validSuggestions.forEach(suggestion => {
            const suggestionElement = document.createElement('div');
            suggestionElement.className = 'suggestion';

            let displayText = '';
            if (suggestion.address && suggestion.address.cityName && suggestion.address.cityName.toUpperCase() !== suggestion.name.toUpperCase()) {
                displayText = `${suggestion.address.cityName}, ${suggestion.name} (${suggestion.iataCode})`;
            } else {
                displayText = `${suggestion.name} (${suggestion.iataCode})`;
            }

            suggestionElement.textContent = displayText;

            // When a suggestion is clicked:
            suggestionElement.addEventListener('click', () => {
                departureInput.value = displayText;
                departureInput.setAttribute('data-iata', suggestion.iataCode);
                departureSuggestions.style.display = 'none';
            });

            departureSuggestions.appendChild(suggestionElement);
        });
    } else {
        departureSuggestions.style.display = 'none';
    }
}
