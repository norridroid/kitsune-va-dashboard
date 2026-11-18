const MOTIVATIONAL_QUOTES = [
  { text: "Clarity creates speed. Great leaders turn chaos into calm, repeatable systems.", tag: "LEADERSHIP" },
  { text: "Small daily improvements in consistency compound into unstoppable team momentum.", tag: "MOMENTUM" },
  { text: "Protect your focus—when the systems run smoothly, you lead from the front.", tag: "EXECUTION" },
  { text: "Every late flag caught early is a client relationship protected.", tag: "EXCELLENCE" },
  { text: "Build the machine once, refine it daily, and let your clarity set the pace.", tag: "SYSTEMS" },
  { text: "High standards with genuine support is how good VAs become A-players.", tag: "COACHING" }
];

export function initCommandVibe() {
  const header = document.querySelector("header");
  if (!header || document.getElementById("kitsune-vibe-bar")) return;

  const h1 = header.querySelector("h1");
  if (h1 && !h1.querySelector(".live-pulse-dot")) {
    h1.classList.add("flex", "items-center", "gap-2.5");
    const dot = document.createElement("span");
    dot.className = "live-pulse-dot";
    dot.title = "Real-time Firebase sync active";
    h1.prepend(dot);
  }

  const bar = document.createElement("div");
  bar.id = "kitsune-vibe-bar";
  bar.className =
    "max-w-7xl mx-auto px-6 pt-4 flex flex-wrap items-center justify-between gap-3 text-xs";

  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  let quoteIdx = dayOfYear % MOTIVATIONAL_QUOTES.length;

  function getGreeting() {
    const hr = new Date().getHours();
    if (hr < 12) return "Good morning, Norris ☀️";
    if (hr < 18) return "Good afternoon, Norris ⚡";
    return "Good evening, Norris 🌙";
  }

  function renderBar() {
    const q = MOTIVATIONAL_QUOTES[quoteIdx];
    const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    bar.innerHTML = `
      <div class="flex flex-wrap items-center gap-2.5 bg-slate-900/75 backdrop-blur-md border border-teal-800/40 px-3.5 py-2 rounded-xl shadow-sm">
        <span class="font-bold text-teal-300">${getGreeting()}</span>
        <span class="text-slate-600">•</span>
        <span class="font-mono text-[11px] text-slate-400">Local ${nowStr}</span>
        <span id="momentum-badge" class="hidden px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-700/70"></span>
      </div>

      <button type="button" id="cycle-quote-btn" title="Click for next boost"
              class="group flex items-center gap-2 bg-slate-900/75 hover:bg-slate-800/90 backdrop-blur-md border border-indigo-500/25 hover:border-teal-500/50 px-3.5 py-2 rounded-xl text-left transition cursor-pointer">
        <span class="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800">${q.tag}</span>
        <span class="text-slate-300 group-hover:text-white italic">“${q.text}”</span>
        <span class="text-slate-500 group-hover:text-teal-300 text-[10px] ml-1">↻</span>
      </button>
    `;

    bar.querySelector("#cycle-quote-btn").addEventListener("click", () => {
      quoteIdx = (quoteIdx + 1) % MOTIVATIONAL_QUOTES.length;
      renderBar();
    });
  }

  renderBar();
  header.insertAdjacentElement("afterend", bar);
}

export function updateMomentumBadge({ loggedInNow, totalVAs, needAttention }) {
  const badge = document.getElementById("momentum-badge");
  if (!badge) return;
  const logged = Number(loggedInNow) || 0;
  const total = Number(totalVAs) || 0;
  const attention = Number(needAttention) || 0;

  if (total > 0 && attention === 0) {
    badge.textContent = "🔥 100% Team On Track";
    badge.classList.remove("hidden");
  } else if (logged > 0) {
    badge.textContent = `⚡ ${logged}/${total} Active on Shift`;
    badge.classList.remove("hidden");
  }
}