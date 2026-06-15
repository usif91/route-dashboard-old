import { state } from './data.js';
import { formatVal, formatRoute, escapeHtml } from './utils.js';

function $(id) { return document.getElementById(id); }

export function setStatus(kind, msgHtml) {
  const el = $("status");
  if (!msgHtml) { el.textContent = ""; return; }
  el.innerHTML = `<div class="${kind} pill">${msgHtml}</div>`;
}

export function updateCounts() {
  // Elements removed from UI as per user request
}

function mapsDirUrl(lat, lon) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

export function getHighlightedPlanKey() {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const t630 = 6 * 60 + 30;
  const t1430 = 14 * 60 + 30;
  const t2230 = 22 * 60 + 30;

  if (mins >= t630 && mins < t1430) return "6 car";
  if (mins >= t1430 && mins < t2230) return "4 car";
  return "2 car";
}

export function updateCarHeader() {
  const el = $("th-plan");
  if (!el) return;
  const key = getHighlightedPlanKey();
  // key is "6 car", "4 car", etc. We want "6 Car"
  const formatted = key.charAt(0).toUpperCase() + key.slice(1).replace("car", "Car");
  el.textContent = formatted;
}

function showNoMatch() {
  const tbody = $("tbody");
  tbody.innerHTML = `<tr class="zebra-even"><td colspan="3" style="padding:18px 10px; white-space:normal;">Sorry, we didn\'t find any match.</td></tr>`;
}

export function renderRows(rows, append = false) {
  const tbody = $("tbody");
  if (!append) tbody.innerHTML = "";

  const hiKey = getHighlightedPlanKey();
  let zebraIndex = 0;

  for (const r of rows) {
    const zebraClass = (zebraIndex % 2 === 0) ? "zebra-even" : "zebra-odd";
    zebraIndex++;

    const isExpanded = state.expandedRoutes.has(String(r.Route));

    const routeCell = `
            <div class="cell-flex clickable" data-route-click="${formatRoute(r.Route)}" title="Tap to copy route">
              <span>${formatRoute(r.Route)}</span>
            </div>
          `;

    const planValue = r[hiKey];
    const displayValue = (planValue !== null && planValue !== undefined && planValue !== "") ? planValue : r.YARD;
    const cellTitle = (planValue) ? `Current Plan (${hiKey})` : "Yard";

    const yardCell = `
            <div class="cell-flex clickable" data-toggle="${escapeHtml(r.Route)}" title="Tap to expand/collapse. Showing: ${cellTitle}">
              <span>${formatVal(displayValue)}</span>
            </div>
          `;

    const hasCoords = (typeof r.lat === "number" && typeof r.lon === "number");
    const streetLink = hasCoords
      ? `<a class="link" href="${mapsDirUrl(r.lat, r.lon)}" target="_blank" rel="noopener">${formatVal(r.STREETSORT)}</a>`
      : `${formatVal(r.STREETSORT)}`;

    const streetCell = `
            <div class="cell-flex" style="width:100%;">
              <span>${streetLink}</span>
              <button class="icon-btn" title="Copy route + streetsort" data-copy-route-street="${formatRoute(r.Route)}|${escapeHtml(r.STREETSORT ?? "")}|${r.lat}|${r.lon}">⧉</button>
            </div>
          `;

    const tr = document.createElement("tr");
    tr.className = zebraClass;
    tr.classList.add("data-row");
    tr.setAttribute("data-json", JSON.stringify(r));
    tr.innerHTML = `<td>${routeCell}</td><td>${yardCell}</td><td>${streetCell}</td>`;
    tbody.appendChild(tr);

    const detailTr = document.createElement("tr");
    detailTr.className = `detail-row ${zebraClass}`;
    detailTr.style.display = isExpanded ? "" : "none";

    const cols = ["6 car", "5 car", "4 car", "3 car", "2 car"];
    const ths = cols.map(c => `<th>${escapeHtml(c)}</th>`).join("");
    const tds = cols.map(c => {
      const cls = (c === hiKey) ? "highlight" : "";
      return `<td class="${cls}">${formatVal(r[c])}</td>`;
    }).join("");

    detailTr.innerHTML = `
            <td colspan="3">
              <div class="detail-box">
                <table class="mini">
                  <thead><tr>${ths}</tr></thead>
                  <tbody><tr>${tds}</tr></tbody>
                </table>
              </div>
            </td>
          `;
    tbody.appendChild(detailTr);
  }
}

export function renderNext(clear = false) {
  const start = state.shown;
  const end = Math.min(state.shown + state.pageSize, state.matches.length);
  const chunk = state.matches.slice(start, end);

  if (state.matches.length === 0 && clear) {
    showNoMatch();
    state.shown = 0;
    $("btnMore").disabled = true;
    $("shownNote").textContent = "0 matches";
    return;
  }
  renderRows(chunk, !clear);
  state.shown = end;

  $("btnMore").disabled = state.shown >= state.matches.length;
  $("shownNote").textContent = state.matches.length
    ? `Showing ${state.shown.toLocaleString()} of ${state.matches.length.toLocaleString()}`
    : `No matches`;
}

export function renderNextNear() {
  const start = state.nearIndex;
  const end = Math.min(state.nearIndex + state.nearPageSize, state.nearSorted.length);
  const chunk = state.nearSorted.slice(start, end).map(x => {
    const r = { ...x.r };
    r.__distance = x.d;
    return r;
  });

  if (state.nearSorted.length === 0 && start === 0) {
    showNoMatch();
    state.nearIndex = 0;
    $("btnMore").disabled = true;
    $("shownNote").textContent = "0 matches";
    return;
  }
  renderRows(chunk, start !== 0);
  state.nearIndex = end;

  $("btnMore").disabled = state.nearIndex >= state.nearSorted.length;
  $("shownNote").textContent = state.nearSorted.length
    ? `Showing ${Math.min(state.nearIndex, state.nearSorted.length)} of ${state.nearSorted.length} nearest`
    : `No coordinate rows found`;
  updateCounts(); // Ensure counts update for near mode
}
