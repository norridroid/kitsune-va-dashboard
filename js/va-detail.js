import { subscribeCached, updateSheetCell, updateScheduleMeta, updateSiteData } from "./firebase.js";
import {
  renderTopNav,
  escapeHtml,
  parsePastedListItems,
  getProbationEndDate,
  formatConditionalActivityBadge
} from "./schedule.js";

renderTopNav("va-detail");

const TAG_START = "[SOD/SOW Sent]";
const TAG_END = "[EOD/EOW Sent]";

let selectedTabData = {};
let allVas = {};
let siteProfiles = {};
let siteGoals = {};
let siteAmComms = {};
let activeWeekKey = "week_1";
let isSowDrawerOpen = false;
let isDossierEditing = false;
let expandedAmRows = {};

let sowDrafts = {};
let sowDirty = {};

let logDrafts = {};
let isSavingLogs = false;

// Tracks optimistic schedule saves so incoming Firebase snapshots don't revert End Time mid-sync
let pendingScheduleLock = {};

const GLOBAL_DATE_RANGE_KEY = "kitsune_global_log_date_range";
let savedDateRange = {};
try {
  savedDateRange = JSON.parse(localStorage.getItem(GLOBAL_DATE_RANGE_KEY) || "{}");
} catch (_) {}
let logDateFrom = savedDateRange.from || "";
let logDateTo = savedDateRange.to || "";

function persistGlobalDateRange() {
  try {
    localStorage.setItem(GLOBAL_DATE_RANGE_KEY, JSON.stringify({ from: logDateFrom, to: logDateTo }));
  } catch (_) {}
}

function getInitialTarget() {
  const hashStr = window.location.hash.replace(/^#/, "");
  const hashParams = new URLSearchParams(hashStr);
  const searchParams = new URLSearchParams(window.location.search);

  let stored = {};
  try {
    stored = JSON.parse(sessionStorage.getItem("kitsune_target_tab") || "{}");
    sessionStorage.removeItem("kitsune_target_tab");
  } catch (_) {}

  return {
    tab: (hashParams.get("tab") || searchParams.get("tab") || stored.id || "").trim(),
    name: (hashParams.get("name") || searchParams.get("name") || stored.name || "").trim()
  };
}

const initialTarget = getInitialTarget();
let activeKey = "";

subscribeCached("kitsuneDashboard", "kitsune_full_detail_cache", (data) => {
  if (!data) return;
  const incomingTabs = data.selectedTabData || {};

  // Preserve optimistic schedule edits if a save just happened within the last 12 seconds
  const now = Date.now();
  Object.keys(pendingScheduleLock).forEach((k) => {
    const lock = pendingScheduleLock[k];
    if (lock && now - lock.timestamp < 12000 && incomingTabs[k]) {
      incomingTabs[k].scheduleRow = lock.scheduleRow;
      incomingTabs[k].briefUrl = lock.briefUrl;
    } else {
      delete pendingScheduleLock[k];
    }
  });

  selectedTabData = incomingTabs;
  allVas = data.vas || {};
  const siteData = data.siteData || {};
  siteProfiles = siteData.vaProfiles || {};
  siteGoals = siteData.vaGoals || {};
  siteAmComms = siteData.amComms || {};

  resolveRequestedKey();
  populateVaPills();
  renderAll();
});

function resolveRequestedKey() {
  const keys = Object.keys(selectedTabData);
  if (!keys.length) return;
  if (activeKey && selectedTabData[activeKey]) return;

  if (initialTarget.tab && selectedTabData[initialTarget.tab]) {
    activeKey = initialTarget.tab;
    return;
  }

  const clean = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[.#$\[\]\/\s]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const rawTarget = clean(initialTarget.name || initialTarget.tab);
  const targetNorm = norm(initialTarget.tab || initialTarget.name);

  if (targetNorm) {
    let matched = keys.find((k) => selectedTabData[k].fullName && clean(selectedTabData[k].fullName) === rawTarget);
    if (matched) {
      activeKey = matched;
      return;
    }

    matched = keys.find((k) => norm(k) === targetNorm || norm(selectedTabData[k].tabName) === targetNorm);
    if (matched) {
      activeKey = matched;
      return;
    }

    const words = rawTarget.split(" ").filter(Boolean);
    const firstTwo = words.slice(0, 2).join(" ");
    if (words.length >= 2) {
      matched = keys.find((k) => {
        const fn = clean(selectedTabData[k].fullName);
        const tn = clean(selectedTabData[k].tabName);
        return fn.startsWith(firstTwo) || tn === firstTwo || tn.startsWith(firstTwo + " ");
      });
      if (matched) {
        activeKey = matched;
        return;
      }
    }

    const firstWord = rawTarget.split(/[\s@_]+/)[0];
    const secondIsInitial = words[1] && words[1].replace(/\./g, "").length === 1;
    if (firstWord && !secondIsInitial) {
      const exactSingle = keys.find((k) => clean(selectedTabData[k].tabName) === firstWord);
      if (exactSingle) {
        activeKey = exactSingle;
        return;
      }

      const sameFirst = keys.filter((k) => {
        const tn = clean(selectedTabData[k].tabName);
        const fn = clean(selectedTabData[k].fullName);
        return tn === firstWord || tn.startsWith(firstWord + " ") || fn.split(" ")[0] === firstWord;
      });
      if (sameFirst.length === 1) {
        activeKey = sameFirst[0];
        return;
      }
    }
  }

  if (initialTarget.tab || initialTarget.name) {
    activeKey = initialTarget.tab || initialTarget.name;
    return;
  }

  activeKey = keys[0];
}

window.selectVaTabPill = (key) => {
  if (!key || !selectedTabData[key]) return;
  activeKey = key;
  isDossierEditing = false;
  isSowDrawerOpen = false;
  const tabObj = selectedTabData[activeKey];
  const nameQuery = tabObj ? `&name=${encodeURIComponent(tabObj.fullName || tabObj.tabName)}` : "";
  window.history.replaceState({}, "", `#tab=${encodeURIComponent(activeKey)}${nameQuery}`);
  populateVaPills();
  renderAll();
};

document.getElementById("toggle-sow-drawer-btn").addEventListener("click", () => {
  isSowDrawerOpen = !isSowDrawerOpen;
  renderSowAlignment();
});

function populateVaPills() {
  const pillBarEl = document.getElementById("va-pill-bar");
  if (!pillBarEl) return;

  const keys = Object.keys(selectedTabData).sort((a, b) =>
    String(selectedTabData[a].tabName || a).localeCompare(String(selectedTabData[b].tabName || b))
  );

  if (!keys.length) {
    pillBarEl.innerHTML = `<span class="text-xs text-slate-400">No tabs synced yet — open <a href="tabs.html" class="text-teal-400 underline">Select Tabs</a></span>`;
    return;
  }

  pillBarEl.innerHTML = keys
    .map((k) => {
      const t = selectedTabData[k];
      const isSelected = k === activeKey;
      const summaryVa = resolveSummaryVaRecord(t);
      const isOnline = Boolean(summaryVa && String(summaryVa.statusNow || "").toLowerCase().includes("logged in"));
      const safeKey = String(k).replace(/'/g, "\\'");
      const titleAttr =
        t.fullName && t.fullName.toLowerCase() !== t.tabName.toLowerCase()
          ? `${t.tabName} (${t.fullName})`
          : t.tabName;

      return `
        <button type="button"
                onclick="window.selectVaTabPill('${safeKey}')"
                title="${escapeHtml(titleAttr)}"
                class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-sky-950/90 text-white border-sky-400 ring-2 ring-sky-500/40 shadow-md"
                    : "bg-slate-950/90 hover:bg-slate-900 text-slate-200 border-slate-800 hover:border-slate-600"
                }">
          <span class="w-2 h-2 rounded-full ${
            isOnline ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-sky-400"
          }"></span>
          <span>${escapeHtml(t.tabName)}</span>
        </button>
      `;
    })
    .join("");
}

function showToast(msg) {
  const toast = document.getElementById("save-toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 3500);
}

function parseScheduleFields(tabObj) {
  const raw = (tabObj.scheduleRow || [])
    .map((v) => String(v || "").trim())
    .filter((v) => v && !v.toLowerCase().includes("brief") && !v.toLowerCase().startsWith("shift schedule"));

  let shiftType = "";
  const times = [];

  raw.forEach((item) => {
    // Handle combined ranges like "6:00AM - 2:00PM" in a single cell
    const rangeMatch = item.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–to]+\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)$/i);
    if (rangeMatch) {
      times.push(rangeMatch[1].toUpperCase().replace(/\s+/g, ""));
      times.push(rangeMatch[2].toUpperCase().replace(/\s+/g, ""));
    } else if (/^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(item)) {
      times.push(item.toUpperCase().replace(/\s+/g, ""));
    } else if (!shiftType) {
      shiftType = item;
    }
  });

  return {
    shiftType,
    startTime: times[0] || "",
    endTime: times[1] || "",
    briefUrl: tabObj.briefUrl || ""
  };
}

function resolveSummaryVaRecord(tabObj) {
  if (!tabObj) return null;
  const clean = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const fn = clean(tabObj.fullName);
  const tn = clean(tabObj.tabName);
  const list = Object.values(allVas).filter(Boolean);

  if (fn) {
    const exactFull = list.find((v) => clean(v.va) === fn);
    if (exactFull) return exactFull;
  }

  let match = list.find((v) => v.matchedTabKey === activeKey || clean(v.va) === tn);
  if (match) return match;

  const tnWords = tn.split(" ").filter(Boolean);
  if (tnWords.length >= 2) {
    match = list.find((v) => {
      const vn = clean(v.va);
      return vn === tn || vn.startsWith(tn + " ");
    });
    if (match) return match;
  }

  if (tnWords.length === 1) {
    const candidates = list.filter((v) => {
      const vn = clean(v.va);
      return vn === tn || vn.startsWith(tn + " ") || vn.split(/[\s@]+/)[0] === tn;
    });
    if (candidates.length === 1) return candidates[0];
    match = candidates.find((v) => {
      const vWords = clean(v.va).split(" ");
      return !(vWords[1] && vWords[1].replace(/\./g, "").length === 1);
    });
    if (match) return match;
  }

  return null;
}

function resolveFullVaName(tabObj) {
  if (tabObj && tabObj.fullName) return tabObj.fullName;
  const matchedVa = resolveSummaryVaRecord(tabObj);
  return (matchedVa && matchedVa.va) || tabObj.tabName;
}

document.getElementById("save-schedule-btn").addEventListener("click", async () => {
  const tabObj = selectedTabData[activeKey];
  if (!tabObj) return;

  const shiftType = document.getElementById("edit-shift-type").value.trim();
  const startTime = document.getElementById("edit-start-time").value.trim();
  const endTime = document.getElementById("edit-end-time").value.trim();
  const briefUrl = document.getElementById("edit-brief-url").value.trim();

  // Optimistically lock the new schedule values in local memory so End Time does not revert
  const updatedScheduleRow = [shiftType, startTime, endTime].filter(Boolean);
  tabObj.scheduleRow = updatedScheduleRow;
  tabObj.briefUrl = briefUrl;
  pendingScheduleLock[activeKey] = {
    timestamp: Date.now(),
    scheduleRow: updatedScheduleRow,
    briefUrl
  };

  renderDossierCard();
  showToast(`Saving schedule & Account Brief to ${tabObj.tabName} in Google Sheets...`);

  await updateScheduleMeta({
    tabName: tabObj.tabName,
    shiftType,
    startTime,
    endTime,
    briefUrl,
    metaCols: tabObj.metaCols
  });

  showToast(`✓ Saved Row 2 schedule (${startTime} – ${endTime}) to ${tabObj.tabName}!`);
});

window.autoResizeNote = (el) => {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
};

function renderAll() {
  renderDossierCard();
  renderSowAlignment();
  renderActiveTab();
}

function renderDossierCard() {
  const section = document.getElementById("va-dossier-section");
  const tabObj = selectedTabData[activeKey];
  if (!tabObj) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  const sched = parseScheduleFields(tabObj);
  const fullName = resolveFullVaName(tabObj);
  const profile = siteProfiles[activeKey] || {};
  const tier = profile.employmentTier || "regular";
  const isProb = tier === "prob";
  const probEnd = getProbationEndDate(profile.startDate) || "—";
  const shiftRange = sched.startTime && sched.endTime ? `${sched.startTime} - ${sched.endTime}` : sched.startTime || "—";

  if (!isDossierEditing) {
    section.innerHTML = `
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div class="flex flex-wrap justify-between items-start border-b border-slate-800/80 pb-3 gap-2">
          <div>
            <div class="flex flex-wrap items-center gap-2.5">
              <h2 class="text-xl font-bold tracking-tight text-white">${escapeHtml(fullName)}</h2>
              <span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                profile.active === false
                  ? "bg-slate-800 text-slate-400 border-slate-700"
                  : "bg-emerald-950 text-emerald-400 border-emerald-800"
              }">${profile.active === false ? "INACTIVE" : "ACTIVE"}</span>
              <span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                isProb
                  ? "bg-amber-950 text-amber-300 border-amber-800"
                  : "bg-sky-950 text-sky-300 border-sky-800"
              }">${isProb ? "PROBATIONARY" : "REGULAR"}</span>
            </div>
            <div class="text-xs text-slate-500 font-mono mt-1">
              Sheet Tab: <strong class="text-slate-300">${escapeHtml(tabObj.tabName)}</strong> • Site-Only Profile Metadata
            </div>
          </div>

          <button type="button" onclick="window.toggleDossierEdit(true)"
                  class="text-xs text-blue-400 hover:text-blue-300 underline font-semibold cursor-pointer">
            Edit VA Settings & Contacts
          </button>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5 text-xs">
          <div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
            <span class="text-slate-500 block text-[10px]">Schedule</span>
            <p class="font-semibold text-slate-200 mt-0.5">${escapeHtml(sched.shiftType || "Full Time")}</p>
          </div>
          <div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
            <span class="text-slate-500 block text-[10px]">Shift Hours</span>
            <p class="font-semibold text-slate-200 mt-0.5 font-mono whitespace-nowrap">${escapeHtml(shiftRange)}</p>
          </div>
          <div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
            <span class="text-slate-500 block text-[10px]">SOD Target</span>
            <p class="font-semibold text-emerald-400 font-mono mt-0.5 whitespace-nowrap">${escapeHtml(profile.sodTarget || sched.startTime || "—")}</p>
          </div>
          <div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
            <span class="text-slate-500 block text-[10px]">Start Date</span>
            <p class="font-semibold text-slate-200 mt-0.5 font-mono">${escapeHtml(profile.startDate || "—")}</p>
          </div>
          <div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
            <span class="text-slate-500 block text-[10px]">Probation End (3-Mo)</span>
            <p class="font-semibold text-amber-400 font-mono mt-0.5">${escapeHtml(probEnd)}</p>
          </div>
          <div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
            <span class="text-slate-500 block text-[10px]">Birthday</span>
            <p class="font-semibold text-slate-200 mt-0.5 font-mono">${escapeHtml(profile.birthday || "—")}</p>
          </div>
          <div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
            <span class="text-slate-500 block text-[10px]">Primary Contact</span>
            <p class="font-semibold text-emerald-400 font-mono mt-0.5">${escapeHtml(profile.phone || "—")}</p>
          </div>
          <div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
            <span class="text-slate-500 block text-[10px]">TL Lead</span>
            <p class="font-semibold text-purple-400 font-mono mt-0.5">${escapeHtml(profile.tl || "Norris")}</p>
          </div>
        </div>

        <div class="bg-slate-950/60 border border-slate-800/90 rounded-xl p-4 space-y-2.5">
          <div class="flex flex-wrap items-center justify-between border-b border-slate-800/80 pb-2 gap-2">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-slate-200 uppercase tracking-wide">💼 Client & Assignment Dossier</span>
              ${profile.role ? `<span class="bg-blue-950 text-blue-300 border border-blue-800 px-2 py-0.5 rounded text-[10px] font-semibold">${escapeHtml(profile.role)}</span>` : ""}
            </div>
            ${sched.briefUrl ? `<a href="${escapeHtml(sched.briefUrl)}" target="_blank" rel="noreferrer" class="text-xs text-blue-400 hover:text-blue-300 underline font-semibold">Open Brief Document ↗</a>` : ""}
          </div>

          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs pt-0.5">
            <div>
              <span class="text-slate-500 text-[10px] block">Client / Business</span>
              <p class="font-semibold text-slate-200 mt-0.5">${escapeHtml(profile.clientName || "—")} ${profile.clientBusiness ? `(${escapeHtml(profile.clientBusiness)})` : ""}</p>
            </div>
            <div>
              <span class="text-slate-500 text-[10px] block">Required Working Days</span>
              <p class="font-semibold text-slate-200 mt-0.5 font-mono">${escapeHtml(profile.workingDays || "M • T • W • TH • F")}</p>
            </div>
            <div>
              <span class="text-slate-500 text-[10px] block">Client Email / Phone</span>
              <p class="font-semibold text-slate-200 mt-0.5 font-mono">${escapeHtml(profile.clientEmail || "—")}</p>
            </div>
            <div>
              <span class="text-slate-500 text-[10px] block">POC & Comm Channel</span>
              <p class="font-semibold text-slate-200 mt-0.5 font-mono">${escapeHtml(profile.pocComm || "—")}</p>
            </div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  section.innerHTML = `
    <form onsubmit="window.saveDossierForm(event)" class="bg-slate-900 border border-blue-800/70 rounded-2xl p-5 shadow-xl space-y-4 text-xs">
      <div class="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <span class="font-bold text-blue-400 uppercase tracking-wider">Editing Site-Only VA Settings & Client Dossier (${escapeHtml(fullName)})</span>
        <button type="button" onclick="window.toggleDossierEdit(false)" class="text-slate-400 hover:text-white underline cursor-pointer">Cancel</button>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label class="text-slate-400 block mb-1 font-semibold">Employment Tier</label>
          <select id="dos-tier" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100">
            <option value="regular" ${tier === "regular" ? "selected" : ""}>Regular (Weekly SOW)</option>
            <option value="prob" ${tier === "prob" ? "selected" : ""}>Probationary (Daily Tasks)</option>
          </select>
        </div>
        <div>
          <label class="text-slate-400 block mb-1 font-semibold">Status</label>
          <select id="dos-active" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100">
            <option value="true" ${profile.active !== false ? "selected" : ""}>ACTIVE</option>
            <option value="false" ${profile.active === false ? "selected" : ""}>INACTIVE</option>
          </select>
        </div>
        <div>
          <label class="text-slate-400 block mb-1 font-semibold">SOD Target</label>
          <input id="dos-sod" type="text" value="${escapeHtml(profile.sodTarget || sched.startTime || "")}" placeholder="6:15 AM"
                 class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono" />
        </div>
        <div>
          <label class="text-slate-400 block mb-1 font-semibold">TL Lead</label>
          <input id="dos-tl" type="text" value="${escapeHtml(profile.tl || "Norris")}"
                 class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100" />
        </div>
        <div>
          <label class="text-slate-400 block mb-1 font-semibold">Start Date (Auto 3-Mo Probation)</label>
          <input id="dos-start" type="date" value="${escapeHtml(profile.startDate || "")}"
                 class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono" />
        </div>
        <div>
          <label class="text-slate-400 block mb-1 font-semibold">Birthday</label>
          <input id="dos-bday" type="date" value="${escapeHtml(profile.birthday || "")}"
                 class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono" />
        </div>
        <div>
          <label class="text-slate-400 block mb-1 font-semibold">Primary Contact</label>
          <input id="dos-phone" type="text" value="${escapeHtml(profile.phone || "")}" placeholder="+639..."
                 class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono" />
        </div>
        <div>
          <label class="text-slate-400 block mb-1 font-semibold">Role Title</label>
          <input id="dos-role" type="text" value="${escapeHtml(profile.role || "")}" placeholder="Sales Development Manager"
                 class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100" />
        </div>
        <div>
          <label class="text-slate-400 block mb-1 font-semibold">Client Name</label>
          <input id="dos-client" type="text" value="${escapeHtml(profile.clientName || "")}" placeholder="Wayne Greenwood"
                 class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100" />
        </div>
        <div>
          <label class="text-slate-400 block mb-1 font-semibold">Client Business</label>
          <input id="dos-biz" type="text" value="${escapeHtml(profile.clientBusiness || "")}" placeholder="Priority Management Australia"
                 class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100" />
        </div>
        <div>
          <label class="text-slate-400 block mb-1 font-semibold">Required Working Days</label>
          <input id="dos-days" type="text" value="${escapeHtml(profile.workingDays || "M • T • W • TH • F")}"
                 class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono" />
        </div>
        <div>
          <label class="text-slate-400 block mb-1 font-semibold">Client Email / Phone</label>
          <input id="dos-cemail" type="text" value="${escapeHtml(profile.clientEmail || "")}"
                 class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100" />
        </div>
        <div class="sm:col-span-2">
          <label class="text-slate-400 block mb-1 font-semibold">POC & Comm Channel</label>
          <input id="dos-poc" type="text" value="${escapeHtml(profile.pocComm || "")}" placeholder="Roslyn Bella via Slack"
                 class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100" />
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t border-slate-800">
        <button type="button" onclick="window.toggleDossierEdit(false)" class="px-3 py-1.5 text-slate-400 hover:text-white">Cancel</button>
        <button type="submit" class="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold">Save Site Profile</button>
      </div>
    </form>
  `;
}

window.toggleDossierEdit = (val) => {
  isDossierEditing = val;
  renderDossierCard();
};

window.saveDossierForm = async (e) => {
  e.preventDefault();
  const tabObj = selectedTabData[activeKey];
  if (!tabObj) return;

  await updateSiteData(`vaProfiles/${activeKey}`, {
    tabName: tabObj.tabName,
    fullName: resolveFullVaName(tabObj),
    employmentTier: document.getElementById("dos-tier").value,
    active: document.getElementById("dos-active").value === "true",
    sodTarget: document.getElementById("dos-sod").value.trim(),
    tl: document.getElementById("dos-tl").value.trim(),
    startDate: document.getElementById("dos-start").value,
    birthday: document.getElementById("dos-bday").value,
    phone: document.getElementById("dos-phone").value.trim(),
    role: document.getElementById("dos-role").value.trim(),
    clientName: document.getElementById("dos-client").value.trim(),
    clientBusiness: document.getElementById("dos-biz").value.trim(),
    workingDays: document.getElementById("dos-days").value.trim(),
    clientEmail: document.getElementById("dos-cemail").value.trim(),
    pocComm: document.getElementById("dos-poc").value.trim()
  });

  isDossierEditing = false;
  showToast("✓ Saved site-only VA dossier & profile!");
};

function getDraftKey(tabKey, weekKey) {
  return `${tabKey}__${weekKey}`;
}

function getGoalBucket() {
  const dKey = getDraftKey(activeKey, activeWeekKey);
  if (sowDrafts[dKey]) {
    return sowDrafts[dKey];
  }

  const vaGoalNode = siteGoals[activeKey] || {};
  const weekNode = vaGoalNode[activeWeekKey] || {};
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

function ensureLocalDraft() {
  const dKey = getDraftKey(activeKey, activeWeekKey);
  if (!sowDrafts[dKey]) {
    sowDrafts[dKey] = getGoalBucket();
  }
  return sowDrafts[dKey];
}

function renderSowAlignment() {
  const section = document.getElementById("sow-alignment-section");
  const toggleBtn = document.getElementById("toggle-sow-drawer-btn");
  const tabObj = selectedTabData[activeKey];

  if (!tabObj) {
    section.classList.add("hidden");
    toggleBtn.classList.add("hidden");
    return;
  }

  toggleBtn.classList.remove("hidden");
  const profile = siteProfiles[activeKey] || {};
  const isProb = profile.employmentTier === "prob";
  toggleBtn.textContent = isSowDrawerOpen
    ? `▲ Hide ${isProb ? "Daily Tasks" : "Weekly SOW"}`
    : `🎯 ${isProb ? "Daily Task Alignment" : "Weekly SOW Alignment"}`;

  if (!isSowDrawerOpen) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  const fullName = resolveFullVaName(tabObj);
  const bucket = getGoalBucket();
  const itemLabel = isProb ? "Task" : "Focus";
  const dKey = getDraftKey(activeKey, activeWeekKey);
  const hasUnsaved = Boolean(sowDirty[dKey]);

  const itemsHtml = bucket.focuses
    .map(
      (f, idx) => `
      <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2">
        <div class="flex items-center justify-between">
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" ${f.achieved ? "checked" : ""}
                   onchange="window.updateGoalItem(${idx}, 'achieved', this.checked)"
                   class="w-3.5 h-3.5 rounded border-slate-700 bg-slate-900 text-emerald-500 cursor-pointer" />
            <span class="text-xs font-bold ${f.achieved ? "text-emerald-400 line-through" : "text-slate-200"}">
              ${itemLabel} ${idx + 1}
            </span>
          </label>
          ${f.achieved ? '<span class="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded font-mono font-bold">HIT</span>' : ""}
        </div>

        <textarea rows="2"
                  onpaste="window.handleMultiPasteGoals(event, ${idx})"
                  oninput="window.updateGoalItem(${idx}, 'text', this.value, true)"
                  placeholder="Enter SOW ${itemLabel.toLowerCase()} ${idx + 1} (or paste a full list to auto-split)..."
                  class="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500 leading-normal">${escapeHtml(f.text || "")}</textarea>

        <input type="text"
               value="${escapeHtml(f.outcomeNotes || "")}"
               oninput="window.updateGoalItem(${idx}, 'outcomeNotes', this.value, true)"
               placeholder="Outcome details, progress, or blockers..."
               class="w-full bg-slate-900/60 border border-slate-800/80 rounded-lg px-2.5 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-emerald-500" />
      </div>`
    )
    .join("");

  section.innerHTML = `
    <div class="bg-slate-900 border ${hasUnsaved ? "border-amber-600/70" : "border-slate-800"} rounded-2xl p-5 shadow-2xl space-y-4">
      <div class="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-2">
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="text-base">${isProb ? "⏳" : "🎯"}</span>
          <span class="text-xs font-bold text-white uppercase tracking-wider">
            ${isProb ? "DAILY TASK ALIGNMENT" : "WEEKLY SOW ALIGNMENT"}:
            <strong class="text-blue-400">${escapeHtml(tabObj.tabName.toUpperCase())}</strong> (${escapeHtml(fullName.toUpperCase())})
          </span>
          <span id="sow-status-badge" class="text-[10px] font-mono px-2 py-0.5 rounded-full border ${
            hasUnsaved
              ? "text-amber-300 bg-amber-950/70 border-amber-700"
              : "text-emerald-400 bg-emerald-950/60 border-emerald-800"
          }">
            ${hasUnsaved ? "● Unsaved draft changes" : "✓ Saved"}
          </span>
        </div>

        <div class="flex items-center gap-2">
          <button type="button" onclick="window.saveSowDraft()"
                  class="px-3.5 py-1.5 text-xs font-bold text-white ${
                    hasUnsaved ? "bg-teal-600 hover:bg-teal-500 ring-2 ring-teal-400/50" : "bg-teal-700 hover:bg-teal-600"
                  } rounded-lg shadow cursor-pointer">
            💾 Save SOW
          </button>
          <button type="button" onclick="window.toggleSowDrawer()"
                  class="px-3 py-1.5 text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg cursor-pointer">
            Collapse
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-slate-200 uppercase tracking-wide">
            ${isProb ? "📋 DAILY TASK MILESTONES" : "🎯 WEEKLY SOW FOCUSES"}
          </span>
          <span class="text-[9px] px-2 py-0.5 rounded border font-mono font-bold ${
            isProb ? "bg-amber-950 border-amber-800 text-amber-300" : "bg-sky-950 border-sky-800 text-sky-300"
          }">${isProb ? "PROBATIONARY" : "REGULAR"}</span>
        </div>
      </div>

      <div class="space-y-2.5">${itemsHtml}</div>

      <div>
        <button type="button" onclick="window.addGoalItem()"
                class="text-xs font-semibold text-blue-400 hover:text-blue-300 bg-blue-950/40 hover:bg-blue-950/70 border border-blue-900/60 px-3 py-1.5 rounded-lg cursor-pointer">
          + Add ${itemLabel}
        </button>
      </div>

      <div class="pt-2 border-t border-slate-800/80 space-y-1.5">
        <label class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">📝 ADDITIONAL NOTES:</label>
        <textarea rows="3"
                  oninput="window.updateGoalAdditionalNotes(this.value, true)"
                  placeholder="Enter additional weekly context, client targets, or review notes..."
                  class="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono leading-relaxed">${escapeHtml(bucket.additionalNotes)}</textarea>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
        <button type="button" onclick="window.appendGoalsToSheet('sod')"
                class="bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs px-4 py-2 rounded-xl shadow flex items-center gap-1.5 cursor-pointer">
          <span>☀️ Append SOW (SOD) to Note Draft</span>
        </button>

        <button type="button" onclick="window.appendGoalsToSheet('eod')"
                class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-4 py-2 rounded-xl shadow flex items-center gap-1.5 cursor-pointer">
          <span>🌙 Append Audit (EOD) to Note Draft</span>
        </button>
      </div>
    </div>
  `;
}

function markSowDirtyIndicator() {
  const dKey = getDraftKey(activeKey, activeWeekKey);
  sowDirty[dKey] = true;
  const badge = document.getElementById("sow-status-badge");
  if (badge) {
    badge.className = "text-[10px] font-mono px-2 py-0.5 rounded-full border text-amber-300 bg-amber-950/70 border-amber-700";
    badge.textContent = "● Unsaved draft changes";
  }
}

window.toggleSowDrawer = () => {
  isSowDrawerOpen = !isSowDrawerOpen;
  renderSowAlignment();
};

window.setSowWeek = (wk) => {
  activeWeekKey = wk;
  renderSowAlignment();
};

window.updateGoalItem = (idx, field, val, skipRerender = false) => {
  const draft = ensureLocalDraft();
  draft.focuses[idx] = { ...draft.focuses[idx], [field]: val };
  markSowDirtyIndicator();
  if (!skipRerender) renderSowAlignment();
};

window.addGoalItem = () => {
  const draft = ensureLocalDraft();
  draft.focuses.push({ id: `f_${Date.now()}`, text: "", achieved: false, outcomeNotes: "" });
  markSowDirtyIndicator();
  renderSowAlignment();
};

window.updateGoalAdditionalNotes = (val, skipRerender = false) => {
  const draft = ensureLocalDraft();
  draft.additionalNotes = val;
  markSowDirtyIndicator();
  if (!skipRerender) renderSowAlignment();
};

window.saveSowDraft = async () => {
  const dKey = getDraftKey(activeKey, activeWeekKey);
  const draft = getGoalBucket();
  await updateSiteData(`vaGoals/${activeKey}/${activeWeekKey}`, {
    focuses: draft.focuses,
    additionalNotes: draft.additionalNotes
  });
  delete sowDrafts[dKey];
  delete sowDirty[dKey];
  showToast(`✓ Saved SOW / Daily Tasks!`);
  renderSowAlignment();
};

window.handleMultiPasteGoals = (e, startIdx) => {
  const items = parsePastedListItems(e.clipboardData);
  if (items.length <= 1) return;
  e.preventDefault();

  const draft = ensureLocalDraft();
  items.forEach((text, offset) => {
    const target = startIdx + offset;
    if (target < draft.focuses.length) {
      draft.focuses[target] = { ...draft.focuses[target], text };
    } else {
      draft.focuses.push({ id: `f_${Date.now()}_${offset}`, text, achieved: false, outcomeNotes: "" });
    }
  });

  markSowDirtyIndicator();
  renderSowAlignment();
  showToast(`✓ Auto-split ${items.length} items — click Save SOW when ready!`);
};

window.appendGoalsToSheet = (mode) => {
  const tabObj = selectedTabData[activeKey];
  if (!tabObj || !tabObj.rows || !tabObj.rows.length) return;

  const bucket = getGoalBucket();
  const notesIdx = (tabObj.headers || []).findIndex((h) => h.toLowerCase() === "notes");
  if (notesIdx === -1) {
    showToast("Could not find Notes column in this VA's tab.");
    return;
  }

  const notesKey = tabObj.cleanHeaders[notesIdx];
  const notesCol = tabObj.colIndices[notesIdx];

  const targetRow =
    [...tabObj.rows].reverse().find((r) => String(r.Clock_in || r.Clock_In || "").trim()) ||
    tabObj.rows[tabObj.rows.length - 1];

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

  if (bucket.additionalNotes.trim()) {
    block += `\n📝 Additional Notes:\n${bucket.additionalNotes.trim()}\n`;
  }

  const rowDraftKey = getLogRowDraftKey(activeKey, targetRow._sheetRow);
  const existingDraft = logDrafts[rowDraftKey];
  const existing =
    existingDraft && existingDraft.notesDirty
      ? existingDraft.notesVal.trim()
      : String(targetRow[notesKey] || "").trim();
  const combined = existing ? `${existing}\n${block.trim()}` : block.trim();

  stageRowDraft(activeKey, targetRow._sheetRow, {
    tabName: tabObj.tabName,
    notesCol,
    notesVal: combined,
    notesDirty: true
  });

  renderActiveTab();
  showToast(`✓ Appended ${mode.toUpperCase()} to Row ${targetRow._sheetRow} draft — click "Save Log Changes" to push to Sheet.`);
};

function getLogRowDraftKey(tabKey, sheetRow) {
  return `${tabKey}__row_${sheetRow}`;
}

function stageRowDraft(tabKey, sheetRow, patch) {
  const key = getLogRowDraftKey(tabKey, sheetRow);
  logDrafts[key] = {
    tabKey,
    sheetRow,
    ...(logDrafts[key] || {}),
    ...patch
  };
  updateLogSaveButtonsUI();
}

function getActiveTabDirtyLogEntries() {
  return Object.values(logDrafts).filter(
    (d) => d && d.tabKey === activeKey && (d.notesDirty || d.flagDirty || d.amDirty)
  );
}

function updateLogSaveButtonsUI() {
  const dirtyCount = getActiveTabDirtyLogEntries().length;
  const label = isSavingLogs
    ? "⏳ Saving..."
    : dirtyCount > 0
    ? `💾 Save Log Changes (${dirtyCount})`
    : "💾 Save Log Changes";

  const btnClass =
    dirtyCount > 0
      ? "px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-lg ring-2 ring-amber-400/50 transition cursor-pointer"
      : "px-3.5 py-1.5 rounded-lg bg-teal-700/80 hover:bg-teal-600 text-white font-semibold text-xs border border-teal-600/60 transition cursor-pointer";

  ["top-save-logs-btn", "bottom-save-logs-btn"].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.textContent = label;
    btn.className = btnClass;
    btn.disabled = isSavingLogs;
  });

  const statusEl = document.getElementById("logs-unsaved-badge");
  if (statusEl) {
    if (dirtyCount > 0) {
      statusEl.textContent = `● ${dirtyCount} unsaved row(s)`;
      statusEl.className =
        "text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-700";
    } else {
      statusEl.textContent = "✓ All rows synced";
      statusEl.className =
        "text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/70";
    }
  }
}

window.stageNoteEdit = (tabName, sheetRow, colIndex, value) => {
  stageRowDraft(activeKey, sheetRow, {
    tabName,
    notesCol: colIndex,
    notesVal: value,
    notesDirty: true
  });
};

window.stageFlagEdit = (tabName, sheetRow, colIndex, value, selectEl) => {
  stageRowDraft(activeKey, sheetRow, {
    tabName,
    flagCol: colIndex,
    flagVal: value,
    flagDirty: true
  });
  if (selectEl) {
    selectEl.className = `px-2 py-1.5 rounded border text-xs ${getFlagSelectStyle(value)}`;
  }
};

window.stageAmCommsEdit = (sheetRow, amKey, value) => {
  stageRowDraft(activeKey, sheetRow, {
    amKey,
    amVal: value,
    amDirty: true
  });
};

window.toggleRowTag = (tabName, sheetRow, colIndex, tag) => {
  const box = document.getElementById(`note-box-${sheetRow}`);
  if (!box) return;
  let text = box.value || "";
  if (text.includes(tag)) {
    text = text.replace(tag, "").replace(/^\s*[\r\n]+/, "").trim();
  } else {
    text = text.trim() ? `${tag}\n${text.trim()}` : tag;
  }
  box.value = text;
  window.autoResizeNote(box);

  stageRowDraft(activeKey, sheetRow, {
    tabName,
    notesCol: colIndex,
    notesVal: text,
    notesDirty: true
  });

  const sodBtn = document.getElementById(`sod-btn-${sheetRow}`);
  const eodBtn = document.getElementById(`eod-btn-${sheetRow}`);
  if (sodBtn) {
    const hasSod = text.includes(TAG_START);
    sodBtn.className = `py-0.5 px-2 rounded-md text-[10px] font-bold border transition cursor-pointer ${
      hasSod
        ? "bg-emerald-950/90 text-emerald-300 border-emerald-600"
        : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200"
    }`;
    sodBtn.textContent = `☀️ ${hasSod ? "✓ SOD" : "+ SOD"}`;
  }
  if (eodBtn) {
    const hasEod = text.includes(TAG_END);
    eodBtn.className = `py-0.5 px-2 rounded-md text-[10px] font-bold border transition cursor-pointer ${
      hasEod
        ? "bg-indigo-950/90 text-indigo-300 border-indigo-600"
        : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200"
    }`;
    eodBtn.textContent = `🌙 ${hasEod ? "✓ EOD" : "+ EOD"}`;
  }
};

window.saveAllLogDrafts = async () => {
  const dirtyEntries = getActiveTabDirtyLogEntries();
  if (!dirtyEntries.length) {
    showToast("No unsaved log changes to save.");
    return;
  }

  isSavingLogs = true;
  updateLogSaveButtonsUI();
  showToast(`Saving ${dirtyEntries.length} modified row(s) to Google Sheets...`);

  try {
    const tabObj = selectedTabData[activeKey];
    const amUpdates = {};
    const updatePromises = dirtyEntries.map(async (entry) => {
      const promises = [];

      // Optimistically update in-memory tabObj.rows so it reflects instantly
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
      delete logDrafts[getLogRowDraftKey(entry.tabKey, entry.sheetRow)];
    });

    await Promise.all(updatePromises);

    if (Object.keys(amUpdates).length) {
      await updateSiteData("amComms", amUpdates);
    }

    showToast(`✓ Saved all ${dirtyEntries.length} row(s) to Google Sheets!`);
  } catch (err) {
    showToast(`Error saving logs: ${err.message}`);
  } finally {
    isSavingLogs = false;
    updateLogSaveButtonsUI();
    renderActiveTab();
  }
};

function parseRowDateToIso(rawStr) {
  const s = String(rawStr || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const hasYear = /\b20\d{2}\b/.test(s);
  const candidate = hasYear ? s : `${s}, ${new Date().getFullYear()}`;
  const d = new Date(candidate);
  if (isNaN(d.getTime())) return "";

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

window.setLogDateRange = (fromVal, toVal) => {
  logDateFrom = fromVal || "";
  logDateTo = toVal || "";
  persistGlobalDateRange();
  renderActiveTab();
};

window.applyQuickDatePreset = (daysBack) => {
  if (!daysBack) {
    logDateFrom = "";
    logDateTo = "";
    persistGlobalDateRange();
    renderActiveTab();
    return;
  }
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (daysBack - 1));

  const toIso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  logDateFrom = toIso(start);
  logDateTo = toIso(end);
  persistGlobalDateRange();
  renderActiveTab();
};

function getFlagSelectStyle(val) {
  const upper = String(val || "").trim().toUpperCase();
  if (upper === "GREEN") return "bg-emerald-950 text-emerald-300 border-emerald-700 font-bold";
  if (upper === "YELLOW") return "bg-amber-950 text-amber-300 border-amber-700 font-bold";
  if (upper === "RED") return "bg-rose-950 text-rose-300 border-rose-700 font-bold";
  if (upper === "RL") return "bg-purple-950 text-purple-300 border-purple-700 font-bold";
  if (upper === "EL") return "bg-orange-950 text-orange-300 border-orange-700 font-bold";
  return "bg-slate-800 text-slate-200 border-slate-700";
}

function renderActiveTab() {
  const container = document.getElementById("tab-content");
  const editorEl = document.getElementById("schedule-editor");
  const openBriefLink = document.getElementById("open-brief-link");
  const tabObj = selectedTabData[activeKey];

  if (!tabObj) {
    editorEl.classList.add("hidden");
    openBriefLink.classList.add("hidden");
    const missingLabel = initialTarget.name || initialTarget.tab;
    container.innerHTML = `
      <p class="text-slate-400 text-sm">
        ${missingLabel ? `<strong>${escapeHtml(missingLabel)}</strong> is not synced yet.` : "This tab is not currently synced."}
        Enable it on <a href="tabs.html" class="text-teal-400 underline">Select Tabs</a> to view and edit it here.
      </p>`;
    return;
  }

  editorEl.classList.remove("hidden");
  const fields = parseScheduleFields(tabObj);
  document.getElementById("edit-shift-type").value = fields.shiftType;
  document.getElementById("edit-start-time").value = fields.startTime;
  document.getElementById("edit-end-time").value = fields.endTime;
  document.getElementById("edit-brief-url").value = fields.briefUrl;

  if (fields.briefUrl) {
    openBriefLink.href = fields.briefUrl;
    openBriefLink.classList.remove("hidden");
  } else {
    openBriefLink.classList.add("hidden");
  }

  const summaryVa = resolveSummaryVaRecord(tabObj);
  const liveStatus = (summaryVa && summaryVa.statusNow) || "Status unavailable";
  const isOnline = liveStatus.toLowerCase().includes("logged in");
  const liveActivity = (summaryVa && summaryVa.avgActivity) || "—";
  const liveAvgHrs = (summaryVa && summaryVa.avgHrsPerDay) || "—";
  const liveLate = (summaryVa && summaryVa.lateClockIns) || "0";
  const liveFocus = (summaryVa && summaryVa.coachingFocus) || "—";

  const headers = tabObj.headers || [];
  const cleanHeaders = tabObj.cleanHeaders || [];
  const colIndices = tabObj.colIndices || [];
  const allRows = tabObj.rows || [];

  const dateColIdx = headers.findIndex((h, idx) => idx === 0 || /week|date/i.test(h));
  const dateKey = dateColIdx !== -1 ? cleanHeaders[dateColIdx] : cleanHeaders[0];

  const rows = allRows.filter((row) => {
    if (!logDateFrom && !logDateTo) return true;
    const iso = parseRowDateToIso(row[dateKey]);
    if (!iso) return true;
    if (logDateFrom && iso < logDateFrom) return false;
    if (logDateTo && iso > logDateTo) return false;
    return true;
  });

  const filterBarHtml = `
    <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-900/95 border-b border-slate-800 text-xs">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-bold text-slate-300 uppercase tracking-wider text-[11px]" title="Applies across all VA tabs">📅 Global Date Range:</span>
        <input type="date" value="${escapeHtml(logDateFrom)}"
               onchange="window.setLogDateRange(this.value, '${escapeHtml(logDateTo)}')"
               class="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-100 font-mono focus:border-teal-500 focus:outline-none" />
        <span class="text-slate-500">to</span>
        <input type="date" value="${escapeHtml(logDateTo)}"
               onchange="window.setLogDateRange('${escapeHtml(logDateFrom)}', this.value)"
               class="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-100 font-mono focus:border-teal-500 focus:outline-none" />
        ${
          logDateFrom || logDateTo
            ? `<button type="button" onclick="window.applyQuickDatePreset(0)"
                       class="px-2 py-1 rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-200 border border-rose-800 text-[11px] font-semibold">
                 Clear
               </button>`
            : ""
        }
        <button type="button" onclick="window.applyQuickDatePreset(7)"
                class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px]">
          7d
        </button>
        <button type="button" onclick="window.applyQuickDatePreset(14)"
                class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px]">
          14d
        </button>
        <button type="button" onclick="window.applyQuickDatePreset(30)"
                class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px]">
          30d
        </button>
        <button type="button" onclick="window.applyQuickDatePreset(0)"
                class="px-2 py-1 rounded-lg ${
                  !logDateFrom && !logDateTo
                    ? "bg-teal-700 text-white font-semibold"
                    : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                } text-[11px]">
          All
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2.5">
        <span class="text-[11px] text-slate-400">Showing <strong>${rows.length}</strong>/${allRows.length}</span>
        <span id="logs-unsaved-badge" class="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/70">
          ✓ All rows synced
        </span>
        <button id="top-save-logs-btn" type="button" onclick="window.saveAllLogDrafts()"
                class="px-3.5 py-1.5 rounded-lg bg-teal-700/80 hover:bg-teal-600 text-white font-semibold text-xs border border-teal-600/60 transition cursor-pointer">
          💾 Save Log Changes
        </button>
      </div>
    </div>
  `;

  const thead = `
    <thead class="bg-slate-800 text-xs uppercase text-slate-300">
      <tr>
        ${headers.map((h) => `<th class="p-3 text-left">${escapeHtml(h)}</th>`).join("")}
      </tr>
    </thead>
  `;

  const tbody = rows.length
    ? rows
        .map((row) => {
          const rowDraft = logDrafts[getLogRowDraftKey(activeKey, row._sheetRow)] || {};
          const rowIsDirty = Boolean(rowDraft.notesDirty || rowDraft.flagDirty || rowDraft.amDirty);

          const cells = headers
            .map((rawH, idx) => {
              const exactSheetCol = colIndices[idx] || idx + 1;
              const primaryKey = cleanHeaders[idx];
              const serverVal =
                row[primaryKey] !== undefined
                  ? row[primaryKey]
                  : row[rawH] !== undefined
                  ? row[rawH]
                  : row[rawH.toLowerCase()] !== undefined
                  ? row[rawH.toLowerCase()]
                  : row[primaryKey.toLowerCase()] || "";
              const lowerHeader = rawH.toLowerCase();

              if (idx === 0 || lowerHeader.includes("week") || lowerHeader.includes("date")) {
                return `
                  <td class="p-3 text-xs whitespace-nowrap align-top">
                    <div class="relative group inline-flex items-center gap-1.5 cursor-help">
                      <span class="font-mono font-semibold text-slate-200 underline decoration-dotted decoration-teal-600 underline-offset-4">
                        ${escapeHtml(serverVal)}
                      </span>
                      <span class="w-1.5 h-1.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-slate-600"}"></span>

                      <div class="hidden group-hover:block absolute left-0 bottom-full mb-2 z-50 w-64 bg-slate-950/95 backdrop-blur-md border border-teal-700/70 rounded-xl p-3 shadow-2xl pointer-events-none space-y-2 text-left whitespace-normal">
                        <div class="flex items-center justify-between border-b border-slate-800 pb-1.5">
                          <span class="text-[10px] font-bold uppercase tracking-wider text-teal-300">
                            ${escapeHtml(tabObj.tabName)} • Live Status
                          </span>
                          <span class="text-[10px] font-mono text-slate-400">${escapeHtml(serverVal)}</span>
                        </div>

                        <div class="flex items-center gap-2 text-xs font-semibold ${isOnline ? "text-emerald-400" : "text-slate-300"}">
                          <span class="w-2 h-2 rounded-full ${isOnline ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}"></span>
                          <span>${escapeHtml(liveStatus)}</span>
                        </div>

                        <div class="grid grid-cols-3 gap-1.5 pt-1 text-center font-mono">
                          <div class="bg-slate-900 border border-slate-800 rounded-lg p-1.5">
                            <span class="block text-[9px] text-slate-400 font-sans">Activity (7d)</span>
                            <div class="mt-0.5 text-xs">${formatConditionalActivityBadge(liveActivity)}</div>
                          </div>
                          <div class="bg-slate-900 border border-slate-800 rounded-lg p-1.5">
                            <span class="block text-[9px] text-slate-400 font-sans">Avg Hrs</span>
                            <strong class="text-xs text-slate-200">${escapeHtml(liveAvgHrs)}</strong>
                          </div>
                          <div class="bg-slate-900 border border-slate-800 rounded-lg p-1.5">
                            <span class="block text-[9px] text-slate-400 font-sans">Late (7d)</span>
                            <strong class="text-xs ${Number(liveLate) > 0 ? "text-amber-300" : "text-emerald-400"}">${escapeHtml(liveLate)}</strong>
                          </div>
                        </div>

                        <div class="text-[10px] text-slate-400 pt-0.5">
                          Focus: <span class="font-semibold ${liveFocus.toLowerCase() === "on track" ? "text-emerald-400" : "text-amber-300"}">${escapeHtml(liveFocus)}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                `;
              }

              if (lowerHeader === "flag") {
                const effectiveFlag = rowDraft.flagDirty ? rowDraft.flagVal : serverVal;
                const flagStyle = getFlagSelectStyle(effectiveFlag);
                const upperVal = String(effectiveFlag || "").trim().toUpperCase();
                return `
                  <td class="p-2 align-top">
                    <select onchange="window.stageFlagEdit('${tabObj.tabName}', ${row._sheetRow}, ${exactSheetCol}, this.value, this)"
                            class="px-2 py-1.5 rounded border text-xs ${flagStyle}">
                      <option value="" ${upperVal === "" ? "selected" : ""}>-</option>
                      <option value="Green" ${upperVal === "GREEN" ? "selected" : ""}>Green</option>
                      <option value="Yellow" ${upperVal === "YELLOW" ? "selected" : ""}>Yellow</option>
                      <option value="Red" ${upperVal === "RED" ? "selected" : ""}>Red</option>
                      <option value="RL" ${upperVal === "RL" ? "selected" : ""}>RL</option>
                      <option value="EL" ${upperVal === "EL" ? "selected" : ""}>EL</option>
                    </select>
                  </td>
                `;
              }

              if (lowerHeader === "notes") {
                const effectiveNote = rowDraft.notesDirty ? rowDraft.notesVal : serverVal;
                const hasSod = effectiveNote.includes(TAG_START);
                const hasEod = effectiveNote.includes(TAG_END);
                const amKey = `${activeKey}_row_${row._sheetRow}`;
                const effectiveAmText = rowDraft.amDirty ? rowDraft.amVal : (siteAmComms[amKey] || "");
                const isAmOpen = Boolean(expandedAmRows[amKey]);

                return `
                  <td class="p-2 min-w-[340px] max-w-[520px] align-top space-y-2">
                    <textarea id="note-box-${row._sheetRow}" rows="1"
                              oninput="window.autoResizeNote(this); window.stageNoteEdit('${tabObj.tabName}', ${row._sheetRow}, ${exactSheetCol}, this.value)"
                              placeholder="Add TL note..."
                              class="note-textarea w-full px-2.5 py-1.5 rounded-lg bg-slate-800 border ${
                                rowDraft.notesDirty ? "border-amber-500/80" : "border-slate-700"
                              } text-xs leading-relaxed text-slate-100 resize-y overflow-hidden focus:border-teal-500 focus:outline-none">${escapeHtml(effectiveNote)}</textarea>

                    <div class="flex flex-wrap items-center justify-between gap-1.5">
                      <button type="button" onclick="window.toggleAmCommsRow('${amKey}')"
                              class="text-[10px] font-bold px-2 py-0.5 rounded border transition cursor-pointer flex items-center gap-1 ${
                                effectiveAmText.trim()
                                  ? "bg-rose-950 text-rose-300 border-rose-800"
                                  : "bg-slate-950 text-slate-400 border-slate-800 hover:text-rose-300"
                              }">
                        <span>🚩</span>
                        <span>${isAmOpen ? "Hide Comms" : effectiveAmText.trim() ? "AM Comms (Logged)" : "+ AM Comms"}</span>
                      </button>

                      <div class="flex items-center gap-1.5">
                        <button id="sod-btn-${row._sheetRow}" type="button" onclick="window.toggleRowTag('${tabObj.tabName}', ${row._sheetRow}, ${exactSheetCol}, '${TAG_START}')"
                                class="py-0.5 px-2 rounded-md text-[10px] font-bold border transition cursor-pointer ${
                                  hasSod
                                    ? "bg-emerald-950/90 text-emerald-300 border-emerald-600"
                                    : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200"
                                }">
                          ☀️ ${hasSod ? "✓ SOD" : "+ SOD"}
                        </button>

                        <button id="eod-btn-${row._sheetRow}" type="button" onclick="window.toggleRowTag('${tabObj.tabName}', ${row._sheetRow}, ${exactSheetCol}, '${TAG_END}')"
                                class="py-0.5 px-2 rounded-md text-[10px] font-bold border transition cursor-pointer ${
                                  hasEod
                                    ? "bg-indigo-950/90 text-indigo-300 border-indigo-600"
                                    : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200"
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
                                      oninput="window.stageAmCommsEdit(${row._sheetRow}, '${amKey}', this.value)"
                                      placeholder="Log client escalations or AM follow-ups..."
                                      class="w-full bg-slate-950 border border-rose-900/70 rounded p-1.5 text-xs text-rose-100 focus:outline-none">${escapeHtml(effectiveAmText)}</textarea>
                          </div>`
                        : ""
                    }
                  </td>
                `;
              }

              return `<td class="p-3 text-xs whitespace-nowrap align-top">${escapeHtml(serverVal)}</td>`;
            })
            .join("");

          return `<tr class="border-t border-slate-800 ${rowIsDirty ? "bg-amber-950/15" : "hover:bg-slate-800/40"}">${cells}</tr>`;
        })
        .join("")
    : `<tr><td colspan="${headers.length || 1}" class="p-6 text-center text-slate-400 text-xs">No log rows match the selected date range.</td></tr>`;

  const bottomSaveBarHtml = `
    <div class="flex items-center justify-end px-4 py-3 bg-slate-900/95 border-t border-slate-800">
      <button id="bottom-save-logs-btn" type="button" onclick="window.saveAllLogDrafts()"
              class="px-3.5 py-1.5 rounded-lg bg-teal-700/80 hover:bg-teal-600 text-white font-semibold text-xs border border-teal-600/60 transition cursor-pointer">
        💾 Save Log Changes
      </button>
    </div>
  `;

  container.innerHTML = `${filterBarHtml}<table class="w-full border-collapse">${thead}<tbody>${tbody}</tbody></table>${bottomSaveBarHtml}`;
  container.querySelectorAll(".note-textarea").forEach((ta) => window.autoResizeNote(ta));
  updateLogSaveButtonsUI();
}

window.toggleAmCommsRow = (amKey) => {
  expandedAmRows[amKey] = !expandedAmRows[amKey];
  renderActiveTab();
};