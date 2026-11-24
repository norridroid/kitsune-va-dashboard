import { subscribeCached } from "./firebase.js";
import {
  renderTopNav,
  escapeHtml,
  getHiddenVaSet,
  findMatchingTabEntry,
  deriveScheduleFromTab,
  buildScheduleColorMap,
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

function findTodayActivityForVa(vaName, tabObj, liveRows) {
  if (!Array.isArray(liveRows) || !liveRows.length) return null;
  const todayIso = toLocalIsoDate(new Date());
  const clean = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const targetVa = clean(vaName);
  const fullName = clean((tabObj && tabObj.fullName) || "");
  const tabName = clean((tabObj && tabObj.tabName) || "");
  const firstTwo = (fullName || targetVa).split(" ").slice(0, 2).join(" ");

  return (
    liveRows.find((r) => {
      const rIso = r.dateIso || parseRowDateToIso(r.date);
      if (rIso !== todayIso) return false;
      const m = clean(r.member);
      return (
        m === targetVa ||
        (fullName && m === fullName) ||
        (tabName && m === tabName) ||
        (firstTwo && m.startsWith(firstTwo))
      );
    }) || null
  );
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

      const tabObj = matchedTab ? matchedTab.tab : null;
      const latestRow = tabObj && Array.isArray(tabObj.rows) && tabObj.rows.length ? tabObj.rows[tabObj.rows.length - 1] : null;
      const shiftDateVal = latestRow ? String(latestRow.Date || latestRow.Week || "Today").trim() : "Today";
      const staleNoteBadge = getOverviewNoteStalenessBadge(tabObj);

      const strictTodaySession = findTodayActivityForVa(v.va, tabObj, liveRows);
      const todayInlinePill = strictTodaySession
        ? `<span title="Today's Work Sessions Activity (${escapeHtml(strictTodaySession.totalDuration || "0:00:00")} tracked)" class="inline-flex items-center gap-0.5 text-[10px]">⚡${formatConditionalActivityBadge(`${strictTodaySession.avgActivityPct ?? 0}%`)}</span>`
        : "";

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

      return `
        <tr class="hover:bg-slate-800/40 transition-colors ${schedStyle.accent} ${isHiddenVa ? "opacity-60 bg-slate-950/60" : ""}">
          <td class="px-3 py-2.5 text-center whitespace-nowrap">
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
          </td>
          <td class="px-3 py-2.5 font-medium whitespace-nowrap relative group cursor-help">
            <div class="flex items-center gap-1.5">
              <a href="va-detail.html#tab=${encodeURIComponent(targetKey)}&name=${encodeURIComponent(v.va)}"
                 onclick="event.preventDefault(); window.openVaPage('${safeTargetKey}', '${safeVaName}');"
                 class="text-teal-300 hover:text-teal-200 underline decoration-teal-700 underline-offset-4 cursor-pointer">
                ${escapeHtml(v.va)}
              </a>
              ${todayInlinePill}
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
      `;
    })
    .join("");
}