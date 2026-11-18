/* Leo DayFront semantic coloring. Presentation-only: no CalDAV data mutation. */
(() => {
  "use strict";
  const daily = /每日|每天|日记|daily\s+(?:schedule|journal|routine)|journal|habit|routine/i;
  const urgent = /🚨|⚠️|\burgent\b|\basap\b|\bcritical\b|\bdeadline\b|\bexam\b|\bpart[\s-]*2\b|\bddl\b|紧急|截止|考试|重要任务|必须完成/i;
  const leisure = /桌游|魔术|聚餐|出游|娱乐|放松|休息|聚会|\b(?:board\s*game|game\s*night|social|party|hangout|movie\s*night|leisure|fun)\b|\bCNA\b.*\bLIC\b/i;
  const fixed = /\b(?:ESE\s*\d{3}|GRD\s*\d{3}|lab|laboratory|class|lecture|course|seminar|office\s*hours|recitation)\b|\bTA\b|课程|上课|值班|授课|实验课|助教/i;
  const priorityByTaskTitle = new Map();
  const explicitEventCategories = new Map();
  const explicitTaskCategories = new Map();
  const VALID = new Set(["fixed", "urgent", "fun", "routine", "default"]);
  function category(title, todo) {
    // The category saved in the CalDAV record by the MCP takes precedence.
    const saved = (todo ? explicitTaskCategories : explicitEventCategories).get(title);
    if (VALID.has(saved)) return saved;
    // Diary/routine tasks are never urgent solely because their title says "DDL".
    if (todo && daily.test(title)) return "routine";
    // CalDAV VTODO priority 1 = critical. This is read from the actual task API,
    // so future priority-one tasks turn red without requiring a title keyword.
    if ((todo && priorityByTaskTitle.get(title) === 1) || urgent.test(title)) return "urgent";
    // A task about organising leisure is still a task, not leisure time itself.
    if (!todo && leisure.test(title)) return "fun";
    if (!todo && fixed.test(title)) return "fixed";
    return "default";
  }
  function colorEvents() {
    maybeLoadVisibleEvents();
    for (const el of document.querySelectorAll(".fc .fc-event")) {
      const title = el.querySelector(".calendar-entry-title")?.textContent?.trim();
      if (!title) continue;
      const todo = el.classList.contains("task-entry") ||
        !!el.querySelector(".calendar-entry-todo");
      const chosen = [...el.classList].find(name => name.startsWith("sl-palette-"))?.slice(11);
      const type = VALID.has(chosen) ? chosen : category(title, todo);
      if (el.dataset.leoColor !== type) el.dataset.leoColor = type;
      // Use a compact, one-line title for short timed entries instead of
      // allowing long multi-line text to be cut off at the event boundary.
      if (el.classList.contains("fc-timegrid-event")) {
        el.classList.toggle("leo-compact-event", el.getBoundingClientRect().height < 90);
      }

    }
  }
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; colorEvents(); });
  }
  async function loadTaskPriorities() {
    try {
      const response = await fetch("/api/v1/tasks", { credentials: "same-origin" });
      if (!response.ok) return;
      const payload = await response.json();
      for (const task of payload.data || []) {
        if (!task.title || !Number.isFinite(task.priority)) continue;
        if (VALID.has(task.category)) explicitTaskCategories.set(task.title, task.category);
        const previous = priorityByTaskTitle.get(task.title);
        if (previous === undefined || task.priority < previous) {
          priorityByTaskTitle.set(task.title, task.priority);
        }
      }
      schedule();
    } catch { /* Calendar UI still works without task-priority augmentation. */ }
  }
  let lastVisibleDate = "";
  function maybeLoadVisibleEvents(force = false) {
    const selected = new URLSearchParams(location.search).get("date") || new Date().toISOString().slice(0, 10);
    if (!force && selected === lastVisibleDate) return;
    lastVisibleDate = selected;
    void loadEventCategories(selected);
  }
  async function loadEventCategories(selected) {
    try {
      const anchor = new Date(selected + "T12:00:00Z");
      if (!Number.isFinite(anchor.getTime())) return;
      const start = new Date(anchor.getTime() - 65 * 86400000).toISOString();
      const end = new Date(anchor.getTime() + 65 * 86400000).toISOString();
      const response = await fetch(`/api/v1/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {credentials:"same-origin"});
      if (!response.ok) return;
      const payload = await response.json();
      for (const event of payload.data || []) {
        if (event.title && VALID.has(event.category)) explicitEventCategories.set(event.title, event.category);
      }
      schedule();
    } catch { /* Fallback title rules remain available. */ }
  }
  function start() {
    colorEvents();
    const root = document.getElementById("root") || document.body;
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    void loadTaskPriorities();
    // Refetch when the user returns to a tab after changing task priorities.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void loadTaskPriorities();
        maybeLoadVisibleEvents(true);
      }
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, {once: true});
  } else start();
})();
(()=>{const map={d:"timeGridDay",w:"timeGridWeek",f:"timeGridFourDay",m:"dayGridMonth",a:"listMonth","1":"timeGridDay","2":"timeGridWeek","3":"dayGridMonth","4":"timeGridFourDay","5":"listMonth"};const action=n=>{const el=document.querySelector(".fc-"+n+"-button");if(el){el.click();return true}return false};function help(){if(document.getElementById("sl-keys"))return;const el=document.createElement("div");el.id="sl-keys";el.style.cssText="position:fixed;inset:0;z-index:2147483000;background:#0009;display:grid;place-items:center";const card=document.createElement("div");card.style.cssText="background:#212126;color:#eee;border:1px solid #555;border-radius:14px;padding:24px;min-width:310px;font:14px system-ui";const heading=document.createElement("h2");heading.textContent="SL Calendar shortcuts";card.append(heading);for(const [key,label] of [["T","Today"],["D / 1","Day"],["W / 2","Week"],["M / 3","Month"],["F / 4","4 Days"],["A / 5","Agenda"],["J / →","Next"],["K / ←","Previous"],["/","Search"],["R","Reload"],["?","Shortcuts"],["Esc","Close dialog / cancel"]]){const row=document.createElement("p");row.textContent=key+"  —  "+label;card.append(row)}const note=document.createElement("small");note.textContent="Not active while typing. Esc to close.";card.append(note);el.append(card);el.addEventListener("click",e=>{if(e.target===el)el.remove()});document.body.append(el)}document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.getElementById("sl-keys")){document.getElementById("sl-keys").remove();e.preventDefault();return}if(e.defaultPrevented||e.ctrlKey||e.altKey||e.metaKey||e.isComposing||e.target.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]')||document.querySelector('[role="dialog"],.dialog-backdrop'))return;const k=e.key.toLowerCase();let ok=false;if(map[k])ok=action(map[k]);else if(k==="t")ok=action("today");else if(k==="j"||k==="arrowright")ok=action("next");else if(k==="k"||k==="arrowleft")ok=action("prev");else if(k==="/")ok=action("search");else if(k==="?"){help();ok=true}else if(k==="r"){location.reload();ok=true}if(ok)e.preventDefault()})})();

/* SL Calendar restore the selected view after FullCalendar mounts/rerenders. */
(() => {
  const KEY = "sl-calendar-view";
  const valid = ["dayGridMonth", "timeGridWeek", "timeGridFourDay", "timeGridThreeDay", "timeGridDay", "listMonth"];
  const selected = () => document.querySelector(".fc-button-primary.fc-button-active");
  const preferred = () => {
    try {
      const mobile = matchMedia("(max-width:720px)").matches;
      const value = localStorage.getItem(mobile ? "sl-mobile-view" : KEY);
      return valid.includes(value) ? value : (mobile ? "timeGridDay" : "timeGridWeek");
    } catch { return matchMedia("(max-width:720px)").matches ? "timeGridDay" : "timeGridWeek"; }
  };
  let scheduled = false;
  let applying = false;
  function reconcile() {
    scheduled = false;
    if (applying) return;
    const current = selected();
    if (!current) return;
    const wanted = preferred();
    if (current.classList.contains("fc-" + wanted + "-button")) return;
    const button = document.querySelector(".fc-" + wanted + "-button");
    if (!button) return;
    applying = true;
    button.click();
    requestAnimationFrame(() => {
      applying = false;
      schedule();
    });
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(reconcile);
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.(".fc-dayGridMonth-button,.fc-timeGridWeek-button,.fc-timeGridFourDay-button,.fc-timeGridThreeDay-button,.fc-timeGridDay-button,.fc-listMonth-button");
    if (!button) return;
    const view = valid.find(v => button.classList.contains("fc-" + v + "-button"));
    if (view) {
      try { localStorage.setItem(matchMedia("(max-width:720px)").matches ? "sl-mobile-view" : KEY, view); } catch {}
    }
  }, true);
  function init() {
    const root = document.getElementById("root") || document.body;
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    schedule();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();

/* Escape closes the topmost SL Calendar overlay without saving changes. */
(() => {
  const overlays = [
    ["#sl-keys", null],
    [".clock-backdrop", '[aria-label="Close time picker"],.clock-footer button:last-child'],
    [".recurrence-action-backdrop", ".recurrence-action-cancel"],
    [".search-backdrop", '[aria-label="Close search"]'],
    [".dialog-backdrop", '[aria-label="Close"],.entry-type-cancel,.dialog-actions button:first-child']
  ];
  function onEscape(event) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const visible = el => el && el.getClientRects().length > 0;
    for (const [overlaySelector, buttonSelector] of overlays) {
      const overlay = [...document.querySelectorAll(overlaySelector)].reverse().find(visible);
      if (!overlay) continue;
      if (overlay.id === "sl-keys") {
        overlay.remove();
      } else {
        let button = buttonSelector && overlay.querySelector(buttonSelector);
        if (!button) {
          button = [...overlay.querySelectorAll("button")].find(b =>
            /^(cancel|close|×)$/i.test(b.textContent.trim()) || /^Close/i.test(b.getAttribute("aria-label") || "")
          );
        }
        if (button) button.click();
        else overlay.dispatchEvent(new MouseEvent("mousedown", {bubbles:true, cancelable:true}));
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
  }
  document.addEventListener("keydown", onEscape, true);
})();
