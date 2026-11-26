import { subscribeCached, updateSheetCell, updateSiteData } from "./firebase.js";
import {
  renderTopNav,
  escapeHtml,
  formatConditionalActivityBadge,
  getHiddenVaSet,
  parsePastedListItems
} from "./schedule.js";

renderTopNav("hubstaff");

let currentViewMode = "sessions";
let timeOffFilterMode = "approved";
let allFirebaseRows = [];
let pastedRows = [];
let isUsingManualPaste = false;
let availableDates = [];
let selectedDate = "";
let expandedRowKeys = new Set();

// Work Sessions filter & Hide/Unhide state
let hsSearchQuery = "";
let hsPresenceFilter = "all"; // "all" | "present" | "absent"
let hsStartTimeFilter = "all";
let hsActivityFilter = "all";
let showWsHidden = false;

const WS_HIDDEN_STORAGE_KEY = "kitsune_ws_hidden_members";
function getWsHiddenSet() {
  try {
    const arr = JSON.parse(localStorage.getItem(WS_HIDDEN_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(arr) ? arr.map((s) => String(s).trim().toLowerCase()) : []);
  } catch (_) {
    return new Set();
  }
}
function saveWsHiddenSet(setObj) {
  try {
    localStorage.setItem(WS_HIDDEN_STORAGE_KEY, JSON.stringify([...setObj]));
  } catch (_) {}
}

// Quick Align & Logs + Tasks/Focuses state
let latestDashboardData = {};
let expandedAlignMemberKey = null;
let isWsTasksOpen = false;
let expandedWsAmRows = {};
let wsTaskDrafts = {};
let wsTaskDirty = {};
let wsLogDrafts = {};
let isSavingWsLogs = false;
let hasDeferredWsRender = false;

let timeOffData = null;
let kitsuneMemberNames = new Set();

// Sort & filter state for Time Off tab
let toSortCol = "start";
let toSortDir = "asc";
let toSearchQuery = "";
let toPolicySelected = "";

// Sort state for Work Sessions main table (default: Schedule)
let hsSortCol = "schedule";
let hsSortDir = "asc";

const dateSelectEl = document.getElementById("hs-date-select");
const prevDayBtn = document.getElementById("hs-prev-day-btn");
const nextDayBtn = document.getElementById("hs-next-day-btn");
const latestDayBtn = document.getElementById("hs-latest-day-btn");
const rangeBadgeEl = document.getElementById("hs-available-range-badge");
const statusEl = document.getElementById("hs-sync-status");

const hsSearchInputEl = document.getElementById("hs-search-input");
const hsPresenceFilterEl = document.getElementById("hs-presence-filter");
const hsStartTimeFilterEl = document.getElementById("hs-start-time-filter");
const hsActivityFilterEl = document.getElementById("hs-activity-filter");
const hsClearFiltersBtn = document.getElementById("hs-clear-filters-btn");
const hsToggleHiddenBtn = document.getElementById("hs-toggle-hidden-btn");
const hsUnhideAllBtn = document.getElementById("hs-unhide-all-btn");
const hsFilterCountLabel = document.getElementById("hs-filter-count-label");

const modeSessionsBtn = document.getElementById("mode-sessions-btn");
const modeTimeOffBtn = document.getElementById("mode-timeoff-btn");
const viewSessionsEl = document.getElementById("view-work-sessions");
const viewTimeOffEl = document.getElementById("view-time-off");
const toKitsuneOnlyEl = document.getElementById("to-kitsune-only");

const filterApprovedBtn = document.getElementById("to-filter-approved");
const filterSubmittedBtn = document.getElementById("to-filter-submitted");
const filterAllBtn = document.getElementById("to-filter-all");

const toSearchEl = document.getElementById("to-search-input");
const toPolicyEl = document.getElementById("to-policy-filter");

function showWsToast(msg) {
  let toast = document.getElementById("ws-save-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "ws-save-toast";
    toast.className =
      "fixed bottom-5 right-5 z-[60] bg-slate-900 border border-teal-600 text-teal-200 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-2xl";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.add("hidden"), 3500);
}

function isWsActivelyEditing() {
  if (isSavingWsLogs) return true;
  const active = document.activeElement;
  if (active && ["TEXTAREA", "INPUT", "SELECT"].includes(active.tagName)) {
    if (active.closest("#hs-tbody")) return true;
  }
  const hasDirtyLogs = Object.values(wsLogDrafts).some(
    (d) => d && (d.notesDirty || d.flagDirty || d.amDirty)
  );
  const hasDirtyTasks = Object.values(wsTaskDirty).some(Boolean);
  return hasDirtyLogs || hasDirtyTasks;
}

function withWsFocusPreserved(renderFn) {
  const active = document.activeElement;
  const activeId = active && active.id ? active.id : "";
  const isTextControl = active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT");
  const selStart = isTextControl && typeof active.selectionStart === "number" ? active.selectionStart : null;
  const selEnd = isTextControl && typeof active.selectionEnd === "number" ? active.selectionEnd : null;
  const scrollTop = active && typeof active.scrollTop === "number" ? active.scrollTop : 0;

  renderFn();

  if (activeId) {
    const restored = document.getElementById(activeId);
    if (restored) {
      restored.focus({ preventScroll: true });
      if (isTextControl && selStart !== null && selEnd !== null && typeof restored.setSelectionRange === "function") {
        try {
          restored.setSelectionRange(selStart, selEnd);
        } catch (_) {}
      }
      if (typeof restored.scrollTop === "number") {
        restored.scrollTop = scrollTop;
      }
    }
  }
}

document.addEventListener("focusout", () => {
  setTimeout(() => {
    if (hasDeferredWsRender && !isWsActivelyEditing()) {
      hasDeferredWsRender = false;
      renderSelectedDateView();
    }
  }, 150);
});

// Work Sessions Filter & Hide/Unhide Listeners
if (hsSearchInputEl) {
  hsSearchInputEl.addEventListener("input", (e) => {
    hsSearchQuery = String(e.target.value || "").trim().toLowerCase();
    renderSelectedDateView();
  });
}

if (hsPresenceFilterEl) {
  hsPresenceFilterEl.addEventListener("change", (e) => {
    hsPresenceFilter = String(e.target.value || "all");
    renderSelectedDateView();
  });
}

if (hsStartTimeFilterEl) {
  hsStartTimeFilterEl.addEventListener("change", (e) => {
    hsStartTimeFilter = String(e.target.value || "all");
    renderSelectedDateView();
  });
}

if (hsActivityFilterEl) {
  hsActivityFilterEl.addEventListener("change", (e) => {
    hsActivityFilter = String(e.target.value || "all");
    renderSelectedDateView();
  });
}

if (hsClearFiltersBtn) {
  hsClearFiltersBtn.addEventListener("click", () => {
    hsSearchQuery = "";
    hsPresenceFilter = "all";
    hsStartTimeFilter = "all";
    hsActivityFilter = "all";
    if (hsSearchInputEl) hsSearchInputEl.value = "";
    if (hsPresenceFilterEl) hsPresenceFilterEl.value = "all";
    if (hsStartTimeFilterEl) hsStartTimeFilterEl.value = "all";
    if (hsActivityFilterEl) hsActivityFilterEl.value = "all";
    renderSelectedDateView();
  });
}

if (hsToggleHiddenBtn) {
  hsToggleHiddenBtn.addEventListener("click", () => {
    showWsHidden = !showWsHidden;
    renderSelectedDateView();
  });
}

if (hsUnhideAllBtn) {
  hsUnhideAllBtn.addEventListener("click", () => {
    try {
      localStorage.removeItem(WS_HIDDEN_STORAGE_KEY);
    } catch (_) {}
    showWsHidden = false;
    showWsToast("✓ Restored all hidden VAs in Work Sessions!");
    renderSelectedDateView();
  });
}

window.hideWsMember = (memberName, tabKey = "") => {
  const norm = String(memberName || "").trim().toLowerCase();
  const normTab = String(tabKey || "").trim().toLowerCase();
  if (!norm && !normTab) return;
  const setObj = getWsHiddenSet();
  if (norm) setObj.add(norm);
  if (normTab) setObj.add(normTab);
  saveWsHiddenSet(setObj);
  if (
    expandedAlignMemberKey &&
    (expandedAlignMemberKey.toLowerCase().endsWith(`__${norm}`) ||
      (normTab && expandedAlignMemberKey.toLowerCase().endsWith(`__${normTab}`)))
  ) {
    expandedAlignMemberKey = null;
  }
  showWsToast(`Hidden ${memberName} — click 'Show hidden' in the filter bar to restore.`);
  renderSelectedDateView();
};

window.unhideWsMember = (memberName, tabKey = "") => {
  const norm = String(memberName || "").trim().toLowerCase();
  const normTab = String(tabKey || "").trim().toLowerCase();
  const setObj = getWsHiddenSet();
  if (norm) setObj.delete(norm);
  if (normTab) setObj.delete(normTab);
  saveWsHiddenSet(setObj);
  if (setObj.size === 0) showWsHidden = false;
  showWsToast(`✓ Restored ${memberName} to Work Sessions!`);
  renderSelectedDateView();
};

function updateWsHiddenControlsUI(hiddenCount) {
  if (!hsToggleHiddenBtn || !hsUnhideAllBtn) return;
  if (hiddenCount > 0) {
    hsToggleHiddenBtn.classList.remove("hidden");
    hsUnhideAllBtn.classList.remove("hidden");
    hsToggleHiddenBtn.textContent = showWsHidden
      ? `Hide hidden (${hiddenCount})`
      : `Show hidden (${hiddenCount})`;
  } else {
    hsToggleHiddenBtn.classList.add("hidden");
    hsUnhideAllBtn.classList.add("hidden");
    showWsHidden = false;
  }
}

if (toSearchEl) {
  toSearchEl.addEventListener("input", (e) => {
    toSearchQuery = String(e.target.value || "").trim().toLowerCase();
    renderTimeOffTable();
  });
}

if (toPolicyEl) {
  toPolicyEl.addEventListener("change", (e) => {
    toPolicySelected = String(e.target.value || "");
    renderTimeOffTable();
  });
}

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
  });
});

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
if (toKitsuneOnlyEl) {
  toKitsuneOnlyEl.addEventListener("change", () => {
    renderTimeOffTable();
  });
}

subscribeCached("kitsuneDashboard", "kitsune_hubstaff_combined_cache", (data) => {
  if (!data) return;
  latestDashboardData = data;

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

  timeOffData = data.hubstaffTimeOff || null;

  const liveData = data.hubstaffLive;
  if (!liveData) {
    if (!isUsingManualPaste) {
      statusEl.textContent = "⏳ Waiting for background Hubstaff tab to sync...";
      document.getElementById("hs-tbody").innerHTML =
        `<tr><td colspan="9" class="p-6 text-center text-slate-400">Open your pinned Hubstaff Work Sessions tab (with the Kitsune extension enabled) or click <strong>📋 Paste Table Fallback</strong> above.</td></tr>`;
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
      statusEl.textContent = `✓ Live Sync (${syncedTime}${filterSuffix}) • Click + Align on any VA to manage Tasks/Focuses & Sheet logs`;

      if (isWsActivelyEditing()) {
        hasDeferredWsRender = true;
      } else {
        hasDeferredWsRender = false;
        rebuildAvailableDatesAndRender(false);
      }
    }
  }

  populatePolicyDropdowns();
  updateSortHeaderIndicators();
  updateHsSortHeaderIndicators();
  updateTimeOffBadgeAndRender();
});

function populatePolicyDropdowns() {
  if (!timeOffData || !toPolicyEl) return;
  const allItems = [
    ...normalizeFirebaseArray(timeOffData.requests),
    ...normalizeFirebaseArray(timeOffData.approvedRequests)
  ];
  const policies = [...new Set(allItems.map((r) => String(r.policy || "").trim()).filter(Boolean))].sort();

  const prev = toPolicySelected;
  toPolicyEl.innerHTML =
    `<option value="">All Policies</option>` +
    policies
      .map(
        (p) =>
          `<option value="${escapeHtml(p)}" ${p === prev ? "selected" : ""}>${escapeHtml(p)}</option>`
      )
      .join("");
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
  const iso = parseFlexibleDateToIso(rawStr);
  if (iso) return new Date(`${iso}T00:00:00`).getTime();
  const s = String(rawStr || "").trim();
  const direct = new Date(s);
  return isNaN(direct.getTime()) ? 0 : direct.getTime();
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
  if (currentViewMode === "timeoff") {
    renderTimeOffTable();
  }
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

function renderTimeOffTable() {
  const tbody = document.getElementById("to-tbody");
  const countsSummary = document.getElementById("to-counts-summary");
  const syncedLabel = document.getElementById("to-synced-label");
  if (!tbody) return;

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
  expandedAlignMemberKey = null;
  updateStepperControls();
  renderSelectedDateView();
});

prevDayBtn.addEventListener("click", () => {
  const idx = availableDates.indexOf(selectedDate);
  if (idx > 0) {
    selectedDate = availableDates[idx - 1];
    expandedRowKeys.clear();
    expandedAlignMemberKey = null;
    updateStepperControls();
    renderSelectedDateView();
  }
});

nextDayBtn.addEventListener("click", () => {
  const idx = availableDates.indexOf(selectedDate);
  if (idx !== -1 && idx < availableDates.length - 1) {
    selectedDate = availableDates[idx + 1];
    expandedRowKeys.clear();
    expandedAlignMemberKey = null;
    updateStepperControls();
    renderSelectedDateView();
  }
});

latestDayBtn.addEventListener("click", () => {
  if (!availableDates.length) return;
  selectedDate = availableDates[availableDates.length - 1];
  expandedRowKeys.clear();
  expandedAlignMemberKey = null;
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
  withWsFocusPreserved(() => renderSelectedDateView());
};

window.toggleWsAlignAccordion = (rowKey) => {
  expandedAlignMemberKey = expandedAlignMemberKey === rowKey ? null : rowKey;
  isWsTasksOpen = false;
  withWsFocusPreserved(() => renderSelectedDateView());
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
  const iso = parseFlexibleDateToIso(dateStr);
  if (iso) return new Date(`${iso}T00:00:00`).getTime();
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

/**
 * Extracts Start Time, End Time, and Shift Type (Full Time / Part Time) for a tab or member.
 */
function getTimeOnlyScheduleFromTabObj(tabObj) {
  if (!tabObj) {
    return { shiftType: "", startTime: "", endTime: "", label: "—", startMinutes: 99999 };
  }

  const row2 = Array.isArray(tabObj.scheduleRow) ? tabObj.scheduleRow : [];
  const a2 = String(row2[0] || "").trim();
  const b2 = String(row2[1] || "").trim();
  const c2 = String(row2[2] || "").trim();
  const isTimeStr = (v) => /^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(v);

  let shiftType = a2 && !a2.toLowerCase().startsWith("shift schedule") ? a2 : "";
  let startTime = "";
  let endTime = "";

  if (isTimeStr(b2) || isTimeStr(c2)) {
    startTime = b2.toUpperCase().replace(/\s+/g, "");
    endTime = c2.toUpperCase().replace(/\s+/g, "");
  } else {
    const times = [];
    row2.forEach((cell) => {
      const item = String(cell || "").trim();
      if (!item || item.toLowerCase().includes("brief") || item.toLowerCase().startsWith("shift schedule")) {
        return;
      }
      const rangeMatch = item.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–to]+\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)$/i);
      if (rangeMatch) {
        times.push(rangeMatch[1].toUpperCase().replace(/\s+/g, ""));
        times.push(rangeMatch[2].toUpperCase().replace(/\s+/g, ""));
      } else if (isTimeStr(item)) {
        times.push(item.toUpperCase().replace(/\s+/g, ""));
      } else if (!shiftType) {
        shiftType = item;
      }
    });
    startTime = times[0] || "";
    endTime = times[1] || "";
  }

  const label =
    startTime && endTime
      ? `${startTime} - ${endTime}`
      : startTime
      ? startTime
      : "—";

  return {
    shiftType: shiftType || "Full Time",
    startTime,
    endTime,
    label,
    startMinutes: startTime ? parseTime12hToMinutes(startTime) : 99999
  };
}

function getMemberTimeOnlySchedule(memberName, resolvedTabObj = null) {
  if (resolvedTabObj) return getTimeOnlyScheduleFromTabObj(resolvedTabObj);
  const resolved = resolveTabEntryForMember(memberName);
  return getTimeOnlyScheduleFromTabObj(resolved ? resolved.tabObj : null);
}

/**
 * Resolves the Overview VA summary record (`vas`) so hover tooltips can show
 * Coaching Focus, Activity (7d), and Avg Hrs.
 */
function resolveOverviewVaForMember(memberName, tabKey = "", tabObj = null) {
  const vas = latestDashboardData.vas || {};
  const list = Object.values(vas).filter(Boolean);
  if (!list.length) return null;

  const clean = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const mClean = clean(memberName);
  const fnClean = clean((tabObj && tabObj.fullName) || "");
  const tnClean = clean((tabObj && tabObj.tabName) || "");

  if (tabKey) {
    const byTab = list.find((v) => v.matchedTabKey === tabKey);
    if (byTab) return byTab;
  }

  if (fnClean) {
    const exactFull = list.find((v) => clean(v.va) === fnClean);
    if (exactFull) return exactFull;
  }

  if (mClean) {
    const exactMember = list.find((v) => clean(v.va) === mClean);
    if (exactMember) return exactMember;
  }

  if (tnClean) {
    const exactTab = list.find((v) => clean(v.va) === tnClean);
    if (exactTab) return exactTab;
  }

  const words = (fnClean || mClean).split(" ").filter(Boolean);
  const firstTwo = words.slice(0, 2).join(" ");
  if (words.length >= 2) {
    const twoWordMatch = list.find((v) => {
      const vn = clean(v.va);
      return vn === firstTwo || vn.startsWith(firstTwo + " ");
    });
    if (twoWordMatch) return twoWordMatch;
  }

  const firstWord = words[0] || "";
  if (firstWord) {
    const sameFirst = list.filter((v) => {
      const vn = clean(v.va);
      return vn === firstWord || vn.startsWith(firstWord + " ") || vn.split(/[\s@]+/)[0] === firstWord;
    });
    if (sameFirst.length === 1) return sameFirst[0];
  }

  return null;
}

function formatHoverCoachingFocus(rawFocus) {
  const text = String(rawFocus || "On track").trim();
  const lower = text.toLowerCase();
  if (lower === "on track" || lower === "-") {
    return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800">${escapeHtml(text)}</span>`;
  }
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-950/90 text-amber-300 border border-amber-800">${escapeHtml(text)}</span>`;
}

/**
 * Checks if a VA has an approved Time Off request covering the selected Session Date.
 */
function findApprovedLeaveForMemberOnDate(memberName, fullName, tabName, sessionDateStr) {
  if (!timeOffData) return null;
  const targetIso = parseFlexibleDateToIso(sessionDateStr);
  if (!targetIso) return null;

  const approvedList = normalizeFirebaseArray(timeOffData.approvedRequests);
  if (!approvedList.length) return null;

  const clean = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const candidates = [clean(memberName), clean(fullName), clean(tabName)].filter(Boolean);

  return (
    approvedList.find((req) => {
      const reqMember = clean(req.member);
      const isMatch = candidates.some((c) => {
        if (reqMember === c) return true;
        const cFirstTwo = c.split(" ").slice(0, 2).join(" ");
        return cFirstTwo && reqMember.startsWith(cFirstTwo);
      });
      if (!isMatch) return false;

      const startIso = parseFlexibleDateToIso(req.startIso || req.startLabel);
      const endIso = parseFlexibleDateToIso(req.endIso || req.endLabel) || startIso;
      if (!startIso) return false;
      return targetIso >= startIso && targetIso <= endIso;
    }) || null
  );
}

/**
 * Determines the presence status for a VA who has 0 Hubstaff sessions on selectedDate:
 * - "leave"    -> Approved Time Off covers selectedDate
 * - "upcoming" -> selectedDate is Today and current local time is before shift start
 * - "absent"   -> Shift start has passed (or past date) with no session & no leave
 */
function evaluateMissingVaStatus(memberName, fullName, tabName, schedObj, sessionDateStr) {
  const leaveRec = findApprovedLeaveForMemberOnDate(memberName, fullName, tabName, sessionDateStr);
  if (leaveRec) {
    return {
      statusType: "leave",
      policy: leaveRec.policy || "Approved Leave",
      reason: leaveRec.reason || ""
    };
  }

  const todayIso = toLocalIsoDate(new Date());
  const targetIso = parseFlexibleDateToIso(sessionDateStr);
  if (targetIso && targetIso === todayIso && schedObj && schedObj.startMinutes < 99999) {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (nowMinutes < schedObj.startMinutes) {
      return { statusType: "upcoming" };
    }
  }

  return { statusType: "absent" };
}

function populateStartTimeFilterDropdown(enrichedRows) {
  if (!hsStartTimeFilterEl) return;
  const startTimesMap = new Map();
  enrichedRows.forEach((r) => {
    if (r._sched && r._sched.startTime) {
      startTimesMap.set(r._sched.startTime, r._sched.startMinutes);
    }
  });

  const sortedStarts = [...startTimesMap.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([st]) => st);

  if (hsStartTimeFilter !== "all" && !sortedStarts.includes(hsStartTimeFilter)) {
    hsStartTimeFilter = "all";
  }

  hsStartTimeFilterEl.innerHTML =
    `<option value="all">All Start Times</option>` +
    sortedStarts
      .map(
        (st) =>
          `<option value="${escapeHtml(st)}" ${st === hsStartTimeFilter ? "selected" : ""}>Start: ${escapeHtml(st)}</option>`
      )
      .join("");
}

/**
 * Resolves the read-only Flag value (Green/Yellow/Red/RL/EL) for a VA on the selected Session Date.
 */
function getMemberFlagForSelectedDate(tabKey, tabObj) {
  if (!tabObj || !selectedDate) return "";
  const resolvedRow = resolveSheetRowForSessionDate(tabObj, selectedDate);
  const row = resolvedRow ? resolvedRow.row : null;
  if (!row) return "";

  const rDraft = tabKey ? wsLogDrafts[getWsRowDraftKey(tabKey, row._sheetRow)] || {} : {};
  if (rDraft.flagDirty) {
    return String(rDraft.flagVal || "").trim();
  }

  const headers = tabObj.headers || [];
  const cleanHeaders = tabObj.cleanHeaders || [];
  const flagIdx = headers.findIndex((h) => h.toLowerCase() === "flag");
  const flagKey = flagIdx !== -1 ? cleanHeaders[flagIdx] : "";
  const rawFlagHeader = flagIdx !== -1 ? headers[flagIdx] : "Flag";

  const serverFlag =
    row[flagKey] !== undefined
      ? row[flagKey]
      : row[rawFlagHeader] !== undefined
      ? row[rawFlagHeader]
      : row[rawFlagHeader.toLowerCase()] || row["flag"] || "";

  return String(serverFlag || "").trim();
}

function renderFlagBadgeHtml(flagVal) {
  const clean = String(flagVal || "").trim();
  const upper = clean.toUpperCase();
  if (!clean) {
    return `<span title="No flag set — click + Align to set" class="text-slate-500 font-mono">—</span>`;
  }
  let styleClass = "bg-slate-800 text-slate-200 border-slate-700";
  let label = clean;
  if (upper === "GREEN") {
    styleClass = "bg-emerald-950/90 text-emerald-300 border-emerald-700";
    label = "Green";
  } else if (upper === "YELLOW") {
    styleClass = "bg-amber-950/90 text-amber-300 border-amber-700";
    label = "Yellow";
  } else if (upper === "RED") {
    styleClass = "bg-rose-950/90 text-rose-300 border-rose-700";
    label = "Red";
  } else if (upper === "RL") {
    styleClass = "bg-purple-950/90 text-purple-300 border-purple-700";
    label = "RL";
  } else if (upper === "EL") {
    styleClass = "bg-orange-950/90 text-orange-300 border-orange-700";
    label = "EL";
  }

  return `<span title="Read-only view — click + Align to change flag" class="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${styleClass}">${escapeHtml(label)}</span>`;
}

function getFlagSortRank(flagVal) {
  const upper = String(flagVal || "").trim().toUpperCase();
  if (upper === "RED") return 1;
  if (upper === "YELLOW") return 2;
  if (upper === "EL") return 3;
  if (upper === "RL") return 4;
  if (upper === "GREEN") return 5;
  return 99;
}

function getHsSortVal(r, col) {
  switch (col) {
    case "member":
      return String(r.member || "").toLowerCase();
    case "flag":
      return getFlagSortRank(r._flag);
    case "schedule":
      return r._sched ? r._sched.startMinutes : 99999;
    case "started":
      return r._isPresent ? parseTime12hToMinutes(r.started) : 99999;
    case "stopped":
      return r._isPresent ? parseTime12hToMinutes(r.stopped) : 99999;
    case "duration":
      return r._isPresent ? Number(r.totalSeconds) || 0 : -1;
    case "activity":
      return r._isPresent ? Number(r.avgActivityPct) || 0 : -1;
    case "sessions":
      return r._isPresent && Array.isArray(r.sessions) ? r.sessions.length : -1;
    default:
      return 0;
  }
}

// ============================================================================
// QUICK ALIGN & LOGS + TASKS/FOCUSES HELPERS (SYNCED WITH VA-DETAIL)
// ============================================================================
function toLocalIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MONTH_INDEX_MAP = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
};

function parseFlexibleDateToIso(rawStr) {
  const s = String(rawStr || "").trim();
  if (!s) return "";

  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, "0")}-${String(isoMatch[3]).padStart(2, "0")}`;
  }

  const noWeekday = s.replace(/^[A-Za-z]+,\s*/, "").trim();

  const mdyText = noWeekday.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,?\s*(\d{2,4}))?$/);
  if (mdyText) {
    const mon = MONTH_INDEX_MAP[mdyText[1].toLowerCase()];
    const day = parseInt(mdyText[2], 10);
    let yr = mdyText[3] ? parseInt(mdyText[3], 10) : new Date().getFullYear();
    if (yr < 100) yr += 2000;
    if (mon && day >= 1 && day <= 31) {
      return `${yr}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const dmyText = noWeekday.match(/^(\d{1,2})\s+([A-Za-z]+)(?:,?\s*(\d{2,4}))?$/);
  if (dmyText) {
    const day = parseInt(dmyText[1], 10);
    const mon = MONTH_INDEX_MAP[dmyText[2].toLowerCase()];
    let yr = dmyText[3] ? parseInt(dmyText[3], 10) : new Date().getFullYear();
    if (yr < 100) yr += 2000;
    if (mon && day >= 1 && day <= 31) {
      return `${yr}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const slashMdy = noWeekday.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMdy) {
    const mon = parseInt(slashMdy[1], 10);
    const day = parseInt(slashMdy[2], 10);
    let yr = parseInt(slashMdy[3], 10);
    if (yr < 100) yr += 2000;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      return `${yr}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const fallback = new Date(noWeekday);
  return isNaN(fallback.getTime()) ? "" : toLocalIsoDate(fallback);
}

function resolveTabEntryForMember(memberName) {
  const selectedTabData = latestDashboardData.selectedTabData || {};
  const keys = Object.keys(selectedTabData);
  if (!keys.length) return null;

  const clean = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const target = clean(memberName);
  if (!target) return null;

  let matchKey = keys.find(
    (k) => clean(selectedTabData[k].fullName) === target || clean(selectedTabData[k].tabName) === target
  );
  if (matchKey) return { tabKey: matchKey, tabObj: selectedTabData[matchKey] };

  const words = target.split(" ").filter(Boolean);
  const firstTwo = words.slice(0, 2).join(" ");
  if (words.length >= 2) {
    matchKey = keys.find((k) => {
      const fn = clean(selectedTabData[k].fullName);
      const tn = clean(selectedTabData[k].tabName);
      return fn.startsWith(firstTwo) || tn === firstTwo || tn.startsWith(firstTwo + " ");
    });
    if (matchKey) return { tabKey: matchKey, tabObj: selectedTabData[matchKey] };
  }

  const firstWord = words[0] || "";
  if (firstWord) {
    const exactSingle = keys.find((k) => clean(selectedTabData[k].tabName) === firstWord);
    if (exactSingle) return { tabKey: exactSingle, tabObj: selectedTabData[exactSingle] };

    const sameFirst = keys.filter((k) => {
      const tn = clean(selectedTabData[k].tabName);
      const fn = clean(selectedTabData[k].fullName);
      return tn === firstWord || tn.startsWith(firstWord + " ") || fn.split(" ")[0] === firstWord;
    });
    if (sameFirst.length === 1) return { tabKey: sameFirst[0], tabObj: selectedTabData[sameFirst[0]] };
  }

  return null;
}

function resolveSheetRowForSessionDate(tabObj, sessionDateStr) {
  const rows = tabObj && Array.isArray(tabObj.rows) ? tabObj.rows : [];
  if (!rows.length) return null;

  const headers = tabObj.headers || [];
  const cleanHeaders = tabObj.cleanHeaders || [];
  const dateColIdx = headers.findIndex((h, idx) => idx === 0 || /week|date/i.test(h));
  const dateKey = dateColIdx !== -1 ? cleanHeaders[dateColIdx] : cleanHeaders[0] || "Date";

  const targetIso = parseFlexibleDateToIso(sessionDateStr);

  if (targetIso) {
    const exact = rows.find((r) => {
      const rawCell = String(r[dateKey] || r.Date || r.Week || "").trim();
      return parseFlexibleDateToIso(rawCell) === targetIso;
    });
    if (exact) {
      const matchedLabel = String(exact[dateKey] || exact.Date || exact.Week || sessionDateStr).trim();
      return { row: exact, label: `Selected Date: ${matchedLabel}`, isExactDateMatch: true };
    }
    return {
      row: null,
      label: `No Sheet row found for ${sessionDateStr}`,
      isExactDateMatch: false
    };
  }

  const valid = rows.filter((r) => {
    const dStr = String(r[dateKey] || r.Date || r.Week || "").trim();
    return !dStr.includes("Dec 26") && !dStr.includes("Dec 2026");
  });

  if (valid.length) {
    const last = valid[valid.length - 1];
    return {
      row: last,
      label: `Latest Shift (${String(last[dateKey] || last.Date || "").trim()})`,
      isExactDateMatch: true
    };
  }

  return { row: rows[rows.length - 1], label: "Latest Shift", isExactDateMatch: true };
}

function getWsDraftKey(tabKey) {
  return `${tabKey}__week_1`;
}

function getWsTaskBucket(tabKey) {
  const dKey = getWsDraftKey(tabKey);
  if (wsTaskDrafts[dKey]) return wsTaskDrafts[dKey];

  const siteGoals = (latestDashboardData.siteData && latestDashboardData.siteData.vaGoals) || {};
  const vaNode = siteGoals[tabKey] || {};
  const weekNode = vaNode["week_1"] || {};
  const focuses =
    Array.isArray(weekNode.focuses) && weekNode.focuses.length
      ? weekNode.focuses.map((f) => ({ ...f }))
      : [
          { id: "f_1", text: "", achieved: false, outcomeNotes: "" },
          { id: "f_2", text: "", achieved: false, outcomeNotes: "" },
          { id: "f_3", text: "", achieved: false, outcomeNotes: "" }
        ];
  return {
    focuses,
    additionalNotes: weekNode.additionalNotes || ""
  };
}

function ensureWsTaskDraft(tabKey) {
  const dKey = getWsDraftKey(tabKey);
  if (!wsTaskDrafts[dKey]) {
    wsTaskDrafts[dKey] = getWsTaskBucket(tabKey);
  }
  return wsTaskDrafts[dKey];
}

function getWsRowDraftKey(tabKey, sheetRow) {
  return `${tabKey}__row_${sheetRow}`;
}

function stageWsRowDraft(tabKey, sheetRow, patch) {
  const key = getWsRowDraftKey(tabKey, sheetRow);
  wsLogDrafts[key] = {
    tabKey,
    sheetRow,
    ...(wsLogDrafts[key] || {}),
    ...patch
  };
  updateWsSaveBtnUI(tabKey);
}

function getWsActiveTabDirtyEntries(tabKey) {
  return Object.values(wsLogDrafts).filter(
    (d) => d && d.tabKey === tabKey && (d.notesDirty || d.flagDirty || d.amDirty)
  );
}

function updateWsSaveBtnUI(tabKey) {
  const btn = document.getElementById(`ws-save-logs-btn-${tabKey}`);
  if (!btn) return;
  const dirtyCount = getWsActiveTabDirtyEntries(tabKey).length;
  btn.disabled = isSavingWsLogs;
  btn.textContent = isSavingWsLogs
    ? "⏳ Saving..."
    : dirtyCount > 0
    ? `💾 Save Log Changes (${dirtyCount})`
    : "💾 Save Log Changes";
  btn.className =
    dirtyCount > 0
      ? "px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-lg ring-2 ring-amber-400/50 transition cursor-pointer"
      : "px-3 py-1.5 rounded-lg bg-teal-700/80 hover:bg-teal-600 text-white font-semibold text-xs border border-teal-600/60 transition cursor-pointer";
}

function getFlagSelectStyle(val) {
  const upper = String(val || "").trim().toUpperCase();
  if (upper === "GREEN") return "bg-emerald-950 text-emerald-300 border-emerald-700 font-bold";
  if (upper === "YELLOW") return "bg-amber-950 text-amber-300 border-amber-700 font-bold";
  if (upper === "RED") return "bg-rose-950 text-rose-300 border-rose-700 font-bold";
  if (upper === "RL") return "bg-purple-950 text-purple-300 border-purple-700 font-bold";
  if (upper === "EL") return "bg-orange-950 text-orange-300 border-orange-700 font-bold";
  return "bg-slate-800 text-slate-200 border-slate-700";
}

function buildWsQuickAlignHtml(memberName, forcedTabKey = null) {
  const selectedTabData = latestDashboardData.selectedTabData || {};
  const resolvedTab =
    forcedTabKey && selectedTabData[forcedTabKey]
      ? { tabKey: forcedTabKey, tabObj: selectedTabData[forcedTabKey] }
      : resolveTabEntryForMember(memberName);

  if (!resolvedTab || !resolvedTab.tabObj) {
    return `<p class="text-xs text-slate-400 p-2">Tab for <strong>${escapeHtml(memberName)}</strong> is not enabled in <a href="tabs.html" class="text-teal-400 underline">Select Tabs</a>.</p>`;
  }

  const { tabKey, tabObj } = resolvedTab;
  const safeTabKey = String(tabKey).replace(/'/g, "\\'");
  const siteProfiles = (latestDashboardData.siteData && latestDashboardData.siteData.vaProfiles) || {};
  const siteAmComms = (latestDashboardData.siteData && latestDashboardData.siteData.amComms) || {};
  const profile = siteProfiles[tabKey] || {};
  const isProb = profile.employmentTier === "prob";
  const itemLabel = isProb ? "Task" : "Focus";
  const bucket = getWsTaskBucket(tabKey);
  const dKey = getWsDraftKey(tabKey);
  const hasTasksUnsaved = Boolean(wsTaskDirty[dKey]);
  const dirtyCount = getWsActiveTabDirtyEntries(tabKey).length;
  const allChecked = bucket.focuses.length > 0 && bucket.focuses.every((f) => Boolean(f.achieved));

  const headers = tabObj.headers || [];
  const cleanHeaders = tabObj.cleanHeaders || [];
  const colIndices = tabObj.colIndices || [];

  const resolvedRow = resolveSheetRowForSessionDate(tabObj, selectedDate);
  const row = resolvedRow ? resolvedRow.row : null;

  const dateIdx = headers.findIndex((h, idx) => idx === 0 || /week|date/i.test(h));
  const inIdx = headers.findIndex((h) => /clock\s*in/i.test(h));
  const outIdx = headers.findIndex((h) => /clock\s*out/i.test(h));
  const hrsIdx = headers.findIndex((h) => /hours/i.test(h));
  const notesIdx = headers.findIndex((h) => h.toLowerCase() === "notes");
  const flagIdx = headers.findIndex((h) => h.toLowerCase() === "flag");
  const redFlagIdx = headers.findIndex((h) => /red\s*flag\s*comms/i.test(h));

  const notesKey = notesIdx !== -1 ? cleanHeaders[notesIdx] : "";
  const notesCol = notesIdx !== -1 ? colIndices[notesIdx] : 0;
  const flagKey = flagIdx !== -1 ? cleanHeaders[flagIdx] : "";
  const flagCol = flagIdx !== -1 ? colIndices[flagIdx] : 0;
  const redFlagKey = redFlagIdx !== -1 ? cleanHeaders[redFlagIdx] : "RED_FLAG_COMMS";
  const redFlagCol = redFlagIdx !== -1 ? colIndices[redFlagIdx] : 7;

  let shiftCardHtml = `<p class="text-xs text-amber-300 bg-amber-950/30 border border-amber-800/60 rounded-xl p-3">⚠️ No shift row found in <strong>${escapeHtml(tabObj.tabName)}</strong>'s Google Sheet tab for <strong>${escapeHtml(selectedDate)}</strong> yet.</p>`;

  if (row) {
    const rDraft = wsLogDrafts[getWsRowDraftKey(tabKey, row._sheetRow)] || {};
    const isDirty = Boolean(rDraft.notesDirty || rDraft.flagDirty || rDraft.amDirty);

    const dateVal = dateIdx !== -1 ? row[cleanHeaders[dateIdx]] || "" : "";
    const inVal = inIdx !== -1 ? row[cleanHeaders[inIdx]] || "—" : "—";
    const outVal = outIdx !== -1 ? row[cleanHeaders[outIdx]] || "—" : "—";
    const hrsVal = hrsIdx !== -1 ? row[cleanHeaders[hrsIdx]] || "—" : "—";

    const rawNotesHeader = notesIdx !== -1 ? headers[notesIdx] : "Notes";
    const rawFlagHeader = flagIdx !== -1 ? headers[flagIdx] : "Flag";
    const rawRedFlagHeader = redFlagIdx !== -1 ? headers[redFlagIdx] : "RED FLAG COMMS";

    const serverNote =
      row[notesKey] !== undefined
        ? row[notesKey]
        : row[rawNotesHeader] !== undefined
        ? row[rawNotesHeader]
        : row[rawNotesHeader.toLowerCase()] || row["notes"] || "";

    const serverFlag =
      row[flagKey] !== undefined
        ? row[flagKey]
        : row[rawFlagHeader] !== undefined
        ? row[rawFlagHeader]
        : row[rawFlagHeader.toLowerCase()] || row["flag"] || "";

    const amKey = `${tabKey}_row_${row._sheetRow}`;
    const serverRedFlag =
      row[redFlagKey] !== undefined
        ? row[redFlagKey]
        : row[rawRedFlagHeader] !== undefined
        ? row[rawRedFlagHeader]
        : siteAmComms[amKey] || "";

    const effectiveNote = rDraft.notesDirty ? rDraft.notesVal : serverNote;
    const effectiveFlag = rDraft.flagDirty ? rDraft.flagVal : serverFlag;
    const effectiveAm = rDraft.amDirty ? rDraft.amVal : serverRedFlag;
    const upperFlag = String(effectiveFlag).trim().toUpperCase();
    const isAmOpen = Boolean(expandedWsAmRows[amKey]);

    shiftCardHtml = `
      <div class="bg-slate-950 border ${isDirty ? "border-amber-500/60" : "border-slate-800"} rounded-xl p-3 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2 text-xs">
          <div class="flex flex-wrap items-center gap-3 font-mono">
            <div>
              <span class="text-[10px] text-slate-500 uppercase font-sans block">Sheet Date</span>
              <span class="text-slate-200 font-semibold">${escapeHtml(dateVal)}</span>
            </div>
            <div>
              <span class="text-[10px] text-slate-500 uppercase font-sans block">Shift</span>
              <span class="text-slate-300">${escapeHtml(inVal)} – ${escapeHtml(outVal)}</span>
            </div>
            <div>
              <span class="text-[10px] text-slate-500 uppercase font-sans block">Hours</span>
              <span class="text-teal-300 font-bold">${escapeHtml(hrsVal)}</span>
            </div>
          </div>

          ${
            flagCol
              ? `<div class="flex items-center gap-2">
                  <span class="text-[10px] font-bold uppercase text-slate-400">Flag:</span>
                  <select onchange="window.stageWsFlagEdit('${safeTabKey}', '${tabObj.tabName}', ${row._sheetRow}, ${flagCol}, this.value, this)"
                          class="px-2.5 py-1 rounded border text-xs cursor-pointer ${getFlagSelectStyle(effectiveFlag)}">
                    <option value="" ${upperFlag === "" ? "selected" : ""}>-</option>
                    <option value="Green" ${upperFlag === "GREEN" ? "selected" : ""}>Green</option>
                    <option value="Yellow" ${upperFlag === "YELLOW" ? "selected" : ""}>Yellow</option>
                    <option value="Red" ${upperFlag === "RED" ? "selected" : ""}>Red</option>
                    <option value="RL" ${upperFlag === "RL" ? "selected" : ""}>RL</option>
                    <option value="EL" ${upperFlag === "EL" ? "selected" : ""}>EL</option>
                  </select>
                </div>`
              : ""
          }
        </div>

        ${
          notesCol
            ? `<div class="space-y-2">
                <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Notes & Tags (Syncs to Sheet)</label>
                <textarea id="ws-note-box-${row._sheetRow}" rows="2"
                          oninput="window.stageWsNoteEdit('${safeTabKey}', '${tabObj.tabName}', ${row._sheetRow}, ${notesCol}, this.value)"
                          placeholder="Add TL note..."
                          class="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border ${
                            rDraft.notesDirty ? "border-amber-500/80" : "border-slate-700"
                          } text-xs text-slate-100 focus:border-teal-500 focus:outline-none">${escapeHtml(effectiveNote)}</textarea>

                <div class="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onclick="window.toggleWsAmRow('${amKey}')"
                          class="text-[10px] font-bold px-2 py-0.5 rounded border cursor-pointer ${
                            effectiveAm.trim()
                              ? "bg-rose-950 text-rose-300 border-rose-800"
                              : "bg-slate-900 text-slate-400 border-slate-700 hover:text-rose-300"
                          }">
                    🚩 ${isAmOpen ? "Hide Comms" : effectiveAm.trim() ? "AM Comms (Logged)" : "+ AM Comms"}
                  </button>
                </div>

                ${
                  isAmOpen
                    ? `<div class="bg-rose-950/25 border border-rose-900/60 rounded-lg p-2 space-y-1">
                        <div class="text-[10px] font-bold text-rose-300 uppercase">🚩 AM Red Flag Comms (Syncs to Column G)</div>
                        <textarea id="ws-am-box-${row._sheetRow}" rows="2"
                                  oninput="window.stageWsAmEdit('${safeTabKey}', '${tabObj.tabName}', ${row._sheetRow}, ${redFlagCol}, '${amKey}', this.value)"
                                  placeholder="Log client escalations or AM follow-ups (pushes to Col G)..."
                                  class="w-full bg-slate-950 border ${
                                    rDraft.amDirty ? "border-amber-500/80" : "border-rose-900/70"
                                  } rounded p-1.5 text-xs text-rose-100">${escapeHtml(effectiveAm)}</textarea>
                      </div>`
                    : ""
                }
              </div>`
            : ""
        }
      </div>
    `;
  }

  const focusInputsHtml = bucket.focuses
    .map(
      (f, idx) => `
      <div class="bg-slate-900 border border-slate-800 rounded-lg p-2.5 space-y-1.5 min-w-0">
        <label class="flex items-center gap-2 text-xs font-semibold text-slate-200 cursor-pointer">
          <input type="checkbox" ${f.achieved ? "checked" : ""}
                 onchange="window.updateWsTaskItem('${safeTabKey}', ${idx}, 'achieved', this.checked)"
                 class="w-3.5 h-3.5 rounded bg-slate-950 border-slate-700 text-emerald-500 cursor-pointer" />
          <span class="${f.achieved ? "line-through text-emerald-400" : ""}">${itemLabel} ${idx + 1}</span>
        </label>
        <textarea id="ws-task-text-${tabKey}-${idx}" rows="2"
                  onpaste="window.handleWsMultiPaste(event, '${safeTabKey}', ${idx})"
                  oninput="window.updateWsTaskItem('${safeTabKey}', ${idx}, 'text', this.value, true)"
                  placeholder="Enter ${itemLabel.toLowerCase()} ${idx + 1} (or paste list to auto-split)..."
                  class="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-xs text-slate-100">${escapeHtml(f.text || "")}</textarea>
        <input id="ws-task-outcome-${tabKey}-${idx}" type="text" value="${escapeHtml(f.outcomeNotes || "")}"
               oninput="window.updateWsTaskItem('${safeTabKey}', ${idx}, 'outcomeNotes', this.value, true)"
               placeholder="Outcome / progress note..."
               class="w-full bg-slate-950/70 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-300" />
      </div>`
    )
    .join("");

  return `
    <div class="bg-slate-900 border border-teal-800/70 rounded-xl p-3 sm:p-4 space-y-3.5 w-full box-border">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs font-bold text-white uppercase tracking-wider">Quick Align & Logs: <strong class="text-teal-300">${escapeHtml(memberName)}</strong></span>
          <a href="va-detail.html#tab=${encodeURIComponent(tabKey)}&name=${encodeURIComponent(memberName)}"
             class="text-xs text-blue-400 hover:text-blue-300 underline">Open Full Dossier ↗</a>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button type="button" onclick="window.toggleWsTasksDrawer()"
                  class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-blue-300 cursor-pointer">
            ${isWsTasksOpen ? "▲ Hide Tasks/Focuses" : "🎯 Tasks/Focuses"}
          </button>
          <button id="ws-save-logs-btn-${escapeHtml(tabKey)}" type="button"
                  onclick="window.saveAllWsLogDrafts('${safeTabKey}')"
                  class="${
                    dirtyCount > 0
                      ? "px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-lg ring-2 ring-amber-400/50 transition cursor-pointer"
                      : "px-3 py-1.5 rounded-lg bg-teal-700/80 hover:bg-teal-600 text-white font-semibold text-xs border border-teal-600/60 transition cursor-pointer"
                  }">
            ${dirtyCount > 0 ? `💾 Save Log Changes (${dirtyCount})` : "💾 Save Log Changes"}
          </button>
        </div>
      </div>

      ${
        isWsTasksOpen
          ? `<div class="bg-slate-950 border ${hasTasksUnsaved ? "border-amber-600/70" : "border-slate-800"} rounded-xl p-3 space-y-3">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold text-blue-300 uppercase">🎯 Tasks/Focuses</span>
                  <span class="text-[9px] px-2 py-0.5 rounded border font-mono font-bold ${
                    isProb ? "bg-amber-950 border-amber-800 text-amber-300" : "bg-sky-950 border-sky-800 text-sky-300"
                  }">${isProb ? "PROBATIONARY" : "REGULAR"}</span>
                </div>
                <div class="flex items-center gap-2">
                  <button type="button" onclick="window.toggleCheckAllWsTasks('${safeTabKey}')"
                          class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-emerald-300 font-semibold text-xs cursor-pointer">
                    ${allChecked ? "☐ Uncheck All" : "✓ Check All"}
                  </button>
                  <button type="button" onclick="window.saveWsTasksDraft('${safeTabKey}')"
                          class="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs cursor-pointer shadow">
                    💾 SAVE
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                ${focusInputsHtml}
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <button type="button" onclick="window.addWsTaskItem('${safeTabKey}')"
                        class="text-xs font-semibold text-blue-400 hover:text-blue-300 bg-blue-950/40 hover:bg-blue-950/70 border border-blue-900/60 px-3 py-1.5 rounded-lg cursor-pointer">
                  + Add ${itemLabel}
                </button>
                <button type="button" onclick="window.clearWsTaskNotes('${safeTabKey}')"
                        class="text-xs font-semibold text-amber-300 hover:text-amber-200 bg-amber-950/40 hover:bg-amber-950/70 border border-amber-800/70 px-3 py-1.5 rounded-lg cursor-pointer">
                  🧹 Clear Notes
                </button>
              </div>

              <div class="pt-2 border-t border-slate-800/80 space-y-1.5">
                <label class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">📝 ADDITIONAL NOTES:</label>
                <textarea id="ws-task-addnotes-${tabKey}" rows="2"
                          oninput="window.updateWsTaskAdditionalNotes('${safeTabKey}', this.value)"
                          placeholder="Enter additional context, client targets, or review notes..."
                          class="w-full bg-slate-900 border border-slate-800 rounded-xl p-2 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono leading-relaxed">${escapeHtml(bucket.additionalNotes || "")}</textarea>
              </div>

              <div class="flex flex-wrap items-center justify-start gap-2 pt-2 border-t border-slate-800">
                <button type="button" onclick="window.appendWsTasksToDraft('${safeTabKey}')"
                        class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs cursor-pointer">
                  Append to Note Draft
                </button>
              </div>
            </div>`
          : ""
      }

      <div class="space-y-1.5">
        <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          📅 Shift Log Entry (${escapeHtml(resolvedRow ? resolvedRow.label : "Current")})
        </div>
        ${shiftCardHtml}
      </div>
    </div>
  `;
}

window.toggleWsTasksDrawer = () => {
  isWsTasksOpen = !isWsTasksOpen;
  withWsFocusPreserved(() => renderSelectedDateView());
};

window.toggleCheckAllWsTasks = (tabKey) => {
  const draft = ensureWsTaskDraft(tabKey);
  const allChecked = draft.focuses.length > 0 && draft.focuses.every((f) => Boolean(f.achieved));
  const nextState = !allChecked;
  draft.focuses = draft.focuses.map((f) => ({ ...f, achieved: nextState }));
  wsTaskDirty[getWsDraftKey(tabKey)] = true;
  withWsFocusPreserved(() => renderSelectedDateView());
};

window.updateWsTaskItem = (tabKey, idx, field, val, skipRerender = false) => {
  const draft = ensureWsTaskDraft(tabKey);
  draft.focuses[idx] = { ...draft.focuses[idx], [field]: val };
  wsTaskDirty[getWsDraftKey(tabKey)] = true;
  if (!skipRerender) withWsFocusPreserved(() => renderSelectedDateView());
};

window.updateWsTaskAdditionalNotes = (tabKey, val) => {
  const draft = ensureWsTaskDraft(tabKey);
  draft.additionalNotes = val;
  wsTaskDirty[getWsDraftKey(tabKey)] = true;
};

window.addWsTaskItem = (tabKey) => {
  const draft = ensureWsTaskDraft(tabKey);
  draft.focuses.push({ id: `f_${Date.now()}`, text: "", achieved: false, outcomeNotes: "" });
  wsTaskDirty[getWsDraftKey(tabKey)] = true;
  withWsFocusPreserved(() => renderSelectedDateView());
};

window.clearWsTaskNotes = (tabKey) => {
  const draft = ensureWsTaskDraft(tabKey);
  draft.focuses = [
    { id: "f_1", text: "", achieved: false, outcomeNotes: "" },
    { id: "f_2", text: "", achieved: false, outcomeNotes: "" },
    { id: "f_3", text: "", achieved: false, outcomeNotes: "" }
  ];
  draft.additionalNotes = "";
  wsTaskDirty[getWsDraftKey(tabKey)] = true;
  withWsFocusPreserved(() => renderSelectedDateView());
  showWsToast("✓ Cleared all Tasks/Focuses and reset to 3 empty items — click SAVE to push.");
};

window.handleWsMultiPaste = (e, tabKey, startIdx) => {
  const items = parsePastedListItems(e.clipboardData);
  if (items.length <= 1) return;
  e.preventDefault();
  const draft = ensureWsTaskDraft(tabKey);
  items.forEach((text, offset) => {
    const target = startIdx + offset;
    if (target < draft.focuses.length) draft.focuses[target] = { ...draft.focuses[target], text };
    else draft.focuses.push({ id: `f_${Date.now()}_${offset}`, text, achieved: false, outcomeNotes: "" });
  });
  wsTaskDirty[getWsDraftKey(tabKey)] = true;
  withWsFocusPreserved(() => renderSelectedDateView());
};

window.saveWsTasksDraft = async (tabKey) => {
  const dKey = getWsDraftKey(tabKey);
  const draft = getWsTaskBucket(tabKey);
  await updateSiteData(`vaGoals/${tabKey}/week_1`, {
    focuses: draft.focuses,
    additionalNotes: draft.additionalNotes
  });
  delete wsTaskDrafts[dKey];
  delete wsTaskDirty[dKey];
  showWsToast(`✓ Saved Tasks/Focuses (synced with VA Dossier)!`);
  withWsFocusPreserved(() => renderSelectedDateView());
};

window.appendWsTasksToDraft = (tabKey) => {
  const selectedTabData = latestDashboardData.selectedTabData || {};
  const tabObj = selectedTabData[tabKey];
  if (!tabObj || !tabObj.rows || !tabObj.rows.length) return;

  const bucket = getWsTaskBucket(tabKey);
  const notesIdx = (tabObj.headers || []).findIndex((h) => h.toLowerCase() === "notes");
  if (notesIdx === -1) return;

  const notesKey = tabObj.cleanHeaders[notesIdx];
  const notesCol = tabObj.colIndices[notesIdx];
  const resolvedRow = resolveSheetRowForSessionDate(tabObj, selectedDate);
  const targetRow = resolvedRow && resolvedRow.row ? resolvedRow.row : tabObj.rows[tabObj.rows.length - 1];

  let block = `\n📋 [Tasks/Focuses]\n`;
  bucket.focuses.forEach((f) => {
    if (f.text && f.text.trim()) {
      block += `• ${f.text.trim()}${f.achieved ? " -> ✓ Achieved" : ""}${
        f.outcomeNotes && f.outcomeNotes.trim() ? ` (${f.outcomeNotes.trim()})` : ""
      }\n`;
    }
  });

  if (bucket.additionalNotes && bucket.additionalNotes.trim()) {
    block += `\n📝 Additional Notes:\n${bucket.additionalNotes.trim()}\n`;
  }

  const rKey = getWsRowDraftKey(tabKey, targetRow._sheetRow);
  const existingDraft = wsLogDrafts[rKey];
  const existing =
    existingDraft && existingDraft.notesDirty
      ? existingDraft.notesVal.trim()
      : String(targetRow[notesKey] || "").trim();
  const combined = existing ? `${existing}\n${block.trim()}` : block.trim();

  stageWsRowDraft(tabKey, targetRow._sheetRow, {
    tabName: tabObj.tabName,
    notesCol,
    notesVal: combined,
    notesDirty: true
  });

  withWsFocusPreserved(() => renderSelectedDateView());
  showWsToast(`✓ Appended to Row ${targetRow._sheetRow} draft — click "Save Log Changes" to push to Sheet.`);
};

window.stageWsNoteEdit = (tabKey, tabName, sheetRow, colIndex, val) => {
  stageWsRowDraft(tabKey, sheetRow, {
    tabName,
    notesCol: colIndex,
    notesVal: val,
    notesDirty: true
  });
};

window.stageWsFlagEdit = (tabKey, tabName, sheetRow, colIndex, val, selectEl) => {
  stageWsRowDraft(tabKey, sheetRow, {
    tabName,
    flagCol: colIndex,
    flagVal: val,
    flagDirty: true
  });
  if (selectEl) {
    selectEl.className = `px-2.5 py-1 rounded border text-xs cursor-pointer ${getFlagSelectStyle(val)}`;
  }
  withWsFocusPreserved(() => renderSelectedDateView());
};

window.stageWsAmEdit = (tabKey, tabName, sheetRow, redFlagCol, amKey, val) => {
  stageWsRowDraft(tabKey, sheetRow, {
    tabName,
    redFlagCol: redFlagCol || 7,
    amKey,
    amVal: val,
    amDirty: true
  });
};

window.toggleWsAmRow = (amKey) => {
  expandedWsAmRows[amKey] = !expandedWsAmRows[amKey];
  withWsFocusPreserved(() => renderSelectedDateView());
};

window.saveAllWsLogDrafts = async (tabKey) => {
  const dirtyEntries = getWsActiveTabDirtyEntries(tabKey);
  if (!dirtyEntries.length) {
    showWsToast("No unsaved log changes to save.");
    return;
  }

  isSavingWsLogs = true;
  updateWsSaveBtnUI(tabKey);
  showWsToast(`Saving ${dirtyEntries.length} modified row(s) to Google Sheets...`);

  try {
    const selectedTabData = latestDashboardData.selectedTabData || {};
    const tabObj = selectedTabData[tabKey];
    const amUpdates = {};

    const updatePromises = dirtyEntries.map(async (entry) => {
      const promises = [];

      if (tabObj && Array.isArray(tabObj.rows)) {
        const targetRow = tabObj.rows.find((r) => r._sheetRow === entry.sheetRow);
        if (targetRow) {
          if (entry.notesDirty && tabObj.cleanHeaders && tabObj.colIndices) {
            const hIdx = tabObj.colIndices.indexOf(entry.notesCol);
            if (hIdx !== -1) targetRow[tabObj.cleanHeaders[hIdx]] = entry.notesVal;
            targetRow["Notes"] = entry.notesVal;
            targetRow["notes"] = entry.notesVal;
          }
          if (entry.flagDirty && tabObj.cleanHeaders && tabObj.colIndices) {
            const fIdx = tabObj.colIndices.indexOf(entry.flagCol);
            if (fIdx !== -1) targetRow[tabObj.cleanHeaders[fIdx]] = entry.flagVal;
            targetRow["Flag"] = entry.flagVal;
            targetRow["flag"] = entry.flagVal;
          }
          if (entry.amDirty) {
            const targetCol = entry.redFlagCol || 7;
            if (tabObj.cleanHeaders && tabObj.colIndices) {
              const rfIdx = tabObj.colIndices.indexOf(targetCol);
              if (rfIdx !== -1) targetRow[tabObj.cleanHeaders[rfIdx]] = entry.amVal;
            }
            targetRow["RED_FLAG_COMMS"] = entry.amVal;
            targetRow["RED FLAG COMMS"] = entry.amVal;
          }
        }
      }

      if (entry.notesDirty && entry.notesCol) {
        promises.push(
          Promise.race([
            updateSheetCell({
              tabName: entry.tabName,
              sheetRow: entry.sheetRow,
              colIndex: entry.notesCol,
              value: entry.notesVal
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Sheet update timeout")), 10000))
          ])
        );
      }

      if (entry.flagDirty && entry.flagCol) {
        promises.push(
          Promise.race([
            updateSheetCell({
              tabName: entry.tabName,
              sheetRow: entry.sheetRow,
              colIndex: entry.flagCol,
              value: entry.flagVal
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Sheet update timeout")), 10000))
          ])
        );
      }

      if (entry.amDirty) {
        const targetCol = entry.redFlagCol || 7;
        if (entry.tabName) {
          promises.push(
            Promise.race([
              updateSheetCell({
                tabName: entry.tabName,
                sheetRow: entry.sheetRow,
                colIndex: targetCol,
                value: entry.amVal
              }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Sheet update timeout")), 10000))
            ])
          );
        }
        if (entry.amKey) {
          amUpdates[entry.amKey] = entry.amVal;
        }
      }

      await Promise.all(promises);
      delete wsLogDrafts[getWsRowDraftKey(entry.tabKey, entry.sheetRow)];
    });

    await Promise.all(updatePromises);

    if (Object.keys(amUpdates).length) {
      await updateSiteData("amComms", amUpdates);
    }

    showWsToast(`✓ Saved all ${dirtyEntries.length} row(s) to Google Sheets!`);
  } catch (err) {
    showWsToast(`Error saving logs: ${err.message}`);
  } finally {
    isSavingWsLogs = false;
    hasDeferredWsRender = false;
    updateWsSaveBtnUI(tabKey);
    renderSelectedDateView();
  }
};

function renderSelectedDateView() {
  const tbody = document.getElementById("hs-tbody");
  const baseRows = isUsingManualPaste ? pastedRows : allFirebaseRows;
  const rawRowsForDay = selectedDate
    ? baseRows.filter((r) => String(r.date || "").trim() === selectedDate)
    : [];

  const selectedTabData = latestDashboardData.selectedTabData || {};
  const siteProfiles = (latestDashboardData.siteData && latestDashboardData.siteData.vaProfiles) || {};
  const wsHiddenSet = getWsHiddenSet();
  let activeHiddenCount = 0;

  const matchedTabKeys = new Set();

  // 1. Enrich present Hubstaff session rows
  const presentEnriched = rawRowsForDay.map((r) => {
    const resolvedTab = resolveTabEntryForMember(r.member);
    const tabKey = resolvedTab ? resolvedTab.tabKey : "";
    const tabObj = resolvedTab ? resolvedTab.tabObj : null;
    if (tabKey) matchedTabKeys.add(tabKey);

    const normName = String(r.member || "").trim().toLowerCase();
    const normTab = String(tabKey || "").trim().toLowerCase();
    const isHidden = wsHiddenSet.has(normName) || (normTab && wsHiddenSet.has(normTab));
    if (isHidden) activeHiddenCount++;

    const overviewVa = resolveOverviewVaForMember(r.member, tabKey, tabObj);

    return {
      ...r,
      _isPresent: true,
      _statusType: "present",
      _tabKey: tabKey,
      _flag: getMemberFlagForSelectedDate(tabKey, tabObj),
      _overviewVa: overviewVa,
      _isHidden: isHidden,
      _sched: getMemberTimeOnlySchedule(r.member, tabObj)
    };
  });

  // 2. Synthesize active VAs from va-detail (selectedTabData) who are NOT present in Hubstaff for selectedDate
  const missingEnriched = [];
  if (selectedDate && !isUsingManualPaste) {
    Object.entries(selectedTabData).forEach(([tabKey, tabObj]) => {
      if (!tabObj || matchedTabKeys.has(tabKey)) return;
      const profile = siteProfiles[tabKey] || {};
      if (profile.active === false) return; // Skip VAs explicitly marked INACTIVE in Dossier

      const displayName = String(tabObj.fullName || tabObj.tabName || tabKey).trim();
      const normName = displayName.toLowerCase();
      const normTab = String(tabKey).trim().toLowerCase();
      const isHidden = wsHiddenSet.has(normName) || wsHiddenSet.has(normTab);
      if (isHidden) activeHiddenCount++;

      const schedObj = getTimeOnlyScheduleFromTabObj(tabObj);
      const statusEval = evaluateMissingVaStatus(
        displayName,
        tabObj.fullName,
        tabObj.tabName,
        schedObj,
        selectedDate
      );
      const overviewVa = resolveOverviewVaForMember(displayName, tabKey, tabObj);

      missingEnriched.push({
        key: `${selectedDate}__absent__${tabKey}`,
        date: selectedDate,
        member: displayName,
        started: "—",
        stopped: "—",
        totalSeconds: 0,
        totalDuration: "0:00:00",
        avgActivityPct: 0,
        sessions: [],
        _isPresent: false,
        _statusType: statusEval.statusType, // "absent" | "leave" | "upcoming"
        _leavePolicy: statusEval.policy || "",
        _leaveReason: statusEval.reason || "",
        _tabKey: tabKey,
        _flag: getMemberFlagForSelectedDate(tabKey, tabObj),
        _overviewVa: overviewVa,
        _isHidden: isHidden,
        _sched: schedObj
      });
    });
  }

  const allCombinedRows = [...presentEnriched, ...missingEnriched].filter(
    (r) => showWsHidden || !r._isHidden
  );

  updateWsHiddenControlsUI(activeHiddenCount);
  populateStartTimeFilterDropdown(allCombinedRows);

  // 3. Apply search, presence, start time, and activity filters
  const hasActiveFilter = Boolean(
    hsSearchQuery ||
      hsPresenceFilter !== "all" ||
      hsStartTimeFilter !== "all" ||
      hsActivityFilter !== "all"
  );
  if (hsClearFiltersBtn) {
    if (hasActiveFilter) hsClearFiltersBtn.classList.remove("hidden");
    else hsClearFiltersBtn.classList.add("hidden");
  }

  const filteredRowsForDay = allCombinedRows.filter((r) => {
    if (hsPresenceFilter === "present" && !r._isPresent) return false;
    if (hsPresenceFilter === "absent" && r._isPresent) return false;

    if (hsStartTimeFilter !== "all") {
      if (!r._sched || r._sched.startTime !== hsStartTimeFilter) return false;
    }

    if (hsActivityFilter !== "all") {
      if (!r._isPresent) return false;
      const act = Number(r.avgActivityPct) || 0;
      if (hsActivityFilter === "low" && act >= 30) return false;
      if (hsActivityFilter === "mid" && (act < 30 || act >= 50)) return false;
      if (hsActivityFilter === "high" && act < 50) return false;
    }

    if (hsSearchQuery) {
      const sessions = Array.isArray(r.sessions) ? r.sessions : [];
      const projStr = sessions.map((s) => `${s.project || ""} ${s.todo || ""}`).join(" ");
      const schedStr = r._sched ? `${r._sched.label} ${r._sched.shiftType}` : "";
      const focusStr = (r._overviewVa && r._overviewVa.coachingFocus) || "";
      const flagStr = r._flag || "";
      const statusStr =
        r._statusType === "leave"
          ? `on leave ${r._leavePolicy}`
          : r._statusType === "upcoming"
          ? "upcoming"
          : r._isPresent
          ? "present"
          : "not present absent";
      const haystack = `${r.member || ""} ${flagStr} ${schedStr} ${projStr} ${statusStr} ${focusStr}`.toLowerCase();
      if (!haystack.includes(hsSearchQuery)) return false;
    }
    return true;
  });

  if (hsFilterCountLabel) {
    const presentCount = filteredRowsForDay.filter((r) => r._isPresent).length;
    const absentCount = filteredRowsForDay.filter((r) => !r._isPresent).length;
    hsFilterCountLabel.textContent = `Showing ${filteredRowsForDay.length} (${presentCount} present • ${absentCount} not present/leave)`;
  }

  // 4. Sort (Default: Schedule start time ascending, then alphabetical)
  const dirMult = hsSortDir === "asc" ? 1 : -1;
  const rowsForDay = [...filteredRowsForDay].sort((a, b) => {
    const va = getHsSortVal(a, hsSortCol);
    const vb = getHsSortVal(b, hsSortCol);
    if (typeof va === "number" && typeof vb === "number") {
      if (va !== vb) return (va - vb) * dirMult;
      return String(a.member || "").localeCompare(String(b.member || ""));
    }
    return String(va).localeCompare(String(vb)) * dirMult;
  });

  // 5. KPIs reflect present members only
  const presentFilteredRows = rowsForDay.filter((r) => r._isPresent);
  const uniqueMembers = new Set(presentFilteredRows.map((r) => r.member));
  const grandTotalSec = presentFilteredRows.reduce((acc, r) => acc + (Number(r.totalSeconds) || 0), 0);
  const weightedTotalAct = presentFilteredRows.reduce(
    (acc, r) => acc + (Number(r.totalSeconds) || 0) * (Number(r.avgActivityPct) || 0),
    0
  );
  const overallAvgAct = grandTotalSec > 0 ? Math.round(weightedTotalAct / grandTotalSec) : 0;
  const lowActCount = presentFilteredRows.filter((r) => (Number(r.avgActivityPct) || 0) < 30).length;

  document.getElementById("hs-kpi-members").textContent = String(uniqueMembers.size);
  document.getElementById("hs-kpi-time").textContent = formatSeconds(grandTotalSec);

  const kpiActEl = document.getElementById("hs-kpi-activity");
  kpiActEl.textContent = presentFilteredRows.length ? `${overallAvgAct}%` : "-";
  kpiActEl.className =
    presentFilteredRows.length && overallAvgAct < 30
      ? "text-2xl font-bold text-rose-400 mt-0.5"
      : presentFilteredRows.length && overallAvgAct >= 50
      ? "text-2xl font-bold text-emerald-400 mt-0.5"
      : "text-2xl font-bold text-amber-300 mt-0.5";

  document.getElementById("hs-kpi-low").textContent = String(lowActCount);

  if (!rowsForDay.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-slate-500">No members match ${escapeHtml(selectedDate || "this date")} / current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = rowsForDay
    .map((r) => {
      const safeKey = String(r.key).replace(/'/g, "\\'");
      const safeMember = String(r.member || "").replace(/'/g, "\\'");
      const safeTabKey = String(r._tabKey || "").replace(/'/g, "\\'");
      const isSessionsExpanded = expandedRowKeys.has(r.key);
      const isAlignExpanded = expandedAlignMemberKey === r.key;
      const sessions = Array.isArray(r.sessions) ? r.sessions : [];
      const schedLabel = r._sched ? r._sched.label : "—";
      const shiftTypeLabel = (r._sched && r._sched.shiftType) || "Full Time";

      const ov = r._overviewVa || {};
      const ovCoachingFocus = ov.coachingFocus || "On track";
      const ovActivity = ov.avgActivity || "-";
      const ovAvgHrs = ov.avgHrsPerDay || "-";

      let presenceBadgeHtml = "";
      if (!r._isPresent) {
        if (r._statusType === "leave") {
          const tip = `${r._leavePolicy}${r._leaveReason ? ` — ${r._leaveReason}` : ""}`;
          presenceBadgeHtml = `<span title="${escapeHtml(tip)}" class="inline-flex items-center px-2 py-0.2 rounded-full text-[10px] font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-700">🌴 On Leave</span>`;
        } else if (r._statusType === "upcoming") {
          presenceBadgeHtml = `<span title="Shift has not started yet" class="inline-flex items-center px-2 py-0.2 rounded-full text-[10px] font-semibold bg-sky-950/90 text-sky-300 border border-sky-700">⏳ Upcoming</span>`;
        } else {
          presenceBadgeHtml = `<span title="No Hubstaff session logged for this date" class="inline-flex items-center px-2 py-0.2 rounded-full text-[10px] font-bold bg-rose-950/90 text-rose-300 border border-rose-700">⚠️ Not Present</span>`;
        }
      }

      const alignDrawerRow = isAlignExpanded
        ? `<tr class="bg-slate-950/95 border-b border-teal-800/60">
            <td colspan="9" class="p-3">
              ${buildWsQuickAlignHtml(r.member, r._tabKey || null)}
            </td>
          </tr>`
        : "";

      const subRows =
        r._isPresent && isSessionsExpanded
          ? `<tr>
              <td colspan="9" class="bg-slate-950/90 px-6 py-3 border-l-4 border-teal-500">
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

      const rowTintClass = !r._isPresent
        ? r._statusType === "leave"
          ? "bg-emerald-950/10"
          : r._statusType === "upcoming"
          ? "bg-slate-900/40"
          : "bg-rose-950/15"
        : "";

      return `
        <tr class="hover:bg-slate-800/40 transition-colors ${rowTintClass} ${isAlignExpanded ? "bg-slate-900/80" : ""} ${r._isHidden ? "opacity-60 bg-slate-950/60" : ""}">
          <td class="px-3 py-2.5 text-center whitespace-nowrap">
            <div class="inline-flex items-center gap-1">
              <button type="button" onclick="window.toggleWsAlignAccordion('${safeKey}')"
                      class="px-2.5 py-1 rounded-md text-[11px] font-bold border transition cursor-pointer ${
                        isAlignExpanded
                          ? "bg-teal-700 text-white border-teal-500"
                          : "bg-slate-900 hover:bg-slate-800 text-teal-300 border-slate-700"
                      }">
                ${isAlignExpanded ? "− Close" : "+ Align"}
              </button>
              ${
                r._isHidden
                  ? `<button type="button" onclick="window.unhideWsMember('${safeMember}', '${safeTabKey}')"
                             title="Restore VA to Work Sessions"
                             class="px-2 py-1 rounded-md text-[10px] font-bold bg-amber-950 hover:bg-amber-900 text-amber-300 border border-amber-700 cursor-pointer">
                       Unhide
                     </button>`
                  : `<button type="button" onclick="window.hideWsMember('${safeMember}', '${safeTabKey}')"
                             title="Hide VA from Work Sessions"
                             class="px-2 py-1 rounded-md text-[10px] font-semibold bg-slate-900 hover:bg-rose-950/70 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-800 cursor-pointer">
                       Hide
                     </button>`
              }
            </div>
          </td>
          <td class="px-4 py-2.5 font-bold whitespace-nowrap relative group">
            <div class="flex items-center gap-2">
              <a href="va-detail.html#tab=${encodeURIComponent(r._tabKey || r.member)}&name=${encodeURIComponent(r.member)}"
                 onclick="try { sessionStorage.setItem('kitsune_target_tab', JSON.stringify({ id: '${safeTabKey}', name: '${safeMember}' })); } catch (_) {}"
                 title="Open ${escapeHtml(r.member)}'s VA Dossier"
                 class="${r._isPresent ? "text-white hover:text-teal-300" : "text-slate-300 hover:text-teal-300"} underline decoration-dotted decoration-teal-700 hover:decoration-teal-400 underline-offset-4 transition-colors cursor-pointer">
                ${escapeHtml(r.member)}
              </a>
              ${presenceBadgeHtml}
              ${r._isHidden ? '<span class="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-amber-300 border border-amber-700/60 font-mono">HIDDEN</span>' : ""}
            </div>

            <!-- Floating Overview Hover Card (Coaching Focus, FT/PT, 7d Activity, Avg Hrs) -->
            <div class="hidden group-hover:block absolute left-4 bottom-full mb-2 z-55 w-72 bg-slate-950/95 backdrop-blur-md border border-teal-700/70 rounded-xl p-3 shadow-2xl pointer-events-none space-y-2 text-left whitespace-normal font-normal">
              <div class="flex items-center justify-between border-b border-slate-800 pb-1.5">
                <span class="text-[10px] font-bold uppercase tracking-wider text-teal-300">${escapeHtml(r.member)}</span>
                <span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200">${escapeHtml(shiftTypeLabel)}</span>
              </div>

              <div class="grid grid-cols-2 gap-2 pt-0.5 text-center font-mono">
                <div class="bg-slate-900 border border-slate-800 rounded-lg p-1.5">
                  <span class="block text-[9px] text-slate-400 font-sans">Activity (7d)</span>
                  <div class="mt-0.5 text-xs">${ovActivity !== "-" ? formatConditionalActivityBadge(ovActivity) : '<span class="text-slate-400">-</span>'}</div>
                </div>
                <div class="bg-slate-900 border border-slate-800 rounded-lg p-1.5">
                  <span class="block text-[9px] text-slate-400 font-sans">Avg Hrs / Day</span>
                  <strong class="text-xs text-teal-300">${escapeHtml(ovAvgHrs)}</strong>
                </div>
              </div>

              <div class="text-[11px] flex items-center justify-between gap-2 pt-0.5">
                <span class="text-slate-400">Coaching Focus:</span>
                <span>${formatHoverCoachingFocus(ovCoachingFocus)}</span>
              </div>
            </div>
          </td>
          <td class="px-3 py-2.5 text-center whitespace-nowrap">
            ${renderFlagBadgeHtml(r._flag)}
          </td>
          <td class="px-3 py-2.5 text-center font-mono whitespace-nowrap">
            <span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-950 border border-slate-700 text-teal-200">
              ${escapeHtml(schedLabel)}
            </span>
          </td>
          <td class="px-3 py-2.5 text-center font-mono text-slate-300 whitespace-nowrap">${escapeHtml(r.started || "—")}</td>
          <td class="px-3 py-2.5 text-center font-mono text-slate-300 whitespace-nowrap">${escapeHtml(r.stopped || "—")}</td>
          <td class="px-3 py-2.5 text-center font-mono font-bold ${r._isPresent ? "text-teal-300" : "text-slate-500"} whitespace-nowrap">${escapeHtml(r.totalDuration || "0:00:00")}</td>
          <td class="px-3 py-2.5 text-center font-mono whitespace-nowrap">
            ${r._isPresent ? formatConditionalActivityBadge(`${r.avgActivityPct || 0}%`) : '<span class="text-slate-500">—</span>'}
          </td>
          <td class="px-3 py-2.5 text-center whitespace-nowrap">
            ${
              r._isPresent
                ? `<button type="button" onclick="window.toggleSessionDetails('${safeKey}')"
                           class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-teal-300 text-[11px] font-semibold cursor-pointer">
                     ${isSessionsExpanded ? "Hide" : `${sessions.length} session(s)`}
                   </button>`
                : `<span class="text-[11px] text-slate-500 font-mono">0 sessions</span>`
            }
          </td>
        </tr>
        ${alignDrawerRow}
        ${subRows}
      `;
    })
    .join("");
}
