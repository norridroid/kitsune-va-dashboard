import { subscribeCached, updateSheetCell, updateSiteData } from "./firebase.js";
import {
  renderTopNav,
  escapeHtml,
  getHiddenVaSet,
  findMatchingTabEntry,
  deriveScheduleFromTab,
  buildScheduleColorMap,
  parsePastedListItems,
  formatConditionalActivityBadge
} from "./schedule.js";

function formatCoachingFocusBadge(rawFocus) {
  const text = String(rawFocus || "On track").trim();
  const lower = text.toLowerCase();
  if (lower === "on track" || lower === "-") {
    return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950/70 text-emerald-300 border border-emerald-800/80">${escapeHtml(text)}</span>`;
  }
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800">${escapeHtml(text)}</span>`;
}

renderTopNav("overview");

const COLUMN_CONFIG = [
  { key: "actions", label: "Actions", locked: true },
  { key: "va", label: "VA", locked: true },
  { key: "schedule", label: "Schedule" },
  { key: "status", label: "Status Now" },
  { key: "days", label: "Days" },
  { key: "avgHrs", label: "Avg Hrs" },
  { key: "late", label: "Late" },
  { key: "earlyShort", label: "Early / Short" },
  { key: "activity", label: "Activity" },
  { key: "flagDays", label: "Flag Days" },
  { key: "flags30d", label: "30d Flags" },
  { key: "tlFlags", label: "TL Flags" },
  { key: "coaching", label: "Coaching Focus" }
];

const HIDDEN_COLS_STORAGE_KEY = "kitsune_overview_hidden_cols";
const HIDDEN_VAS_STORAGE_KEY = "kitsune_hidden_vas";

let hiddenCols = new Set();
try {
  const savedCols = JSON.parse(localStorage.getItem(HIDDEN_COLS_STORAGE_KEY) || "[]");
  if (Array.isArray(savedCols)) hiddenCols = new Set(savedCols);
} catch (_) {}

function saveHiddenCols() {
  try {
    localStorage.setItem(HIDDEN_COLS_STORAGE_KEY, JSON.stringify([...hiddenCols]));
  } catch (_) {}
}

function getVisibleColCount() {
  return COLUMN_CONFIG.filter((c) => c.locked || !hiddenCols.has(c.key)).length;
}

function applyColumnVisibilityToHeader() {
  COLUMN_CONFIG.forEach((col) => {
    const th = document.querySelector(`th[data-col="${col.key}"]`);
    if (!th) return;
    if (!col.locked && hiddenCols.has(col.key)) {
      th.classList.add("hidden");
    } else {
      th.classList.remove("hidden");
    }
  });
}

function syncStickyDrawerWidths() {
  const tableWrapper = document.querySelector("#va-tbody")?.closest(".overflow-x-auto");
  const visibleWidth = tableWrapper ? tableWrapper.clientWidth : window.innerWidth - 32;
  document.querySelectorAll(".kitsune-sticky-drawer").forEach((el) => {
    el.style.width = `${Math.max(visibleWidth - 16, 280)}px`;
  });
}

window.addEventListener("resize", syncStickyDrawerWidths);

function initColumnMenuUI() {
  const menuBtn = document.getElementById("toggle-columns-menu-btn");
  const dropdown = document.getElementById("columns-menu-dropdown");
  const listEl = document.getElementById("columns-checkbox-list");
  const resetBtn = document.getElementById("reset-columns-btn");

  if (!menuBtn || !dropdown || !listEl) return;

  const renderCheckboxes = () => {
    listEl.innerHTML = COLUMN_CONFIG.filter((c) => !c.locked)
      .map(
        (col) => `
        <label class="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-slate-800 cursor-pointer text-slate-200 select-none">
          <input type="checkbox" ${!hiddenCols.has(col.key) ? "checked" : ""}
                 onchange="window.toggleOverviewColumn('${col.key}', this.checked)"
                 class="rounded bg-slate-950 border-slate-700 text-teal-500 cursor-pointer" />
          <span>${escapeHtml(col.label)}</span>
        </label>`
      )
      .join("");
  };

  renderCheckboxes();

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("hidden");
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && e.target !== menuBtn) {
      dropdown.classList.add("hidden");
    }
  });

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      hiddenCols.clear();
      saveHiddenCols();
      renderCheckboxes();
      applyColumnVisibilityToHeader();
      renderDashboard();
    });
  }
}

window.toggleOverviewColumn = (colKey, isVisible) => {
  if (isVisible) hiddenCols.delete(colKey);
  else hiddenCols.add(colKey);
  saveHiddenCols();
  applyColumnVisibilityToHeader();
  renderDashboard();
};

initColumnMenuUI();
applyColumnVisibilityToHeader();

let latestData = {};
let sortMode = "schedule";
let searchFilter = "";
let showHiddenVas = false;
let expandedVaId = null;
let isAccordionGoalsOpen = false;
let expandedAmRows = {};

let overviewSowDrafts = {};
let overviewSowDirty = {};
let overviewLogDrafts = {};
let isSavingOverviewLogs = false;

subscribeCached("kitsuneDashboard", "kitsune_overview_cache", (data) => {
  if (!data) return;
  latestData = data;
  renderDashboard();
});

function showOverviewToast(msg) {
  let toast = document.getElementById("overview-save-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "overview-save-toast";
    toast.className =
      "fixed bottom-5 right-5 z-[60] bg-slate-900 border border-teal-600 text-teal-200 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-2xl";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.add("hidden"), 3500);
}

const searchInputEl =
  document.getElementById("va-search") ||
  document.getElementById("search-input") ||
  document.querySelector('input[placeholder*="Filter by VA"]');

if (searchInputEl) {
  searchInputEl.addEventListener("input", (e) => {
    searchFilter = String(e.target.value || "").trim().toLowerCase();
    renderDashboard();
  });
}

const sortSchedBtn =
  document.getElementById("sort-schedule-btn") ||
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Order by Schedule");
const sortSheetBtn =
  document.getElementById("sheet-order-btn") ||
  document.getElementById("sort-sheet-btn") ||
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Sheet Order");

function updateSortButtonsUI() {
  if (sortSchedBtn) {
    sortSchedBtn.className =
      sortMode === "schedule"
        ? "px-3 py-1.5 rounded-lg bg-teal-600 text-white font-semibold text-xs cursor-pointer"
        : "px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 cursor-pointer";
  }
  if (sortSheetBtn) {
    sortSheetBtn.className =
      sortMode === "sheet"
        ? "px-3 py-1.5 rounded-lg bg-teal-600 text-white font-semibold text-xs cursor-pointer"
        : "px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs border border-slate-700 cursor-pointer";
  }
}

if (sortSchedBtn) {
  sortSchedBtn.addEventListener("click", () => {
    sortMode = "schedule";
    updateSortButtonsUI();
    renderDashboard();
  });
}
if (sortSheetBtn) {
  sortSheetBtn.addEventListener("click", () => {
    sortMode = "sheet";
    updateSortButtonsUI();
    renderDashboard();
  });
}

const toggleHiddenBtn = document.getElementById("toggle-hidden-btn");
const unhideAllBtn = document.getElementById("unhide-all-btn");

if (toggleHiddenBtn) {
  toggleHiddenBtn.addEventListener("click", () => {
    showHiddenVas = !showHiddenVas;
    renderDashboard();
  });
}

if (unhideAllBtn) {
  unhideAllBtn.addEventListener("click", () => {
    try {
      localStorage.removeItem(HIDDEN_VAS_STORAGE_KEY);
    } catch (_) {}
    showHiddenVas = false;
    showOverviewToast("✓ Restored all hidden VAs!");
    renderDashboard();
  });
}

window.hideSingleVa = (vaId) => {
  const current = getHiddenVaSet();
  current.add(vaId);
  try {
    localStorage.setItem(HIDDEN_VAS_STORAGE_KEY, JSON.stringify([...current]));
  } catch (_) {}
  if (expandedVaId === vaId) expandedVaId = null;
  showOverviewToast("VA hidden — click 'Show hidden' or 'Restore all' in the toolbar to bring them back.");
  renderDashboard();
};

window.unhideSingleVa = (vaId) => {
  const current = getHiddenVaSet();
  current.delete(vaId);
  try {
    localStorage.setItem(HIDDEN_VAS_STORAGE_KEY, JSON.stringify([...current]));
  } catch (_) {}
  if (current.size === 0) showHiddenVas = false;
  showOverviewToast("✓ VA restored to Overview!");
  renderDashboard();
};

function updateHiddenVaControlsUI(hiddenCount) {
  if (!toggleHiddenBtn || !unhideAllBtn) return;
  if (hiddenCount > 0) {
    toggleHiddenBtn.classList.remove("hidden");
    unhideAllBtn.classList.remove("hidden");
    toggleHiddenBtn.textContent = showHiddenVas
      ? `Hide hidden (${hiddenCount})`
      : `Show hidden (${hiddenCount})`;
  } else {
    toggleHiddenBtn.classList.add("hidden");
    unhideAllBtn.classList.add("hidden");
    showHiddenVas = false;
  }
}

window.openVaPage = (tabKey, vaName) => {
  const safeKey = String(tabKey || "").trim();
  const safeName = String(vaName || "").trim();
  try {
    sessionStorage.setItem("kitsune_target_tab", JSON.stringify({ id: safeKey, name: safeName }));
  } catch (_) {}
  window.location.href = `va-detail.html#tab=${encodeURIComponent(safeKey)}&name=${encodeURIComponent(safeName)}`;
};

window.toggleVaAccordion = (vaId) => {
  expandedVaId = expandedVaId === vaId ? null : vaId;
  isAccordionGoalsOpen = false;
  renderDashboard();
};

function toLocalIsoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseRowDateToIso(rawStr) {
  const s = String(rawStr || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const dmyMatch = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1];
    const mon = dmyMatch[2];
    const yr = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    const parsedDmy = new Date(`${mon} ${day}, ${yr}`);
    if (!isNaN(parsedDmy.getTime())) return toLocalIsoDate(parsedDmy);
  }

  const hasYear = /\b20\d{2}\b/.test(s);
  const candidate = hasYear ? s : `${s}, ${new Date().getFullYear()}`;
  const d = new Date(candidate);
  if (isNaN(d.getTime())) return "";

  return toLocalIsoDate(d);
}

/**
 * Checks how many days ago the VA's Notes were last updated (Yesterday = 1d, 2d ago, 3+ days ago).
 */
function getOverviewNoteStalenessBadge(tabObj) {
  if (!tabObj || !Array.isArray(tabObj.rows) || !tabObj.rows.length) return "";

  const headers = tabObj.headers || [];
  const cleanHeaders = tabObj.cleanHeaders || [];
  const dateIdx = headers.findIndex((h, idx) => idx === 0 || /week|date/i.test(h));
  const dateKey = dateIdx !== -1 ? cleanHeaders[dateIdx] : cleanHeaders[0];
  const notesIdx = headers.findIndex((h) => h.toLowerCase() === "notes");
  const notesKey = notesIdx !== -1 ? cleanHeaders[notesIdx] : "Notes";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = toLocalIsoDate(today);

  let latestNoteIso = "";
  let latestNoteDateLabel = "";

  tabObj.rows.forEach((r) => {
    const rawDate = String(r[dateKey] || "").trim();
    const iso = parseRowDateToIso(rawDate);
    if (!iso || iso > todayIso) return;

    const noteVal = String(r[notesKey] !== undefined ? r[notesKey] : r.Notes || r.notes || "").trim();
    if (noteVal.length > 0) {
      if (!latestNoteIso || iso > latestNoteIso) {
        latestNoteIso = iso;
        latestNoteDateLabel = rawDate;
      }
    }
  });

  if (!latestNoteIso) {
    return `<span title="No notes logged yet" class="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-rose-950 text-rose-300 border border-rose-700 animate-pulse">🚨 No notes</span>`;
  }

  const lastDate = new Date(`${latestNoteIso}T00:00:00`);
  const diffDays = Math.round((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return "";

  if (diffDays === 1) {
    return `<span title="Last note updated Yesterday (${escapeHtml(latestNoteDateLabel)})" class="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-950/90 text-amber-300 border border-amber-700">⚠️ Yesterday</span>`;
  }

  if (diffDays === 2) {
    return `<span title="No note updated for 2 days (Last: ${escapeHtml(latestNoteDateLabel)})" class="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-orange-950/90 text-orange-300 border border-orange-700">🟠 2d ago</span>`;
  }

  return `<span title="No note updated for ${diffDays} days (Last: ${escapeHtml(latestNoteDateLabel)})" class="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-rose-950 text-rose-300 border border-rose-700 animate-pulse">🚨 ${diffDays}d ago</span>`;
}

function findCurrentDateActivityForVa(vaName, tabObj, liveRows) {
  if (!Array.isArray(liveRows) || !liveRows.length) return null;
  const clean = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const targetVa = clean(vaName);
  const fullName = clean((tabObj && tabObj.fullName) || "");
  const tabName = clean((tabObj && tabObj.tabName) || "");
  const firstTwo = (fullName || targetVa).split(" ").slice(0, 2).join(" ");

  const matchingMemberRows = liveRows.filter((r) => {
    const m = clean(r.member);
    return (
      m === targetVa ||
      (fullName && m === fullName) ||
      (tabName && m === tabName) ||
      (firstTwo && m.startsWith(firstTwo))
    );
  });

  if (!matchingMemberRows.length) return null;
  matchingMemberRows.sort((a, b) => String(b.dateIso || b.date || "").localeCompare(String(a.dateIso || a.date || "")));
  return matchingMemberRows[0];
}

function renderDashboard() {
  const data = latestData || {};
  const kpis = data.kpis || {};

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setText("sheet-updated", kpis.sheetUpdatedLabel || "Connected");
  setText("sheet-updated-label", kpis.sheetUpdatedLabel || "Connected");
  setText("kpi-total", kpis.totalVAs ?? "-");
  setText("kpi-logged", kpis.loggedInNow ?? "-");
  setText("kpi-late", kpis.lateClockIns7d ?? "-");

  const avgActEl = document.getElementById("kpi-activity");
  if (avgActEl) {
    const rawAvgAct = kpis.avgActivity7d ?? "-";
    avgActEl.innerHTML =
      rawAvgAct !== "-" && rawAvgAct !== "" ? formatConditionalActivityBadge(rawAvgAct) : "-";
  }

  setText("kpi-attention", kpis.needAttention ?? "-");

  const vas = data.vas || {};
  const order = Array.isArray(data.vaOrder) ? data.vaOrder : Object.keys(vas);
  const selectedTabData = data.selectedTabData || {};
  const siteProfiles = (data.siteData && data.siteData.vaProfiles) || {};
  const liveData = data.hubstaffLive || {};
  const liveRows = Array.isArray(liveData.rows) ? liveData.rows : Object.values(liveData.rows || {});
  const hiddenSet = getHiddenVaSet();
  const tbody = document.getElementById("va-tbody");
  if (!tbody) return;

  applyColumnVisibilityToHeader();
  const visibleColSpan = getVisibleColCount();

  let activeHiddenCount = 0;

  const enrichedList = order
    .filter((id) => {
      const v = vas[id];
      if (!v) return false;
      const vaText = String(v.va || "").trim();
      const lower = vaText.toLowerCase();
      if (
        !vaText ||
        vaText.length > 60 ||
        lower.startsWith("late / early") ||
        lower.startsWith("this tab is rebuilt") ||
        lower.startsWith("tl flags =") ||
        lower.includes("don't type here") ||
        lower.includes("need the va's scheduled")
      ) {
        return false;
      }
      if (hiddenSet.has(id)) {
        activeHiddenCount++;
        if (!showHiddenVas) return false;
      }
      return true;
    })
    .map((id, sheetIndex) => {
      const v = vas[id];
      const schedInfo = deriveScheduleFromTab(v, selectedTabData);
      const matchedTab = findMatchingTabEntry(v, selectedTabData);
      return {
        id,
        sheetIndex,
        v,
        isHiddenVa: hiddenSet.has(id),
        matchedTab,
        targetKey: schedInfo.matchedTabKey || v.id,
        shiftLabel: schedInfo.shiftLabel,
        startMinutes: schedInfo.startMinutes
      };
    });

  updateHiddenVaControlsUI(activeHiddenCount);

  const { colorMap, unsetStyle } = buildScheduleColorMap(enrichedList);

  let filteredList = enrichedList.filter((item) => {
    if (!searchFilter) return true;
    const haystack = `${item.v.va} ${item.shiftLabel} ${item.v.coachingFocus || ""} ${item.v.statusNow || ""}`.toLowerCase();
    return haystack.includes(searchFilter);
  });

  if (sortMode === "schedule") {
    filteredList = [...filteredList].sort(
      (a, b) => a.startMinutes - b.startMinutes || a.sheetIndex - b.sheetIndex
    );
  }

  if (!filteredList.length) {
    tbody.innerHTML = `<tr><td colspan="${visibleColSpan}" class="p-6 text-center text-slate-500">No VAs match the current filter.</td></tr>`;
    return;
  }

  const colCls = (key, base) => (!hiddenCols.has(key) ? base : `${base} hidden`);

  tbody.innerHTML = filteredList
    .map((item) => {
      const { id, v, isHiddenVa, matchedTab, targetKey, shiftLabel } = item;
      const profile = siteProfiles[targetKey] || siteProfiles[v.id] || {};
      const isProb = profile.employmentTier === "prob";
      const safeId = String(id).replace(/'/g, "\\'");
      const safeTargetKey = String(targetKey).replace(/'/g, "\\'");
      const safeVaName = String(v.va).replace(/'/g, "\\'");
      const isExpanded = expandedVaId === id;

      const tabObj = matchedTab ? matchedTab.tab : null;
      const latestRow = tabObj && Array.isArray(tabObj.rows) && tabObj.rows.length ? tabObj.rows[tabObj.rows.length - 1] : null;
      const shiftDateVal = latestRow ? String(latestRow.Date || latestRow.Week || "Today").trim() : "Today";
      const staleNoteBadge = getOverviewNoteStalenessBadge(tabObj);

      const todayWorkSession = findCurrentDateActivityForVa(v.va, tabObj, liveRows);
      const currentDateActBadge = todayWorkSession
        ? formatConditionalActivityBadge(`${todayWorkSession.avgActivityPct ?? 0}%`)
        : formatConditionalActivityBadge(v.avgActivity || "-");
      const currentDateTracked = todayWorkSession ? todayWorkSession.totalDuration : v.avgHrsPerDay || "—";

      const isLoggedIn = String(v.statusNow || "").toLowerCase().includes("logged in");
      const statusBadge = isLoggedIn
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-700"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Logged In</span>`
        : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">${escapeHtml(v.statusNow || "-")}</span>`;

      const schedStyle = colorMap.get(shiftLabel) || unsetStyle;
      const schedPillHtml = `<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${schedStyle.pill}">${escapeHtml(shiftLabel)}</span>`;

      const accordionRow = isExpanded
        ? `<tr class="bg-slate-950/90 border-b border-teal-800/60">
            <td colspan="${visibleColSpan}" class="p-2">
              <div class="kitsune-sticky-drawer sticky left-2 box-border">
                ${buildInlineAccordionHtml(targetKey, v.va, matchedTab ? matchedTab.tab : null)}
              </div>
            </td>
          </tr>`
        : "";

      return `
        <tr class="hover:bg-slate-800/40 transition-colors ${schedStyle.accent} ${isExpanded ? "bg-slate-900/80" : ""} ${isHiddenVa ? "opacity-60 bg-slate-950/60" : ""}">
          <td class="px-3 py-2.5 text-center whitespace-nowrap">
            <div class="inline-flex items-center gap-1">
              <button type="button" onclick="window.toggleVaAccordion('${safeId}')"
                      class="px-2.5 py-1 rounded-md text-[11px] font-bold border transition cursor-pointer ${
                        isExpanded
                          ? "bg-teal-700 text-white border-teal-500"
                          : "bg-slate-900 hover:bg-slate-800 text-teal-300 border-slate-700"
                      }">
                ${isExpanded ? "− Close" : "+ Align"}
              </button>
              ${
                isHiddenVa
                  ? `<button type="button" onclick="window.unhideSingleVa('${safeId}')"
                             title="Restore VA to visible list"
                             class="px-2 py-1 rounded-md text-[10px] font-bold bg-amber-950 hover:bg-amber-900 text-amber-300 border border-amber-700 cursor-pointer">
                       Unhide
                     </button>`
                  : `<button type="button" onclick="window.hideSingleVa('${safeId}')"
                             title="Hide VA from Overview"
                             class="px-2 py-1 rounded-md text-[10px] font-semibold bg-slate-900 hover:bg-rose-950/70 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-800 cursor-pointer">
                       Hide
                     </button>`
              }
            </div>
          </td>
          <td class="px-3 py-2.5 font-medium whitespace-nowrap relative group cursor-help">
            <div class="flex items-center gap-1.5">
              <a href="va-detail.html#tab=${encodeURIComponent(targetKey)}&name=${encodeURIComponent(v.va)}"
                 onclick="event.preventDefault(); window.openVaPage('${safeTargetKey}', '${safeVaName}');"
                 class="text-teal-300 hover:text-teal-200 underline decoration-teal-700 underline-offset-4 cursor-pointer">
                ${escapeHtml(v.va)}
              </a>
              ${isProb ? '<span class="text-[9px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800 font-mono">PROB</span>' : ""}
              ${isHiddenVa ? '<span class="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-amber-300 border border-amber-700/60 font-mono">HIDDEN</span>' : ""}
              ${staleNoteBadge}
            </div>

            <!-- Floating Hover Card with Current Date Activity Rate -->
            <div class="hidden group-hover:block absolute left-0 bottom-full mb-2 z-55 w-64 bg-slate-950/95 backdrop-blur-md border border-teal-700/70 rounded-xl p-3 shadow-2xl pointer-events-none space-y-1.5 text-left whitespace-normal">
              <div class="flex items-center justify-between border-b border-slate-800 pb-1">
                <span class="text-[10px] font-bold uppercase tracking-wider text-teal-300">${escapeHtml(v.va)}</span>
                <span class="text-[9px] font-mono text-slate-400">${escapeHtml(todayWorkSession ? todayWorkSession.date : shiftDateVal)}</span>
              </div>
              <div class="text-[11px] flex items-center justify-between text-slate-200 pt-0.5">
                <span>⚡ Today Activity:</span>
                <span>${currentDateActBadge}</span>
              </div>
              <div class="text-[11px] flex items-center justify-between text-slate-200">
                <span>⏱️ Tracked Today:</span>
                <strong class="font-mono text-teal-300">${escapeHtml(currentDateTracked)}</strong>
              </div>
            </div>
          </td>
          <td class="${colCls("schedule", "px-3 py-2.5 text-center whitespace-nowrap")}">${schedPillHtml}</td>
          <td class="${colCls("status", "px-3 py-2.5 text-center whitespace-nowrap")}">${statusBadge}</td>
          <td class="${colCls("days", "px-3 py-2.5 text-center whitespace-nowrap")}">${escapeHtml(v.daysWorked || "-")}</td>
          <td class="${colCls("avgHrs", "px-3 py-2.5 text-center whitespace-nowrap")}">${escapeHtml(v.avgHrsPerDay || "-")}</td>
          <td class="${colCls("late", "px-3 py-2.5 text-center whitespace-nowrap")}">${escapeHtml(v.lateClockIns || "0")}</td>
          <td class="${colCls("earlyShort", "px-3 py-2.5 text-center whitespace-nowrap")}">${escapeHtml(v.earlyLogOutsShortDays || "0")}</td>
          <td class="${colCls("activity", "px-3 py-2.5 text-center whitespace-nowrap")}">${formatConditionalActivityBadge(v.avgActivity)}</td>
          <td class="${colCls("flagDays", "px-3 py-2.5 text-center whitespace-nowrap")}">${escapeHtml(v.flagDays || "0")}</td>
          <td class="${colCls("flags30d", "px-3 py-2.5 text-center whitespace-nowrap")}">${escapeHtml(v.flagDays30d || "0")}</td>
          <td class="${colCls("tlFlags", "px-3 py-2.5 text-center whitespace-nowrap")}">${escapeHtml(v.tlFlagsYellowRed || "-")}</td>
          <td class="${colCls("coaching", "px-3 py-2.5 text-left whitespace-nowrap")}">${formatCoachingFocusBadge(v.coachingFocus)}</td>
        </tr>
        ${accordionRow}
      `;
    })
    .join("");

  requestAnimationFrame(syncStickyDrawerWidths);
}

function getOverviewDraftKey(tabKey) {
  return `${tabKey}__default`;
}

function getOverviewGoalBucket(tabKey) {
  const dKey = getOverviewDraftKey(tabKey);
  if (overviewSowDrafts[dKey]) return overviewSowDrafts[dKey];

  const siteGoals = (latestData.siteData && latestData.siteData.vaGoals) || {};
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

function ensureOverviewSowDraft(tabKey) {
  const dKey = getOverviewDraftKey(tabKey);
  if (!overviewSowDrafts[dKey]) {
    overviewSowDrafts[dKey] = getOverviewGoalBucket(tabKey);
  }
  return overviewSowDrafts[dKey];
}

function getOverviewRowDraftKey(tabKey, sheetRow) {
  return `${tabKey}__row_${sheetRow}`;
}

function stageOverviewRowDraft(tabKey, sheetRow, patch) {
  const key = getOverviewRowDraftKey(tabKey, sheetRow);
  overviewLogDrafts[key] = {
    tabKey,
    sheetRow,
    ...(overviewLogDrafts[key] || {}),
    ...patch
  };
  updateOverviewSaveBtnUI(tabKey);
}

function getActiveTabDirtyEntries(tabKey) {
  return Object.values(overviewLogDrafts).filter(
    (d) => d && d.tabKey === tabKey && (d.notesDirty || d.flagDirty || d.amDirty)
  );
}

function updateOverviewSaveBtnUI(tabKey) {
  const btn = document.getElementById(`overview-save-logs-btn-${tabKey}`);
  if (!btn) return;
  const dirtyCount = getActiveTabDirtyEntries(tabKey).length;
  btn.disabled = isSavingOverviewLogs;
  btn.textContent = isSavingOverviewLogs
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

function resolveCurrentDateRow(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const today = new Date();
  const options = { month: "short", day: "numeric", year: "2-digit" };
  const formattedToday = today.toLocaleDateString("en-US", options);

  let match = rows.find((r) => {
    const dStr = String(r.Date || r.Week || Object.values(r)[0] || "").trim();
    return dStr === formattedToday;
  });
  if (match) return { row: match, label: "Today's Shift" };

  const valid = rows.filter((r) => {
    const dStr = String(r.Date || r.Week || "").trim();
    return !dStr.includes("Dec 26") && !dStr.includes("Dec 2026");
  });

  if (valid.length) {
    const active = [...valid].reverse().find((r) => String(r.Clock_in || r.Clock_In || "").trim());
    if (active) return { row: active, label: `Latest Active Shift (${String(active.Date || active.Week || "").trim()})` };
    return { row: valid[valid.length - 1], label: `Latest Shift (${String(valid[valid.length - 1].Date || "").trim()})` };
  }

  return { row: rows[rows.length - 1], label: "Latest Shift" };
}

function buildInlineAccordionHtml(tabKey, vaName, tabObj) {
  if (!tabObj) {
    return `<p class="text-xs text-slate-400">Tab for <strong>${escapeHtml(vaName)}</strong> is not enabled in <a href="tabs.html" class="text-teal-400 underline">Select Tabs</a>.</p>`;
  }

  const safeTabKey = String(tabKey).replace(/'/g, "\\'");
  const siteProfiles = (latestData.siteData && latestData.siteData.vaProfiles) || {};
  const siteAmComms = (latestData.siteData && latestData.siteData.amComms) || {};
  const profile = siteProfiles[tabKey] || {};
  const isProb = profile.employmentTier === "prob";
  const itemLabel = isProb ? "Task" : "Focus";
  const bucket = getOverviewGoalBucket(tabKey);
  const dKey = getOverviewDraftKey(tabKey);
  const hasSowUnsaved = Boolean(overviewSowDirty[dKey]);
  const dirtyCount = getActiveTabDirtyEntries(tabKey).length;

  const headers = tabObj.headers || [];
  const cleanHeaders = tabObj.cleanHeaders || [];
  const colIndices = tabObj.colIndices || [];
  const allRows = tabObj.rows || [];

  const resolved = resolveCurrentDateRow(allRows);
  const row = resolved ? resolved.row : null;

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
  const redFlagCol = redFlagIdx !== -1 ? colIndices[redFlagIdx] : 7; // Column G default

  let shiftCardHtml = `<p class="text-xs text-slate-500 p-2">No shift log rows found.</p>`;

  if (row) {
    const rDraft = overviewLogDrafts[getOverviewRowDraftKey(tabKey, row._sheetRow)] || {};
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
    const isAmOpen = Boolean(expandedAmRows[amKey]);

    shiftCardHtml = `
      <div class="bg-slate-950 border ${isDirty ? "border-amber-500/60" : "border-slate-800"} rounded-xl p-3 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2 text-xs">
          <div class="flex flex-wrap items-center gap-3 font-mono">
            <div>
              <span class="text-[10px] text-slate-500 uppercase font-sans block">Date</span>
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
                  <select onchange="window.stageOvFlagEdit('${safeTabKey}', '${tabObj.tabName}', ${row._sheetRow}, ${flagCol}, this.value, this)"
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
                <label class="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Notes & Tags</label>
                <textarea id="ov-note-box-${row._sheetRow}" rows="2"
                          oninput="window.stageOvNoteEdit('${safeTabKey}', '${tabObj.tabName}', ${row._sheetRow}, ${notesCol}, this.value)"
                          placeholder="Add TL note..."
                          class="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border ${
                            rDraft.notesDirty ? "border-amber-500/80" : "border-slate-700"
                          } text-xs text-slate-100 focus:border-teal-500 focus:outline-none">${escapeHtml(effectiveNote)}</textarea>

                <div class="flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onclick="window.toggleOvAmRow('${amKey}')"
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
                        <textarea rows="2"
                                  oninput="window.stageOvAmEdit('${safeTabKey}', '${tabObj.tabName}', ${row._sheetRow}, ${redFlagCol}, '${amKey}', this.value)"
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
                 onchange="window.updateOvGoalItem('${safeTabKey}', ${idx}, 'achieved', this.checked)"
                 class="w-3.5 h-3.5 rounded bg-slate-950 border-slate-700 text-emerald-500 cursor-pointer" />
          <span class="${f.achieved ? "line-through text-emerald-400" : ""}">${itemLabel} ${idx + 1}</span>
        </label>
        <textarea rows="2"
                  onpaste="window.handleOvMultiPaste(event, '${safeTabKey}', ${idx})"
                  oninput="window.updateOvGoalItem('${safeTabKey}', ${idx}, 'text', this.value, true)"
                  placeholder="Enter ${itemLabel.toLowerCase()} ${idx + 1} (or paste list to auto-split)..."
                  class="w-full bg-slate-950 border border-slate-800 rounded p-1.5 text-xs text-slate-100">${escapeHtml(f.text || "")}</textarea>
        <input type="text" value="${escapeHtml(f.outcomeNotes || "")}"
               oninput="window.updateOvGoalItem('${safeTabKey}', ${idx}, 'outcomeNotes', this.value, true)"
               placeholder="Outcome / progress note..."
               class="w-full bg-slate-950/70 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-300" />
      </div>`
    )
    .join("");

  return `
    <div class="bg-slate-900 border border-teal-800/70 rounded-xl p-3 sm:p-4 space-y-3.5 w-full box-border">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs font-bold text-white uppercase tracking-wider">Quick Align & Logs: <strong class="text-teal-300">${escapeHtml(vaName)}</strong></span>
          <a href="va-detail.html#tab=${encodeURIComponent(tabKey)}&name=${encodeURIComponent(vaName)}"
             class="text-xs text-blue-400 hover:text-blue-300 underline">Open Full Dossier ↗</a>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button type="button" onclick="window.toggleAccordionGoals()"
                  class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-blue-300 cursor-pointer">
            ${isAccordionGoalsOpen ? "▲ Hide SOW Alignment" : isProb ? "🎯 Daily Task Alignment" : "🎯 Weekly SOW Alignment"}
          </button>
          <button id="overview-save-logs-btn-${escapeHtml(tabKey)}" type="button"
                  onclick="window.saveAllOverviewLogDrafts('${safeTabKey}')"
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
        isAccordionGoalsOpen
          ? `<div class="bg-slate-950 border ${hasSowUnsaved ? "border-amber-600/70" : "border-slate-800"} rounded-xl p-3 space-y-3">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                <span class="text-xs font-bold text-blue-300 uppercase">${isProb ? "📋 Daily Task Milestones" : "🎯 Weekly SOW Focuses"}</span>
                <button type="button" onclick="window.saveOvSowDraft('${safeTabKey}')"
                        class="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold text-xs cursor-pointer shadow">
                  💾 Save SOW
                </button>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                ${focusInputsHtml}
              </div>

              <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
                <button type="button" onclick="window.appendOvGoalsToDraft('${safeTabKey}', 'sod')"
                        class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs cursor-pointer">
                  ☀️ Append SOW (SOD) to Note Draft
                </button>
                <button type="button" onclick="window.appendOvGoalsToDraft('${safeTabKey}', 'eod')"
                        class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs cursor-pointer">
                  🌙 Append Audit (EOD) to Note Draft
                </button>
              </div>
            </div>`
          : ""
      }

      <div class="space-y-1.5">
        <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          📅 Today's Shift Log Entry (${escapeHtml(resolved ? resolved.label : "Current")})
        </div>
        ${shiftCardHtml}
      </div>
    </div>
  `;
}

window.toggleAccordionGoals = () => {
  isAccordionGoalsOpen = !isAccordionGoalsOpen;
  renderDashboard();
};

window.updateOvGoalItem = (tabKey, idx, field, val, skipRerender = false) => {
  const draft = ensureOverviewSowDraft(tabKey);
  draft.focuses[idx] = { ...draft.focuses[idx], [field]: val };
  overviewSowDirty[getOverviewDraftKey(tabKey)] = true;
  if (!skipRerender) renderDashboard();
};

window.handleOvMultiPaste = (e, tabKey, startIdx) => {
  const items = parsePastedListItems(e.clipboardData);
  if (items.length <= 1) return;
  e.preventDefault();
  const draft = ensureOverviewSowDraft(tabKey);
  items.forEach((text, offset) => {
    const target = startIdx + offset;
    if (target < draft.focuses.length) draft.focuses[target] = { ...draft.focuses[target], text };
    else draft.focuses.push({ id: `f_${Date.now()}_${offset}`, text, achieved: false, outcomeNotes: "" });
  });
  overviewSowDirty[getOverviewDraftKey(tabKey)] = true;
  renderDashboard();
};

window.saveOvSowDraft = async (tabKey) => {
  const dKey = getOverviewDraftKey(tabKey);
  const draft = getOverviewGoalBucket(tabKey);
  await updateSiteData(`vaGoals/${tabKey}/week_1`, {
    focuses: draft.focuses,
    additionalNotes: draft.additionalNotes
  });
  delete overviewSowDrafts[dKey];
  delete overviewSowDirty[dKey];
  showOverviewToast(`✓ Saved SOW!`);
  renderDashboard();
};

window.appendOvGoalsToDraft = (tabKey, mode) => {
  const selectedTabData = latestData.selectedTabData || {};
  const tabObj = selectedTabData[tabKey];
  if (!tabObj || !tabObj.rows || !tabObj.rows.length) return;

  const bucket = getOverviewGoalBucket(tabKey);
  const notesIdx = (tabObj.headers || []).findIndex((h) => h.toLowerCase() === "notes");
  if (notesIdx === -1) return;

  const notesKey = tabObj.cleanHeaders[notesIdx];
  const notesCol = tabObj.colIndices[notesIdx];
  const resolved = resolveCurrentDateRow(tabObj.rows);
  const targetRow = resolved ? resolved.row : tabObj.rows[tabObj.rows.length - 1];

  let block = "";
  if (mode === "sod") {
    block = `\n📋 [SOD SOW Focuses]\n`;
    bucket.focuses.forEach((f) => {
      if (f.text && f.text.trim()) block += `• ${f.text.trim()}\n`;
    });
  } else {
    block = `\n🏁 [EOW Focus Audit]\n`;
    bucket.focuses.forEach((f) => {
      if (f.text && f.text.trim()) {
        block += `• ${f.text.trim()} -> ${f.achieved ? "✓ Achieved" : "✗ Incomplete"}${
          f.outcomeNotes ? ` (${f.outcomeNotes.trim()})` : ""
        }\n`;
      }
    });
  }

  const rKey = getOverviewRowDraftKey(tabKey, targetRow._sheetRow);
  const existingDraft = overviewLogDrafts[rKey];
  const existing =
    existingDraft && existingDraft.notesDirty
      ? existingDraft.notesVal.trim()
      : String(targetRow[notesKey] || "").trim();
  const combined = existing ? `${existing}\n${block.trim()}` : block.trim();

  stageOverviewRowDraft(tabKey, targetRow._sheetRow, {
    tabName: tabObj.tabName,
    notesCol,
    notesVal: combined,
    notesDirty: true
  });

  renderDashboard();
  showOverviewToast(`✓ Appended ${mode.toUpperCase()} to Row ${targetRow._sheetRow} draft — click "Save Log Changes" to push to Sheet.`);
};

window.stageOvNoteEdit = (tabKey, tabName, sheetRow, colIndex, val) => {
  stageOverviewRowDraft(tabKey, sheetRow, {
    tabName,
    notesCol: colIndex,
    notesVal: val,
    notesDirty: true
  });
};

window.stageOvFlagEdit = (tabKey, tabName, sheetRow, colIndex, val, selectEl) => {
  stageOverviewRowDraft(tabKey, sheetRow, {
    tabName,
    flagCol: colIndex,
    flagVal: val,
    flagDirty: true
  });
  if (selectEl) {
    selectEl.className = `px-2.5 py-1 rounded border text-xs cursor-pointer ${getFlagSelectStyle(val)}`;
  }
};

window.stageOvAmEdit = (tabKey, tabName, sheetRow, redFlagCol, amKey, val) => {
  stageOverviewRowDraft(tabKey, sheetRow, {
    tabName,
    redFlagCol: redFlagCol || 7,
    amKey,
    amVal: val,
    amDirty: true
  });
};

window.toggleOvAmRow = (amKey) => {
  expandedAmRows[amKey] = !expandedAmRows[amKey];
  renderDashboard();
};

window.saveAllOverviewLogDrafts = async (tabKey) => {
  const dirtyEntries = getActiveTabDirtyEntries(tabKey);
  if (!dirtyEntries.length) {
    showOverviewToast("No unsaved log changes to save.");
    return;
  }

  isSavingOverviewLogs = true;
  updateOverviewSaveBtnUI(tabKey);
  showOverviewToast(`Saving ${dirtyEntries.length} modified row(s) to Google Sheets...`);

  try {
    const selectedTabData = latestData.selectedTabData || {};
    const tabObj = selectedTabData[tabKey];
    const amUpdates = {};

    const updatePromises = dirtyEntries.map(async (entry) => {
      const promises = [];

      if (tabObj && Array.isArray(tabObj.rows)) {
        const targetRow = tabObj.rows.find((r) => r._sheetRow === entry.sheetRow);
        if (targetRow) {
          if (entry.notesDirty && tabObj.cleanHeaders && tabObj.colIndices) {
            const hIdx = tabObj.colIndices.indexOf(entry.notesCol);
            if (hIdx !== -1) {
              targetRow[tabObj.cleanHeaders[hIdx]] = entry.notesVal;
            }
            targetRow["Notes"] = entry.notesVal;
            targetRow["notes"] = entry.notesVal;
          }
          if (entry.flagDirty && tabObj.cleanHeaders && tabObj.colIndices) {
            const fIdx = tabObj.colIndices.indexOf(entry.flagCol);
            if (fIdx !== -1) {
              targetRow[tabObj.cleanHeaders[fIdx]] = entry.flagVal;
            }
            targetRow["Flag"] = entry.flagVal;
            targetRow["flag"] = entry.flagVal;
          }
          if (entry.amDirty) {
            const targetCol = entry.redFlagCol || 7;
            if (tabObj.cleanHeaders && tabObj.colIndices) {
              const rfIdx = tabObj.colIndices.indexOf(targetCol);
              if (rfIdx !== -1) {
                targetRow[tabObj.cleanHeaders[rfIdx]] = entry.amVal;
              }
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
        const targetCol = entry.redFlagCol || 7; // Column G (RED FLAG COMMS)
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
      delete overviewLogDrafts[getOverviewRowDraftKey(entry.tabKey, entry.sheetRow)];
    });

    await Promise.all(updatePromises);

    if (Object.keys(amUpdates).length) {
      await updateSiteData("amComms", amUpdates);
    }

    showOverviewToast(`✓ Saved all ${dirtyEntries.length} row(s) to Google Sheets!`);
  } catch (err) {
    showOverviewToast(`Error saving logs: ${err.message}`);
  } finally {
    isSavingOverviewLogs = false;
    updateOverviewSaveBtnUI(tabKey);
    renderDashboard();
  }
};