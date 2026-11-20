import { subscribeCached } from "./firebase.js";
import { renderTopNav, escapeHtml, formatConditionalActivityBadge, getHiddenVaSet } from "./schedule.js";

renderTopNav("hubstaff");

let currentViewMode = "sessions";
let timeOffFilterMode = "approved";
let allFirebaseRows = [];
let pastedRows = [];
let isUsingManualPaste = false;
let availableDates = [];
let selectedDate = "";
let expandedRowKeys = new Set();

let timeOffData = null;
let kitsuneMemberNames = new Set();

// Sort & filter state for Time Off tables
let toSortCol = "start";
let toSortDir = "asc"; // "asc" | "desc"
let toSearchQuery = "";
let toPolicySelected = "";

// Sort state for Work Sessions main table
let hsSortCol = "member";
let hsSortDir = "asc";

const dateSelectEl = document.getElementById("hs-date-select");
const prevDayBtn = document.getElementById("hs-prev-day-btn");
const nextDayBtn = document.getElementById("hs-next-day-btn");
const latestDayBtn = document.getElementById("hs-latest-day-btn");
const rangeBadgeEl = document.getElementById("hs-available-range-badge");
const statusEl = document.getElementById("hs-sync-status");

const modeSessionsBtn = document.getElementById("mode-sessions-btn");
const modeTimeOffBtn = document.getElementById("mode-timeoff-btn");
const viewSessionsEl = document.getElementById("view-work-sessions");
const viewTimeOffEl = document.getElementById("view-time-off");
const toKitsuneOnlyEl = document.getElementById("to-kitsune-only");

const filterApprovedBtn = document.getElementById("to-filter-approved");
const filterSubmittedBtn = document.getElementById("to-filter-submitted");
const filterAllBtn = document.getElementById("to-filter-all");

const wsSearchEl = document.getElementById("ws-to-search");
const wsPolicyEl = document.getElementById("ws-to-policy-filter");
const toSearchEl = document.getElementById("to-search-input");
const toPolicyEl = document.getElementById("to-policy-filter");

function syncFilterInputsAndRender() {
  if (wsSearchEl && wsSearchEl.value !== toSearchQuery) wsSearchEl.value = toSearchQuery;
  if (toSearchEl && toSearchEl.value !== toSearchQuery) toSearchEl.value = toSearchQuery;
  if (wsPolicyEl && wsPolicyEl.value !== toPolicySelected) wsPolicyEl.value = toPolicySelected;
  if (toPolicyEl && toPolicyEl.value !== toPolicySelected) toPolicyEl.value = toPolicySelected;
  renderTimeOffTable();
  renderWorkSessionsApprovedTable();
}

[wsSearchEl, toSearchEl].forEach((el) => {
  if (!el) return;
  el.addEventListener("input", (e) => {
    toSearchQuery = String(e.target.value || "").trim().toLowerCase();
    syncFilterInputsAndRender();
  });
});

[wsPolicyEl, toPolicyEl].forEach((el) => {
  if (!el) return;
  el.addEventListener("change", (e) => {
    toPolicySelected = String(e.target.value || "");
    syncFilterInputsAndRender();
  });
});

// Wire all Time Off table headers for sorting
document.querySelectorAll(".to-sort-th").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.getAttribute("data-sort-col");
    if (!col) return;
    if (toSortCol === col) {
      toSortDir = toSortDir === "asc" ? "desc" : "asc";
    } else {
      toSortCol = col;
      toSortDir = "asc";
    }
    updateSortHeaderIndicators();
    renderTimeOffTable();
    renderWorkSessionsApprovedTable();
  });
});

// Wire all Work Sessions table headers for sorting
document.querySelectorAll(".hs-sort-th").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.getAttribute("data-hs-sort");
    if (!col) return;
    if (hsSortCol === col) {
      hsSortDir = hsSortDir === "asc" ? "desc" : "asc";
    } else {
      hsSortCol = col;
      hsSortDir = "asc";
    }
    updateHsSortHeaderIndicators();
    renderSelectedDateView();
  });
});

function updateSortHeaderIndicators() {
  document.querySelectorAll(".to-sort-th").forEach((th) => {
    const col = th.getAttribute("data-sort-col");
    const ind = th.querySelector(".sort-ind");
    if (!ind) return;
    if (col === toSortCol) {
      ind.textContent = toSortDir === "asc" ? "▲" : "▼";
      ind.className = "sort-ind text-amber-300 ml-1 font-bold";
    } else {
      ind.textContent = "⇅";
      ind.className = "sort-ind text-slate-500 ml-1";
    }
  });
}

function updateHsSortHeaderIndicators() {
  document.querySelectorAll(".hs-sort-th").forEach((th) => {
    const col = th.getAttribute("data-hs-sort");
    const ind = th.querySelector(".hs-sort-ind");
    if (!ind) return;
    if (col === hsSortCol) {
      ind.textContent = hsSortDir === "asc" ? "▲" : "▼";
      ind.className = "hs-sort-ind text-amber-300 ml-1 font-bold";
    } else {
      ind.textContent = "⇅";
      ind.className = "hs-sort-ind text-slate-500 ml-1";
    }
  });
}

function setTimeOffFilterMode(mode) {
  timeOffFilterMode = mode;
  filterApprovedBtn.className =
    mode === "approved"
      ? "px-3 py-1 rounded-lg bg-emerald-700 text-white font-bold text-xs cursor-pointer"
      : "px-3 py-1 rounded-lg text-slate-300 hover:text-white font-semibold text-xs cursor-pointer";
  filterSubmittedBtn.className =
    mode === "submitted"
      ? "px-3 py-1 rounded-lg bg-amber-700 text-white font-bold text-xs cursor-pointer"
      : "px-3 py-1 rounded-lg text-slate-300 hover:text-white font-semibold text-xs cursor-pointer";
  filterAllBtn.className =
    mode === "all"
      ? "px-3 py-1 rounded-lg bg-teal-700 text-white font-bold text-xs cursor-pointer"
      : "px-3 py-1 rounded-lg text-slate-300 hover:text-white font-semibold text-xs cursor-pointer";
  renderTimeOffTable();
}

filterApprovedBtn.addEventListener("click", () => setTimeOffFilterMode("approved"));
filterSubmittedBtn.addEventListener("click", () => setTimeOffFilterMode("submitted"));
filterAllBtn.addEventListener("click", () => setTimeOffFilterMode("all"));

function setViewMode(mode) {
  currentViewMode = mode;
  if (mode === "sessions") {
    viewSessionsEl.classList.remove("hidden");
    viewTimeOffEl.classList.add("hidden");
    modeSessionsBtn.className =
      "px-4 py-2 rounded-lg bg-teal-600 text-white font-bold text-xs shadow transition cursor-pointer";
    modeTimeOffBtn.className =
      "px-4 py-2 rounded-lg text-slate-300 hover:text-white font-semibold text-xs transition cursor-pointer flex items-center gap-2";
  } else {
    viewSessionsEl.classList.add("hidden");
    viewTimeOffEl.classList.remove("hidden");
    modeTimeOffBtn.className =
      "px-4 py-2 rounded-lg bg-teal-600 text-white font-bold text-xs shadow transition cursor-pointer flex items-center gap-2";
    modeSessionsBtn.className =
      "px-4 py-2 rounded-lg text-slate-300 hover:text-white font-semibold text-xs transition cursor-pointer";
    renderTimeOffTable();
  }
}

modeSessionsBtn.addEventListener("click", () => setViewMode("sessions"));
modeTimeOffBtn.addEventListener("click", () => setViewMode("timeoff"));
toKitsuneOnlyEl.addEventListener("change", () => {
  renderTimeOffTable();
  renderWorkSessionsApprovedTable();
});

subscribeCached("kitsuneDashboard", "kitsune_hubstaff_combined_cache", (data) => {
  if (!data) return;

  const hiddenSet = getHiddenVaSet();
  const vas = data.vas || {};
  const names = new Set();
  Object.values(vas).forEach((v) => {
    if (v && v.va && !hiddenSet.has(v.id)) {
      names.add(String(v.va).trim().toLowerCase());
    }
  });
  Object.values(data.selectedTabData || {}).forEach((t) => {
    if (t && t.fullName) names.add(String(t.fullName).trim().toLowerCase());
    if (t && t.tabName) names.add(String(t.tabName).trim().toLowerCase());
  });
  kitsuneMemberNames = names;

  const liveData = data.hubstaffLive;
  if (!liveData) {
    if (!isUsingManualPaste) {
      statusEl.textContent = "⏳ Waiting for background Hubstaff tab to sync...";
      document.getElementById("hs-tbody").innerHTML =
        `<tr><td colspan="6" class="p-6 text-center text-slate-400">Open your pinned Hubstaff Work Sessions tab (with the Kitsune extension enabled) or click <strong>📋 Paste Table Fallback</strong> above.</td></tr>`;
    }
  } else {
    allFirebaseRows = Array.isArray(liveData.rows) ? liveData.rows : Object.values(liveData.rows || {});
    if (!isUsingManualPaste) {
      const syncedTime = liveData.syncedAt
        ? new Date(liveData.syncedAt).toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          })
        : "Connected";
      const filterSuffix = liveData.filterName ? ` • ${liveData.filterName}` : "";
      statusEl.textContent = `✓ Live Sync (${syncedTime}${filterSuffix}) • View-only (does not write to Google Sheets)`;
      rebuildAvailableDatesAndRender(false);
    }
  }

  timeOffData = data.hubstaffTimeOff || null;
  populatePolicyDropdowns();
  updateSortHeaderIndicators();
  updateHsSortHeaderIndicators();
  updateTimeOffBadgeAndRender();
});

function populatePolicyDropdowns() {
  if (!timeOffData) return;
  const allItems = [
    ...normalizeFirebaseArray(timeOffData.requests),
    ...normalizeFirebaseArray(timeOffData.approvedRequests)
  ];
  const policies = [...new Set(allItems.map((r) => String(r.policy || "").trim()).filter(Boolean))].sort();

  [wsPolicyEl, toPolicyEl].forEach((sel) => {
    if (!sel) return;
    const prev = toPolicySelected;
    sel.innerHTML =
      `<option value="">All Policies</option>` +
      policies
        .map(
          (p) =>
            `<option value="${escapeHtml(p)}" ${p === prev ? "selected" : ""}>${escapeHtml(p)}</option>`
        )
        .join("");
  });
}

function isKitsuneMember(memberName) {
  if (!kitsuneMemberNames.size) return true;
  const clean = String(memberName || "").trim().toLowerCase();
  if (!clean) return false;
  if (kitsuneMemberNames.has(clean)) return true;

  const words = clean.split(/\s+/);
  const firstWord = words[0] || "";
  const firstTwo = words.slice(0, 2).join(" ");

  for (const kn of kitsuneMemberNames) {
    if (kn === firstWord || kn.startsWith(firstTwo) || clean.startsWith(kn)) return true;
  }
  return false;
}

function normalizeFirebaseArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === "object") return Object.values(val).filter(Boolean);
  return [];
}

function parseFlexibleDateMs(rawStr) {
  const s = String(rawStr || "").trim();
  if (!s) return 0;
  const direct = new Date(s);
  if (!isNaN(direct.getTime())) return direct.getTime();
  // Handle "Tue, Nov 3, 2026 2:06 pm"
  const cleaned = s.replace(/^[A-Za-z]+,\s*/, "").replace(/\s+(am|pm)$/i, " $1");
  const fallback = new Date(cleaned);
  return isNaN(fallback.getTime()) ? 0 : fallback.getTime();
}

function getSortValue(r, col) {
  switch (col) {
    case "member":
      return String(r.member || "").toLowerCase();
    case "policy":
      return String(r.policy || "").toLowerCase();
    case "reason":
      return String(r.reason || "").toLowerCase();
    case "start":
      return parseFlexibleDateMs(r.startIso || r.startLabel);
    case "end":
      return parseFlexibleDateMs(r.endIso || r.endLabel);
    case "hours":
      return parseDurationToSeconds(r.hours || "0:00:00");
    case "status":
      return String(r.status || "").toLowerCase();
    case "requestedOn":
      return parseFlexibleDateMs(r.requestedOn);
    default:
      return 0;
  }
}

function applyFilterAndSort(list, kitsuneOnly) {
  const filtered = list.filter((r) => {
    if (kitsuneOnly && !isKitsuneMember(r.member)) return false;
    if (toPolicySelected && String(r.policy || "").trim() !== toPolicySelected) return false;
    if (toSearchQuery) {
      const hay = `${r.member || ""} ${r.policy || ""} ${r.reason || ""}`.toLowerCase();
      if (!hay.includes(toSearchQuery)) return false;
    }
    return true;
  });

  const dirMult = toSortDir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => {
    const va = getSortValue(a, toSortCol);
    const vb = getSortValue(b, toSortCol);
    if (typeof va === "number" && typeof vb === "number") {
      return (va - vb) * dirMult;
    }
    return String(va).localeCompare(String(vb)) * dirMult;
  });
}

function getApprovedRequests(kitsuneOnly = false) {
  if (!timeOffData) return [];
  const list = normalizeFirebaseArray(timeOffData.approvedRequests);
  return applyFilterAndSort(list, kitsuneOnly);
}

function getSubmittedRequests(kitsuneOnly = false) {
  if (!timeOffData) return [];
  const list = normalizeFirebaseArray(timeOffData.requests);
  return applyFilterAndSort(list, kitsuneOnly);
}

function updateTimeOffBadgeAndRender() {
  const badgeEl = document.getElementById("to-nav-badge");
  const rawSubmitted = timeOffData
    ? normalizeFirebaseArray(timeOffData.requests).filter((r) => isKitsuneMember(r.member))
    : [];
  if (rawSubmitted.length > 0) {
    badgeEl.textContent = String(rawSubmitted.length);
    badgeEl.classList.remove("hidden");
  } else {
    badgeEl.classList.add("hidden");
  }
  renderTimeOffTable();
  renderWorkSessionsApprovedTable();
}

function getTimeOffStatusBadge(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "approved") {
    return `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">Approved</span>`;
  }
  if (s === "denied") {
    return `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-950 text-rose-300 border border-rose-700">Denied</span>`;
  }
  return `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-950 text-amber-300 border border-amber-700">Submitted</span>`;
}

function renderTimeOffRowHtml(r) {
  return `
    <tr class="hover:bg-slate-800/40 transition-colors align-top">
      <td class="px-4 py-2.5 font-bold text-white whitespace-nowrap">${escapeHtml(r.member)}</td>
      <td class="px-3 py-2.5 text-slate-300 whitespace-nowrap">
        <span class="inline-block px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-[11px] font-medium whitespace-nowrap">${escapeHtml(r.policy)}</span>
      </td>
      <td class="px-3 py-2.5 text-slate-300 max-w-[200px] whitespace-normal break-words leading-snug">${escapeHtml(r.reason || "—")}</td>
      <td class="px-3 py-2.5 font-mono text-slate-200 whitespace-nowrap" title="${escapeHtml(r.startTooltip || "")}">${escapeHtml(r.startLabel)}</td>
      <td class="px-3 py-2.5 font-mono text-slate-200 whitespace-nowrap" title="${escapeHtml(r.endTooltip || "")}">${escapeHtml(r.endLabel)}</td>
      <td class="px-3 py-2.5 text-center font-mono font-bold text-teal-300 whitespace-nowrap">${escapeHtml(r.hours)}</td>
      <td class="px-3 py-2.5 text-center whitespace-nowrap">${getTimeOffStatusBadge(r.status)}</td>
      <td class="px-3 py-2.5 font-mono text-slate-400 whitespace-nowrap">${escapeHtml(r.requestedOn)}</td>
    </tr>`;
}

function renderWorkSessionsApprovedTable() {
  const tbody = document.getElementById("ws-approved-tbody");
  const countPill = document.getElementById("ws-approved-count-pill");
  if (!tbody) return;

  if (!timeOffData) {
    if (countPill) countPill.textContent = "0";
    tbody.innerHTML = `<tr><td colspan="8" class="p-5 text-center text-slate-500">Waiting for Hubstaff Time Off sync...</td></tr>`;
    return;
  }

  const kitsuneOnly = toKitsuneOnlyEl ? toKitsuneOnlyEl.checked : true;
  const approvedList = getApprovedRequests(kitsuneOnly);
  if (countPill) countPill.textContent = String(approvedList.length);

  if (!approvedList.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-5 text-center text-slate-500">No approved leaves match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = approvedList.map(renderTimeOffRowHtml).join("");
}

function renderTimeOffTable() {
  const tbody = document.getElementById("to-tbody");
  const countsSummary = document.getElementById("to-counts-summary");
  const syncedLabel = document.getElementById("to-synced-label");

  if (!timeOffData) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-slate-400">Open <a href="https://app.hubstaff.com/organizations/700726/time_off_requests" target="_blank" rel="noreferrer" class="text-teal-400 underline">Hubstaff Time Off Requests</a> with the extension reloaded to sync requests automatically.</td></tr>`;
    return;
  }

  const counts = timeOffData.tabCounts || {};
  countsSummary.textContent = `Org Totals — Submitted: ${counts.submitted ?? 0} • Approved: ${counts.approved ?? 0} • Denied: ${counts.denied ?? 0}`;
  syncedLabel.textContent = timeOffData.syncedAt
    ? `Synced ${new Date(timeOffData.syncedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : "";

  const kitsuneOnly = toKitsuneOnlyEl ? toKitsuneOnlyEl.checked : false;

  let filtered = [];
  if (timeOffFilterMode === "approved") {
    filtered = getApprovedRequests(kitsuneOnly);
  } else if (timeOffFilterMode === "submitted") {
    filtered = getSubmittedRequests(kitsuneOnly);
  } else {
    const byId = new Map();
    [
      ...normalizeFirebaseArray(timeOffData.requests),
      ...normalizeFirebaseArray(timeOffData.approvedRequests)
    ].forEach((r, idx) => byId.set(r.id || `row_${idx}`, r));
    filtered = applyFilterAndSort(Array.from(byId.values()), kitsuneOnly);
  }

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-slate-500">No time off requests match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(renderTimeOffRowHtml).join("");
}

// ============================================================================
// WORK SESSIONS STEPPER & RENDERING
// ============================================================================
dateSelectEl.addEventListener("change", () => {
  selectedDate = dateSelectEl.value;
  expandedRowKeys.clear();
  updateStepperControls();
  renderSelectedDateView();
});

prevDayBtn.addEventListener("click", () => {
  const idx = availableDates.indexOf(selectedDate);
  if (idx > 0) {
    selectedDate = availableDates[idx - 1];
    expandedRowKeys.clear();
    updateStepperControls();
    renderSelectedDateView();
  }
});

nextDayBtn.addEventListener("click", () => {
  const idx = availableDates.indexOf(selectedDate);
  if (idx !== -1 && idx < availableDates.length - 1) {
    selectedDate = availableDates[idx + 1];
    expandedRowKeys.clear();
    updateStepperControls();
    renderSelectedDateView();
  }
});

latestDayBtn.addEventListener("click", () => {
  if (!availableDates.length) return;
  selectedDate = availableDates[availableDates.length - 1];
  expandedRowKeys.clear();
  updateStepperControls();
  renderSelectedDateView();
});

document.getElementById("hs-refresh-btn").addEventListener("click", () => {
  isUsingManualPaste = false;
  expandedRowKeys.clear();
  rebuildAvailableDatesAndRender(false);
});

document.getElementById("hs-paste-toggle-btn").addEventListener("click", () => {
  document.getElementById("hs-paste-drawer").classList.toggle("hidden");
});
document.getElementById("hs-paste-close").addEventListener("click", () => {
  document.getElementById("hs-paste-drawer").classList.add("hidden");
});
document.getElementById("hs-paste-parse-btn").addEventListener("click", () => {
  const raw = document.getElementById("hs-paste-input").value;
  if (!raw.trim()) return;
  parsePastedHubstaffText(raw);
  document.getElementById("hs-paste-drawer").classList.add("hidden");
});

window.toggleSessionDetails = (rowKey) => {
  if (expandedRowKeys.has(rowKey)) expandedRowKeys.delete(rowKey);
  else expandedRowKeys.add(rowKey);
  renderSelectedDateView();
};

function formatSeconds(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function parseDurationToSeconds(str) {
  const parts = String(str || "").trim().split(":").map(Number);
  if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  return 0;
}

function parseTime12hToMinutes(str) {
  const m = String(str || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return 99999;
  let hr = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || "").toUpperCase();
  if (ap === "PM" && hr < 12) hr += 12;
  if (ap === "AM" && hr === 12) hr = 0;
  return hr * 60 + min;
}

function dateSortKey(dateStr) {
  const parsed = new Date(String(dateStr || "").trim());
  return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function rebuildAvailableDatesAndRender(forceLatest = false) {
  const baseRows = isUsingManualPaste ? pastedRows : allFirebaseRows;
  const uniqueDates = [...new Set(baseRows.map((r) => String(r.date || "").trim()).filter(Boolean))];

  uniqueDates.sort((a, b) => dateSortKey(a) - dateSortKey(b));
  availableDates = uniqueDates;

  if (!availableDates.length) {
    selectedDate = "";
    dateSelectEl.innerHTML = `<option value="">No dates available</option>`;
    rangeBadgeEl.textContent = "Synced Range: —";
    updateStepperControls();
    renderSelectedDateView();
    return;
  }

  const minDate = availableDates[0];
  const maxDate = availableDates[availableDates.length - 1];
  rangeBadgeEl.textContent =
    minDate === maxDate ? `Synced Date: ${minDate}` : `Synced Range: ${minDate} – ${maxDate}`;

  if (forceLatest || !selectedDate || !availableDates.includes(selectedDate)) {
    selectedDate = maxDate;
  }

  dateSelectEl.innerHTML = availableDates
    .map(
      (d) =>
        `<option value="${escapeHtml(d)}" ${d === selectedDate ? "selected" : ""}>${escapeHtml(d)}</option>`
    )
    .join("");

  updateStepperControls();
  renderSelectedDateView();
}

function updateStepperControls() {
  const idx = availableDates.indexOf(selectedDate);
  dateSelectEl.value = selectedDate;
  prevDayBtn.disabled = idx <= 0;
  nextDayBtn.disabled = idx === -1 || idx >= availableDates.length - 1;
  latestDayBtn.disabled = !availableDates.length || idx === availableDates.length - 1;
}

function parsePastedHubstaffText(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const grouped = new Map();
  let currentDate = "Pasted Date";
  let currentMember = "";

  lines.forEach((line) => {
    if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}$/i.test(line)) {
      currentDate = line;
      currentMember = "";
      return;
    }

    const cols = line.split("\t").map((c) => c.trim());
    if (cols.length < 7) return;
    if (cols[0] === "Client" && cols[2] === "Member") return;

    const [client, project, member, todo, manual, started, stopped, duration, activity] = cols;
    if (member) currentMember = member;
    if (!currentMember || !duration) return;

    const sec = parseDurationToSeconds(duration);
    const actPct = parseFloat(String(activity || "0").replace("%", "")) || 0;
    const key = `${currentDate}__${currentMember}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        date: currentDate,
        member: currentMember,
        started: started || "—",
        stopped: stopped || "—",
        totalSeconds: 0,
        weightedActSum: 0,
        sessions: []
      });
    }

    const rec = grouped.get(key);
    if (stopped) rec.stopped = stopped;
    rec.totalSeconds += sec;
    rec.weightedActSum += sec * actPct;
    rec.sessions.push({
      project: project || client || "Client Work",
      todo: todo || "",
      started: started || "—",
      stopped: stopped || "—",
      duration,
      activity: activity || "0%"
    });
  });

  pastedRows = Array.from(grouped.values()).map((r) => ({
    ...r,
    totalDuration: formatSeconds(r.totalSeconds),
    avgActivityPct: r.totalSeconds > 0 ? Math.round(r.weightedActSum / r.totalSeconds) : 0
  }));

  isUsingManualPaste = true;
  expandedRowKeys.clear();
  statusEl.textContent = `✓ Rendered pasted report (${pastedRows.length} member entries • Click Live Feed to return to auto-sync)`;
  rebuildAvailableDatesAndRender(true);
}

function getHsSortVal(r, col) {
  switch (col) {
    case "member":
      return String(r.member || "").toLowerCase();
    case "started":
      return parseTime12hToMinutes(r.started);
    case "stopped":
      return parseTime12hToMinutes(r.stopped);
    case "duration":
      return Number(r.totalSeconds) || 0;
    case "activity":
      return Number(r.avgActivityPct) || 0;
    case "sessions":
      return Array.isArray(r.sessions) ? r.sessions.length : 0;
    default:
      return 0;
  }
}

function renderSelectedDateView() {
  const tbody = document.getElementById("hs-tbody");
  const baseRows = isUsingManualPaste ? pastedRows : allFirebaseRows;
  const rawRowsForDay = selectedDate
    ? baseRows.filter((r) => String(r.date || "").trim() === selectedDate)
    : [];

  const dirMult = hsSortDir === "asc" ? 1 : -1;
  const rowsForDay = [...rawRowsForDay].sort((a, b) => {
    const va = getHsSortVal(a, hsSortCol);
    const vb = getHsSortVal(b, hsSortCol);
    if (typeof va === "number" && typeof vb === "number") {
      return (va - vb) * dirMult;
    }
    return String(va).localeCompare(String(vb)) * dirMult;
  });

  const uniqueMembers = new Set(rowsForDay.map((r) => r.member));
  const grandTotalSec = rowsForDay.reduce((acc, r) => acc + (Number(r.totalSeconds) || 0), 0);
  const weightedTotalAct = rowsForDay.reduce(
    (acc, r) => acc + (Number(r.totalSeconds) || 0) * (Number(r.avgActivityPct) || 0),
    0
  );
  const overallAvgAct = grandTotalSec > 0 ? Math.round(weightedTotalAct / grandTotalSec) : 0;
  const lowActCount = rowsForDay.filter((r) => (Number(r.avgActivityPct) || 0) < 30).length;

  document.getElementById("hs-kpi-members").textContent = String(uniqueMembers.size);
  document.getElementById("hs-kpi-time").textContent = formatSeconds(grandTotalSec);

  const kpiActEl = document.getElementById("hs-kpi-activity");
  kpiActEl.textContent = rowsForDay.length ? `${overallAvgAct}%` : "-";
  kpiActEl.className =
    rowsForDay.length && overallAvgAct < 30
      ? "text-2xl font-bold text-rose-400 mt-0.5"
      : rowsForDay.length && overallAvgAct >= 50
      ? "text-2xl font-bold text-emerald-400 mt-0.5"
      : "text-2xl font-bold text-amber-300 mt-0.5";

  document.getElementById("hs-kpi-low").textContent = String(lowActCount);

  if (!rowsForDay.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500">No work sessions recorded for ${escapeHtml(selectedDate || "this date")}.</td></tr>`;
    return;
  }

  tbody.innerHTML = rowsForDay
    .map((r) => {
      const safeKey = String(r.key).replace(/'/g, "\\'");
      const isExpanded = expandedRowKeys.has(r.key);
      const sessions = Array.isArray(r.sessions) ? r.sessions : [];

      const subRows = isExpanded
        ? `<tr>
            <td colspan="6" class="bg-slate-950/90 px-6 py-3 border-l-4 border-teal-500">
              <div class="text-[11px] font-bold text-teal-300 uppercase mb-2">
                Sessions on ${escapeHtml(selectedDate)} — ${escapeHtml(r.member)}
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
                ${sessions
                  .map(
                    (s) => `
                  <div class="bg-slate-900 border border-slate-800 rounded-lg p-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div class="font-semibold text-slate-200">${escapeHtml(s.project || "Client Work")}</div>
                      ${s.todo ? `<div class="text-[10px] text-slate-400">${escapeHtml(s.todo)}</div>` : ""}
                      <div class="text-[10px] text-slate-400 font-mono mt-0.5">${escapeHtml(s.started || "—")} - ${escapeHtml(s.stopped || "—")}</div>
                    </div>
                    <div class="text-right font-mono shrink-0">
                      <div class="text-teal-300 font-bold">${escapeHtml(s.duration || "0:00:00")}</div>
                      <div class="text-[10px] mt-0.5">${formatConditionalActivityBadge(s.activity || "0%")}</div>
                    </div>
                  </div>`
                  )
                  .join("")}
              </div>
            </td>
          </tr>`
        : "";

      return `
        <tr class="hover:bg-slate-800/40 transition-colors">
          <td class="px-4 py-2.5 font-bold text-white">${escapeHtml(r.member)}</td>
          <td class="px-3 py-2.5 text-center font-mono text-slate-300">${escapeHtml(r.started || "—")}</td>
          <td class="px-3 py-2.5 text-center font-mono text-slate-300">${escapeHtml(r.stopped || "—")}</td>
          <td class="px-3 py-2.5 text-center font-mono font-bold text-teal-300">${escapeHtml(r.totalDuration || "0:00:00")}</td>
          <td class="px-3 py-2.5 text-center font-mono">${formatConditionalActivityBadge(`${r.avgActivityPct || 0}%`)}</td>
          <td class="px-3 py-2.5 text-center">
            <button type="button" onclick="window.toggleSessionDetails('${safeKey}')"
                    class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-teal-300 text-[11px] font-semibold cursor-pointer">
              ${isExpanded ? "Hide" : `${sessions.length} session(s)`}
            </button>
          </td>
        </tr>
        ${subRows}
      `;
    })
    .join("");
}