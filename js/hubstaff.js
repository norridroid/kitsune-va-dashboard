import { subscribeCached } from "./firebase.js";
import { renderTopNav, escapeHtml, formatConditionalActivityBadge, getHiddenVaSet } from "./schedule.js";

renderTopNav("hubstaff");

let currentViewMode = "sessions"; // "sessions" | "timeoff"
let allFirebaseRows = [];
let pastedRows = [];
let isUsingManualPaste = false;
let availableDates = [];
let selectedDate = "";
let expandedRowKeys = new Set();

let timeOffData = null;
let kitsuneMemberNames = new Set();

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
toKitsuneOnlyEl.addEventListener("change", renderTimeOffTable);

// Subscribe to full dashboard root so we get hubstaffLive, hubstaffTimeOff, and active Kitsune VAs
subscribeCached("kitsuneDashboard", "kitsune_hubstaff_combined_cache", (data) => {
  if (!data) return;

  // Build active Kitsune member name set for optional filtering on Time Off Requests
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

  // 1. Work Sessions Live Data
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

  // 2. Time Off Requests Data
  timeOffData = data.hubstaffTimeOff || null;
  updateTimeOffBadgeAndRender();
});

function isKitsuneMember(memberName) {
  if (!kitsuneMemberNames.size) return true;
  const clean = String(memberName || "").trim().toLowerCase();
  if (kitsuneMemberNames.has(clean)) return true;
  const firstTwo = clean.split(/\s+/).slice(0, 2).join(" ");
  for (const kn of kitsuneMemberNames) {
    if (kn.startsWith(firstTwo) || clean.startsWith(kn)) return true;
  }
  return false;
}

function updateTimeOffBadgeAndRender() {
  const badgeEl = document.getElementById("to-nav-badge");
  if (timeOffData && Array.isArray(timeOffData.requests)) {
    const relevant = timeOffData.requests.filter((r) => isKitsuneMember(r.member));
    const submittedCount = relevant.filter((r) => String(r.status).toLowerCase() === "submitted").length;
    if (submittedCount > 0) {
      badgeEl.textContent = String(submittedCount);
      badgeEl.classList.remove("hidden");
    } else {
      badgeEl.classList.add("hidden");
    }
  }
  renderTimeOffTable();
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

function renderTimeOffTable() {
  const tbody = document.getElementById("to-tbody");
  const activeBadge = document.getElementById("to-active-tab-badge");
  const countsSummary = document.getElementById("to-counts-summary");
  const syncedLabel = document.getElementById("to-synced-label");

  if (!timeOffData) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-slate-400">Open <a href="https://app.hubstaff.com/organizations/700726/time_off_requests" target="_blank" rel="noreferrer" class="text-teal-400 underline">Hubstaff Time Off Requests</a> with the extension reloaded to sync requests automatically.</td></tr>`;
    return;
  }

  const counts = timeOffData.tabCounts || {};
  activeBadge.textContent = `Hubstaff Tab: ${timeOffData.activeTab || "Submitted"}`;
  countsSummary.textContent = `Org Totals — Submitted: ${counts.submitted ?? 0} • Approved: ${counts.approved ?? 0} • Denied: ${counts.denied ?? 0}`;
  syncedLabel.textContent = timeOffData.syncedAt
    ? `Synced ${new Date(timeOffData.syncedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : "";

  const allReqs = Array.isArray(timeOffData.requests) ? timeOffData.requests : [];
  const filtered = toKitsuneOnlyEl.checked ? allReqs.filter((r) => isKitsuneMember(r.member)) : allReqs;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="p-6 text-center text-slate-500">No time off requests match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (r) => `
      <tr class="hover:bg-slate-800/40 transition-colors align-top">
        <td class="px-4 py-3 font-bold text-white whitespace-nowrap">${escapeHtml(r.member)}</td>
        <td class="px-3 py-3 text-slate-300">
          <span class="px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-[11px] font-medium">${escapeHtml(r.policy)}</span>
        </td>
        <td class="px-3 py-3 text-slate-300 max-w-xs">${escapeHtml(r.reason || "—")}</td>
        <td class="px-3 py-3 font-mono text-slate-200 whitespace-nowrap" title="${escapeHtml(r.startTooltip || "")}">${escapeHtml(r.startLabel)}</td>
        <td class="px-3 py-3 font-mono text-slate-200 whitespace-nowrap" title="${escapeHtml(r.endTooltip || "")}">${escapeHtml(r.endLabel)}</td>
        <td class="px-3 py-3 text-center font-mono font-bold text-teal-300 whitespace-nowrap">${escapeHtml(r.hours)}</td>
        <td class="px-3 py-3 text-center whitespace-nowrap">${getTimeOffStatusBadge(r.status)}</td>
        <td class="px-3 py-3 font-mono text-slate-400 whitespace-nowrap">${escapeHtml(r.requestedOn)}</td>
      </tr>`
    )
    .join("");
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

function renderSelectedDateView() {
  const tbody = document.getElementById("hs-tbody");
  const baseRows = isUsingManualPaste ? pastedRows : allFirebaseRows;
  const rowsForDay = selectedDate
    ? baseRows.filter((r) => String(r.date || "").trim() === selectedDate)
    : [];

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