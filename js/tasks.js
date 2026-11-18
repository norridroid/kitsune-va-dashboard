import { subscribeCached, setSiteData, updateSiteData, removeSiteData } from "./firebase.js";
import { renderTopNav, escapeHtml, getHiddenVaSet } from "./schedule.js";

renderTopNav("tasks");

let vas = {};
let vaOrder = [];
let tasks = {};
let filterStatus = "Active";

subscribeCached("kitsuneDashboard", "kitsune_tasks_cache", (data) => {
  if (!data) return;
  vas = data.vas || {};
  vaOrder = data.vaOrder || [];
  tasks = (data.siteData && data.siteData.tlTasks) || {};
  populateVaDropdowns();
  renderTasks();
});

function getVisibleOverviewVas() {
  const hiddenSet = getHiddenVaSet();
  const keys = vaOrder.length ? vaOrder : Object.keys(vas);
  return keys
    .map((k) => vas[k])
    .filter((v) => v && !hiddenSet.has(v.id))
    .sort((a, b) => a.va.localeCompare(b.va));
}

function populateVaDropdowns() {
  const list = getVisibleOverviewVas();
  const vaOptions = list.map((v) => `<option value="${v.id}">${escapeHtml(v.va)}</option>`).join("");

  const createEl = document.getElementById("task-va");
  const filterEl = document.getElementById("filter-va");

  const prevCreate = createEl.value;
  const prevFilter = filterEl.value;

  createEl.innerHTML = `<option value="general">General / Team</option>` + vaOptions;
  filterEl.innerHTML = `<option value="All">All Assignees</option><option value="general">General / Team</option>` + vaOptions;

  if (prevCreate) createEl.value = prevCreate;
  if (prevFilter) filterEl.value = prevFilter;
}

document.querySelectorAll(".status-filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    filterStatus = btn.dataset.status;
    document.querySelectorAll(".status-filter").forEach((b) => {
      b.className = b.dataset.status === filterStatus
        ? "status-filter px-2.5 py-1 rounded bg-slate-800 text-white font-semibold"
        : "status-filter px-2.5 py-1 rounded text-slate-400";
    });
    renderTasks();
  });
});

document.getElementById("filter-cat").addEventListener("change", renderTasks);
document.getElementById("filter-va").addEventListener("change", renderTasks);

document.getElementById("add-task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("task-title").value.trim();
  const vaId = document.getElementById("task-va").value;
  if (!title) return;

  const taskId = `task_${Date.now()}`;
  await setSiteData(`tlTasks/${taskId}`, {
    id: taskId,
    title,
    vaId,
    vaName: vas[vaId] ? vas[vaId].va : "General",
    category: document.getElementById("task-cat").value,
    priority: document.getElementById("task-prio").value,
    dueDate: document.getElementById("task-due").value || "",
    completed: false,
    createdAt: new Date().toISOString()
  });

  document.getElementById("task-title").value = "";
  document.getElementById("task-due").value = "";
});

window.toggleTaskDone = async (id, current) => {
  await updateSiteData(`tlTasks/${id}`, { completed: !current });
};

window.deleteTask = async (id) => {
  if (confirm("Delete this task?")) await removeSiteData(`tlTasks/${id}`);
};

function renderTasks() {
  const catFilter = document.getElementById("filter-cat").value;
  const vaFilter = document.getElementById("filter-va").value;

  const entries = Object.entries(tasks);
  document.getElementById("pending-count").textContent = entries.filter(([, t]) => t && !t.completed).length;

  const filtered = entries
    .filter(([, t]) => {
      if (!t) return false;
      if (filterStatus === "Active" && t.completed) return false;
      if (filterStatus === "Completed" && !t.completed) return false;
      if (catFilter !== "All" && t.category !== catFilter) return false;
      if (vaFilter !== "All" && t.vaId !== vaFilter) return false;
      return true;
    })
    .sort((a, b) => Number(a[1].completed) - Number(b[1].completed) || (b[1].createdAt || "").localeCompare(a[1].createdAt || ""));

  document.getElementById("tasks-list").innerHTML =
    filtered
      .map(
        ([id, t]) => `
      <div class="p-3 rounded-xl border flex items-center justify-between gap-3 ${
        t.completed ? "bg-slate-950/40 border-slate-800/60 opacity-60" : "bg-slate-950 border-slate-800"
      }">
        <div class="flex items-center gap-3 min-w-0">
          <input type="checkbox" ${t.completed ? "checked" : ""} onchange="window.toggleTaskDone('${id}', ${Boolean(t.completed)})"
                 class="w-4 h-4 accent-teal-500 cursor-pointer" />
          <div class="min-w-0">
            <p class="text-xs font-medium ${t.completed ? "line-through text-slate-500" : "text-slate-100"}">${escapeHtml(t.title)}</p>
            <div class="text-[10px] text-slate-500 font-mono mt-0.5">
              Assigned: <strong class="text-slate-300">${escapeHtml(t.vaName || "General")}</strong>
              ${t.dueDate ? ` • Due: ${escapeHtml(t.dueDate)}` : ""}
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-teal-300">${escapeHtml(t.category)}</span>
          <span class="text-[10px] px-2 py-0.5 rounded border ${
            t.priority === "High" ? "bg-rose-950 text-rose-300 border-rose-800" : "bg-amber-950/70 text-amber-300 border-amber-800"
          }">${escapeHtml(t.priority)}</span>
          <button type="button" onclick="window.deleteTask('${id}')" class="text-slate-500 hover:text-rose-400 px-1 text-xs">✕</button>
        </div>
      </div>`
      )
      .join("") || `<p class="text-center py-8 text-xs text-slate-500 italic">No tasks match the selected filters.</p>`;
}