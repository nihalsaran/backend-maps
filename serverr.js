// backend/server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const port = 8000;

app.use(express.json());
app.use(cors());

// Replace with your Google Maps API key
const GOOGLE_MAPS_API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY_HERE';

// Helper function to get elevation for a specific location
const getElevation = async (location) => {
    try {
        const elevationResponse = await axios.get(`https://maps.googleapis.com/maps/api/elevation/json`, {
            params: {
                locations: `${location.lat},${location.lng}`,
                key: GOOGLE_MAPS_API_KEY
            }
        });

        if (elevationResponse.data.status !== 'OK') {
            throw new Error('Failed to get elevation data');
        }

        return elevationResponse.data.results[0].elevation;
    } catch (error) {
        console.error('Elevation API error:', error);
        return null;
    }
};

// Endpoint to calculate max reachable point considering terrain and practical stops
app.post('/max-reachable-point', async (req, res) => {
    const { origin, destination } = req.body;

    try {
        // Get directions from origin to destination
        const directionsResponse = await axios.get(`https://maps.googleapis.com/maps/api/directions/json`, {
            params: {
                origin: origin,
                destination: destination,
                key: GOOGLE_MAPS_API_KEY,
                mode: 'driving'
            }
        });

        if (directionsResponse.data.status !== 'OK') {
            return res.status(400).json({ error: 'Failed to get directions' });
        }

        const route = directionsResponse.data.routes[0];
        const legs = route.legs;

        // Calculate total distance and elevation gain along the route
        let totalDistance = 0;
        let totalElevationGain = 0;

        for (const leg of legs) {
            totalDistance += leg.distance.value; // in meters
            const startLocation = leg.start_location;
            const endLocation = leg.end_location;

            // Calculate elevation change for this leg
            const startElevation = await getElevation(startLocation);
            const endElevation = await getElevation(endLocation);

            if (startElevation !== null && endElevation !== null) {
                const elevationChange = Math.max(0, endElevation - startElevation); // consider only elevation gains
                totalElevationGain += elevationChange;
            }
        }

        // Estimate fuel stops based on average fuel efficiency and distance
        const averageFuelEfficiency = 10; // in kilometers per liter
        const fuelCapacity = 50; // in liters
        const fuelStops = Math.ceil(totalDistance / (averageFuelEfficiency * 1000 * fuelCapacity));

        // Determine practical stops along the route
        const practicalStops = [];

        for (let i = 1; i <= fuelStops; i++) {
            const stopDistance = i * (averageFuelEfficiency * 1000 * fuelCapacity);
            const stopLocation = await getPointAlongRoute(origin, destination, stopDistance);

            if (stopLocation) {
                practicalStops.push(stopLocation);
            }
        }

        // Find the maximum reachable point considering the practical stops
        const maxReachablePoint = practicalStops.length > 0 ? practicalStops[practicalStops.length - 1] : legs[legs.length - 1].end_location;

        res.json({ maxPoint: maxReachablePoint });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred while calculating the max reachable point' });
    }
});

// Helper function to get a point along the route at a specific distance
const getPointAlongRoute = async (origin, destination, distance) => {
    try {
        const response = await axios.get(`https://maps.googleapis.com/maps/api/directions/json`, {
            params: {
                origin: origin,
                destination: destination,
                key: GOOGLE_MAPS_API_KEY,
                mode: 'driving',
                waypoints: `via:${distance}`
            }
        });

        if (response.data.status !== 'OK') {
            throw new Error('Failed to get point along the route');
        }

        const route = response.data.routes[0];
        return route.legs[0].end_location;

    } catch (error) {
        console.error('Point along route error:', error);
        return null;
    }
};

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
