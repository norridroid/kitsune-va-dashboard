import { subscribeCached, saveSelectedTabsAndSync } from "./firebase.js";
import { renderTopNav } from "./schedule.js";

renderTopNav("tabs");

let availableTabs = [];
let selectedSet = new Set();

subscribeCached("kitsuneDashboard/availableTabs", "kitsune_available_tabs", (tabs) => {
  availableTabs = tabs || [];
  renderCheckboxes();
});

subscribeCached("kitsuneDashboard/selectedTabs", "kitsune_selected_tabs", (selected) => {
  const list = Array.isArray(selected) ? selected : Object.keys(selected || {}).filter(k => selected[k]);
  selectedSet = new Set(list);
  renderCheckboxes();
});

function renderCheckboxes() {
  const container = document.getElementById("tab-list");
  const selectable = availableTabs.filter(t => !t.isSummary);

  if (!selectable.length) {
    container.innerHTML = `<p class="text-slate-500 text-sm">No tabs found yet. Run syncDashboardToFirebase in Apps Script first.</p>`;
    return;
  }

  container.innerHTML = selectable.map(t => `
    <label class="flex items-center gap-3 p-3 rounded-lg bg-slate-800/60 hover:bg-slate-800 cursor-pointer border border-slate-700/50">
      <input type="checkbox" value="${t.name}" ${selectedSet.has(t.name) ? "checked" : ""}
             class="tab-cb accent-teal-500 w-4 h-4" />
      <span class="text-sm truncate">${t.name}</span>
    </label>
  `).join("");
}

document.getElementById("select-all-btn").onclick = () => {
  document.querySelectorAll(".tab-cb").forEach(cb => cb.checked = true);
};

document.getElementById("clear-all-btn").onclick = () => {
  document.querySelectorAll(".tab-cb").forEach(cb => cb.checked = false);
};

document.getElementById("save-sync-btn").onclick = async () => {
  const status = document.getElementById("status-msg");
  const chosen = Array.from(document.querySelectorAll(".tab-cb:checked")).map(cb => cb.value);

  status.textContent = "Saving & syncing selected tabs...";
  try {
    await saveSelectedTabsAndSync(chosen);
    status.textContent = `Synced ${chosen.length} tab(s)!`;
  } catch (_) {
    status.textContent = `Saved ${chosen.length} tab(s) to Firebase!`;
  }
};