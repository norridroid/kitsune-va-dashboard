import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  update,
  push,
  remove
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBpy_WeYN0GvqCnXCUj1w5ycWaOHjM4sxI",
  authDomain: "lva-dashboards.firebaseapp.com",
  databaseURL: "https://lva-dashboards-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "lva-dashboards",
  storageBucket: "lva-dashboards.firebasestorage.app",
  messagingSenderId: "260025431478",
  appId: "1:260025431478:web:9fa88f206dadb1b51dbd17"
};

export const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzAduCDSNtpP-aSrUeF8IZD1UcEQK4AlIXunokA7NSIxebH6udNO-Bw8Fg0PJgJ4JB_wQ/exec";
export const WEBHOOK_SECRET = "lva-dashboards-2026";

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

export function subscribeCached(path, cacheKey, callback) {
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try { callback(JSON.parse(cached)); } catch (_) {}
  }

  onValue(ref(db, path), (snapshot) => {
    const val = snapshot.val();
    if (val !== null) {
      sessionStorage.setItem(cacheKey, JSON.stringify(val));
    }
    callback(val);
  });
}

export async function saveSelectedTabsAndSync(tabNames) {
  await set(ref(db, "kitsuneDashboard/selectedTabs"), tabNames);
  await postToAppsScript({ action: "syncNow" });
}

export async function updateSheetCell({ tabName, sheetRow, colIndex, value }) {
  await postToAppsScript({
    action: "updateCell",
    tabName,
    sheetRow,
    colIndex,
    value
  });
}

export async function updateScheduleMeta({ tabName, shiftType, startTime, endTime, briefUrl, metaCols }) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      secret: WEBHOOK_SECRET,
      action: "updateScheduleMeta",
      tabName,
      shiftType,
      startTime,
      endTime,
      briefUrl,
      metaCols
    })
  });
  return res.json();
}

async function postToAppsScript(payload) {
  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ secret: WEBHOOK_SECRET, ...payload })
  });
}

// Site-only Firebase read/write helpers (never touches Google Sheets)
export function setSiteData(path, value) {
  return set(ref(db, `kitsuneDashboard/siteData/${path}`), value);
}

export function updateSiteData(path, partialObj) {
  return update(ref(db, `kitsuneDashboard/siteData/${path}`), partialObj);
}

export function pushSiteData(path, value) {
  return push(ref(db, `kitsuneDashboard/siteData/${path}`), value);
}

export function removeSiteData(path) {
  return remove(ref(db, `kitsuneDashboard/siteData/${path}`));
}