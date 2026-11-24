import { subscribeCached, setSiteData, updateSiteData, removeSiteData } from "./firebase.js";
import { renderTopNav, escapeHtml, getHiddenVaSet } from "./schedule.js";

renderTopNav("tasks");

let vas = {};
let vaOrder = [];
let tasks = {};
let filterStatus = "Active";
let editingTaskId = null;

subscribeCached("kitsuneDashboard", "kitsune_tasks_cache", (data) => {
  if (!data) return;
  vas = data.vas || {};
  vaOrder = data.vaOrder || [];
  tasks = (data.siteData && data.siteData.tlTasks) || {};
  populateVaDropdowns();
  if (!editingTaskId) {
    renderTasks();
  }
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

window.startEditTask = (id) => {
  editingTaskId = id;
  renderTasks();
};

window.cancelEditTask = () => {
  editingTaskId = null;
  renderTasks();
};

window.saveEditTask = async (e, id) => {
  e.preventDefault();
  const titleInput = document.getElementById(`edit-task-title-${id}`);
  const vaSelect = document.getElementById(`edit-task-va-${id}`);
  const catSelect = document.getElementById(`edit-task-cat-${id}`);
  const prioSelect = document.getElementById(`edit-task-prio-${id}`);
  const dueInput = document.getElementById(`edit-task-due-${id}`);

  const title = titleInput ? titleInput.value.trim() : "";
  if (!title) return;

  const vaId = vaSelect ? vaSelect.value : "general";
  const vaName = vas[vaId] ? vas[vaId].va : "General";

  await updateSiteData(`tlTasks/${id}`, {
    title,
    vaId,
    vaName,
    category: catSelect ? catSelect.value : "Others",
    priority: prioSelect ? prioSelect.value : "Medium",
    dueDate: dueInput ? dueInput.value : "",
    updatedAt: new Date().toISOString()
  });

  editingTaskId = null;
  renderTasks();
};

window.deleteTask = async (id) => {
  if (confirm("Delete this task?")) {
    if (editingTaskId === id) editingTaskId = null;
    await removeSiteData(`tlTasks/${id}`);
  }
};

function buildEditTaskRowHtml(id, t) {
  const list = getVisibleOverviewVas();
  const vaOptions =
    `<option value="general" ${t.vaId === "general" ? "selected" : ""}>General / Team</option>` +
    list
      .map(
        (v) =>
          `<option value="${escapeHtml(v.id)}" ${t.vaId === v.id ? "selected" : ""}>${escapeHtml(v.va)}</option>`
      )
      .join("");

  const categories = [
    "Attendance / Late",
    "1:1 Follow-up",
    "Performance & Quality",
    "Disciplinary / Pings",
    "Schedule & Leaves",
    "Others"
  ];
  const catOptions = categories
    .map(
      (c) => `<option value="${escapeHtml(c)}" ${t.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`
    )
    .join("");

  const priorities = ["High", "Medium", "Low"];
  const prioOptions = priorities
    .map(
      (p) => `<option value="${escapeHtml(p)}" ${t.priority === p ? "selected" : ""}>${escapeHtml(p)}</option>`
    )
    .join("");

  return `
    <form onsubmit="window.saveEditTask(event, '${escapeHtml(id)}')"
          class="p-3.5 rounded-xl border border-teal-600/80 bg-slate-950 space-y-2.5 shadow-lg">
      <div class="flex items-center justify-between text-[11px] font-bold text-teal-300 uppercase tracking-wider">
        <span>✏️ Editing Task</span>
        <button type="button" onclick="window.cancelEditTask()" class="text-slate-400 hover:text-white underline cursor-pointer">Cancel</button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-12 gap-2">
        <input id="edit-task-title-${escapeHtml(id)}" type="text" required value="${escapeHtml(t.title || "")}"
               class="md:col-span-5 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:border-teal-500 focus:outline-none" />
        <select id="edit-task-va-${escapeHtml(id)}"
                class="md:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200">
          ${vaOptions}
        </select>
        <select id="edit-task-cat-${escapeHtml(id)}"
                class="md:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200">
          ${catOptions}
        </select>
        <select id="edit-task-prio-${escapeHtml(id)}"
                class="md:col-span-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200">
          ${prioOptions}
        </select>
        <input id="edit-task-due-${escapeHtml(id)}" type="date" value="${escapeHtml(t.dueDate || "")}"
               class="md:col-span-2 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 font-mono" />
      </div>
      <div class="flex justify-end gap-2">
        <button type="button" onclick="window.cancelEditTask()"
                class="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer">
          Cancel
        </button>
        <button type="submit"
                class="px-4 py-1 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold cursor-pointer">
          💾 Save Changes
        </button>
      </div>
    </form>
  `;
}

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
      .map(([id, t]) => {
        if (editingTaskId === id) {
          return buildEditTaskRowHtml(id, t);
        }
        return `
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
          <button type="button" onclick="window.startEditTask('${id}')"
                  title="Edit task"
                  class="text-xs font-semibold text-blue-400 hover:text-blue-300 bg-slate-900 hover:bg-slate-800 border border-slate-700 px-2 py-0.5 rounded cursor-pointer">
            Edit
          </button>
          <button type="button" onclick="window.deleteTask('${id}')" title="Delete task" class="text-slate-500 hover:text-rose-400 px-1 text-xs cursor-pointer">✕</button>
        </div>
      </div>`;
      })
      .join("") || `<p class="text-center py-8 text-xs text-slate-500 italic">No tasks match the selected filters.</p>`;
}