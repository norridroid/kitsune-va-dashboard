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

const TAG_START = "[SOD/SOW Sent]";
const TAG_END = "[EOD/EOW Sent]";

let latestData = {};
let sortMode = "schedule";
let searchFilter = "";
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

function renderDashboard() {
  const data = latestData || {};
  const kpis = data.kpis || {};

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

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
  const hiddenSet = getHiddenVaSet();
  const tbody = document.getElementById("va-tbody");
  if (!tbody) return;

  const enrichedList = order
    .filter((id) => {
      const v = vas[id];
      if (!v || hiddenSet.has(id)) return false;
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
        matchedTab,
        targetKey: schedInfo.matchedTabKey || v.id,
        shiftLabel: schedInfo.shiftLabel,
        startMinutes: schedInfo.startMinutes
      };
    });

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
    tbody.innerHTML = `<tr><td colspan="13" class="p-6 text-center text-slate-500">No VAs match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredList
    .map((item) => {
      const { id, v, matchedTab, targetKey, shiftLabel } = item;
      const profile = siteProfiles[targetKey] || siteProfiles[v.id] || {};
      const isProb = profile.employmentTier === "prob";
      const safeId = String(id).replace(/'/g, "\\'");
      const safeTargetKey = String(targetKey).replace(/'/g, "\\'");
      const safeVaName = String(v.va).replace(/'/g, "\\'");
      const isExpanded = expandedVaId === id;

      const tabObj = matchedTab ? matchedTab.tab : null;
      const latestRow = tabObj && Array.isArray(tabObj.rows) && tabObj.rows.length ? tabObj.rows[tabObj.rows.length - 1] : null;
      const notesText = latestRow ? String(latestRow.Notes || latestRow.notes || "") : "";
      const hasSodSent = notesText.includes("[SOD/SOW Sent]");
      const hasEodSent = notesText.includes("[EOD/EOW Sent]");
      const shiftDateVal = latestRow ? String(latestRow.Date || latestRow.Week || "Today").trim() : "Today";

      const isLoggedIn = String(v.statusNow || "").toLowerCase().includes("logged in");
      const statusBadge = isLoggedIn
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-700"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Logged In</span>`
        : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">${escapeHtml(v.statusNow || "-")}</span>`;

      const schedStyle = colorMap.get(shiftLabel) || unsetStyle;
      const schedPillHtml = `<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border ${schedStyle.pill}">${escapeHtml(shiftLabel)}</span>`;

      const accordionRow = isExpanded
        ? `<tr class="bg-slate-950/90 border-b border-teal-800/60">
            <td colspan="13" class="p-4">
              ${buildInlineAccordionHtml(targetKey, v.va, matchedTab ? matchedTab.tab : null)}
            </td>
          </tr>`
        : "";

      return `
        <tr class="hover:bg-slate-800/40 transition-colors ${schedStyle.accent} ${isExpanded ? "bg-slate-900/80" : ""}">
          <td class="px-3 py-2.5 text-center whitespace-nowrap">
            <button type="button" onclick="window.toggleVaAccordion('${safeId}')"
                    class="px-2.5 py-1 rounded-md text-[11px] font-bold border transition cursor-pointer ${
                      isExpanded
                        ? "bg-teal-700 text-white border-teal-500"
                        : "bg-slate-900 hover:bg-slate-800 text-teal-300 border-slate-700"
                    }">
              ${isExpanded ? "− Close" : "+ Align"}
            </button>
          </td>
          <td class="px-3 py-2.5 font-medium whitespace-nowrap relative group cursor-help">
            <div class="flex items-center gap-1.5">
              <a href="va-detail.html#tab=${encodeURIComponent(targetKey)}&name=${encodeURIComponent(v.va)}"
                 onclick="event.preventDefault(); window.openVaPage('${safeTargetKey}', '${safeVaName}');"
                 class="text-teal-300 hover:text-teal-200 underline decoration-teal-700 underline-offset-4 cursor-pointer">
                ${escapeHtml(v.va)}
              </a>
              ${isProb ? '<span class="text-[9px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800 font-mono">PROB</span>' : ""}
              <span class="w-2 h-2 rounded-full ${hasSodSent && hasEodSent ? "bg-emerald-400" : hasSodSent ? "bg-amber-400" : "bg-slate-600"}" title="Report Status Indicator"></span>
            </div>

            <!-- Floating Hover Card for Reports -->
            <div class="hidden group-hover:block absolute left-0 bottom-full mb-2 z-55 w-60 bg-slate-950/95 backdrop-blur-md border border-teal-700/70 rounded-xl p-3 shadow-2xl pointer-events-none space-y-1.5 text-left whitespace-normal">
              <div class="flex items-center justify-between border-b border-slate-800 pb-1">
                <span class="text-[10px] font-bold uppercase tracking-wider text-teal-300">${escapeHtml(v.va)} • Report Status</span>
                <span class="text-[9px] font-mono text-slate-400">${escapeHtml(shiftDateVal)}</span>
              </div>
              <div class="text-[11px] flex items-center justify-between text-slate-200 pt-0.5">
                <span>☀️ SOD SOW:</span>
                <strong class="${hasSodSent ? "text-emerald-400" : "text-slate-500"}">${hasSodSent ? "Sent" : "Not sent yet"}</strong>
              </div>
              <div class="text-[11px] flex items-center justify-between text-slate-200">
                <span>🌙 EOD Audit:</span>
                <strong class="${hasEodSent ? "text-emerald-400" : "text-slate-500"}">${hasEodSent ? "Sent" : "Not sent yet"}</strong>
              </div>
            </div>
          </td>
          <td class="px-3 py-2.5 text-center whitespace-nowrap">${schedPillHtml}</td>
          <td class="px-3 py-2.5 text-center whitespace-nowrap">${statusBadge}</td>
          <td class="px-3 py-2.5 text-center whitespace-nowrap">${escapeHtml(v.daysWorked || "-")}</td>
          <td class="px-3 py-2.5 text-center whitespace-nowrap">${escapeHtml(v.avgHrsPerDay || "-")}</td>
          <td class="px-3 py-2.5 text-center whitespace-nowrap">${escapeHtml(v.lateClockIns || "0")}</td>
          <td class="px-3 py-2.5 text-center whitespace-nowrap">${escapeHtml(v.earlyLogOutsShortDays || "0")}</td>
          <td class="px-3 py-2.5 text-center whitespace-nowrap">${formatConditionalActivityBadge(v.avgActivity)}</td>
          <td class="px-3 py-2.5 text-center whitespace-nowrap">${escapeHtml(v.flagDays || "0")}</td>
          <td class="px-3 py-2.5 text-center whitespace-nowrap">${escapeHtml(v.flagDays30d || "0")}</td>
          <td class="px-3 py-2.5 text-center whitespace-nowrap">${escapeHtml(v.tlFlagsYellowRed || "-")}</td>
          <td class="px-3 py-2.5 text-left whitespace-nowrap">${formatCoachingFocusBadge(v.coachingFocus)}</td>
        </tr>
        ${accordionRow}
      `;
    })
    .join("");
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
      ? "px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-lg ring-2 ring-amber-400/50 transition cursor-pointer"
      : "px-3.5 py-1.5 rounded-lg bg-teal-700/80 hover:bg-teal-600 text-white font-semibold text-xs border border-teal-600/60 transition cursor-pointer";
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
    return dStr.toLowerCase().includes("nov 17") || dStr === formattedToday;
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

  const notesKey = notesIdx !== -1 ? cleanHeaders[notesIdx] : "";
  const notesCol = notesIdx !== -1 ? colIndices[notesIdx] : 0;
  const flagKey = flagIdx !== -1 ? cleanHeaders[flagIdx] : "";
  const flagCol = flagIdx !== -1 ? colIndices[flagIdx] : 0;

  let rowHtml = `<p class="text-xs text-slate-500 p-2">No shift log rows found.</p>`;

  if (row) {
    const rDraft = overviewLogDrafts[getOverviewRowDraftKey(tabKey, row._sheetRow)] || {};
    const isDirty = Boolean(rDraft.notesDirty || rDraft.flagDirty || rDraft.amDirty);

    const dateVal = dateIdx !== -1 ? row[cleanHeaders[dateIdx]] || "" : "";
    const inVal = inIdx !== -1 ? row[cleanHeaders[inIdx]] || "—" : "—";
    const outVal = outIdx !== -1 ? row[cleanHeaders[outIdx]] || "—" : "—";
    const hrsVal = hrsIdx !== -1 ? row[cleanHeaders[hrsIdx]] || "—" : "—";

    const rawNotesHeader = notesIdx !== -1 ? headers[notesIdx] : "Notes";
    const rawFlagHeader = flagIdx !== -1 ? headers[flagIdx] : "Flag";

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

    const effectiveNote = rDraft.notesDirty ? rDraft.notesVal : serverNote;
    const effectiveFlag = rDraft.flagDirty ? rDraft.flagVal : serverFlag;

    const upperFlag = String(effectiveFlag).trim().toUpperCase();
    const hasSod = effectiveNote.includes(TAG_START);
    const hasEod = effectiveNote.includes(TAG_END);

    const amKey = `${tabKey}_row_${row._sheetRow}`;
    const effectiveAm = rDraft.amDirty ? rDraft.amVal : siteAmComms[amKey] || "";
    const isAmOpen = Boolean(expandedAmRows[amKey]);

    rowHtml = `
      <tr class="border-t border-slate-800 ${isDirty ? "bg-amber-950/15" : ""}">
        <td class="p-2.5 font-mono text-xs text-slate-200 whitespace-nowrap align-top">${escapeHtml(dateVal)}</td>
        <td class="p-2.5 font-mono text-xs text-slate-300 whitespace-nowrap align-top">${escapeHtml(inVal)} – ${escapeHtml(outVal)}</td>
        <td class="p-2.5 font-mono text-xs text-teal-300 whitespace-nowrap align-top">${escapeHtml(hrsVal)}</td>
        <td class="p-2 min-w-[340px] align-top space-y-1.5">
          ${
            notesCol
              ? `<textarea id="ov-note-box-${row._sheetRow}" rows="2"
                           oninput="window.stageOvNoteEdit('${safeTabKey}', '${tabObj.tabName}', ${row._sheetRow}, ${notesCol}, this.value)"
                           placeholder="Add TL note..."
                           class="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border ${
                             rDraft.notesDirty ? "border-amber-500/80" : "border-slate-700"
                           } text-xs text-slate-100 focus:border-teal-500 focus:outline-none">${escapeHtml(effectiveNote)}</textarea>

                 <div class="flex flex-wrap items-center justify-between gap-1.5">
                   <button type="button" onclick="window.toggleOvAmRow('${amKey}')"
                           class="text-[10px] font-bold px-2 py-0.5 rounded border cursor-pointer ${
                             effectiveAm.trim()
                               ? "bg-rose-950 text-rose-300 border-rose-800"
                               : "bg-slate-900 text-slate-400 border-slate-700 hover:text-rose-300"
                           }">
                     🚩 ${isAmOpen ? "Hide Comms" : effectiveAm.trim() ? "AM Comms (Logged)" : "+ AM Comms"}
                   </button>

                   <div class="flex items-center gap-1.5">
                     <button id="ov-sod-btn-${row._sheetRow}" type="button"
                             onclick="window.toggleOvRowTag('${safeTabKey}', '${tabObj.tabName}', ${row._sheetRow}, ${notesCol}, '${TAG_START}')"
                             class="py-0.5 px-2 rounded text-[10px] font-bold border cursor-pointer ${
                               hasSod
                                 ? "bg-emerald-950 text-emerald-300 border-emerald-600"
                                 : "bg-slate-900 text-slate-400 border-slate-700 hover:text-white"
                             }">
                       ☀️ ${hasSod ? "✓ SOD" : "+ SOD"}
                     </button>
                     <button id="ov-eod-btn-${row._sheetRow}" type="button"
                             onclick="window.toggleOvRowTag('${safeTabKey}', '${tabObj.tabName}', ${row._sheetRow}, ${notesCol}, '${TAG_END}')"
                             class="py-0.5 px-2 rounded text-[10px] font-bold border cursor-pointer ${
                               hasEod
                                 ? "bg-indigo-950 text-indigo-300 border-indigo-600"
                                 : "bg-slate-900 text-slate-400 border-slate-700 hover:text-white"
                             }">
                       🌙 ${hasEod ? "✓ EOD" : "+ EOD"}
                     </button>
                   </div>
                 </div>

                 ${
                   isAmOpen
                     ? `<div class="bg-rose-950/25 border border-rose-900/60 rounded-lg p-2 space-y-1">
                         <div class="text-[10px] font-bold text-rose-300 uppercase">🚩 AM Red Flag Comms (Site-Only)</div>
                         <textarea rows="2"
                                   oninput="window.stageOvAmEdit('${safeTabKey}', ${row._sheetRow}, '${amKey}', this.value)"
                                   placeholder="Log client escalations or AM follow-ups..."
                                   class="w-full bg-slate-950 border border-rose-900/70 rounded p-1.5 text-xs text-rose-100">${escapeHtml(effectiveAm)}</textarea>
                       </div>`
                     : ""
                 }`
              : ""
          }
        </td>
        <td class="p-2 align-top">
          ${
            flagCol
              ? `<select onchange="window.stageOvFlagEdit('${safeTabKey}', '${tabObj.tabName}', ${row._sheetRow}, ${flagCol}, this.value, this)"
                         class="px-2 py-1.5 rounded border text-xs ${getFlagSelectStyle(effectiveFlag)}">
                  <option value="" ${upperFlag === "" ? "selected" : ""}>-</option>
                  <option value="Green" ${upperFlag === "GREEN" ? "selected" : ""}>Green</option>
                  <option value="Yellow" ${upperFlag === "YELLOW" ? "selected" : ""}>Yellow</option>
                  <option value="Red" ${upperFlag === "RED" ? "selected" : ""}>Red</option>
                  <option value="RL" ${upperFlag === "RL" ? "selected" : ""}>RL</option>
                  <option value="EL" ${upperFlag === "EL" ? "selected" : ""}>EL</option>
                </select>`
              : ""
          }
        </td>
      </tr>
    `;
  }

  const focusInputsHtml = bucket.focuses
    .map(
      (f, idx) => `
      <div class="bg-slate-900 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
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
    <div class="bg-slate-900 border border-teal-800/70 rounded-xl p-4 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="text-xs font-bold text-white uppercase tracking-wider">Quick Align & Logs: <strong class="text-teal-300">${escapeHtml(vaName)}</strong></span>
          <a href="va-detail.html#tab=${encodeURIComponent(tabKey)}&name=${encodeURIComponent(vaName)}"
             class="text-xs text-blue-400 hover:text-blue-300 underline">Open Full Dossier ↗</a>
        </div>

        <div class="flex items-center gap-2">
          <button type="button" onclick="window.toggleAccordionGoals()"
                  class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-blue-300 cursor-pointer">
            ${isAccordionGoalsOpen ? "▲ Hide SOW Alignment" : "🎯 Weekly SOW Alignment"}
          </button>
          <button id="overview-save-logs-btn-${escapeHtml(tabKey)}" type="button"
                  onclick="window.saveAllOverviewLogDrafts('${safeTabKey}')"
                  class="${
                    dirtyCount > 0
                      ? "px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-lg ring-2 ring-amber-400/50 transition cursor-pointer"
                      : "px-3.5 py-1.5 rounded-lg bg-teal-700/80 hover:bg-teal-600 text-white font-semibold text-xs border border-teal-600/60 transition cursor-pointer"
                  }">
            ${dirtyCount > 0 ? `💾 Save Log Changes (${dirtyCount})` : "💾 Save Log Changes"}
          </button>
        </div>
      </div>

      ${
        isAccordionGoalsOpen
          ? `<div class="bg-slate-950 border ${hasSowUnsaved ? "border-amber-600/70" : "border-slate-800"} rounded-xl p-3.5 space-y-3">
              <div class="flex items-center justify-between border-b border-slate-800 pb-2">
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

      <div class="space-y-1">
        <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
          <span>📅 Today's Shift Log Entry (${escapeHtml(resolved ? resolved.label : "Current")})</span>
        </div>
        <div class="overflow-x-auto border border-slate-800 rounded-xl">
          <table class="w-full text-left border-collapse">
            <thead class="bg-slate-950 text-[10px] uppercase text-slate-400">
              <tr>
                <th class="p-2.5">Date</th>
                <th class="p-2.5">Shift</th>
                <th class="p-2.5">Hours</th>
                <th class="p-2.5">Notes & Tags</th>
                <th class="p-2.5">Flag</th>
              </tr>
            </thead>
            <tbody>${rowHtml}</tbody>
          </table>
        </div>
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
    selectEl.className = `px-2 py-1.5 rounded border text-xs ${getFlagSelectStyle(val)}`;
  }
};

window.stageOvAmEdit = (tabKey, sheetRow, amKey, val) => {
  stageOverviewRowDraft(tabKey, sheetRow, {
    amKey,
    amVal: val,
    amDirty: true
  });
};

window.toggleOvAmRow = (amKey) => {
  expandedAmRows[amKey] = !expandedAmRows[amKey];
  renderDashboard();
};

window.toggleOvRowTag = (tabKey, tabName, sheetRow, colIndex, tag) => {
  const box = document.getElementById(`ov-note-box-${sheetRow}`);
  if (!box) return;
  let text = box.value || "";
  if (text.includes(tag)) {
    text = text.replace(tag, "").replace(/^\s*[\r\n]+/, "").trim();
  } else {
    text = text.trim() ? `${tag}\n${text.trim()}` : tag;
  }
  box.value = text;

  stageOverviewRowDraft(tabKey, sheetRow, {
    tabName,
    notesCol: colIndex,
    notesVal: text,
    notesDirty: true
  });

  const sodBtn = document.getElementById(`ov-sod-btn-${sheetRow}`);
  const eodBtn = document.getElementById(`ov-eod-btn-${sheetRow}`);
  if (sodBtn) {
    const hasSod = text.includes(TAG_START);
    sodBtn.className = `py-0.5 px-2 rounded text-[10px] font-bold border cursor-pointer ${
      hasSod
        ? "bg-emerald-950 text-emerald-300 border-emerald-600"
        : "bg-slate-900 text-slate-400 border-slate-700 hover:text-white"
    }`;
    sodBtn.textContent = `☀️ ${hasSod ? "✓ SOD" : "+ SOD"}`;
  }
  if (eodBtn) {
    const hasEod = text.includes(TAG_END);
    eodBtn.className = `py-0.5 px-2 rounded text-[10px] font-bold border cursor-pointer ${
      hasEod
        ? "bg-indigo-950 text-indigo-300 border-indigo-600"
        : "bg-slate-900 text-slate-400 border-slate-700 hover:text-white"
    }`;
    eodBtn.textContent = `🌙 ${hasEod ? "✓ EOD" : "+ EOD"}`;
  }
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

      // Optimistically update in-memory overview tabObj.rows so the accordion reflects instantly
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

      if (entry.amDirty && entry.amKey) {
        amUpdates[entry.amKey] = entry.amVal;
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