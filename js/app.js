import { state, loadWorkbook, computeMatches, searchNearMe, userForceFetch } from './data.js';
import { setStatus, updateCounts, renderNext, renderNextNear, renderRows, updateCarHeader } from './ui.js';
import { escapeHtml } from './utils.js';
import { logSearch } from './logger.js';

let logTimeout;

const $ = (id) => document.getElementById(id);
const EXCEL_FILE = null; // Deprecated - using Google Sheets via config.js

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        setStatus("ok", `Copied: <b>${escapeHtml(text)}</b>`);
        setTimeout(() => setStatus("", ""), 1100);
    } catch (e) {
        // Fallback for some browsers
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        setStatus("ok", `Copied: <b>${escapeHtml(text)}</b>`);
        setTimeout(() => setStatus("", ""), 1100);
    }
}

function handleTableClick(e) {
    // Route click -> copy padded route
    const routeWrap = e.target.closest("[data-route-click]");
    if (routeWrap) {
        const route = routeWrap.getAttribute("data-route-click");
        if (route) copyText(String(route));
        return;
    }

    // Streetsort copy button
    const btn = e.target.closest("button");
    if (btn) {
        const copyRouteStreet = btn.getAttribute("data-copy-route-street");
        if (copyRouteStreet !== null) {
            const parts = String(copyRouteStreet).split("|");
            const route = parts[0];
            const street = parts[1];
            const lat = parts[2];
            const lon = parts[3];

            let textToCopy = "";
            let htmlToCopy = "";

            // Check if we are on the Report page
            if (document.body.classList.contains('report-mode')) {
                // Format: Date Route Street (e.g., "2/3 27128 Anaheim st & farragut av")
                const now = new Date();
                const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;

                // Add new lines as requested
                textToCopy = `${dateStr}\n${route}\n${street}`.trim();
            } else {
                // Home Page: Copy only intersection
                textToCopy = street.trim();
            }

            // If we have coordinates, create a hyperlink
            if (lat && lon && lat !== "undefined" && lon !== "undefined") {
                const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
                const htmlSafeText = escapeHtml(textToCopy).replace(/\n/g, "<br>");
                htmlToCopy = `<a href="${url}">${htmlSafeText}</a>`;

                // Use Clipboard API for rich text
                try {
                    const blobHtml = new Blob([htmlToCopy], { type: "text/html" });
                    const blobText = new Blob([textToCopy], { type: "text/plain" });
                    const data = [new ClipboardItem({
                        "text/html": blobHtml,
                        "text/plain": blobText
                    })];

                    navigator.clipboard.write(data).then(() => {
                        setStatus("ok", `Copied (with link): <b>${escapeHtml(textToCopy)}</b>`);
                        setTimeout(() => setStatus("", ""), 1100);
                    }).catch(err => {
                        console.error("Clipboard write failed:", err);
                        // Fallback to plain text copy
                        copyText(textToCopy);
                    });
                    return;
                } catch (e) {
                    console.error("Clipboard API error:", e);
                    // Fallback to plain text copy
                    copyText(textToCopy);
                }
            } else {
                copyText(textToCopy);
            }
            return;
        }
    }

    // Yard click -> toggle expansion
    const toggleWrap = e.target.closest("[data-toggle]");
    if (toggleWrap) {
        const key = String(toggleWrap.getAttribute("data-toggle"));
        if (state.expandedRoutes.has(key)) state.expandedRoutes.delete(key);
        else state.expandedRoutes.add(key);

        $("tbody").innerHTML = "";
        if (state.nearMode) {
            // Re-render near view partial
            const shown = state.nearSorted.slice(0, state.nearIndex).map(x => x.r);
            renderRows(shown, false);
        } else {
            // Re-render matches
            const shown = state.matches.slice(0, state.shown);
            renderRows(shown, false);
        }
    }
}

// Event Listeners
$("q").addEventListener("input", (e) => {
    state.query = e.target.value || "";
    state.userPos = null;
    setStatus("", "");
    computeMatches();

    if (state.query.trim().length < 2) {
        $("tbody").innerHTML = "";
        document.querySelector(".card").style.display = "none";
        document.querySelector("header").classList.add("empty-state");
        $("btnMore").disabled = true;
        $("shownNote").textContent = "Type at least 2 letters to search";
    } else {
        document.querySelector(".card").style.display = "block";
        document.querySelector("header").classList.remove("empty-state");
        renderNext(true); // Re-render with new matches
    }

    // Logging with debounce (wait 2s after typing stops)
    clearTimeout(logTimeout);
    if (state.query.trim().length >= 2) {
        logTimeout = setTimeout(() => {
            const top = state.matches.length > 0 ? state.matches[0] : null;
            logSearch(state.query, { topResult: top });
        }, 2000);
    }
});

$("btnMore").addEventListener("click", () => {
    if (state.nearMode) renderNextNear();
    else renderNext(false);
});

$("btnNear").addEventListener("click", () => {
    searchNearMe(setStatus, () => {
        document.querySelector(".card").style.display = "block";
        document.querySelector("header").classList.remove("empty-state");
        $("tbody").innerHTML = "";
        renderNextNear();

        // Log the location search
        if (state.userPos) {
            const top = state.nearSorted.length > 0 ? state.nearSorted[0].r : null;
            logSearch("Search Near Me", {
                topResult: top,
                location: state.userPos,
                intersection: top ? top.STREETSORT : "Unknown"
            });
        }
    });
});

document.querySelector("h1").addEventListener("dblclick", () => {
    userForceFetch(setStatus, () => {
        updateCounts();
        updateCarHeader();
        computeMatches();
        if (state.query && state.query.trim().length >= 2) {
            document.querySelector(".card").style.display = "block";
            document.querySelector("header").classList.remove("empty-state");
            renderNext(true);
        } else if (state.nearMode && state.userPos) {
            document.querySelector(".card").style.display = "block";
            document.querySelector("header").classList.remove("empty-state");
            $("tbody").innerHTML = "";
            renderNextNear();
        } else {
            document.querySelector(".card").style.display = "none";
            document.querySelector("header").classList.add("empty-state");
            $("tbody").innerHTML = "";
            $("btnMore").disabled = true;
            $("shownNote").textContent = "Data force fetched. Ready to search.";
        }
    });
});

$("tbody").addEventListener("click", handleTableClick);

// Init
loadWorkbook(false, setStatus, () => {
    updateCounts();
    updateCarHeader(); // Dynamic header text
    computeMatches();

    if (state.query && state.query.trim().length >= 2) {
        document.querySelector(".card").style.display = "block";
        document.querySelector("header").classList.remove("empty-state");
        renderNext(true);
    } else {
        document.querySelector(".card").style.display = "none";
        document.querySelector("header").classList.add("empty-state");
        $("tbody").innerHTML = "";
        $("btnMore").disabled = true;
        $("shownNote").textContent = "Type at least 2 letters to search or use Location";
    }
});
