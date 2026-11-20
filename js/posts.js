import { subscribeCached, updateSiteData, pushSiteData, removeSiteData } from "./firebase.js";
import { renderTopNav, escapeHtml } from "./schedule.js";

renderTopNav("posts");

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
let selectedDay = DAYS[Math.min(Math.max(new Date().getDay() - 1, 0), 4)];
let sodTemplates = {};
let reminders = {};
let editingReminderId = null;

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
            class="px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
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

window.startEditReminder = (id) => {
  if (!reminders[id]) return;
  editingReminderId = id;
  renderReminders();
};

window.cancelEditReminder = () => {
  editingReminderId = null;
  renderReminders();
};

window.saveEditedReminder = async (id) => {
  const existing = reminders[id];
  if (!existing) return;

  const titleEl = document.getElementById(`edit-rem-title-${id}`);
  const catEl = document.getElementById(`edit-rem-cat-${id}`);
  const notesEl = document.getElementById(`edit-rem-notes-${id}`);

  const updatedTitle = titleEl ? titleEl.value.trim() : existing.title;
  if (!updatedTitle) {
    alert("Reminder title cannot be empty.");
    return;
  }

  const updatedCategory = (catEl ? catEl.value.trim() : existing.category) || "General";
  const updatedNotes = notesEl ? notesEl.value.trim() : existing.notes || "";

  await updateSiteData(`customReminders/${id}`, {
    ...existing,
    title: updatedTitle,
    category: updatedCategory,
    notes: updatedNotes,
    updatedAt: new Date().toISOString()
  });

  editingReminderId = null;
  renderReminders();
};

window.deleteReminder = async (id) => {
  if (confirm("Delete this reminder?")) {
    if (editingReminderId === id) editingReminderId = null;
    await removeSiteData(`customReminders/${id}`);
  }
};

function renderReminders() {
  const entries = Object.entries(reminders);
  document.getElementById("reminders-list").innerHTML =
    entries
      .map(([id, r]) => {
        const safeId = String(id).replace(/'/g, "\\'");

        if (editingReminderId === id) {
          return `
            <div class="bg-slate-950 border border-amber-500/70 rounded-xl p-3.5 space-y-3 text-xs">
              <div class="flex items-center justify-between border-b border-slate-800 pb-2">
                <span class="text-[10px] font-bold uppercase tracking-wider text-amber-300">✏️ Editing Reminder</span>
                <button type="button" onclick="window.cancelEditReminder()" class="text-[11px] text-slate-400 hover:text-white underline cursor-pointer">Cancel</button>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input id="edit-rem-title-${escapeHtml(id)}" type="text" value="${escapeHtml(r.title || "")}" placeholder="Reminder title..."
                       class="sm:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white focus:border-teal-500 focus:outline-none" />
                <input id="edit-rem-cat-${escapeHtml(id)}" type="text" value="${escapeHtml(r.category || "General")}" placeholder="Folder / Category"
                       class="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white focus:border-teal-500 focus:outline-none" />
              </div>
              <textarea id="edit-rem-notes-${escapeHtml(id)}" rows="4" placeholder="Reminder details..."
                        class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 font-mono text-slate-200 focus:border-teal-500 focus:outline-none">${escapeHtml(r.notes || "")}</textarea>
              <div class="flex justify-end gap-2">
                <button type="button" onclick="window.cancelEditReminder()"
                        class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer">
                  Cancel
                </button>
                <button type="button" onclick="window.saveEditedReminder('${safeId}')"
                        class="px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-bold cursor-pointer">
                  💾 Save
                </button>
              </div>
            </div>`;
        }

        return `
          <div class="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-teal-300 font-mono">📁 ${escapeHtml(r.category || "General")}</span>
                <strong class="text-xs text-white">${escapeHtml(r.title)}</strong>
              </div>
              <div class="flex gap-1.5">
                <button type="button" onclick="window.copyReminder('${safeId}')" class="px-2.5 py-1 rounded bg-teal-900/60 hover:bg-teal-800/80 text-teal-200 text-[10px] font-semibold cursor-pointer">📋 Copy</button>
                <button type="button" onclick="window.startEditReminder('${safeId}')" class="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 text-[10px] font-semibold cursor-pointer">✏️ Edit</button>
                <button type="button" onclick="window.deleteReminder('${safeId}')" class="px-2 py-1 rounded bg-slate-900 hover:bg-rose-950/70 text-slate-400 hover:text-rose-400 text-[10px] cursor-pointer">🗑️</button>
              </div>
            </div>
            <pre class="text-xs text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">${escapeHtml(r.notes || "")}</pre>
          </div>`;
      })
      .join("") || `<p class="text-xs text-slate-500 italic text-center py-6">No custom reminders yet.</p>`;
}