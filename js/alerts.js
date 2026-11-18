import { subscribeCached, updateSiteData } from "./firebase.js";
import {
  escapeHtml,
  getHiddenVaSet,
  getProbationEndDate,
  getDaysDifference,
  getUpcomingBirthdayDetails,
  findMatchingTabEntry
} from "./schedule.js";

const CONTACT_TEMPLATE = `Emergency Contact Person (Name and Number): 
VA email: 
Client ID: 
Client email: 
Other Notes: `;

let vas = {};
let selectedTabData = {};
let profiles = {};

subscribeCached("kitsuneDashboard", "kitsune_alerts_cache", (data) => {
  if (!data) return;
  vas = data.vas || {};
  selectedTabData = data.selectedTabData || {};
  profiles = (data.siteData && data.siteData.vaProfiles) || {};
  renderAlerts();
});

// Resolves the exact key used by va-detail.html (e.g., "Adrienne") and merges any legacy key ("Adrienne_Tenchavez")
function getUnifiedProfile(va) {
  const match = findMatchingTabEntry(va, selectedTabData);
  const canonicalKey = match ? match.key : va.id;
  const mergedProfile = {
    ...(profiles[va.id] || {}),
    ...(profiles[canonicalKey] || {})
  };
  return { canonicalKey, profile: mergedProfile };
}

window.updateDirField = async (canonicalKey, legacyKey, field, val) => {
  const statusEl = document.getElementById("dir-save-status");
  if (statusEl) statusEl.textContent = "Saving...";
  try {
    await updateSiteData(`vaProfiles/${canonicalKey}`, { [field]: val });
    if (legacyKey && legacyKey !== canonicalKey) {
      await updateSiteData(`vaProfiles/${legacyKey}`, { [field]: val });
    }
    if (statusEl) {
      statusEl.textContent = "✓ Synced with VA Dossier";
      setTimeout(() => {
        statusEl.textContent = "";
      }, 2500);
    }
  } catch (err) {
    const errBox = document.getElementById("alerts-error");
    if (errBox) {
      errBox.textContent = "Save error: " + err.message;
      errBox.classList.remove("hidden");
    }
  }
};

function renderAlerts() {
  const hiddenSet = getHiddenVaSet();
  const vaList = Object.values(vas)
    .filter((v) => v && !hiddenSet.has(v.id))
    .map((v) => ({ va: v, ...getUnifiedProfile(v) }))
    .sort((a, b) => a.va.va.localeCompare(b.va.va));

  // 1. Probation Watchlist
  const probItems = vaList.filter((item) => item.profile.employmentTier === "prob");
  document.getElementById("probation-list").innerHTML =
    probItems
      .map(({ va, profile: p }) => {
        const end = getProbationEndDate(p.startDate);
        const left = getDaysDifference(end);

        let badgeStyle = "bg-emerald-950 text-emerald-300 border-emerald-800 font-semibold";
        let badgeText = `${left} days left`;

        if (left === null) {
          badgeStyle = "bg-slate-900 text-slate-400 border-slate-700";
          badgeText = "Start Date Unset";
        } else if (left < 0) {
          badgeStyle = "bg-rose-950 text-rose-300 border-rose-800 font-bold";
          badgeText = `Overdue by ${Math.abs(left)}d`;
        } else if (left <= 14) {
          badgeStyle = "bg-amber-950 text-amber-300 border-amber-800 font-bold";
          badgeText = `Ending Soon: ${left}d left`;
        }

        return `
          <div class="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3 text-xs">
            <div>
              <strong class="text-white">${escapeHtml(va.va)}</strong>
              <div class="text-[10px] text-slate-500 font-mono mt-0.5">
                Started: ${escapeHtml(p.startDate || "—")} → 3-Mo Review: ${escapeHtml(end || "—")}
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-full text-[10px] border whitespace-nowrap ${badgeStyle}">${badgeText}</span>
          </div>`;
      })
      .join("") ||
    `<p class="text-xs text-slate-500 italic">No probationary VAs marked yet (set tier in VA Dossiers &amp; Logs).</p>`;

  // 2. Birthday Radar
  const bdayItems = vaList
    .map((item) => ({ ...item, info: getUpcomingBirthdayDetails(item.profile.birthday, 30) }))
    .filter((x) => x.info && x.info.isUpcoming)
    .sort((a, b) => a.info.diffDays - b.info.diffDays);

  document.getElementById("birthday-list").innerHTML =
    bdayItems
      .map(
        ({ va, profile: p, info }) => `
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3 text-xs">
          <div>
            <strong class="text-white">${escapeHtml(va.va)}</strong>
            <div class="text-[10px] text-slate-500 font-mono mt-0.5">
              Birthday: ${escapeHtml(p.birthday)}
            </div>
          </div>
          <span class="px-2.5 py-1 rounded-full text-[10px] border whitespace-nowrap font-bold ${
            info.diffDays === 0
              ? "bg-rose-950 text-rose-300 border-rose-800 animate-pulse"
              : info.diffDays <= 7
              ? "bg-cyan-950 text-cyan-300 border-cyan-800"
              : "bg-slate-900 text-slate-300 border-slate-700"
          }">
            ${info.diffDays === 0 ? "🎉 TODAY!" : `In ${info.diffDays} day(s)`}
          </span>
        </div>`
      )
      .join("") || `<p class="text-xs text-slate-500 italic">No birthdays in the next 30 days.</p>`;

  // 3. Team Directory & Emergency Contacts Table
  document.getElementById("directory-tbody").innerHTML =
    vaList
      .map(({ va, canonicalKey, profile: p }) => `
        <tr class="align-top hover:bg-slate-950/60">
          <td class="p-3 font-bold text-slate-100">
            <a href="va-detail.html#tab=${encodeURIComponent(canonicalKey)}&name=${encodeURIComponent(va.va)}"
               class="text-teal-300 hover:text-teal-200 underline decoration-teal-700 underline-offset-4">
              ${escapeHtml(va.va)}
            </a>
          </td>
          <td class="p-3">
            <input type="text" value="${escapeHtml(p.phone || "")}" placeholder="+639..."
                   onchange="window.updateDirField('${canonicalKey}', '${va.id}', 'phone', this.value)"
                   class="w-full bg-slate-950 border border-slate-800 focus:border-emerald-600 rounded-lg px-2 py-1 text-emerald-400 font-mono focus:outline-none" />
          </td>
          <td class="p-3">
            <input type="text" value="${escapeHtml(p.tl || "Norris")}"
                   onchange="window.updateDirField('${canonicalKey}', '${va.id}', 'tl', this.value)"
                   class="w-full bg-slate-950 border border-slate-800 focus:border-purple-600 rounded-lg px-2 py-1 text-slate-200 focus:outline-none" />
          </td>
          <td class="p-3">
            <textarea rows="5" onchange="window.updateDirField('${canonicalKey}', '${va.id}', 'contactNotes', this.value)"
                      class="w-full bg-slate-950 border border-slate-800 focus:border-teal-500 rounded-xl p-2 text-xs font-mono text-slate-200 leading-relaxed focus:outline-none">${escapeHtml(
                        p.contactNotes || CONTACT_TEMPLATE
                      )}</textarea>
          </td>
        </tr>`
      )
      .join("") || `<tr><td colspan="4" class="p-6 text-center text-slate-500">No active VAs found.</td></tr>`;
}