import { subscribeCached, updateSiteData, pushSiteData, removeSiteData } from "./firebase.js";
import { renderTopNav, escapeHtml } from "./schedule.js";

renderTopNav("posts");

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
let selectedDay = DAYS[Math.min(Math.max(new Date().getDay() - 1, 0), 4)];
let sodTemplates = {};
let reminders = {};

subscribeCached("kitsuneDashboard/siteData", "kitsune_posts_cache", (siteData) => {
  const sd = siteData || {};
  sodTemplates = sd.sodTemplates || {};
  reminders = sd.customReminders || {};
  renderDayPills();
  document.getElementById("sod-textarea").value = sodTemplates[selectedDay] || "";
  renderReminders();
});

function renderDayPills() {
  document.getElementById("day-pills").innerHTML = DAYS.map(
    (d) => `
    <button type="button" onclick="window.selectSodDay('${d}')"
            class="px-3 py-1 rounded-lg text-xs font-semibold ${
              selectedDay === d ? "bg-teal-600 text-white" : "text-slate-400 hover:text-white"
            }">${d}</button>`
  ).join("");
}

window.selectSodDay = (day) => {
  selectedDay = day;
  renderDayPills();
  document.getElementById("sod-textarea").value = sodTemplates[selectedDay] || "";
};

document.getElementById("save-sod-btn").addEventListener("click", async () => {
  const val = document.getElementById("sod-textarea").value;
  await updateSiteData("sodTemplates", { [selectedDay]: val });
  alert(`✓ Saved ${selectedDay} SOD template!`);
});

document.getElementById("copy-sod-btn").addEventListener("click", () => {
  navigator.clipboard.writeText(document.getElementById("sod-textarea").value);
  alert(`✓ Copied ${selectedDay} SOD template to clipboard!`);
});

document.getElementById("toggle-add-rem").addEventListener("click", () => {
  document.getElementById("add-rem-form").classList.toggle("hidden");
});

document.getElementById("add-rem-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await pushSiteData("customReminders", {
    title: document.getElementById("rem-title").value.trim(),
    category: document.getElementById("rem-cat").value.trim() || "General",
    notes: document.getElementById("rem-notes").value.trim(),
    createdAt: new Date().toISOString()
  });
  document.getElementById("rem-title").value = "";
  document.getElementById("rem-notes").value = "";
  document.getElementById("add-rem-form").classList.add("hidden");
});

window.copyReminder = (id) => {
  const r = reminders[id];
  if (!r) return;
  navigator.clipboard.writeText(`📌 *${r.title.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${r.notes || ""}`);
  alert("✓ Copied reminder!");
};

window.deleteReminder = async (id) => {
  if (confirm("Delete this reminder?")) await removeSiteData(`customReminders/${id}`);
};

function renderReminders() {
  const entries = Object.entries(reminders);
  document.getElementById("reminders-list").innerHTML =
    entries
      .map(
        ([id, r]) => `
      <div class="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-teal-300 font-mono">📁 ${escapeHtml(r.category || "General")}</span>
            <strong class="text-xs text-white">${escapeHtml(r.title)}</strong>
          </div>
          <div class="flex gap-1.5">
            <button type="button" onclick="window.copyReminder('${id}')" class="px-2.5 py-1 rounded bg-teal-900/60 text-teal-200 text-[10px] font-semibold">📋 Copy</button>
            <button type="button" onclick="window.deleteReminder('${id}')" class="px-2 py-1 rounded bg-slate-900 text-slate-400 hover:text-rose-400 text-[10px]">🗑️</button>
          </div>
        </div>
        <pre class="text-xs text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">${escapeHtml(r.notes || "")}</pre>
      </div>`
      )
      .join("") || `<p class="text-xs text-slate-500 italic text-center py-6">No custom reminders yet.</p>`;
}