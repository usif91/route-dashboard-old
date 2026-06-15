import { GOOGLE_SCRIPT_URL } from './config.js';

function getClientId() {
    let id = localStorage.getItem('dashboard_client_id');
    if (!id) {
        // Generate a unique device ID with timestamp for uniqueness
        id = 'User-' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36).substr(-4);
        localStorage.setItem('dashboard_client_id', id);
    }
    return id;
}

export async function logSearch(query, details = {}) {
    if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("YOUR_")) {
        console.warn("Google Script URL not set");
        return;
    }

    const topResult = details.topResult;
    const payload = {
        action: 'log',
        source: 'Client',
        user: getClientId(),
        query: query,
        topResultSummary: topResult ? `${topResult.Route} (${topResult.YARD})` : "No Match",
        intersection: details.intersection || (topResult ? topResult.STREETSORT : ""),
        location: details.location ? `${details.location.lat},${details.location.lon}` : "",
        sixCar: topResult ? (topResult["6 car"] || "") : ""
    };

    // Use POST with keepalive to robustly send data to GAS
    // We use text/plain to avoid preflight CORS issues, GAS parses it fine
    try {
        fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            cache: 'no-cache',
            keepalive: true,
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
            },
            body: JSON.stringify(payload)
        }).catch(err => console.error("Log send missed:", err));
    } catch (e) {
        console.error("Logging failed", e);
    }

    console.log("Logged:", query);
}
