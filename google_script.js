function doGet(e) {
    const action = e.parameter.action;

    if (action === "getVersion") {
        return ContentService.createTextOutput(PropertiesService.getScriptProperties().getProperty("dataVersion") || "0").setMimeType(ContentService.MimeType.TEXT);
    }

    if (action === "getNicknames") {
        return getNicknames();
    }

    if (action === "getReports") {
        return getReports();
    }

    if (action === "getLogs") {
        return getLogs();
    }

    if (action === "setNickname") {
        return setNickname(e);
    }

    // Default to getData if no action specified (for robustness)
    return getData();
}

function setNickname(e) {
    const deviceId = e.parameter.deviceId;
    const nickname = e.parameter.nickname;
    if (!deviceId) return ContentService.createTextOutput("Missing deviceId").setMimeType(ContentService.MimeType.TEXT);

    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("nicknames");
    if (!sheet) {
        sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("nicknames");
        sheet.appendRow(["Device ID", "Nickname"]);
    }

    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;

    // Find existing row (skip header)
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(deviceId)) {
            rowIndex = i;
            break;
        }
    }

    if (rowIndex !== -1) {
        if (nickname) {
            sheet.getRange(rowIndex + 1, 2).setValue(nickname);
        } else {
            sheet.deleteRow(rowIndex + 1);
        }
    } else if (nickname) {
        sheet.appendRow([deviceId, nickname]);
    }

    return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
    // Handle POST requests
    // e.postData.contents is the raw body
    let data;
    try {
        data = JSON.parse(e.postData.contents);
    } catch (err) {
        return ContentService.createTextOutput("Invalid JSON").setMimeType(ContentService.MimeType.TEXT);
    }

    const action = e.parameter.action || data.action;

    if (action === "submitReport") {
        return submitReport(data);
    }

    if (action === "resolveReport") {
        return resolveReport(data);
    }

    if (action === "getReports") {
        return getReports();
    }

    if (action === "log") {
        return logSearch(data);
    }

    if (action === "updateData") {
        return updateData(data);
    }

    if (action === "forceUpdateVersion") {
        PropertiesService.getScriptProperties().setProperty("dataVersion", new Date().getTime().toString());
        return ContentService.createTextOutput("Version updated").setMimeType(ContentService.MimeType.TEXT);
    }

    return ContentService.createTextOutput("Unknown action").setMimeType(ContentService.MimeType.TEXT);
}

// --- EXISTING LOGGING LOGIC (Preserved) ---

function getLogs() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("logs");
    if (!sheet) {
        return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
        return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
    }

    const headers = data[0];
    const rows = data.slice(1);

    // Convert to array of objects
    const result = rows.map(row => {
        let obj = {};
        headers.forEach((h, i) => {
            // Convert header to camelCase or simple lowercase
            let key = h.toLowerCase().replace(/ /g, "");
            if (key === "timestamp") obj.timestamp = row[i];
            else if (key === "source") obj.source = row[i];
            else if (key === "user" || key === "deviceid") obj.user = row[i];
            else if (key === "query") obj.query = row[i];
            else if (key === "topresult" || key === "topresultsummary") obj.topResultSummary = row[i];
            else if (key === "intersection") obj.intersection = row[i];
            else if (key === "location") obj.location = row[i];
            else if (key === "6car") obj.sixCar = row[i];
            else obj[key] = row[i];
        });
        return obj;
    }).reverse(); // Newest first

    return ContentService
        .createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
}

function logSearch(data) {
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("logs");
    if (!sheet) {
        sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("logs");
        sheet.appendRow(["Timestamp", "Source ", "User ", "Query ", "Top Result", "Intersection ", "Location ", "6 Car"]);
    } else {
        const firstCell = sheet.getRange(1, 1).getValue();
        if (firstCell !== "Timestamp") {
            sheet.insertRowBefore(1);
            sheet.getRange(1, 1, 1, 8).setValues([["Timestamp", "Source ", "User ", "Query ", "Top Result", "Intersection ", "Location ", "6 Car"]]);
        }
    }

    const timestamp = new Date();

    sheet.appendRow([
        timestamp,
        data.source || "",
        data.user || "",
        data.query || "",
        data.topResultSummary || "",
        data.intersection || "",
        data.location || "",
        data.sixCar || ""
    ]);

    return ContentService.createTextOutput("Log recorded").setMimeType(ContentService.MimeType.TEXT);
}

// --- NEW REPORTING LOGIC ---

function submitReport(data) {
    // Requires a sheet named "Reports"
    // Columns: [Timestamp, Status, Route, Intersection, Lat, Lon, ProblemType, Details, LocationNotes, AdditionalNotes, DeviceID]
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Reports");
    if (!sheet) {
        sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("Reports");
        sheet.appendRow(["Timestamp", "Status", "Route", "Intersection", "Lat", "Lon", "ProblemType", "Details", "LocationNotes", "AdditionalNotes", "DeviceID"]);
    } else {
        // Self-healing: If sheet exists but has no headers, insert them
        const firstCell = sheet.getRange(1, 1).getValue();
        if (firstCell !== "Timestamp") {
            sheet.insertRowBefore(1);
            sheet.getRange(1, 1, 1, 11).setValues([["Timestamp", "Status", "Route", "Intersection", "Lat", "Lon", "ProblemType", "Details", "LocationNotes", "AdditionalNotes", "DeviceID"]]);
        }
    }

    const timestamp = new Date();
    sheet.appendRow([
        timestamp,
        "Open",
        data.route || "",
        data.intersection || "",
        data.lat || "",
        data.lon || "",
        data.problemType || "",
        data.details || "",
        data.locationNotes || "",
        data.additionalNotes || "",
        data.deviceId || "Unknown"
    ]);

    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Report submitted" })).setMimeType(ContentService.MimeType.JSON);
}

function getReports() {
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Reports");
    if (!sheet) {
        return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
    }

    // Self-healing check for getReports as well
    if (sheet.getLastRow() > 0) {
        const firstCell = sheet.getRange(1, 1).getValue();
        if (firstCell !== "Timestamp") {
            sheet.insertRowBefore(1);
            sheet.getRange(1, 1, 1, 11).setValues([["Timestamp", "Status", "Route", "Intersection", "Lat", "Lon", "ProblemType", "Details", "LocationNotes", "AdditionalNotes", "DeviceID"]]);
        }
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
        return ContentService.createTextOutput("[]").setMimeType(ContentService.MimeType.JSON);
    }

    const headers = data[0];
    const results = [];

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const statusIndex = headers.indexOf("Status");

        // Only return Open reports
        if (statusIndex !== -1 && row[statusIndex] !== "Open") {
            continue;
        }

        const obj = {};
        for (let j = 0; j < headers.length; j++) {
            let val = row[j];
            // Format dates nicely
            if (val instanceof Date) {
                val = val.toLocaleString();
            }
            obj[headers[j]] = val;
        }
        // Save the row index so clients can target it for resolution
        obj._rowIndex = i + 1;
        results.push(obj);
    }

    return ContentService.createTextOutput(JSON.stringify(results)).setMimeType(ContentService.MimeType.JSON);
}

function resolveReport(data) {
    const rowIndex = parseInt(data.rowIndex, 10);
    if (!rowIndex || isNaN(rowIndex)) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Invalid row index" })).setMimeType(ContentService.MimeType.JSON);
    }

    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Reports");
    if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Reports sheet not found" })).setMimeType(ContentService.MimeType.JSON);
    }

    // Check self-healing to prevent off-by-one errors
    const firstCell = sheet.getRange(1, 1).getValue();
    if (firstCell !== "Timestamp") {
        sheet.insertRowBefore(1);
        sheet.getRange(1, 1, 1, 11).setValues([["Timestamp", "Status", "Route", "Intersection", "Lat", "Lon", "ProblemType", "Details", "LocationNotes", "AdditionalNotes", "DeviceID"]]);
    }

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const statusColIndex = headers.indexOf("Status") + 1; // 1-indexed

    if (statusColIndex > 0) {
        sheet.getRange(rowIndex, statusColIndex).setValue("Resolved");
        return ContentService.createTextOutput(JSON.stringify({ success: true, message: "Report resolved" })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Could not find Status column" })).setMimeType(ContentService.MimeType.JSON);
}

function getNicknames() {
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("nicknames");
    if (!sheet) return ContentService.createTextOutput("{}").setMimeType(ContentService.MimeType.JSON);

    const data = sheet.getDataRange().getValues();
    const map = {};
    // Skip header
    for (let i = 1; i < data.length; i++) {
        map[data[i][0]] = data[i][1];
    }

    return ContentService.createTextOutput(JSON.stringify(map)).setMimeType(ContentService.MimeType.JSON);
}


// --- NEW DATA (INTERSECTIONS) LOGIC ---

function getData() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet1 = ss.getSheetByName("data");
    const sheet3 = ss.getSheetByName("search"); // "search" sheet maps to old "sheet3" (synonyms)

    const data1 = sheet1 ? sheet1.getDataRange().getValues() : [];
    const data3 = sheet3 ? sheet3.getDataRange().getValues() : [];

    // We need to return the raw arrays so the frontend can proces them (mergeSheets logic)
    // OR we can merge them here. Merging here reduces frontend complexity.

    const result = {
        sheet1: arrayToObjects(data1), // Main Data
        sheet3: arrayToObjects(data3)  // Synonyms (Search)
    };

    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function safeDecode(val) {
    if (val === null || val === undefined) return val;
    if (typeof val !== "string") return val;
    try {
        var decoded = decodeURIComponent(val);
        // Handle double-encoding
        if (decoded.indexOf("%") !== -1) {
            try { decoded = decodeURIComponent(decoded); } catch (e) { }
        }
        return decoded;
    } catch (e) { return val; }
}

function arrayToObjects(data) {
    if (!data || data.length === 0) return [];
    const headers = data[0];
    return data.slice(1).map(row => {
        let obj = {};
        headers.forEach((h, i) => {
            obj[h] = safeDecode(row[i]);
        });
        return obj;
    });
}

function updateData(req) {
    // req: { route: 123, intersection: "1ST ST", updates: { name, coordinates, plans: {...} } }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet1 = ss.getSheetByName("data");

    if (!sheet1) return ContentService.createTextOutput("Sheet 'data' not found").setMimeType(ContentService.MimeType.TEXT);

    const data = sheet1.getDataRange().getValues();
    const headers = data[0];

    // Find column indices
    const routeIdx = headers.findIndex(h => h.toLowerCase() === "route");
    const streetIdx = headers.findIndex(h => h.toLowerCase().includes("street") || h === "STREETSORT");
    const coordIdx = headers.findIndex(h => h.toLowerCase().includes("coord"));
    // Plan columns (6 car, 4 car, etc) might be in Sheet1 or Sheet2.
    // The data.js merge logic implies plans are in Sheet2 usually, or mixed.
    // We need to check where the keys are.

    let rowIdx = -1;

    // Find the row matches route and street (using original name)
    for (let i = 1; i < data.length; i++) {
        const rRoute = data[i][routeIdx];
        const rStreet = data[i][streetIdx];

        // Loose comparison for route, strict for street
        if (String(rRoute) == String(req.route) && rStreet === req.intersection) {
            rowIdx = i;
            break;
        }
    }

    if (rowIdx === -1) {
        return ContentService.createTextOutput("Row not found").setMimeType(ContentService.MimeType.TEXT).setStatusCode(404);
    }

    // Update Sheet1
    if (req.updates.name !== undefined && streetIdx !== -1) {
        sheet1.getRange(rowIdx + 1, streetIdx + 1).setValue(req.updates.name);
    }
    if (req.updates.coordinates !== undefined && coordIdx !== -1) {
        sheet1.getRange(rowIdx + 1, coordIdx + 1).setValue(req.updates.coordinates);
    }

    // If plans are in Sheet1, update them. If in Sheet2, update there.
    // For simplicity, we try finding columns in Sheet1 first.
    if (req.updates.plans) {
        for (const [key, val] of Object.entries(req.updates.plans)) {
            // key is "6 car", "4 car" etc.
            let colIdx = headers.findIndex(h => h.toLowerCase() === key.toLowerCase() || h.toLowerCase().includes(key.toLowerCase()));
            if (colIdx !== -1) {
                sheet1.getRange(rowIdx + 1, colIdx + 1).setValue(val);
            } else {
                // Check Sheet2 (search)
                updateSheet2(ss, req.route, key, val);
            }
        }
    }

    PropertiesService.getScriptProperties().setProperty("dataVersion", new Date().getTime().toString());

    return ContentService.createTextOutput("Updated").setMimeType(ContentService.MimeType.TEXT);
}

function updateSheet2(ss, route, planKey, value) {
    const sheet2 = ss.getSheetByName("search"); // Updated to 'search'
    if (!sheet2) return;

    const data = sheet2.getDataRange().getValues();
    const headers = data[0];
    const routeIdx = headers.findIndex(h => h.toLowerCase() === "route");

    // Find column for planKey (e.g. "1" for "1 car", or "6" for "6 car" if headers are just numbers)
    // Mapping keys "6 car" -> "6", "4 car" -> "4" might be needed based on sheet structure
    // We try fuzzy matching header
    const digit = planKey.replace(/\D/g, "");
    const colIdx = headers.findIndex(h => {
        const s = String(h).toLowerCase();
        return s === digit || s === `${digit}.0` || (s.includes(digit) && s.includes("car"));
    });

    if (colIdx === -1 || routeIdx === -1) return;

    // Find row
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][routeIdx]) == String(route)) {
            sheet2.getRange(i + 1, colIdx + 1).setValue(value);
            return;
        }
    }
}
