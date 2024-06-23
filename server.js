// backend/server.js
require('dotenv').config(); // Make sure to require dotenv at the beginning
const express = require('express');
const axios = require('axios');
const app = express();
const cors = require('cors');
const port = 8000;

app.use(express.json());
app.use(cors());

// Use the API key from the .env file
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Function to calculate distance between two points (in meters)
function calculateDistance(point1, point2) {
    const lat1 = point1.lat;
    const lng1 = point1.lng;
    const lat2 = point2.lat;
    const lng2 = point2.lng;

    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const distance = R * c;
    return distance;
}

// Function to check if a point is on the route
function isPointOnRoute(point, route) {
    for (let leg of route.legs) {
        for (let step of leg.steps) {
            const startLocation = step.start_location;
            const endLocation = step.end_location;
            const distanceFromStart = calculateDistance(point, startLocation);
            const distanceFromEnd = calculateDistance(point, endLocation);
            const legDistance = calculateDistance(startLocation, endLocation);

            // Check if point is within a certain distance from the start or end of the step
            if (distanceFromStart <= legDistance && distanceFromEnd <= legDistance) {
                return true;
            }
        }
    }
    return false;
}

// Endpoint to calculate max reachable point (nearest parking location on route)
app.post('/max-reachable-point', async (req, res) => {
    const { origin, destination } = req.body;

    try {
        // Get directions from Google Directions API
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
        const endLocation = route.legs[route.legs.length - 1].end_location;

        // Search for nearby parking lots on the route
        const placesOnRouteResponse = await axios.get(`https://maps.googleapis.com/maps/api/place/nearbysearch/json`, {
            params: {
                location: `${endLocation.lat},${endLocation.lng}`,
                radius: 500, // search within 500 meters
                type: 'parking',
                key: GOOGLE_MAPS_API_KEY
            }
        });

        if (placesOnRouteResponse.data.status !== 'OK') {
            return res.status(400).json({ error: 'Failed to get nearby places on route' });
        }

        const parkingLotsOnRoute = placesOnRouteResponse.data.results;
        let closestParkingLotOnRoute = null;
        let minDistanceOnRoute = Infinity;

        // Find closest parking lot on route
        for (let parkingLot of parkingLotsOnRoute) {
            const parkingLotPoint = parkingLot.geometry.location;
            const distanceToDestination = calculateDistance(parkingLotPoint, endLocation);

            if (isPointOnRoute(parkingLotPoint, route) && distanceToDestination < minDistanceOnRoute) {
                minDistanceOnRoute = distanceToDestination;
                closestParkingLotOnRoute = parkingLotPoint;
            }
        }

        // If no suitable parking lot found on route, find nearest parking lot outside route
        if (!closestParkingLotOnRoute) {
            const placesOutsideRouteResponse = await axios.get(`https://maps.googleapis.com/maps/api/place/nearbysearch/json`, {
                params: {
                    location: `${endLocation.lat},${endLocation.lng}`,
                    radius: 500, // search within 2000 meters (adjust as needed)
                    type: 'parking',
                    key: GOOGLE_MAPS_API_KEY
                }
            });

            if (placesOutsideRouteResponse.data.status !== 'OK') {
                return res.status(400).json({ error: 'Failed to get nearby places outside route' });
            }

            const parkingLotsOutsideRoute = placesOutsideRouteResponse.data.results;
            let closestParkingLotOutsideRoute = null;
            let minDistanceOutsideRoute = Infinity;

            // Find closest parking lot outside route
            for (let parkingLot of parkingLotsOutsideRoute) {
                const parkingLotPoint = parkingLot.geometry.location;
                const distanceToDestination = calculateDistance(parkingLotPoint, endLocation);

                if (distanceToDestination < minDistanceOutsideRoute) {
                    minDistanceOutsideRoute = distanceToDestination;
                    closestParkingLotOutsideRoute = parkingLotPoint;
                }
            }

            if (closestParkingLotOutsideRoute) {
                res.json({ maxPoint: closestParkingLotOutsideRoute });
            } else {
                res.json({ maxPoint: endLocation });
            }

        } else {
            res.json({ maxPoint: closestParkingLotOnRoute });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred while calculating the max reachable point' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});