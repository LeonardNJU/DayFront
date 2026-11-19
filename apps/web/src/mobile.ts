import type { CalendarApi, EventApi } from '@fullcalendar/core';
/* SL Calendar mobile interaction layer v2: one day in two 12-hour columns. */
(() => {
  'use strict';
  const mobile = matchMedia('(max-width:720px)');
  const VIEW_KEY = 'sl-mobile-view';
  const views: readonly (readonly [string, string])[] = [
    ['timeGridDay', 'Day'],
    ['timeGridThreeDay', '3 Days'],
    ['timeGridWeek', 'Week'],
    ['dayGridMonth', 'Month'],
    ['listMonth', 'Agenda'],
  ];
  const icons: Record<string, string> = {
    calendar:
      '<path d="M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1-1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>',
    tasks:
      '<path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
    today: '<path d="M3 11a9 9 0 1 1 2.6 6.4"/><path d="M3 4v7h7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
    prev: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
  };
  const $ = (q: string) => document.querySelector<HTMLElement>(q);
  const svg = (name: string) =>
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    icons[name] +
    '</svg>';
  interface Gesture {
    id: number;
    x: number;
    y: number;
    start: number;
    from: number;
    to: number;
    dayIndex: number;
    holding: boolean;
    cancelled: boolean;
    board: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  }
  interface Tap {
    t: number;
    x: number;
    y: number;
    dayIndex: number;
  }
  interface MobileState {
    screen: 'calendar' | 'tasks';
    mounted: boolean;
    firstTasks: boolean;
    gesture: Gesture | null;
    lastTap: Tap | null;
    gridKey: string;
    renderVersion: number;
    day: string | null;
  }
  interface MobileBridge {
    calendar?: CalendarApi;
    createEvent: (start: string, end?: string) => void;
    createTask: (due?: string) => void;
    openEntry: (event: EventApi) => void;
  }
  const state: MobileState = {
    screen: 'calendar',
    mounted: false,
    firstTasks: true,
    gesture: null,
    lastTap: null,
    gridKey: '',
    renderVersion: 0,
    day: null,
  };
  const bridge = (): MobileBridge | undefined =>
    (window as unknown as { slMobileCalendar?: MobileBridge }).slMobileCalendar;
  function action(q: string) {
    const b = $(q);
    if (b) {
      b.click();
      return true;
    }
    return false;
  }
  function localDate(d: Date) {
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }
  function isoAt(date: Date, minute: number) {
    const d = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      0,
      0,
      0,
      0,
    );
    d.setMinutes(minute);
    const offset = -d.getTimezoneOffset(),
      sign = offset >= 0 ? '+' : '-',
      h = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0'),
      m = String(Math.abs(offset) % 60).padStart(2, '0');
    return (
      localDate(d) +
      'T' +
      String(d.getHours()).padStart(2, '0') +
      ':' +
      String(d.getMinutes()).padStart(2, '0') +
      ':00' +
      sign +
      h +
      ':' +
      m
    );
  }
  function currentDate() {
    return bridge()?.calendar?.getDate() || new Date();
  }
  function currentView() {
    return (
      bridge()?.calendar?.view?.type ||
      views.find(([v]) => $('.fc-' + v + '-button.fc-button-active'))?.[0] ||
      'timeGridDay'
    );
  }
  function isDay() {
    return (
      mobile.matches &&
      state.screen === 'calendar' &&
      currentView() === 'timeGridDay'
    );
  }
  function isThree() {
    return (
      mobile.matches &&
      state.screen === 'calendar' &&
      currentView() === 'timeGridThreeDay'
    );
  }
  function dayForIndex(index: number) {
    const base = currentDate(),
      d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    if (isThree()) d.setDate(d.getDate() + index - 1);
    return d;
  }
  function isCurrentToday() {
    return localDate(currentDate()) === localDate(new Date());
  }
  function dayIndexForX(x: number) {
    if (!isThree()) return 0;
    const rect = $('#slm-dualday .slm-day-columns')?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 1;
    return Math.min(
      2,
      Math.max(0, Math.floor(((x - rect.left) / rect.width) * 3)),
    );
  }
  function navigate(delta: number) {
    const api = bridge()?.calendar;
    if (!api) {
      action(delta < 0 ? '.fc-prev-button' : '.fc-next-button');
      return;
    }
    if (currentView() === 'timeGridDay') {
      const d = new Date(api.getDate());
      d.setDate(d.getDate() + delta);
      api.gotoDate(d);
    } else {
      action(delta < 0 ? '.fc-prev-button' : '.fc-next-button');
    }
  }
  function setToday() {
    setScreen('calendar');
    if (bridge()?.calendar) bridge()?.calendar?.today();
    else action('.fc-today-button');
  }
  function setScreen(screen: MobileState['screen']) {
    if (!mobile.matches) return;
    state.screen = screen;
    document.body.classList.toggle('slm-tasks', screen === 'tasks');
    document
      .querySelectorAll<HTMLElement>('#slm-shell [data-screen]')
      .forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.screen === screen)),
      );
    if (screen === 'tasks' && state.firstTasks) {
      const u = $('.sidebar details.task-group-upcoming');
      if (u) (u as HTMLDetailsElement).open = false;
      state.firstTasks = false;
    }
    closeMenus();
    sync();
    if (screen === 'calendar')
      requestAnimationFrame(() => dispatchEvent(new Event('resize')));
  }
  function closeMenus() {
    for (const id of ['slm-views', 'slm-create']) {
      const el = $('#' + id);
      if (el) el.hidden = true;
    }
    $('#slm-view')?.setAttribute('aria-expanded', 'false');
    $('#slm-add')?.setAttribute('aria-expanded', 'false');
  }
  function toggleMenu(which: string) {
    const el = $('#slm-' + which),
      wasOpen = el && !el.hidden;
    closeMenus();
    if (el && !wasOpen) {
      el.hidden = false;
      $('#slm-' + (which === 'views' ? 'view' : 'add'))?.setAttribute(
        'aria-expanded',
        'true',
      );
    }
  }
  function chooseView(v: string) {
    const actual = v === 'timeGridFourDay' ? 'timeGridThreeDay' : v;
    try {
      localStorage.setItem(VIEW_KEY, actual);
    } catch {
      /* local storage is unavailable */
    }
    setScreen('calendar');
    const api = bridge()?.calendar;
    if (api) api.changeView(actual);
    else action('.fc-' + actual + '-button');
    sync();
  }
  function makeShell() {
    const shell = document.createElement('div');
    shell.id = 'slm-shell';
    shell.innerHTML =
      '<header class="slm-header"><div class="slm-brand"><img src="/sl-calendar-icon-64.png" alt="" width="30" height="30"><span>SL Calendar</span></div>' +
      '<div class="slm-top-actions"><button id="slm-search" type="button" aria-label="Search">' +
      svg('search') +
      '</button></div>' +
      '<div class="slm-datebar"><button id="slm-prev" type="button" aria-label="Previous day or range">' +
      svg('prev') +
      '</button>' +
      '<h1 id="slm-current-date">Calendar</h1><button id="slm-next" type="button" aria-label="Next day or range">' +
      svg('next') +
      '</button>' +
      '<button id="slm-view" type="button" aria-label="Choose calendar view" aria-expanded="false"><span id="slm-view-name">Day</span>' +
      svg('down') +
      '</button></div></header>' +
      '<div class="slm-menu" id="slm-views" hidden role="group" aria-label="Calendar views">' +
      views
        .map(
          ([v, label]) =>
            '<button type="button" data-view="' +
            v +
            '">' +
            label +
            '</button>',
        )
        .join('') +
      '</div>' +
      '<div class="slm-menu slm-add-menu" id="slm-create" hidden role="group" aria-label="Create">' +
      '<button type="button" data-create="event">' +
      svg('calendar') +
      'New event</button>' +
      '<button type="button" data-create="task">' +
      svg('tasks') +
      'New task</button></div>' +
      '<nav class="slm-nav" aria-label="Mobile navigation">' +
      '<button type="button" data-screen="calendar" aria-pressed="true"><span class="slm-nav-icon">' +
      svg('calendar') +
      '</span><span class="slm-nav-label">Calendar</span></button>' +
      '<button type="button" data-screen="tasks" aria-pressed="false">' +
      svg('tasks') +
      '<span>Tasks</span></button>' +
      '<button type="button" id="slm-add" aria-expanded="false">' +
      svg('plus') +
      '<span>New</span></button></nav>';
    document.body.append(shell);
    state.mounted = true;
    shell.addEventListener('click', (e) => {
      const b = (e.target as Element)?.closest('button');
      if (!b) return;
      if (b.dataset.screen) {
        if (b.dataset.screen === 'calendar' && !isCurrentToday()) setToday();
        else setScreen(b.dataset.screen as MobileState['screen']);
        return;
      }
      if (b.id === 'slm-prev') {
        navigate(-1);
        return;
      }
      if (b.id === 'slm-next') {
        navigate(1);
        return;
      }
      if (b.id === 'slm-search') {
        action('.fc-search-button');
        return;
      }
      if (b.id === 'slm-view') {
        toggleMenu('views');
        return;
      }
      if (b.id === 'slm-add') {
        toggleMenu('create');
        return;
      }
      if (b.dataset.view) {
        chooseView(b.dataset.view);
        return;
      }
      if (b.dataset.create) {
        closeMenus();
        if (b.dataset.create === 'task') {
          if (bridge()) bridge()?.createTask();
          else action('.sidebar .primary-task-action');
        } else {
          setScreen('calendar');
          if (bridge())
            bridge()?.createEvent(
              isoAt(currentDate(), 9 * 60),
              isoAt(currentDate(), 10 * 60),
            );
          else action('.fc-quickEvent-button');
        }
      }
    });
    document.addEventListener('click', (e) => {
      if (!(e.target as Element)?.closest('#slm-shell')) closeMenus();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenus();
    });
  }
  function dayGrid() {
    let board = $('#slm-dualday');
    const main = $('.calendar-main');
    if (!main) return null;
    if (!board) {
      board = document.createElement('section');
      board.id = 'slm-dualday';
      board.setAttribute('aria-label', 'Full-day timeline');
      main.append(board);
    }
    return board;
  }
  function renderDay(force = false) {
    const board = dayGrid();
    if (!board) return;
    if (!isDay()) {
      board.hidden = true;
      return;
    }
    board.hidden = false;
    board.classList.remove('slm-grid-three');
    board.setAttribute('aria-label', 'One day in two 12-hour columns');
    const date = currentDate(),
      dayKey = localDate(date);
    const entries: EventApi[] = [];
    for (const ev of bridge()?.calendar?.getEvents?.() || []) {
      if (!ev.start) continue;
      const end = ev.end || new Date(ev.start.getTime() + 3600000);
      const dayStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
      );
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      if (ev.start < dayEnd && end > dayStart) entries.push(ev);
    }
    entries.sort(
      (a, b) =>
        (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0) ||
        a.title.localeCompare(b.title),
    );
    const sig =
      dayKey +
      '|' +
      state.renderVersion +
      '|' +
      entries
        .map((e) =>
          [
            e.id,
            e.start?.getTime(),
            e.end?.getTime(),
            e.title,
            e.backgroundColor,
            e.extendedProps?.completed,
          ].join(':'),
        )
        .join('|');
    if (!force && state.gridKey === sig) return;
    state.gridKey = sig;
    state.day = dayKey;
    board.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'slm-day-heading';
    heading.innerHTML = '<span>00:00–12:00</span><span>12:00–24:00</span>';
    board.append(heading);
    const cols = document.createElement('div');
    cols.className = 'slm-day-columns';
    board.append(cols);
    const allDay = entries.filter((e) => e.allDay);
    if (allDay.length) {
      const strip = document.createElement('div');
      strip.className = 'slm-day-allday';
      strip.setAttribute('aria-label', 'All-day events');
      allDay.slice(0, 5).forEach((e) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = e.title;
        b.style.borderLeftColor = colorFor(e);
        b.addEventListener('click', () => bridge()?.openEntry(e));
        strip.append(b);
      });
      if (allDay.length > 5) {
        const more = document.createElement('span');
        more.textContent = '+' + (allDay.length - 5) + ' more';
        strip.append(more);
      }
      board.insertBefore(strip, cols);
    }
    const startDate = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    for (let col = 0; col < 2; col++) {
      const lane = document.createElement('div');
      lane.className = 'slm-day-lane';
      lane.dataset.half = String(col);
      cols.append(lane);
      for (let h = 0; h <= 12; h++) {
        const tick = document.createElement('div');
        tick.className = 'slm-hour-tick';
        tick.style.top = (h / 12) * 100 + '%';
        const absolute = col * 12 + h;
        tick.textContent =
          (absolute === 24 ? '24' : String(absolute).padStart(2, '0')) + ':00';
        lane.append(tick);
      }
      const rangeStart = col * 720,
        rangeEnd = rangeStart + 720;
      const segments: {
        ev: EventApi;
        start: number;
        end: number;
        lane: number;
      }[] = [];
      entries
        .filter((e) => !e.allDay)
        .forEach((ev) => {
          const start = Math.max(
            0,
            (ev.start!.getTime() - startDate.getTime()) / 60000,
          );
          const end = Math.min(
            1440,
            (ev.end
              ? ev.end.getTime() - startDate.getTime()
              : ev.start!.getTime() - startDate.getTime() + 3600000) / 60000,
          );
          if (start < rangeEnd && end > rangeStart)
            segments.push({
              ev,
              start: Math.max(start, rangeStart),
              end: Math.min(end, rangeEnd),
              lane: 0,
            });
        });
      segments.sort((a, b) => a.start - b.start || b.end - a.end);
      // Distribute overlapping events across columns within each 12-hour lane.
      for (let k = 0; k < segments.length; k++) {
        const used = new Set(
          segments
            .slice(0, k)
            .filter((s) => s.end > segments[k]!.start)
            .map((s) => s.lane),
        );
        let slot = 0;
        while (used.has(slot)) slot++;
        segments[k]!.lane = slot;
      }
      for (const item of segments) {
        const overlaps = segments.filter(
          (s) => s.start < item.end && s.end > item.start,
        );
        const count = Math.min(
          3,
          Math.max(1, ...overlaps.map((s) => s.lane + 1)),
        );
        const box = document.createElement('button');
        box.type = 'button';
        box.className = 'slm-day-event';
        box.dataset.eventid = item.ev.id;
        box.style.backgroundColor = colorFor(item.ev);
        const top = ((item.start - rangeStart) / 720) * 100,
          h = Math.max(1.4, ((item.end - item.start) / 720) * 100);
        box.style.top = top + '%';
        box.style.height = h + '%';
        box.style.left =
          'calc(36px + (100% - 38px) * ' + (item.lane % 3) + '/' + count + ')';
        box.style.width = 'calc((100% - 38px) / ' + count + ' - 2px)';
        const label = document.createElement('span');
        label.className = 'slm-event-title';
        label.textContent = item.ev.title;
        box.append(label);
        if (h > 5) {
          const t = document.createElement('small');
          const startHour = Math.floor(item.start / 60);
          const min = Math.floor(item.start % 60);
          t.textContent =
            String(startHour).padStart(2, '0') +
            ':' +
            String(min).padStart(2, '0');
          box.append(t);
        }
        box.title = item.ev.title;
        box.addEventListener('click', (e) => {
          e.stopPropagation();
          bridge()?.openEntry(item.ev);
        });
        lane.append(box);
      }
    }
  }
  function renderThree(force = false) {
    const board = dayGrid();
    if (!board) return;
    if (!isThree()) {
      board.classList.remove('slm-grid-three');
      return;
    }
    board.hidden = false;
    board.classList.add('slm-grid-three');
    board.setAttribute(
      'aria-label',
      'Three days, each showing all 24 hours without vertical scrolling',
    );
    const dates = [0, 1, 2].map(dayForIndex);
    const starts = dates.map(
      (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()),
    );
    const ends = starts.map((d) => {
      const e = new Date(d);
      e.setDate(e.getDate() + 1);
      return e;
    });
    const api = bridge()?.calendar;
    const all = (api?.getEvents?.() || []).filter(
      (e) =>
        e.start !== null &&
        e.start < ends[2]! &&
        (e.end || new Date(e.start.getTime() + 3600000)) > starts[0]!,
    );
    const signature =
      'three|' +
      dates.map(localDate).join(',') +
      '|' +
      state.renderVersion +
      '|' +
      all
        .map((e) =>
          [
            e.id,
            e.start?.getTime(),
            e.end?.getTime(),
            e.title,
            e.backgroundColor,
            e.extendedProps?.completed,
          ].join(':'),
        )
        .join('|');
    if (!force && state.gridKey === signature) return;
    state.gridKey = signature;
    board.replaceChildren();
    const headings = document.createElement('div');
    headings.className = 'slm-day-heading';
    headings.replaceChildren(
      ...dates.map((date) => {
        const heading = document.createElement('span');
        heading.textContent = date.toLocaleDateString('en-US', {
          weekday: 'short',
          day: 'numeric',
        });
        if (localDate(date) === localDate(new Date()))
          heading.classList.add('slm-is-today');
        return heading;
      }),
    );
    board.append(headings);
    const hasAllDay = all.some((e) => e.allDay);
    if (hasAllDay) {
      const wrap = document.createElement('div');
      wrap.className = 'slm-day-allday slm-three-allday';
      starts.forEach((start, i) => {
        const cell = document.createElement('div');
        cell.className = 'slm-three-allday-cell';
        all
          .filter(
            (e) =>
              e.allDay &&
              e.start !== null &&
              e.start < ends[i]! &&
              (e.end || new Date(e.start.getTime() + 86400000)) > start,
          )
          .forEach((ev) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.title = ev.title;
            chip.textContent = ev.title;
            chip.style.borderLeftColor = colorFor(ev);
            chip.addEventListener('click', () => bridge()?.openEntry(ev));
            cell.append(chip);
          });
        wrap.append(cell);
      });
      board.append(wrap);
    }
    const cols = document.createElement('div');
    cols.className = 'slm-day-columns';
    board.append(cols);
    dates.forEach((date, col) => {
      const lane = document.createElement('div');
      lane.className = 'slm-day-lane';
      lane.dataset.dayIndex = String(col);
      cols.append(lane);
      for (let h = 0; h <= 24; h++) {
        const tick = document.createElement('div');
        tick.className = 'slm-hour-tick';
        tick.style.top = (h / 24) * 100 + '%';
        tick.textContent = String(h).padStart(2, '0');
        lane.append(tick);
      }
      const segments: {
        ev: EventApi;
        start: number;
        end: number;
        lane: number;
      }[] = [];
      all
        .filter((e) => !e.allDay)
        .forEach((ev) => {
          const eventEnd = ev.end || new Date(ev.start!.getTime() + 3600000);
          if (ev.start! >= ends[col]! || eventEnd <= starts[col]!) return;
          const a = Math.max(
            0,
            (ev.start!.getTime() - starts[col]!.getTime()) / 60000,
          );
          const b = Math.min(
            1440,
            (eventEnd.getTime() - starts[col]!.getTime()) / 60000,
          );
          if (b > a) segments.push({ ev, start: a, end: b, lane: 0 });
        });
      segments.sort((a, b) => a.start - b.start || b.end - a.end);
      segments.forEach((seg, i) => {
        const taken = new Set(
          segments
            .slice(0, i)
            .filter((prev) => prev.end > seg.start)
            .map((prev) => prev.lane),
        );
        while (taken.has(seg.lane)) seg.lane++;
      });
      segments.forEach((seg) => {
        const simultaneous = segments.filter(
          (s) => s.start < seg.end && s.end > seg.start,
        );
        const count = Math.min(
          3,
          Math.max(1, ...simultaneous.map((s) => s.lane + 1)),
        );
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'slm-day-event';
        b.style.backgroundColor = colorFor(seg.ev);
        b.style.top = (seg.start / 1440) * 100 + '%';
        b.style.height =
          Math.max(1.4, ((seg.end - seg.start) / 1440) * 100) + '%';
        b.style.left =
          'calc(29px + (100% - 31px) * ' + (seg.lane % 3) + '/' + count + ')';
        b.style.width = 'calc((100% - 31px)/' + count + ' - 1px)';
        const label = document.createElement('span');
        label.className = 'slm-event-title';
        label.textContent = seg.ev.title;
        b.append(label);
        b.title = seg.ev.title;
        if (seg.end - seg.start >= 75) {
          const time = document.createElement('small');
          time.textContent =
            String(Math.floor(seg.start / 60)).padStart(2, '0') +
            ':' +
            String(Math.round(seg.start % 60)).padStart(2, '0');
          b.append(time);
        }
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          bridge()?.openEntry(seg.ev);
        });
        lane.append(b);
      });
    });
  }
  function colorFor(ev: EventApi) {
    const category = String(ev.extendedProps?.category ?? '').toLowerCase();
    const fallback: Record<string, string> = {
      fixed: '#258b59',
      urgent: '#d84553',
      fun: '#e5aa26',
      routine: '#8664c9',
      default: '#5287e9',
    };
    const custom = ev.backgroundColor || '';
    return (
      fallback[category] ??
      (/^(#[\da-f]{3,8}|rgb\([^)]*\))$/i.test(custom)
        ? custom
        : fallback.default) ??
      '#5287e9'
    );
  }
  function timeAt(x: number, y: number) {
    const board = $('#slm-dualday'),
      cols = board?.querySelector('.slm-day-columns');
    if (!cols) return null;
    const rect = cols.getBoundingClientRect();
    if (!rect.height) return null;
    const ratio = Math.max(0, Math.min(0.999, (y - rect.top) / rect.height));
    if (isThree()) return Math.floor((ratio * 1440) / 15) * 15;
    const half = x < rect.left + rect.width / 2 ? 0 : 1;
    return half * 720 + Math.floor((ratio * 720) / 15) * 15;
  }
  function showSelection() {
    const board = $('#slm-dualday');
    if (!board || !state.gesture?.holding) return;
    board
      .querySelectorAll<HTMLElement>('.slm-selection')
      .forEach((e) => e.remove());
    const start = Math.min(state.gesture.from, state.gesture.to),
      end = Math.max(state.gesture.from, state.gesture.to) + 15;
    const columns = board.querySelectorAll<HTMLElement>('.slm-day-lane');
    columns.forEach((lane, index) => {
      if (isThree() && index !== state.gesture!.dayIndex) return;
      const a = isThree() ? start : Math.max(start, index * 720);
      const b = isThree() ? end : Math.min(end, (index + 1) * 720);
      if (a >= b) return;
      const overlay = document.createElement('div');
      overlay.className = 'slm-selection';
      overlay.style.top =
        (isThree() ? a / 1440 : (a - index * 720) / 720) * 100 + '%';
      overlay.style.height = ((b - a) / (isThree() ? 1440 : 720)) * 100 + '%';
      const label = document.createElement('span');
      const fm = (m: number) =>
        String(Math.floor(m / 60)).padStart(2, '0') +
        ':' +
        String(m % 60).padStart(2, '0');
      label.textContent = fm(start) + '–' + fm(end);
      overlay.append(label);
      lane.append(overlay);
    });
  }
  function clearSelection() {
    const board = $('#slm-dualday');
    board?.querySelectorAll('.slm-selection').forEach((e) => e.remove());
  }
  function startInput() {
    // Pointer events give identical semantics for touchscreen and mouse testing.
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!mobile.matches || state.screen !== 'calendar' || e.button !== 0)
          return;
        const onBoard = (e.target as Element)?.closest(
          '#slm-dualday .slm-day-lane',
        );
        const onFull = (e.target as Element)?.closest('.fc-view-harness');
        if (!onBoard && !onFull) return;
        const onEvent = !!(e.target as Element)?.closest(
          '.slm-day-event,.fc-event',
        );
        if (
          !onEvent &&
          (e.target as Element)?.closest(
            'button,a,input,textarea,select,[role=dialog]',
          )
        )
          return;
        const pos = onBoard ? timeAt(e.clientX, e.clientY) : null;
        const g: Gesture = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          start: performance.now(),
          from: pos ?? 0,
          to: pos ?? 0,
          dayIndex: dayIndexForX(e.clientX),
          holding: false,
          cancelled: false,
          board: !!onBoard && !onEvent,
          timer: null,
        };
        state.gesture = g;
        if (onBoard && !onEvent && pos !== null) {
          g.timer = setTimeout(() => {
            if (state.gesture !== g || g.cancelled) return;
            g.holding = true;
            g.to = g.from;
            showSelection();
            navigator.vibrate?.(10);
          }, 420);
        }
      },
      true,
    );
    document.addEventListener(
      'pointermove',
      (e) => {
        const g = state.gesture;
        if (!g || e.pointerId !== g.id) return;
        const dx = e.clientX - g.x,
          dy = e.clientY - g.y;
        if (!g.holding && Math.hypot(dx, dy) > 13) {
          clearTimeout(g.timer ?? undefined);
          g.cancelled = true;
        }
        if (g.holding) {
          const at = timeAt(e.clientX, e.clientY);
          if (at !== null && at !== g.to) {
            g.to = at;
            showSelection();
          }
          e.preventDefault();
        }
      },
      { passive: false, capture: true },
    );
    document.addEventListener(
      'pointerup',
      (e) => {
        const g = state.gesture;
        if (!g || e.pointerId !== g.id) return;
        state.gesture = null;
        clearTimeout(g.timer ?? undefined);
        const dx = e.clientX - g.x,
          dy = e.clientY - g.y;
        if (g.holding) {
          const a = Math.min(g.from, g.to),
            b = Math.max(g.from, g.to) + 15;
          clearSelection();
          // Event editor: preserve the exact selected interval; minimum 30 minutes.
          const eventDate = dayForIndex(g.dayIndex);
          bridge()?.createEvent(
            isoAt(eventDate, a),
            isoAt(eventDate, Math.max(a + 30, b)),
          );
          state.lastTap = null;
          return;
        }
        if (
          Math.abs(dx) >= 50 &&
          Math.abs(dx) >= Math.abs(dy) * 1.3 &&
          performance.now() - g.start < 1100
        ) {
          navigate(dx < 0 ? 1 : -1);
          state.lastTap = null;
          return;
        }
        if (!g.board || g.cancelled || Math.hypot(dx, dy) > 16) return;
        const now = performance.now(),
          pos = timeAt(e.clientX, e.clientY);
        const prev = state.lastTap;
        if (
          prev &&
          now - prev.t < 380 &&
          Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 34
        ) {
          state.lastTap = null;
          if (pos !== null && prev.dayIndex === g.dayIndex)
            bridge()?.createTask(isoAt(dayForIndex(g.dayIndex), pos));
        } else
          state.lastTap = {
            t: now,
            x: e.clientX,
            y: e.clientY,
            dayIndex: g.dayIndex,
          };
      },
      true,
    );
    document.addEventListener(
      'pointercancel',
      () => {
        clearTimeout(state.gesture?.timer ?? undefined);
        state.gesture = null;
        clearSelection();
      },
      true,
    );
    // Stop synthetic click and FullCalendar touch handlers from fighting the custom board.
    document.addEventListener(
      'touchstart',
      (e) => {
        if ((e.target as Element)?.closest('#slm-dualday')) e.stopPropagation();
      },
      true,
    );
    document.addEventListener(
      'touchmove',
      (e) => {
        if ((e.target as Element)?.closest('#slm-dualday')) e.stopPropagation();
      },
      { capture: true, passive: true },
    );
    document.addEventListener(
      'touchend',
      (e) => {
        if ((e.target as Element)?.closest('#slm-dualday')) e.stopPropagation();
      },
      true,
    );
  }
  function sync() {
    const app = $('.app-shell');
    if (!mobile.matches || !app) {
      document.body.classList.remove(
        'slm-active',
        'slm-tasks',
        'slm-one-day',
        'slm-three-day',
      );
      return;
    }
    if (!state.mounted) makeShell();
    document.body.classList.add('slm-active');
    document.body.classList.toggle('slm-tasks', state.screen === 'tasks');
    document.body.classList.toggle('slm-one-day', isDay());
    document.body.classList.toggle('slm-three-day', isThree());
    const calendarNav = $("#slm-shell [data-screen='calendar']");
    if (calendarNav) {
      const atToday = isCurrentToday();
      const label = calendarNav.querySelector('.slm-nav-label');
      const icon = calendarNav.querySelector<HTMLElement>('.slm-nav-icon');
      if (label && label.textContent !== (atToday ? 'Calendar' : 'Today'))
        label.textContent = atToday ? 'Calendar' : 'Today';
      if (icon && icon.dataset.today !== String(!atToday)) {
        icon.innerHTML = svg(atToday ? 'calendar' : 'today');
        icon.dataset.today = String(!atToday);
      }
      calendarNav.setAttribute(
        'aria-label',
        atToday ? 'Calendar' : 'Return to today',
      );
    }
    const title = isDay()
      ? currentDate().toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
      : $('.fc-toolbar-title')?.textContent?.trim();
    const value = state.screen === 'tasks' ? 'My Tasks' : title || 'Calendar';
    const heading = $('#slm-current-date');
    if (heading && heading.textContent !== value) heading.textContent = value;
    const active = views.find(([v]) => currentView() === v);
    if (active) {
      const label = $('#slm-view-name');
      if (label && label.textContent !== active[1])
        label.textContent = active[1];
      document
        .querySelectorAll<HTMLElement>('#slm-views [data-view]')
        .forEach((b) => {
          const chosen = b.dataset.view === active[0];
          if (b.classList.contains('is-active') !== chosen)
            b.classList.toggle('is-active', chosen);
          if (b.getAttribute('aria-pressed') !== String(chosen))
            b.setAttribute('aria-pressed', String(chosen));
        });
    }
    if (isDay()) renderDay();
    else if (isThree()) renderThree();
    else {
      const board = $('#slm-dualday');
      if (board) board.hidden = true;
    }
  }
  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  }
  function start() {
    // Keep explicit mobile view preference; day remains the default for a new visitor.
    try {
      if (!localStorage.getItem(VIEW_KEY))
        localStorage.setItem(VIEW_KEY, 'timeGridDay');
    } catch {
      /* local storage is unavailable */
    }
    new MutationObserver(schedule).observe($('#root') || document.body, {
      subtree: true,
      childList: true,
    });
    addEventListener('slm-events-changed', () => {
      state.renderVersion++;
      schedule();
    });
    addEventListener('slm-date-changed', schedule);
    mobile.addEventListener('change', () => {
      const v = mobile.matches
        ? localStorage.getItem(VIEW_KEY) || 'timeGridDay'
        : localStorage.getItem('sl-calendar-view') || 'timeGridWeek';
      bridge()?.calendar?.changeView(v);
      state.screen = 'calendar';
      state.gridKey = '';
      schedule();
    });
    startInput();
    const requested = localStorage.getItem(VIEW_KEY) || 'timeGridDay';
    if (mobile.matches) {
      const desired = requested;
      const api = bridge()?.calendar;
      if (api && api.view.type !== desired) api.changeView(desired);
      else if (!api)
        setTimeout(() => {
          const active = bridge()?.calendar;
          if (active && active.view.type !== desired)
            active.changeView(desired);
          schedule();
        }, 200);
    }
    schedule();
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

export {};
