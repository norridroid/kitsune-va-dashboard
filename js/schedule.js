import { initCommandVibe } from "./theme.js";

const SCHEDULE_PALETTE = [
  { pill: "bg-sky-950/90 text-sky-300 border-sky-700", accent: "border-l-4 border-l-sky-500" },
  { pill: "bg-emerald-950/90 text-emerald-300 border-emerald-700", accent: "border-l-4 border-l-emerald-500" },
  { pill: "bg-amber-950/90 text-amber-300 border-amber-700", accent: "border-l-4 border-l-amber-500" },
  { pill: "bg-purple-950/90 text-purple-300 border-purple-700", accent: "border-l-4 border-l-purple-500" },
  { pill: "bg-rose-950/90 text-rose-300 border-rose-700", accent: "border-l-4 border-l-rose-500" },
  { pill: "bg-cyan-950/90 text-cyan-300 border-cyan-700", accent: "border-l-4 border-l-cyan-500" },
  { pill: "bg-indigo-950/90 text-indigo-300 border-indigo-700", accent: "border-l-4 border-l-indigo-500" },
  { pill: "bg-lime-950/90 text-lime-300 border-lime-700", accent: "border-l-4 border-l-lime-500" },
  { pill: "bg-fuchsia-950/90 text-fuchsia-300 border-fuchsia-700", accent: "border-l-4 border-l-fuchsia-500" },
  { pill: "bg-orange-950/90 text-orange-300 border-orange-700", accent: "border-l-4 border-l-orange-500" }
];

const UNSET_STYLE = {
  pill: "bg-slate-800/80 text-slate-400 border-slate-700",
  accent: "border-l-4 border-l-slate-700"
};

export const HIDDEN_STORAGE_KEY = "kitsune_hidden_vas";

export function getHiddenVaSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_STORAGE_KEY) || "[]"));
  } catch (_) {
    return new Set();
  }
}

export function renderTopNav(activePage) {
  const navEl = document.getElementById("main-nav");
  if (!navEl) return;
  const links = [
    { id: "overview", href: "index.html", label: "Overview" },
    { id: "va-detail", href: "va-detail.html", label: "VA Dossiers & Logs" },
    { id: "hubstaff", href: "hubstaff.html", label: "Work Sessions" },
    { id: "tasks", href: "tasks.html", label: "TL Tasks" },
    { id: "alerts", href: "alerts.html", label: "Alerts & Directory" },
    { id: "posts", href: "posts.html", label: "Daily Posts" },
    { id: "tabs", href: "tabs.html", label: "Select Tabs" }
  ];
  navEl.innerHTML = links
    .map(
      (l) => `
      <a href="${l.href}" class="px-3 py-1.5 rounded text-xs sm:text-sm transition ${
        activePage === l.id
          ? "bg-teal-700 text-white font-semibold shadow-sm"
          : "bg-slate-800 hover:bg-slate-700 text-slate-200"
      }">${l.label}</a>`
    )
    .join("");

  initCommandVibe();
}

export function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatConditionalActivityBadge(activityStr) {
  const cleanNum = parseFloat(String(activityStr || "").replace("%", "")) || 0;
  if (cleanNum < 30 || cleanNum > 97) {
    return `<span class="inline-block px-1.5 py-0.5 rounded bg-rose-950/90 text-rose-300 border border-rose-700/80 font-bold shadow-[0_0_8px_rgba(244,63,94,0.3)]" title="Activity outlier (<30% or >97%)">${escapeHtml(activityStr)}</span>`;
  }
  return escapeHtml(activityStr || "—");
}

export function parsePastedListItems(clipboardData) {
  if (!clipboardData) return [];
  const plainText = clipboardData.getData("text/plain") || "";
  return plainText
    .replace(/\u00A0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•\-*–—]+|^\s*\d+[.)]\s*/g, "").trim())
    .filter((line) => {
      if (!line) return false;
      if (/^(today's\s+(completed|incomplete)\s+tasks|bottlenecks?|sow\s+focuses?|tasks?):?$/i.test(line)) return false;
      if (/:(\s*none|\s*n\/a)$/i.test(line)) return false;
      return true;
    });
}

export function getProbationEndDate(startDateStr) {
  if (!startDateStr) return null;
  const d = new Date(startDateStr);
  if (isNaN(d.getTime())) return null;
  const currentDay = d.getDate();
  d.setMonth(d.getMonth() + 3);
  if (d.getDate() !== currentDay) d.setDate(0);
  return d.toISOString().split("T")[0];
}

export function getDaysDifference(targetDateStr) {
  if (!targetDateStr) return null;
  const target = new Date(targetDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  if (isNaN(target.getTime())) return null;
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

export function getUpcomingBirthdayDetails(birthdayStr, windowDays = 30) {
  if (!birthdayStr) return null;
  const parts = birthdayStr.split("-");
  if (parts.length !== 3) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();
  const birthMonth = parseInt(parts[1], 10) - 1;
  const birthDay = parseInt(parts[2], 10);

  let nextBday = new Date(currentYear, birthMonth, birthDay);
  if (nextBday < today) nextBday = new Date(currentYear + 1, birthMonth, birthDay);

  const diffDays = Math.ceil((nextBday - today) / (1000 * 60 * 60 * 24));
  return {
    diffDays,
    isUpcoming: diffDays >= 0 && diffDays <= windowDays,
    nextDate: nextBday.toISOString().split("T")[0]
  };
}

export function findMatchingTabEntry(va, selectedTabData) {
  if (!selectedTabData) return null;
  const entries = Object.entries(selectedTabData).filter(([, t]) => Boolean(t));
  if (!entries.length) return null;

  const clean = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const sanitize = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[.#$\[\]\/\s]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const fullName = clean(va.va || va.tabName || "");
  const fullSanitized = sanitize(fullName);

  // 1. Pre-matched tab key from Code.gs or exact ID match
  if (va.matchedTabKey && selectedTabData[va.matchedTabKey]) {
    return { key: va.matchedTabKey, tab: selectedTabData[va.matchedTabKey] };
  }
  if (va.id && selectedTabData[va.id]) {
    return { key: va.id, tab: selectedTabData[va.id] };
  }

  // 2. Exact match against tab.fullName (extracted from Row 1 inside the VA's sheet tab)
  let found = entries.find(([, t]) => t.fullName && clean(t.fullName) === fullName);
  if (found) return { key: found[0], tab: found[1] };

  // 3. Exact tabName or sanitized key match
  found = entries.find(([k, t]) => {
    const tn = clean(t.tabName);
    return tn === fullName || sanitize(k) === fullSanitized || sanitize(tn) === fullSanitized;
  });
  if (found) return { key: found[0], tab: found[1] };

  // 4. Two-word match (distinguishes "Mary Anne" vs "Mary A.")
  const words = fullName.split(" ").filter(Boolean);
  const firstTwoWords = words.slice(0, 2).join(" ");
  if (words.length >= 2) {
    found = entries.find(([, t]) => {
      const fn = clean(t.fullName);
      const tn = clean(t.tabName);
      return fn.startsWith(firstTwoWords) || tn === firstTwoWords || tn.startsWith(firstTwoWords + " ");
    });
    if (found) return { key: found[0], tab: found[1] };
  }

  // 5. First-word match ONLY when unambiguous and second word isn't a single initial
  const firstWord = fullName.split(/[\s@]+/)[0];
  const secondIsInitial = words[1] && words[1].replace(/\./g, "").length === 1;
  if (firstWord && firstWord.length >= 3 && !secondIsInitial) {
    const exactSingleWordTab = entries.find(([, t]) => clean(t.tabName) === firstWord);
    if (exactSingleWordTab) {
      return { key: exactSingleWordTab[0], tab: exactSingleWordTab[1] };
    }

    const sameFirstWordTabs = entries.filter(([, t]) => {
      const tn = clean(t.tabName);
      const fn = clean(t.fullName);
      return tn === firstWord || tn.startsWith(firstWord + " ") || fn.split(" ")[0] === firstWord;
    });
    if (sameFirstWordTabs.length === 1) {
      return { key: sameFirstWordTabs[0][0], tab: sameFirstWordTabs[0][1] };
    }
  }

  return null;
}

export function deriveScheduleFromTab(va, selectedTabData) {
  const match = findMatchingTabEntry(va, selectedTabData);
  const tabObj = match ? match.tab : null;
  const matchedTabKey = match ? match.key : (va.matchedTabKey || va.id);

  const rawItems =
    tabObj && Array.isArray(tabObj.scheduleRow) && tabObj.scheduleRow.length
      ? tabObj.scheduleRow
      : Array.isArray(va.scheduleRow)
      ? va.scheduleRow
      : [];

  const items = rawItems
    .map((v) => String(v || "").trim())
    .filter((v) => v && !v.toLowerCase().includes("brief") && !v.toLowerCase().startsWith("shift schedule"));

  let shiftType = "";
  const times = [];

  items.forEach((item) => {
    if (/^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(item)) {
      times.push(item.toUpperCase().replace(/\s+/g, ""));
    } else if (!shiftType) {
      shiftType = item;
    }
  });

  const shiftWindow = times.length >= 2 ? `${times[0]} - ${times[1]}` : times[0] || "";
  const shiftLabel = [shiftType, shiftWindow].filter(Boolean).join(" • ") || "No schedule";

  let startMinutes = 9999;
  if (times[0]) {
    const m = times[0].match(/^(\d{1,2}):(\d{2})(AM|PM)?$/i);
    if (m) {
      let hrs = parseInt(m[1], 10);
      const mins = parseInt(m[2], 10);
      const meridiem = (m[3] || "").toUpperCase();
      if (meridiem === "PM" && hrs < 12) hrs += 12;
      if (meridiem === "AM" && hrs === 12) hrs = 0;
      startMinutes = hrs * 60 + mins;
    }
  }

  return {
    shiftLabel,
    startMinutes,
    isTabSynced: Boolean(tabObj),
    matchedTabKey
  };
}

export function buildScheduleColorMap(vaList) {
  const uniqueSchedules = [];
  const seen = new Set();

  [...vaList]
    .sort((a, b) => a.startMinutes - b.startMinutes || a.shiftLabel.localeCompare(b.shiftLabel))
    .forEach((va) => {
      if (!va.shiftLabel || va.shiftLabel === "No schedule") return;
      if (!seen.has(va.shiftLabel)) {
        seen.add(va.shiftLabel);
        uniqueSchedules.push(va.shiftLabel);
      }
    });

  const colorMap = new Map();
  uniqueSchedules.forEach((label, idx) => {
    colorMap.set(label, SCHEDULE_PALETTE[idx % SCHEDULE_PALETTE.length]);
  });

  return { colorMap, uniqueSchedules, unsetStyle: UNSET_STYLE };
}