import { normalizeForTokens, formatRoute, formatVal } from './utils.js';

export const state = {
    synonyms: [],

    DATA: [],
    query: "",
    matches: [],
    shown: 0,
    pageSize: 200,

    nearMode: false,
    nearSorted: [],
    nearIndex: 0,
    nearPageSize: 5,

    userPos: null,
    expandedRoutes: new Set(),
    synonyms: new Map(),

    // Synonyms from Sheet3 (optional)
    SYN_TOKEN: new Map(), // token -> Set(tokens)
    SYN_GROUPS: []        // [{phrases:[...], tokens:Set([...])}]
};

function safeDecode(s) {
    if (!s) return "";
    try {
        // Repeatedly decode if double encoded
        let decoded = decodeURIComponent(s);
        // Try one more time just in case (some legacies were double encoded)
        if (decoded.includes("%")) {
            try { decoded = decodeURIComponent(decoded); } catch (e) { }
        }
        return decoded;
    } catch (e) { return s; }
}

// Loading from Google Sheets now
export async function loadWorkbook(isAdmin, setStatusCallback, callback) {
    if (setStatusCallback) setStatusCallback("muted", `Loading data… <span class="spinner"></span>`);
    try {
        const { GOOGLE_SCRIPT_URL } = await import('./config.js');

        const cachedData = localStorage.getItem('routeDashboardData');
        const lastFetched = localStorage.getItem('routeDashboardLastFetched');

        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
	
        const now = Date.now();
        const cacheIsFresh = lastFetched && (now - parseInt(lastFetched, 10) < SEVEN_DAYS_MS);

        let json;

        if (cacheIsFresh && cachedData) {
            console.log("Cache is less than 7 days old. Using cached data.");
            json = JSON.parse(cachedData);
        } else {
            console.log("Cache expired or missing. Fetching fresh data from Google Sheets...");
            if (setStatusCallback) setStatusCallback("muted", `Fetching data from Google Sheets… <span class="spinner"></span>`);
            const resp = await fetch(`${GOOGLE_SCRIPT_URL}?action=getData`);
            if (!resp.ok) throw new Error(`Fetch failed (${resp.status})`);

            json = await resp.json();
            console.log("Received fresh data:", json);

            try {
                localStorage.setItem('routeDashboardData', JSON.stringify(json));
                localStorage.setItem('routeDashboardLastFetched', Date.now().toString());
            } catch (e) {
                console.warn("Could not save to localStorage (quota exceeded?)", e);
            }
        }

        processSheets(json);

        if (setStatusCallback) setStatusCallback("ok", `Loaded ${state.DATA.length.toLocaleString()} rows.`);
        if (callback) callback();
    } catch (err) {
        // Fallback to cache if error
        const cachedData = localStorage.getItem('routeDashboardData');
        if (cachedData) {
            console.log("Fallback to cached data due to error", err);
            try {
                processSheets(JSON.parse(cachedData));
                if (setStatusCallback) setStatusCallback("ok", `Loaded ${state.DATA.length.toLocaleString()} rows (Offline Mode).`);
                if (callback) callback();
                return;
            } catch (e) {
                console.warn("Failed to parse cached data", e);
            }
        }

        if (setStatusCallback) setStatusCallback("error", `Could not load data. ${err.message}`);
        console.error("Data Load Error:", err);
        state.DATA = [];
        if (callback) callback();
    }
}

function processSheets(data) {
    // data.sheet1 is the source of truth now
    const sheet1 = data.sheet1 || [];

    // Sheet3 logic (synonyms) - mostly skipped in GAS for now, or we can add it later.
    state.synonyms = new Map();
    state.SYN_TOKEN = new Map();
    state.SYN_GROUPS = [];

    try {
        processSynonyms(data.sheet3 || []); // "search" sheet data
    } catch (e) {
        console.warn("Synonym processing failed:", e);
    }

    // Direct mapping of Sheet1 to state.DATA
    // We assume Sheet1 has all columns: Route, YARD, STREETSORT, coordinates, 6 car, 4 car, 2 car

    // Helper to find column case-insensitively if needed, though usually keys are stable
    const findCol = (row, name) => Object.keys(row).find(k => k.toLowerCase().includes(name.toLowerCase()));

    const processed = [];
    if (sheet1.length > 0) {
        // Detect keys once
        const ex = sheet1[0];
        const routeKey = ("Route" in ex) ? "Route" : Object.keys(ex)[0]; // First col usually Route
        const yardKey = ("YARD" in ex) ? "YARD" : (findCol(ex, "yard") || "YARD");
        const streetKey = ("STREETSORT" in ex) ? "STREETSORT" : (findCol(ex, "street") || "STREETSORT");

        // Plan keys: "6 car", "4 car", "2 car" (or "1 car", "3 car", "5 car")
        const plans = ["6 car", "5 car", "4 car", "3 car", "2 car", "1 car"];
        const planKeys = {};
        plans.forEach(p => {
            planKeys[p] = (p in ex) ? p : (findCol(ex, p) || p);
        });

        for (const r of sheet1) {
            const route = Number(r[routeKey]);
            if (!Number.isFinite(route)) continue;

            const out = {
                Route: route,
                YARD: r[yardKey] ? safeDecode(r[yardKey]) : null,
                STREETSORT: r[streetKey] ? safeDecode(r[streetKey]) : null,
                _RAW_STREET: r[streetKey], // Keep original for updates
                coordinates: r.coordinates ? safeDecode(String(r.coordinates)) : null,
            };

            // Map plans
            plans.forEach(p => {
                out[p] = r[planKeys[p]] ?? null;
            });

            const { lat, lon } = parseCoord(out.coordinates);
            out.lat = lat; out.lon = lon;

            processed.push(out);
        }
    }

    state.DATA = processed;
}

function processSynonyms(sheet3) {
    const addTokenSyn = (a, b) => {
        if (!a || !b) return;
        if (!state.SYN_TOKEN.has(a)) state.SYN_TOKEN.set(a, new Set([a]));
        if (!state.SYN_TOKEN.has(b)) state.SYN_TOKEN.set(b, new Set([b]));
        state.SYN_TOKEN.get(a).add(b);
        state.SYN_TOKEN.get(b).add(a);
    };

    for (const row of sheet3) {
        const phrases = Object.values(row)
            .map(v => v === null || v === undefined ? "" : String(v))
            .map(v => normalizeForTokens(v))
            .filter(v => v);

        if (phrases.length < 2) continue;
        const uniq = Array.from(new Set(phrases));

        // Simple single-token synonyms
        for (const term of uniq) {
            state.synonyms.set(term, uniq);
        }

        const tokSet = new Set();
        for (const ph of uniq) {
            for (const t of ph.split(" ").filter(Boolean)) {
                if (t !== "AND") tokSet.add(t);
            }
        }

        // Best-effort direct token pair if the row is exactly two single tokens
        if (uniq.length === 2) {
            const aT = uniq[0].split(" ").filter(Boolean);
            const bT = uniq[1].split(" ").filter(Boolean);
            if (aT.length === 1 && bT.length === 1) {
                addTokenSyn(aT[0], bT[0]);
            }
        }

        state.SYN_GROUPS.push({ phrases: uniq, tokens: tokSet });
    }
}

function parseCoord(s) {
    if (s === null || s === undefined) return { lat: null, lon: null };
    const txt = String(s).trim().replace(/,+\s*$/, "");
    const parts = txt.split(",").map(x => x.trim()).filter(Boolean);
    if (parts.length < 2) return { lat: null, lon: null };
    const lat = Number(parts[0]);
    const lon = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { lat: null, lon: null };
    return { lat, lon };
}

function buildHaystack(r) {
    const raw = (r.Route ?? "").toString();
    const digits = raw.replace(/\D/g, "");
    const padded = (digits || raw).toString().padStart(5, "0");
    return normalizeForTokens(`${padded} ${digits || raw} ${r.YARD ?? ""} ${r.STREETSORT ?? ""}`);
}

function queryMode(q) {
    const norm = normalizeForTokens(q);
    if (!norm) return "all";
    const hasLetter = /[A-Z]/.test(norm);
    const hasDigit = /[0-9]/.test(norm);
    if (!hasLetter && hasDigit) return "numeric";
    return "alpha";
}

function haystackForMode(r, mode) {
    if (mode === "numeric") {
        const route = formatRoute(r.Route);
        return normalizeForTokens(`${route} ${r.STREETSORT ?? ""}`);
    }
    if (mode === "alpha") {
        return normalizeForTokens(`${r.STREETSORT ?? ""}`);
    }
    return buildHaystack(r);
}

function tokenizeQuery(q) {
    const qNorm = normalizeForTokens(q);
    return qNorm.split(" ").filter(Boolean).filter(t => t !== "AND");
}

function tokenMatch(query, haystack) {
    if (!query) return true;
    const tokens = tokenizeQuery(query);
    if (!tokens.length) return true;
    return tokens.every(t => {
        const alts = state.synonyms.get(t) || [t];
        return alts.some(a => haystack.includes(a));
    });
}

function haversineMiles(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 3958.7613;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}



function calculateScore(item, query, mode) {
    const haystack = haystackForMode(item, mode);
    const tokens = tokenizeQuery(query);
    let totalScore = 0;

    for (const token of tokens) {
        const alts = state.synonyms.get(token) || [token];
        let bestScoreForToken = -10000;

        // Find the best match among synonyms for this token
        let foundAny = false;
        for (const alt of alts) {
            // Find all occurrences of this token as a complete word
            const haystackTokens = haystack.split(' ');

            for (let i = 0; i < haystackTokens.length; i++) {
                const haystackToken = haystackTokens[i];

                // Check if the haystack token starts with the search token
                if (haystackToken.startsWith(alt)) {
                    foundAny = true;

                    // Calculate the character position in the original haystack
                    const charPos = haystackTokens.slice(0, i).join(' ').length + (i > 0 ? 1 : 0);

                    let score = 0;

                    // 1. Bonus for start of string
                    if (charPos === 0) score += 1000;
                    // 2. Bonus for word boundary (which all these are by definition)
                    else score += 500;

                    // 3. Bonus for exact match (not just prefix)
                    if (haystackToken === alt) score += 100;

                    // 4. Penalty for distance from start
                    score -= charPos;

                    if (score > bestScoreForToken) bestScoreForToken = score;
                }
            }
        }

        // If the token matches (it should, because we filtered), add to total
        if (foundAny) {
            totalScore += bestScoreForToken;
        }
    }
    return totalScore;
}


export function computeMatches() {
    state.nearMode = false;
    state.nearSorted = [];
    state.nearIndex = 0;

    const q = state.query;

    // User Requirement: Don't show results before adding at least 2 letters
    if (q.trim().length < 2) {
        state.matches = [];
        state.shown = 0;
        return;
    }

    const mode = queryMode(q);

    // 1. Filter
    const filtered = state.DATA.filter(r => tokenMatch(q, haystackForMode(r, mode)));

    // 2. Score and Sort
    // We map to an object to avoid recalculating scores repeatedly during sort
    const scored = filtered.map(r => ({
        data: r,
        score: calculateScore(r, q, mode)
    }));

    scored.sort((a, b) => b.score - a.score);

    state.matches = scored.map(s => s.data);
    state.shown = 0;
}

export function searchNearMe(setStatusCallback, renderCallback) {
    if (!navigator.geolocation) {
        setStatusCallback("error", "Geolocation not supported in this browser.");
        return;
    }
    setStatusCallback("muted", `Searching near you… <span class="spinner"></span>`);
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            state.userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };

            const withDist = state.DATA
                .filter(r => typeof r.lat === "number" && typeof r.lon === "number")
                .map(r => ({ r, d: haversineMiles(state.userPos.lat, state.userPos.lon, r.lat, r.lon) }))
                .sort((a, b) => a.d - b.d);

            state.nearMode = true;
            state.nearSorted = withDist;
            state.nearIndex = 0;

            const lat = state.userPos.lat.toFixed(6);
            const lon = state.userPos.lon.toFixed(6);
            const acc = (state.userPos.accuracy ?? 0).toFixed(0);
            setStatusCallback("ok", `Captured your location: <b>${lat}, ${lon}</b> (±${acc} m).`);

            state.expandedRoutes.clear();
            renderCallback();
        },
        (err) => setStatusCallback("error", `Could not get your location: ${escapeHtml(err.message)}`),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
}

export async function adminForceUpdate(setStatusCallback) {
    if (setStatusCallback) setStatusCallback("muted", `Publishing update to clients… <span class="spinner"></span>`);
    try {
        const { GOOGLE_SCRIPT_URL, JSONBIN_BIN_ID, JSONBIN_API_KEY } = await import('./config.js');

        if (JSONBIN_BIN_ID === "YOUR_BIN_ID_HERE") {
            throw new Error("JSONBin is not configured in config.js");
        }

        const newVersion = new Date().getTime().toString();

        // 1. Tell JSONBin to bump the global version
        const respVersion = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': JSONBIN_API_KEY
            },
            body: JSON.stringify({ version: newVersion })
        });
        if (!respVersion.ok) throw new Error(`Version update failed (${respVersion.status})`);

        // 2. Actually fetch the freshly updated data for the cache
        const respData = await fetch(`${GOOGLE_SCRIPT_URL}?action=getData`);
        if (!respData.ok) throw new Error(`Fetch failed (${respData.status})`);

        const json = await respData.json();

        // 3. Update the local cache with the new data
        localStorage.setItem('routeDashboardData', JSON.stringify(json));

        // 4. Update the local version tag to match what we just published
        localStorage.setItem('routeDashboardVersion', newVersion);

        if (setStatusCallback) setStatusCallback("ok", `Update published. Clients will refresh their data on next load.`);
    } catch (err) {
        if (setStatusCallback) setStatusCallback("error", `Failed to publish update: ${err.message}`);
        console.error("Force update failed:", err);
    }
}

export async function userForceFetch(setStatusCallback, renderCallback) {
    if (setStatusCallback) setStatusCallback("muted", `Force fetching live data from Google Sheets… <span class="spinner"></span>`);
    try {
        const { GOOGLE_SCRIPT_URL } = await import('./config.js');

        const respData = await fetch(`${GOOGLE_SCRIPT_URL}?action=getData`);
        if (!respData.ok) throw new Error(`Fetch failed (${respData.status})`);

        const json = await respData.json();

        const newVersionResp = await fetch(`${GOOGLE_SCRIPT_URL}?action=getVersion`);
        if (newVersionResp.ok) {
            const newVersion = await newVersionResp.text();
            localStorage.setItem('routeDashboardVersion', newVersion);
        }

        localStorage.setItem('routeDashboardData', JSON.stringify(json));
        localStorage.setItem('routeDashboardLastFetched', Date.now().toString());

        processSheets(json);
        if (setStatusCallback) setStatusCallback("ok", `Loaded ${state.DATA.length.toLocaleString()} fresh rows directly from server.`);
        if (renderCallback) renderCallback();

    } catch (err) {
        if (setStatusCallback) setStatusCallback("error", `Force fetch failed: ${err.message}`);
        console.error("User Force Fetch error:", err);
    }
}
