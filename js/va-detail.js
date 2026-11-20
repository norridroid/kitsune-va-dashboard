import { subscribeCached, updateSheetCell, updateScheduleMeta, updateSiteData } from "./firebase.js";
import {
  renderTopNav,
  escapeHtml,
  parsePastedListItems,
  getProbationEndDate,
  formatConditionalActivityBadge,
  deriveScheduleFromTab
} from "./schedule.js";

renderTopNav("va-detail");

let selectedTabData = {};
let allVas = {};
let vaOrderList = [];
let hubstaffLiveRows = [];
let siteProfiles = {};
let siteGoals = {};
let siteAmComms = {};
let activeWeekKey = "week_1";
let isDossierEditing = false;
let expandedAmRows = {};
let expandedDateAlignRows = {};

let sowDrafts = {};
let sowDirty = {};

let logDrafts = {};
let isSavingLogs = false;

// Tracks optimistic schedule saves so incoming Firebase snapshots don't revert End Time mid-sync
let pendingScheduleLock = {};

const CUSTOM_PILL_ORDER_KEY = "kitsune_custom_va_pill_order";
let customPillOrder = [];
try {
  const savedOrder = JSON.parse(localStorage.getItem(CUSTOM_PILL_ORDER_KEY) || "[]");
  if (Array.isArray(savedOrder)) customPillOrder = savedOrder;
} catch (_) {}

function saveCustomPillOrder() {
  try {
    localStorage.setItem(CUSTOM_PILL_ORDER_KEY, JSON.stringify(customPillOrder));
  } catch (_) {}
}

let draggedPillKey = null;

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

const resetOrderBtn = document.getElementById("reset-pill-order-btn");
if (resetOrderBtn) {
  resetOrderBtn.addEventListener("click", () => {
    customPillOrder = [];
    saveCustomPillOrder();
    populateVaPills();
    showToast("✓ Reset VA pill order to match Overview schedule order");
  });
}

subscribeCached("kitsuneDashboard", "kitsune_full_detail_cache", (data) => {
  if (!data) return;
  const incomingTabs = data.selectedTabData || {};

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
  vaOrderList = Array.isArray(data.vaOrder) ? data.vaOrder : Object.keys(allVas);

  const liveData = data.hubstaffLive || {};
  hubstaffLiveRows = Array.isArray(liveData.rows)
    ? liveData.rows
    : Object.values(liveData.rows || {});

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

  const orderedKeys = getOrderedTabKeys();
  activeKey = orderedKeys[0] || keys[0];
}

function getOrderedTabKeys() {
  const keys = Object.keys(selectedTabData);
  if (!keys.length) return [];

  const metaByKey = {};
  keys.forEach((k) => {
    const t = selectedTabData[k];
    const summaryVa = resolveSummaryVaRecordForTab(k, t);
    const vaId = summaryVa ? summaryVa.id : "";
    const sheetIndex = vaId && vaOrderList.indexOf(vaId) !== -1 ? vaOrderList.indexOf(vaId) : 9999;
    const schedInfo = summaryVa
      ? deriveScheduleFromTab(summaryVa, selectedTabData)
      : deriveScheduleFromTab({ id: k, va: t.tabName, scheduleRow: t.scheduleRow }, selectedTabData);

    metaByKey[k] = {
      startMinutes: schedInfo && typeof schedInfo.startMinutes === "number" ? schedInfo.startMinutes : 99999,
      sheetIndex,
      label: String(t.tabName || k)
    };
  });

  const defaultSorted = [...keys].sort((a, b) => {
    const ma = metaByKey[a];
    const mb = metaByKey[b];
    return ma.startMinutes - mb.startMinutes || ma.sheetIndex - mb.sheetIndex || ma.label.localeCompare(mb.label);
  });

  if (!customPillOrder.length) return defaultSorted;

  const customIndexMap = new Map(customPillOrder.map((k, idx) => [k, idx]));
  return [...defaultSorted].sort((a, b) => {
    const ia = customIndexMap.has(a) ? customIndexMap.get(a) : 9999 + defaultSorted.indexOf(a);
    const ib = customIndexMap.has(b) ? customIndexMap.get(b) : 9999 + defaultSorted.indexOf(b);
    return ia - ib;
  });
}

window.selectVaTabPill = (key) => {
  if (!key || !selectedTabData[key]) return;
  activeKey = key;
  isDossierEditing = false;
  expandedDateAlignRows = {};
  const tabObj = selectedTabData[activeKey];
  const nameQuery = tabObj ? `&name=${encodeURIComponent(tabObj.fullName || tabObj.tabName)}` : "";
  window.history.replaceState({}, "", `#tab=${encodeURIComponent(activeKey)}${nameQuery}`);
  populateVaPills();
  renderAll();
};

window.handlePillDragStart = (e, key) => {
  draggedPillKey = key;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", key);
  }
  if (e.currentTarget) e.currentTarget.classList.add("opacity-50");
};

window.handlePillDragEnd = (e) => {
  draggedPillKey = null;
  if (e.currentTarget) e.currentTarget.classList.remove("opacity-50");
  document.querySelectorAll("#va-pill-bar button").forEach((btn) => {
    btn.classList.remove("ring-2", "ring-amber-400", "scale-105");
  });
};

window.handlePillDragOver = (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  if (e.currentTarget) e.currentTarget.classList.add("ring-2", "ring-amber-400");
};

window.handlePillDragLeave = (e) => {
  if (e.currentTarget) e.currentTarget.classList.remove("ring-2", "ring-amber-400");
};

window.handlePillDrop = (e, targetKey) => {
  e.preventDefault();
  if (e.currentTarget) e.currentTarget.classList.remove("ring-2", "ring-amber-400");

  const sourceKey = draggedPillKey || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
  if (!sourceKey || sourceKey === targetKey) return;

  const currentOrder = getOrderedTabKeys();
  const fromIdx = currentOrder.indexOf(sourceKey);
  const toIdx = currentOrder.indexOf(targetKey);
  if (fromIdx === -1 || toIdx === -1) return;

  currentOrder.splice(fromIdx, 1);
  currentOrder.splice(toIdx, 0, sourceKey);

  customPillOrder = currentOrder;
  saveCustomPillOrder();
  populateVaPills();
};

function getNoteStalenessInfo(tabObj) {
  if (!tabObj || !Array.isArray(tabObj.rows) || !tabObj.rows.length) return null;

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
    return {
      daysAgo: 99,
      label: "No notes logged (3d+)",
      shortBadge: "No notes",
      severity: "danger"
    };
  }

  const lastDate = new Date(`${latestNoteIso}T00:00:00`);
  const diffDays = Math.round((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return null;

  if (diffDays === 1) {
    return {
      daysAgo: 1,
      lastDateLabel: latestNoteDateLabel,
      label: `No note since Yesterday (${latestNoteDateLabel})`,
      shortBadge: "1d stale",
      severity: "warn"
    };
  }

  if (diffDays === 2) {
    return {
      daysAgo: 2,
      lastDateLabel: latestNoteDateLabel,
      label: `No note for 2 days (Last: ${latestNoteDateLabel})`,
      shortBadge: "2d stale",
      severity: "orange"
    };
  }

  return {
    daysAgo: diffDays,
    lastDateLabel: latestNoteDateLabel,
    label: `No note for ${diffDays} days (Last: ${latestNoteDateLabel})`,
    shortBadge: `${diffDays}d stale`,
    severity: "danger"
  };
}

function renderStalenessBadgeHtml(staleInfo) {
  if (!staleInfo) return "";
  if (staleInfo.severity === "warn") {
    return `<span title="${escapeHtml(staleInfo.label)}" class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/90 text-amber-300 border border-amber-700">⚠️ ${escapeHtml(staleInfo.label)}</span>`;
  }
  if (staleInfo.severity === "orange") {
    return `<span title="${escapeHtml(staleInfo.label)}" class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-950/90 text-orange-300 border border-orange-700">🟠 ${escapeHtml(staleInfo.label)}</span>`;
  }
  return `<span title="${escapeHtml(staleInfo.label)}" class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-700 animate-pulse">🚨 ${escapeHtml(staleInfo.label)}</span>`;
}

function populateVaPills() {
  const pillBarEl = document.getElementById("va-pill-bar");
  if (!pillBarEl) return;

  if (resetOrderBtn) {
    if (customPillOrder.length > 0) resetOrderBtn.classList.remove("hidden");
    else resetOrderBtn.classList.add("hidden");
  }

  const keys = getOrderedTabKeys();

  if (!keys.length) {
    pillBarEl.innerHTML = `<span class="text-xs text-slate-400">No tabs synced yet — open <a href="tabs.html" class="text-teal-400 underline">Select Tabs</a></span>`;
    return;
  }

  pillBarEl.innerHTML = keys
    .map((k) => {
      const t = selectedTabData[k];
      const isSelected = k === activeKey;
      const summaryVa = resolveSummaryVaRecordForTab(k, t);
      const isOnline = Boolean(summaryVa && String(summaryVa.statusNow || "").toLowerCase().includes("logged in"));
      const staleInfo = getNoteStalenessInfo(t);
      const safeKey = String(k).replace(/'/g, "\\'");

      const baseTitle =
        t.fullName && t.fullName.toLowerCase() !== t.tabName.toLowerCase()
          ? `${t.tabName} (${t.fullName})`
          : t.tabName;
      const titleAttr = staleInfo ? `${baseTitle} — ${staleInfo.label}` : baseTitle;

      const stalePillTag = staleInfo
        ? staleInfo.severity === "warn"
          ? `<span class="text-[9px] px-1.5 py-0.2 rounded-full bg-amber-950 text-amber-300 border border-amber-700 font-mono">1d</span>`
          : staleInfo.severity === "orange"
          ? `<span class="text-[9px] px-1.5 py-0.2 rounded-full bg-orange-950 text-orange-300 border border-orange-700 font-mono">2d</span>`
          : `<span class="text-[9px] px-1.5 py-0.2 rounded-full bg-rose-950 text-rose-300 border border-rose-700 font-mono">${staleInfo.daysAgo >= 99 ? "3d+" : `${staleInfo.daysAgo}d`}</span>`
        : "";

      return `
        <button type="button"
                draggable="true"
                ondragstart="window.handlePillDragStart(event, '${safeKey}')"
                ondragend="window.handlePillDragEnd(event)"
                ondragover="window.handlePillDragOver(event)"
                ondragleave="window.handlePillDragLeave(event)"
                ondrop="window.handlePillDrop(event, '${safeKey}')"
                onclick="window.selectVaTabPill('${safeKey}')"
                title="${escapeHtml(titleAttr)}"
                class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-grab active:cursor-grabbing ${
                  isSelected
                    ? "bg-sky-950/90 text-white border-sky-400 ring-2 ring-sky-500/40 shadow-md"
                    : "bg-slate-950/90 hover:bg-slate-900 text-slate-200 border-slate-800 hover:border-slate-600"
                }">
          <span class="w-2 h-2 rounded-full ${
            isOnline ? "bg-emerald-400 shadow-[0_0_6px_#34d399]" : "bg-sky-400"
          }"></span>
          <span>${escapeHtml(t.tabName)}</span>
          ${stalePillTag}
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
  const row2 = Array.isArray(tabObj.scheduleRow) ? tabObj.scheduleRow : [];
  const a2 = String(row2[0] || "").trim();
  const b2 = String(row2[1] || "").trim();
  const c2 = String(row2[2] || "").trim();
  const g2 = String(row2[6] || "").trim();

  const briefUrl = tabObj.briefUrl || (g2.toLowerCase().startsWith("http") ? g2 : "");
  const isTimeStr = (v) => /^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(v);

  if (isTimeStr(b2) || isTimeStr(c2)) {
    return {
      shiftType: a2 && !a2.toLowerCase().startsWith("shift schedule") ? a2 : "Full Time",
      startTime: b2.toUpperCase().replace(/\s+/g, ""),
      endTime: c2.toUpperCase().replace(/\s+/g, ""),
      briefUrl
    };
  }

  const cleaned = row2
    .map((v) => String(v || "").trim())
    .filter((v) => v && !v.toLowerCase().includes("brief") && !v.toLowerCase().startsWith("shift schedule"));

  let shiftType = "";
  const times = [];

  cleaned.forEach((item) => {
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

  return {
    shiftType,
    startTime: times[0] || "",
    endTime: times[1] || "",
    briefUrl
  };
}

function resolveSummaryVaRecordForTab(tabKey, tabObj) {
  if (!tabObj) return null;
  const clean = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const fn = clean(tabObj.fullName);
  const tn = clean(tabObj.tabName);
  const list = Object.values(allVas).filter(Boolean);

  if (fn) {
    const exactFull = list.find((v) => clean(v.va) === fn);
    if (exactFull) return exactFull;
  }

  let match = list.find((v) => v.matchedTabKey === tabKey || clean(v.va) === tn);
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

function resolveSummaryVaRecord(tabObj) {
  return resolveSummaryVaRecordForTab(activeKey, tabObj);
}

function resolveFullVaName(tabObj) {
  if (tabObj && tabObj.fullName) return tabObj.fullName;
  const matchedVa = resolveSummaryVaRecord(tabObj);
  return (matchedVa && matchedVa.va) || tabObj.tabName;
}

function findHubstaffSessionForDate(tabObj, rowDateStr) {
  if (!hubstaffLiveRows.length || !tabObj) return null;
  const isoDate = parseRowDateToIso(rowDateStr);
  if (!isoDate) return null;

  const clean = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const fullName = clean(resolveFullVaName(tabObj));
  const tabName = clean(tabObj.tabName);
  const firstTwo = fullName.split(" ").slice(0, 2).join(" ");

  return (
    hubstaffLiveRows.find((r) => {
      const rIso = r.dateIso || parseRowDateToIso(r.date);
      if (rIso !== isoDate) return false;
      const m = clean(r.member);
      return (
        m === fullName ||
        m === tabName ||
        (firstTwo && m.startsWith(firstTwo)) ||
        (tabName && m.startsWith(tabName))
      );
    }) || null
  );
}

document.getElementById("save-schedule-btn").addEventListener("click", async () => {
  const tabObj = selectedTabData[activeKey];
  if (!tabObj) return;

  const shiftType = document.getElementById("edit-shift-type").value.trim();
  const startTime = document.getElementById("edit-start-time").value.trim();
  const endTime = document.getElementById("edit-end-time").value.trim();
  const briefUrl = document.getElementById("edit-brief-url").value.trim();

  const existingRow2 = Array.isArray(tabObj.scheduleRow) ? [...tabObj.scheduleRow] : [];
  while (existingRow2.length < 7) existingRow2.push("");
  existingRow2[0] = shiftType;
  existingRow2[1] = startTime;
  existingRow2[2] = endTime;
  existingRow2[6] = briefUrl ? "Account Brief" : "";

  tabObj.scheduleRow = existingRow2;
  tabObj.briefUrl = briefUrl;
  pendingScheduleLock[activeKey] = {
    timestamp: Date.now(),
    scheduleRow: existingRow2,
    briefUrl
  };

  renderDossierCard();
  showToast(`Saving schedule (B2/C2) & Account Brief (G2) to ${tabObj.tabName}...`);

  await updateScheduleMeta({
    tabName: tabObj.tabName,
    shiftType,
    startTime,
    endTime,
    briefUrl,
    metaCols: { shiftTypeCol: 1, startTimeCol: 2, endTimeCol: 3, briefCol: 7 }
  });

  showToast(`✓ Saved B2 (${startTime}), C2 (${endTime}) & G2 Brief to ${tabObj.tabName}!`);
});

window.autoResizeNote = (el) => {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
};

function renderAll() {
  renderDossierCard();
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
  const staleInfo = getNoteStalenessInfo(tabObj);

  if (!isDossierEditing) {
    section.innerHTML = `
      <div class="bg-slate-900 border ${staleInfo && staleInfo.severity === "danger" ? "border-rose-800/80" : "border-slate-800"} rounded-2xl p-5 shadow-xl space-y-4">
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
              ${renderStalenessBadgeHtml(staleInfo)}
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
            <span class="text-slate-500 block text-[10px]">Shift Hours (B2–C2)</span>
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
            ${sched.briefUrl ? `<a href="${escapeHtml(sched.briefUrl)}" target="_blank" rel="noreferrer" class="text-xs text-blue-400 hover:text-blue-300 underline font-semibold">Open Brief Document (G2) ↗</a>` : ""}
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

function buildAlignmentDrawerHtml({ targetSheetRow = null, targetDateLabel = "" } = {}) {
  const tabObj = selectedTabData[activeKey];
  if (!tabObj) return "";

  const profile = siteProfiles[activeKey] || {};
  const isProb = profile.employmentTier === "prob";
  const fullName = resolveFullVaName(tabObj);
  const bucket = getGoalBucket();
  const itemLabel = isProb ? "Task" : "Focus";
  const dKey = getDraftKey(activeKey, activeWeekKey);
  const hasUnsaved = Boolean(sowDirty[dKey]);

  const itemsHtml = bucket.focuses
    .map(
      (f, idx) => `
      <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2 min-w-0">
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

  const rowArg = targetSheetRow !== null ? targetSheetRow : "null";
  const closeHandler = `window.toggleDateAlignRow(${targetSheetRow})`;

  return `
    <div class="bg-slate-900 border ${hasUnsaved ? "border-amber-600/70" : "border-blue-900/70"} rounded-2xl p-4 sm:p-5 shadow-2xl space-y-4 w-full max-w-full box-border">
      <div class="flex flex-wrap items-center justify-between border-b border-slate-800 pb-3 gap-2">
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="text-base">${isProb ? "⏳" : "🎯"}</span>
          <span class="text-xs font-bold text-white uppercase tracking-wider">
            ${isProb ? "DAILY TASK ALIGNMENT" : "WEEKLY SOW ALIGNMENT"}:
            <strong class="text-blue-400">${escapeHtml(tabObj.tabName.toUpperCase())}</strong>
            ${targetDateLabel ? `<span class="text-teal-300 font-mono ml-1">• ${escapeHtml(targetDateLabel)}</span>` : `(${escapeHtml(fullName.toUpperCase())})`}
          </span>
          <span class="sow-status-badge text-[10px] font-mono px-2 py-0.5 rounded-full border ${
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
            💾 SAVE
          </button>
          <button type="button" onclick="${closeHandler}"
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

      <div class="grid grid-cols-1 md:grid-cols-3 gap-2.5">${itemsHtml}</div>

      <div class="flex flex-wrap items-center gap-2">
        <button type="button" onclick="window.addGoalItem()"
                class="text-xs font-semibold text-blue-400 hover:text-blue-300 bg-blue-950/40 hover:bg-blue-950/70 border border-blue-900/60 px-3 py-1.5 rounded-lg cursor-pointer">
          + Add ${itemLabel}
        </button>
        <button type="button" onclick="window.clearGoalNotes()"
                class="text-xs font-semibold text-amber-300 hover:text-amber-200 bg-amber-950/40 hover:bg-amber-950/70 border border-amber-800/70 px-3 py-1.5 rounded-lg cursor-pointer">
          🧹 Clear Notes
        </button>
      </div>

      <div class="pt-2 border-t border-slate-800/80 space-y-1.5">
        <label class="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">📝 ADDITIONAL NOTES:</label>
        <textarea rows="2"
                  oninput="window.updateGoalAdditionalNotes(this.value, true)"
                  placeholder="Enter additional weekly context, client targets, or review notes..."
                  class="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono leading-relaxed">${escapeHtml(bucket.additionalNotes)}</textarea>
      </div>

      <div class="flex flex-wrap items-center justify-start gap-2 pt-2 border-t border-slate-800">
        <button type="button" onclick="window.appendGoalsToSheet(${rowArg})"
                class="bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs px-4 py-2 rounded-xl shadow flex items-center gap-1.5 cursor-pointer">
          <span>Append</span>
        </button>
      </div>
    </div>
  `;
}

function markSowDirtyIndicator() {
  const dKey = getDraftKey(activeKey, activeWeekKey);
  sowDirty[dKey] = true;
  document.querySelectorAll(".sow-status-badge").forEach((badge) => {
    badge.className = "sow-status-badge text-[10px] font-mono px-2 py-0.5 rounded-full border text-amber-300 bg-amber-950/70 border-amber-700";
    badge.textContent = "● Unsaved draft changes";
  });
}

window.toggleDateAlignRow = (sheetRow) => {
  const key = `${activeKey}__${sheetRow}`;
  expandedDateAlignRows[key] = !expandedDateAlignRows[key];
  renderActiveTab();
};

window.setSowWeek = (wk) => {
  activeWeekKey = wk;
  renderActiveTab();
};

window.updateGoalItem = (idx, field, val, skipRerender = false) => {
  const draft = ensureLocalDraft();
  draft.focuses[idx] = { ...draft.focuses[idx], [field]: val };
  markSowDirtyIndicator();
  if (!skipRerender) {
    renderActiveTab();
  }
};

window.addGoalItem = () => {
  const draft = ensureLocalDraft();
  draft.focuses.push({ id: `f_${Date.now()}`, text: "", achieved: false, outcomeNotes: "" });
  markSowDirtyIndicator();
  renderActiveTab();
};

window.clearGoalNotes = () => {
  const draft = ensureLocalDraft();
  const baseThree = draft.focuses.slice(0, 3).map((f) => ({
    ...f,
    outcomeNotes: ""
  }));
  while (baseThree.length < 3) {
    baseThree.push({
      id: `f_${baseThree.length + 1}`,
      text: "",
      achieved: false,
      outcomeNotes: ""
    });
  }
  draft.focuses = baseThree;
  markSowDirtyIndicator();
  renderActiveTab();
  showToast("✓ Cleared task notes and reset to 3 items — click SAVE to keep changes.");
};

window.updateGoalAdditionalNotes = (val, skipRerender = false) => {
  const draft = ensureLocalDraft();
  draft.additionalNotes = val;
  markSowDirtyIndicator();
  if (!skipRerender) {
    renderActiveTab();
  }
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
  renderActiveTab();
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
  renderActiveTab();
  showToast(`✓ Auto-split ${items.length} items — click SAVE when ready!`);
};

window.appendGoalsToSheet = (specificSheetRow = null) => {
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

  const targetRow = specificSheetRow
    ? tabObj.rows.find((r) => r._sheetRow === specificSheetRow) || tabObj.rows[tabObj.rows.length - 1]
    : [...tabObj.rows].reverse().find((r) => String(r.Clock_in || r.Clock_In || "").trim()) ||
      tabObj.rows[tabObj.rows.length - 1];

  let block = `\n📋 [SOW Alignment]\n`;
  bucket.focuses.forEach((f) => {
    if (f.text && f.text.trim()) {
      block += `• ${f.text.trim()}${f.achieved ? " -> ✓ Achieved" : ""}${
        f.outcomeNotes && f.outcomeNotes.trim() ? ` (${f.outcomeNotes.trim()})` : ""
      }\n`;
    }
  });

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
  showToast(`✓ Appended to Row ${targetRow._sheetRow} draft — click "Save Log Changes" to push to Sheet.`);
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

window.stageAmCommsEdit = (tabName, sheetRow, redFlagCol, amKey, value) => {
  stageRowDraft(activeKey, sheetRow, {
    tabName,
    redFlagCol: redFlagCol || 7,
    amKey,
    amVal: value,
    amDirty: true
  });
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
    populateVaPills();
    renderAll();
  }
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

window.setLogDateRange = (fromVal, toVal) => {
  logDateFrom = fromVal || "";
  logDateTo = toVal || "";
  persistGlobalDateRange();
  renderActiveTab();
};

window.applyQuickDatePreset = (preset) => {
  if (!preset || preset === "all") {
    logDateFrom = "";
    logDateTo = "";
    persistGlobalDateRange();
    renderActiveTab();
    return;
  }

  const today = new Date();
  if (preset === "today") {
    const iso = toLocalIsoDate(today);
    logDateFrom = iso;
    logDateTo = iso;
    persistGlobalDateRange();
    renderActiveTab();
    return;
  }

  if (preset === "yesterday") {
    const yest = new Date();
    yest.setDate(today.getDate() - 1);
    const iso = toLocalIsoDate(yest);
    logDateFrom = iso;
    logDateTo = iso;
    persistGlobalDateRange();
    renderActiveTab();
    return;
  }

  const daysBack = Number(preset) || 7;
  const start = new Date();
  start.setDate(today.getDate() - (daysBack - 1));

  logDateFrom = toLocalIsoDate(start);
  logDateTo = toLocalIsoDate(today);
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

  const profile = siteProfiles[activeKey] || {};
  const isProb = profile.employmentTier === "prob";
  const summaryVa = resolveSummaryVaRecord(tabObj);
  const liveStatus = (summaryVa && summaryVa.statusNow) || "Status unavailable";
  const isOnline = liveStatus.toLowerCase().includes("logged in");
  const liveActivity7d = (summaryVa && summaryVa.avgActivity) || "—";
  const liveAvgHrs = (summaryVa && summaryVa.avgHrsPerDay) || "—";
  const liveLate = (summaryVa && summaryVa.lateClockIns) || "0";
  const liveFocus = (summaryVa && summaryVa.coachingFocus) || "—";

  const headers = tabObj.headers || [];
  const cleanHeaders = tabObj.cleanHeaders || [];
  const colIndices = tabObj.colIndices || [];
  const allRows = tabObj.rows || [];

  const dateColIdx = headers.findIndex((h, idx) => idx === 0 || /week|date/i.test(h));
  const dateKey = dateColIdx !== -1 ? cleanHeaders[dateColIdx] : cleanHeaders[0];

  const redFlagIdx = headers.findIndex((h) => /red\s*flag\s*comms/i.test(h));
  const redFlagKey = redFlagIdx !== -1 ? cleanHeaders[redFlagIdx] : "RED_FLAG_COMMS";
  const redFlagCol = redFlagIdx !== -1 ? colIndices[redFlagIdx] : 7; // Column G default
  const rawRedFlagHeader = redFlagIdx !== -1 ? headers[redFlagIdx] : "RED FLAG COMMS";

  // Build visible column list (hide duplicate RED FLAG COMMS column since it's edited in AM Comms drawer)
  const visibleColumnIndices = headers
    .map((h, idx) => ({ h, idx }))
    .filter(({ h }) => !/red\s*flag\s*comms/i.test(h));

  const todayIso = toLocalIsoDate(new Date());
  const yestDate = new Date();
  yestDate.setDate(yestDate.getDate() - 1);
  const yesterdayIso = toLocalIsoDate(yestDate);

  const isTodaySelected = logDateFrom === todayIso && logDateTo === todayIso;
  const isYesterdaySelected = logDateFrom === yesterdayIso && logDateTo === yesterdayIso;

  const rows = allRows
    .filter((row) => {
      if (!logDateFrom && !logDateTo) return true;
      const iso = parseRowDateToIso(row[dateKey]);
      if (!iso) return true;
      if (logDateFrom && iso < logDateFrom) return false;
      if (logDateTo && iso > logDateTo) return false;
      return true;
    })
    .sort((a, b) => {
      const isoA = parseRowDateToIso(a[dateKey]);
      const isoB = parseRowDateToIso(b[dateKey]);
      if (isoA && isoB && isoA !== isoB) {
        return isoB.localeCompare(isoA);
      }
      return (Number(b._sheetRow) || 0) - (Number(a._sheetRow) || 0);
    });

  const presetBtnClass = (active) =>
    active
      ? "px-2 py-1 rounded-lg bg-teal-700 text-white font-semibold text-[11px] cursor-pointer"
      : "px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] cursor-pointer";

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
            ? `<button type="button" onclick="window.applyQuickDatePreset('all')"
                       class="px-2 py-1 rounded-lg bg-rose-950/70 hover:bg-rose-900 text-rose-200 border border-rose-800 text-[11px] font-semibold cursor-pointer">
                 Clear
               </button>`
            : ""
        }
        <button type="button" onclick="window.applyQuickDatePreset('today')"
                class="${presetBtnClass(isTodaySelected)}">
          Today
        </button>
        <button type="button" onclick="window.applyQuickDatePreset('yesterday')"
                class="${presetBtnClass(isYesterdaySelected)}">
          Yesterday
        </button>
        <button type="button" onclick="window.applyQuickDatePreset(7)"
                class="${presetBtnClass(false)}">
          7d
        </button>
        <button type="button" onclick="window.applyQuickDatePreset(14)"
                class="${presetBtnClass(false)}">
          14d
        </button>
        <button type="button" onclick="window.applyQuickDatePreset(30)"
                class="${presetBtnClass(false)}">
          30d
        </button>
        <button type="button" onclick="window.applyQuickDatePreset('all')"
                class="${presetBtnClass(!logDateFrom && !logDateTo)}">
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
        ${visibleColumnIndices.map(({ h }) => `<th class="p-3 text-left">${escapeHtml(h)}</th>`).join("")}
      </tr>
    </thead>
  `;

  const tbody = rows.length
    ? rows
        .map((row) => {
          const rowDraft = logDrafts[getLogRowDraftKey(activeKey, row._sheetRow)] || {};
          const rowIsDirty = Boolean(rowDraft.notesDirty || rowDraft.flagDirty || rowDraft.amDirty);
          const dateValForRow = String(row[dateKey] || "").trim();
          const dateAlignKey = `${activeKey}__${row._sheetRow}`;
          const isDateAlignOpen = Boolean(expandedDateAlignRows[dateAlignKey]);

          const dayWorkSession = findHubstaffSessionForDate(tabObj, dateValForRow);
          const dayActivityStr = dayWorkSession
            ? `${dayWorkSession.avgActivityPct ?? 0}%`
            : liveActivity7d;
          const dayTrackedStr = dayWorkSession ? dayWorkSession.totalDuration : liveAvgHrs;

          const cells = visibleColumnIndices
            .map(({ h: rawH, idx }) => {
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

                      <div class="hidden group-hover:block absolute left-0 bottom-full mb-2 z-50 w-72 bg-slate-950/95 backdrop-blur-md border border-teal-700/70 rounded-xl p-3 shadow-2xl pointer-events-none space-y-2 text-left whitespace-normal">
                        <div class="flex items-center justify-between border-b border-slate-800 pb-1.5">
                          <span class="text-[10px] font-bold uppercase tracking-wider text-teal-300">
                            ${escapeHtml(tabObj.tabName)} • Date Activity
                          </span>
                          <span class="text-[10px] font-mono text-slate-400">${escapeHtml(serverVal)}</span>
                        </div>

                        <div class="flex items-center gap-2 text-xs font-semibold ${isOnline ? "text-emerald-400" : "text-slate-300"}">
                          <span class="w-2 h-2 rounded-full ${isOnline ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}"></span>
                          <span>${escapeHtml(liveStatus)}</span>
                        </div>

                        <div class="grid grid-cols-3 gap-1.5 pt-1 text-center font-mono">
                          <div class="bg-slate-900 border border-slate-800 rounded-lg p-1.5">
                            <span class="block text-[9px] text-slate-400 font-sans">${dayWorkSession ? "Date Activity" : "Activity (7d)"}</span>
                            <div class="mt-0.5 text-xs">${formatConditionalActivityBadge(dayActivityStr)}</div>
                          </div>
                          <div class="bg-slate-900 border border-slate-800 rounded-lg p-1.5">
                            <span class="block text-[9px] text-slate-400 font-sans">${dayWorkSession ? "Tracked" : "Avg Hrs"}</span>
                            <strong class="text-xs text-slate-200">${escapeHtml(dayTrackedStr)}</strong>
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
                const amKey = `${activeKey}_row_${row._sheetRow}`;
                const serverRedFlag =
                  row[redFlagKey] !== undefined
                    ? row[redFlagKey]
                    : row[rawRedFlagHeader] !== undefined
                    ? row[rawRedFlagHeader]
                    : siteAmComms[amKey] || "";

                const effectiveAmText = rowDraft.amDirty ? rowDraft.amVal : serverRedFlag;
                const isAmOpen = Boolean(expandedAmRows[amKey]);

                return `
                  <td class="p-2 min-w-[320px] align-top space-y-2">
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

                      <button type="button" onclick="window.toggleDateAlignRow(${row._sheetRow})"
                              class="py-0.5 px-2.5 rounded-md text-[10px] font-bold border transition cursor-pointer ${
                                isDateAlignOpen
                                  ? "bg-blue-800 text-white border-blue-500"
                                  : "bg-slate-950 text-blue-300 border-slate-800 hover:border-blue-600"
                              }">
                        ${isDateAlignOpen ? "▲ Hide Alignment" : isProb ? "🎯 Daily Task Alignment" : "🎯 Weekly SOW Alignment"}
                      </button>
                    </div>

                    ${
                      isAmOpen
                        ? `<div class="bg-rose-950/25 border border-rose-900/60 rounded-lg p-2 space-y-1">
                            <div class="text-[10px] font-bold text-rose-300 uppercase">🚩 AM Red Flag Comms (Syncs to Column G)</div>
                            <textarea rows="2"
                                      oninput="window.stageAmCommsEdit('${tabObj.tabName}', ${row._sheetRow}, ${redFlagCol}, '${amKey}', this.value)"
                                      placeholder="Log client escalations or AM follow-ups (pushes to Col G)..."
                                      class="w-full bg-slate-950 border ${
                                        rowDraft.amDirty ? "border-amber-500/80" : "border-rose-900/70"
                                      } rounded p-1.5 text-xs text-rose-100 focus:outline-none">${escapeHtml(effectiveAmText)}</textarea>
                          </div>`
                        : ""
                    }
                  </td>
                `;
              }

              return `<td class="p-3 text-xs whitespace-nowrap align-top">${escapeHtml(serverVal)}</td>`;
            })
            .join("");

          const perDateAlignRowHtml = isDateAlignOpen
            ? `<tr class="bg-slate-950/95 border-t border-blue-800/60">
                <td colspan="${visibleColumnIndices.length || 1}" class="p-3 sm:p-4">
                  ${buildAlignmentDrawerHtml({
                    targetSheetRow: row._sheetRow,
                    targetDateLabel: dateValForRow || `Row ${row._sheetRow}`
                  })}
                </td>
              </tr>`
            : "";

          return `
            <tr class="border-t border-slate-800 ${rowIsDirty ? "bg-amber-950/15" : "hover:bg-slate-800/40"}">${cells}</tr>
            ${perDateAlignRowHtml}
          `;
        })
        .join("")
    : `<tr><td colspan="${visibleColumnIndices.length || 1}" class="p-6 text-center text-slate-400 text-xs">No log rows match the selected date range.</td></tr>`;

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