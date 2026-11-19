import dayGridPlugin from '@fullcalendar/daygrid';
import type { EventDropArg } from '@fullcalendar/core';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent,
} from 'react';

import {
  calendarEventSchema,
  calendarTaskSchema,
  type Calendar,
  type CalendarEvent,
  type CalendarMutation,
  type CalendarTask,
  type EventMutation,
  type TaskMutation,
} from '@dayfront/shared';

import {
  authenticationRequiredEvent,
  createEvent,
  createCalendar,
  createTask,
  deleteEvent,
  deleteCalendar,
  deleteTask,
  getCalendars,
  getAuthSession,
  getEvents,
  getPublicConfig,
  getTaskList,
  getTasks,
  login,
  logout,
  searchEvents,
  updateEvent,
  updateCalendar,
  updateTask,
} from './api.js';
import { EventDialog } from './EventDialog.js';
import type { TimeFormat } from './ClockInput.js';
import { CalendarManager } from './CalendarManager.js';
import { taskCalendarRange } from './calendar-display.js';
import { TaskDialog } from './TaskDialog.js';
import {
  calendarHistory,
  calendarHistoryChangedEvent,
} from './change-history.js';
import {
  DEFAULT_EVENT_COLOR,
  defaultTaskColor,
  P1_TASK_COLOR,
} from './palette.js';
import { applySemanticEventAppearance } from './semantic.js';
import { installCalendarShortcuts } from './keyboard.js';
import { LoginPage } from './LoginPage.js';
import { fuzzyTitleMatch } from './search.js';

const entrySymbols = {
  event: { symbol: '◆', label: 'Event' },
  note: { symbol: '▤', label: 'Note' },
  todo: { symbol: '☑', label: 'Todo' },
} as const;

export function CalendarEntryContent({
  entry,
  timeText,
  onToggle,
}: {
  entry: {
    entryType: 'event' | 'note' | 'todo';
    title: string;
    recurring: boolean;
    completed?: boolean;
  };
  timeText: string;
  onToggle?: () => void;
}) {
  const type = entrySymbols[entry.entryType];
  return (
    <span className="calendar-entry-content">
      {entry.entryType === 'todo' && onToggle && (
        <button
          className={
            'leo-calendar-task-toggle' + (entry.completed ? ' is-done' : '')
          }
          type="button"
          title={entry.completed ? 'Reopen task' : 'Complete task'}
          aria-label={(entry.completed ? 'Reopen ' : 'Complete ') + entry.title}
          aria-pressed={Boolean(entry.completed)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggle();
          }}
        >
          {entry.completed ? '✓' : ''}
        </button>
      )}
      {timeText && <span className="calendar-entry-time">{timeText}</span>}
      <span className="calendar-entry-title">{entry.title}</span>
      <span
        className={`calendar-entry-icon calendar-entry-type calendar-entry-${entry.entryType}`}
        aria-label={type.label}
        title={type.label}
      >
        {entry.entryType === 'note' ? type.symbol : null}
      </span>
      {entry.recurring && (
        <span
          className="calendar-entry-icon calendar-entry-repeat"
          aria-label="Recurring series"
          title="Recurring series"
        >
          ↻
        </span>
      )}
    </span>
  );
}

const fallbackColors = [
  '#5b8def',
  '#53b175',
  '#df8b45',
  '#a978d1',
  '#dc6472',
  '#35a7a0',
];

const defaultSidebarSettings = {
  enabled: true,
  defaultOpen: false,
  showBrand: true,
  showTasks: true,
  showCalendars: true,
};

function colorFor(calendar: Calendar, index: number): string {
  return (
    calendar.color?.slice(0, 7) ??
    fallbackColors[index % fallbackColors.length] ??
    '#5b8def'
  );
}

function entryTextColor(background: string): '#ffffff' | '#090d18' {
  const hex = background.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return '#ffffff';
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  );
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.179 ? '#090d18' : '#ffffff';
}

function localDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function dateFromUrl(): string | undefined {
  const value = new URL(window.location.href).searchParams.get('date');
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function updateUrlDate(value: string) {
  const url = new URL(window.location.href);
  if (url.searchParams.get('date') === value) return;
  url.searchParams.set('date', value);
  window.history.replaceState(window.history.state, '', url);
}

function previousDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function sortedTasks(tasks: readonly CalendarTask[]): CalendarTask[] {
  return [...tasks].sort((left, right) => {
    const leftPriority = left.priority === 0 ? 10 : left.priority;
    const rightPriority = right.priority === 0 ? 10 : right.priority;
    return (
      leftPriority - rightPriority ||
      (left.due ?? left.start ?? '9999').localeCompare(
        right.due ?? right.start ?? '9999',
      ) ||
      left.title.localeCompare(right.title)
    );
  });
}

function taskHierarchy(tasks: readonly CalendarTask[]) {
  const byUid = new Map(tasks.map((task) => [task.uid, task]));
  const parentByUid = new Map<string, string>();
  tasks.forEach((task) => {
    if (task.parentUid && byUid.has(task.parentUid))
      parentByUid.set(task.uid, task.parentUid);
    task.childUids?.forEach((childUid) => {
      if (byUid.has(childUid) && !parentByUid.has(childUid))
        parentByUid.set(childUid, task.uid);
    });
  });
  const childrenByUid = new Map<string, CalendarTask[]>();
  tasks.forEach((task) => {
    const parentUid = parentByUid.get(task.uid);
    if (!parentUid) return;
    const children = childrenByUid.get(parentUid) ?? [];
    children.push(task);
    childrenByUid.set(parentUid, children);
  });
  childrenByUid.forEach((children, uid) =>
    childrenByUid.set(uid, sortedTasks(children)),
  );
  return {
    roots: tasks.filter((task) => !parentByUid.has(task.uid)),
    childrenByUid,
    childUids: new Set(parentByUid.keys()),
  };
}

function taskReleased(
  task: CalendarTask,
  now: number,
  available: readonly CalendarTask[],
): boolean {
  if (task.start && task.startGate !== false) {
    const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(task.start)
      ? new Date(task.start + 'T00:00:00').getTime()
      : new Date(task.start).getTime();
    if (Number.isFinite(timestamp) && timestamp > now) return false;
  }
  return (
    !task.startTaskUid ||
    available.some(
      (candidate) => candidate.uid === task.startTaskUid && candidate.completed,
    )
  );
}

function taskStatusInput(
  task: CalendarTask,
  status: 'needs-action' | 'completed',
): TaskMutation {
  return {
    calendarId: task.calendarId,
    title: task.title,
    ...(task.start ? { start: task.start } : {}),
    ...(task.due ? { due: task.due } : {}),
    allDay: task.allDay,
    ...(task.description ? { description: task.description } : {}),
    status,
    priority: task.priority,
    ...(task.category ? { category: task.category } : {}),
    ...(task.color ? { color: task.color } : {}),
    ...(task.startTaskUid ? { startTaskUid: task.startTaskUid } : {}),
    ...(task.startGate !== undefined ? { startGate: task.startGate } : {}),
    recurrenceRule: task.recurrenceRule ?? null,
    ...(task.recurrenceId
      ? {
          recurrenceId: task.recurrenceId,
          occurrenceStart: task.start ?? task.due,
          recurrenceScope: 'occurrence' as const,
        }
      : {}),
    ...(task.parentUid ? { parentUid: task.parentUid } : {}),
  };
}

function taskDateLabel(task: CalendarTask): string | undefined {
  const value = task.due ?? task.start;
  if (!value) return undefined;
  const key = localDateKey(value);
  const today = localDateKey(new Date().toISOString());
  if (key === today) return 'Today';
  const tomorrow = new Date(`${today}T00:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (key === localDateKey(tomorrow.toISOString())) return 'Tomorrow';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${key}T12:00:00`));
}

function TaskTreeItem({
  task,
  childrenByUid,
  onSelect,
  onToggle,
  updatingIds,
  ancestors = new Set<string>(),
}: {
  task: CalendarTask;
  childrenByUid: ReadonlyMap<string, readonly CalendarTask[]>;
  onSelect: (task: CalendarTask) => void;
  onToggle: (task: CalendarTask, completed: boolean) => void;
  updatingIds: ReadonlySet<string>;
  ancestors?: ReadonlySet<string>;
}) {
  const [subtasksOpen, setSubtasksOpen] = useState(false);
  const children = ancestors.has(task.uid)
    ? []
    : (childrenByUid.get(task.uid) ?? []);
  const nextAncestors = new Set(ancestors).add(task.uid);
  const subtaskListId = `subtasks-${task.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const dateLabel = taskDateLabel(task);
  return (
    <li className={task.completed ? 'is-completed' : ''}>
      <div className="task-list-row">
        {children.length > 0 && (
          <button
            type="button"
            className="subtask-toggle"
            aria-expanded={subtasksOpen}
            aria-controls={subtaskListId}
            aria-label={`${subtasksOpen ? 'Hide' : 'Show'} subtasks for ${task.title}`}
            onClick={() => setSubtasksOpen((open) => !open)}
          >
            <span aria-hidden="true">›</span>
          </button>
        )}
        <span
          className={`task-checkbox-shell${updatingIds.has(task.id) ? ' is-updating' : ''}`}
        >
          <input
            className="task-list-checkbox"
            type="checkbox"
            checked={task.completed}
            disabled={updatingIds.has(task.id)}
            aria-label={`${task.completed ? 'Reopen' : 'Complete'} ${task.title}`}
            onChange={(event) => onToggle(task, event.target.checked)}
          />
        </span>
        <button
          type="button"
          className="task-title-button"
          onClick={() => onSelect(task)}
        >
          <span className="task-copy">
            <span className="task-list-title">{task.title}</span>
            {(dateLabel || children.length > 0) && (
              <span className="task-list-meta">
                {dateLabel && <span>{dateLabel}</span>}
                {children.length > 0 && (
                  <span>
                    {children.length} {children.length === 1 ? 'step' : 'steps'}
                  </span>
                )}
              </span>
            )}
          </span>
          {task.priority > 0 && (
            <span
              className="task-priority"
              style={task.priority === 1 ? { color: P1_TASK_COLOR } : undefined}
              title={`Priority ${task.priority}`}
            >
              P{task.priority}
            </span>
          )}
        </button>
      </div>
      {children.length > 0 && subtasksOpen && (
        <ul className="subtask-list" id={subtaskListId}>
          {children.map((child) => (
            <TaskTreeItem
              task={child}
              childrenByUid={childrenByUid}
              onSelect={onSelect}
              onToggle={onToggle}
              updatingIds={updatingIds}
              ancestors={nextAncestors}
              key={child.id}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function isOnScrollableSurface(
  target: EventTarget | null,
  boundary: HTMLElement,
): boolean {
  if (!(target instanceof Element)) return false;
  let element: Element | null = target;
  while (element) {
    if (element instanceof HTMLElement) {
      const style = window.getComputedStyle(element);
      const scrollsVertically =
        /(auto|scroll)/.test(style.overflowY) &&
        element.scrollHeight > element.clientHeight;
      const scrollsHorizontally =
        /(auto|scroll)/.test(style.overflowX) &&
        element.scrollWidth > element.clientWidth;
      if (scrollsVertically || scrollsHorizontally) return true;
    }
    if (element === boundary) break;
    element = element.parentElement;
  }
  return false;
}

function isOnHorizontallyScrollableSurface(
  target: EventTarget | null,
  boundary: HTMLElement,
): boolean {
  if (!(target instanceof Element)) return false;
  let element: Element | null = target;
  while (element) {
    if (element instanceof HTMLElement) {
      const style = window.getComputedStyle(element);
      const canScroll = /(auto|scroll)/.test(style.overflowX);
      if (canScroll && element.scrollWidth > element.clientWidth + 1)
        return true;
    }
    if (element === boundary) break;
    element = element.parentElement;
  }
  return false;
}

function TaskGroup({
  title,
  tasks,
  childrenByUid,
  onSelect,
  onToggle,
  updatingIds,
}: {
  title: string;
  tasks: readonly CalendarTask[];
  childrenByUid: ReadonlyMap<string, readonly CalendarTask[]>;
  onSelect: (task: CalendarTask) => void;
  onToggle: (task: CalendarTask, completed: boolean) => void;
  updatingIds: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(title !== 'Completed');
  return (
    <details
      className={`task-group task-group-${title.toLowerCase()}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>{title}</span> <span>{tasks.length}</span>
      </summary>
      {tasks.length > 0 && (
        <ul>
          {tasks.map((task) => (
            <TaskTreeItem
              task={task}
              childrenByUid={childrenByUid}
              onSelect={onSelect}
              onToggle={onToggle}
              updatingIds={updatingIds}
              key={task.id}
            />
          ))}
        </ul>
      )}
    </details>
  );
}

export function SearchOverlay({
  calendars,
  onClose,
  onSelect,
}: {
  calendars: readonly Calendar[];
  onClose: () => void;
  onSelect: (event: CalendarEvent) => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fuzzy, setFuzzy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void searchEvents(
      undefined,
      calendars.map((calendar) => calendar.id),
      controller.signal,
    )
      .then(setIndex)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setIndex([]);
      })
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => {
      controller.abort();
    };
  }, [calendars]);
  const colors = useMemo(
    () =>
      new Map(
        calendars.map((calendar, index) => [
          calendar.id,
          colorFor(calendar, index),
        ]),
      ),
    [calendars],
  );
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length < 2) return [];
    return index.filter((event) => {
      const title = event.title.toLocaleLowerCase();
      if (title.includes(needle)) return true;
      return fuzzy && fuzzyTitleMatch(title, needle);
    });
  }, [fuzzy, index, query]);
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') return onClose();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) =>
        results.length
          ? (current + direction + results.length) % results.length
          : 0,
      );
    }
    if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      onSelect(results[activeIndex]);
    }
  }
  return (
    <div className="search-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="search-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Search events"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="search-input-row">
          <span className="search-input-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search events…"
            aria-label="Search events"
          />
          <button type="button" onClick={onClose} aria-label="Close search">
            ×
          </button>
        </div>
        <label className="search-fuzzy-option">
          <input
            type="checkbox"
            checked={fuzzy}
            onChange={(event) => {
              setFuzzy(event.target.checked);
              setActiveIndex(0);
              window.requestAnimationFrame(() => inputRef.current?.focus());
            }}
          />
          Fuzzy matching
        </label>
        <div className="search-results" aria-live="polite">
          {loading ? (
            <p>Searching…</p>
          ) : (
            results.map((event, resultIndex) => (
              <button
                type="button"
                key={`${event.resourceId}-${event.start}`}
                onClick={() => onSelect(event)}
                className={
                  resultIndex === activeIndex ? 'is-active' : undefined
                }
                onMouseEnter={() => setActiveIndex(resultIndex)}
              >
                <span className="search-result-title">
                  <span
                    className="search-result-color"
                    style={{ backgroundColor: colors.get(event.calendarId) }}
                    aria-hidden="true"
                  />
                  <strong>{event.title}</strong>
                </span>
                <span>{event.start.slice(0, 10)}</span>
              </button>
            ))
          )}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <p>No events found.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function CalendarApp({
  username,
  onLogout,
}: {
  username?: string;
  onLogout?: () => void;
}) {
  const calendarRef = useRef<FullCalendar>(null);
  const calendarMainRef = useRef<HTMLElement>(null);
  const wheelDistance = useRef(0);
  const wheelReset = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const touchStart = useRef<{ x: number; y: number; time: number } | undefined>(
    undefined,
  );
  const swipeReset = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const fullscreenFallback = useRef(false);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [loadingCalendars, setLoadingCalendars] = useState(true);
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [editor, setEditor] = useState<{
    event?: CalendarEvent;
    initialDate?: string;
    initialEnd?: string;
  }>();
  const [taskEditor, setTaskEditor] = useState<CalendarTask | null>();
  const [taskEditorReturn, setTaskEditorReturn] = useState<CalendarTask>();
  const [taskInitialDate, setTaskInitialDate] = useState<string>();
  const [taskInitialEnd, setTaskInitialEnd] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [pingResourceId, setPingResourceId] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [calendarControlsOpen, setCalendarControlsOpen] = useState(false);
  const [calendarFullscreen, setCalendarFullscreen] = useState(false);
  const [sidebarSettings, setSidebarSettings] = useState(
    defaultSidebarSettings,
  );
  const [timeFormat, setTimeFormat] = useState<TimeFormat>('12h');
  const [calendarPickerOpen, setCalendarPickerOpen] = useState(false);
  const [taskPickerOpen, setTaskPickerOpen] = useState(true);
  const [calendarManagerOpen, setCalendarManagerOpen] = useState(false);
  const [deletingCompleted, setDeletingCompleted] = useState(false);
  const [updatingTaskIds, setUpdatingTaskIds] = useState<Set<string>>(
    new Set(),
  );
  const [initialCalendarDate] = useState(() => dateFromUrl());
  const [historyStatus, setHistoryStatus] = useState('');
  const [responsiveDayMaxEvents, setResponsiveDayMaxEvents] = useState<
    true | number
  >(true);

  useEffect(() => installCalendarShortcuts(), []);

  useEffect(() => {
    const surface = calendarMainRef.current;
    if (!surface || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = entry.contentRect.width;
      const nextLimit =
        width < 720 ? 0 : width < 980 ? 1 : width < 1240 ? 2 : true;
      setResponsiveDayMaxEvents((current) =>
        current === nextLimit ? current : nextLimit,
      );
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const button = calendarMainRef.current?.querySelector<HTMLButtonElement>(
      '.fc-compactMenu-button',
    );
    button?.setAttribute('aria-expanded', String(calendarControlsOpen));
  }, [calendarControlsOpen]);

  useEffect(() => {
    const syncFullscreenState = () => {
      if (!fullscreenFallback.current)
        setCalendarFullscreen(
          document.fullscreenElement === calendarMainRef.current,
        );
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () =>
      document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  useEffect(() => {
    const navigateFromHistory = () => {
      const date = dateFromUrl();
      if (date) calendarRef.current?.getApi().gotoDate(date);
    };
    window.addEventListener('popstate', navigateFromHistory);
    return () => window.removeEventListener('popstate', navigateFromHistory);
  }, []);

  useEffect(() => {
    void getPublicConfig()
      .then((config) => {
        document.documentElement.dataset.theme = config.ui.darkMode;
        setTimeFormat(config.ui.timeFormat);
        setSidebarSettings(config.ui.sidebar);
        setSidebarOpen(
          config.ui.sidebar.enabled && config.ui.sidebar.defaultOpen,
        );
        const views = {
          month: 'dayGridMonth',
          week: 'timeGridWeek',
          day: 'timeGridDay',
          agenda: 'listMonth',
        };
        // A saved view always wins over server defaults.
        try {
          const mobile = window.matchMedia('(max-width:720px)').matches;
          if (
            !localStorage.getItem(
              mobile ? 'sl-mobile-view' : 'sl-calendar-view',
            )
          )
            calendarRef.current
              ?.getApi()
              .changeView(views[config.ui.defaultView]);
        } catch {
          calendarRef.current
            ?.getApi()
            .changeView(views[config.ui.defaultView]);
        }
      })
      .catch(() => {
        document.documentElement.dataset.theme = 'auto';
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getCalendars(controller.signal)
      .then((items) => {
        setCalendars(items);
        setSelected(new Set(items.map((calendar) => calendar.id)));
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError')
          return;
        setError('DayFront could not load calendars from the CalDAV server.');
      })
      .finally(() => setLoadingCalendars(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    calendarRef.current?.getApi().refetchEvents();
  }, [selected]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setLoadingTasks(true);
    });
    void getTaskList([...selected], controller.signal)
      .then(setTasks)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError'))
          setError(
            'DayFront could not load the task list from the CalDAV server.',
          );
      })
      .finally(() => setLoadingTasks(false));
    return () => controller.abort();
  }, [selected]);

  useEffect(() => {
    // Re-evaluate task start gates at their next release and when the tab becomes visible.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const releaseTimes = tasks
      .filter((task) => task.start && task.startGate !== false)
      .map((task) =>
        /^\d{4}-\d{2}-\d{2}$/.test(task.start!)
          ? new Date(task.start! + 'T00:00:00').getTime()
          : new Date(task.start!).getTime(),
      )
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    function schedule() {
      const now = Date.now();
      const next = releaseTimes.find((timestamp) => timestamp > now);
      if (next !== undefined)
        timer = setTimeout(
          () => {
            calendarRef.current?.getApi().refetchEvents();
            schedule();
          },
          Math.max(100, Math.min(next - now + 500, 2_147_480_000)),
        );
    }
    const visibility = () => {
      if (document.visibilityState === 'visible') {
        calendarRef.current?.getApi().refetchEvents();
      }
    };
    schedule();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [tasks]);

  useEffect(() => {
    const refresh = () => {
      void getTaskList([...selected])
        .then(setTasks)
        .catch(() => undefined);
      calendarRef.current?.getApi().refetchEvents();
      setHistoryStatus(
        calendarHistory.canUndo ? 'Calendar change recorded' : 'Change applied',
      );
    };
    const failure = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === 'string')
        setHistoryStatus(event.detail);
    };
    const keydown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        key !== 'z' ||
        !(event.ctrlKey !== event.metaKey) ||
        !(event.ctrlKey || event.metaKey)
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable], [role="textbox"]',
        ) ||
        document.querySelector('[role="dialog"],.dialog-backdrop')
      )
        return;
      if (event.shiftKey ? !calendarHistory.canRedo : !calendarHistory.canUndo)
        return;
      event.preventDefault();
      if (event.shiftKey) void calendarHistory.redo();
      else void calendarHistory.undo();
    };
    window.addEventListener(calendarHistoryChangedEvent, refresh);
    window.addEventListener('sl-history-error', failure);
    window.addEventListener('keydown', keydown, true);
    return () => {
      window.removeEventListener(calendarHistoryChangedEvent, refresh);
      window.removeEventListener('sl-history-error', failure);
      window.removeEventListener('keydown', keydown, true);
    };
  }, [selected]);

  useEffect(() => {
    function handleDateHeaderClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const header = target?.closest(
        '.fc-col-header-cell[data-date],.fc-daygrid-day-top',
      );
      const date =
        header?.getAttribute('data-date') ??
        header?.closest('[data-date]')?.getAttribute('data-date');
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      event.preventDefault();
      event.stopPropagation();
      setTaskInitialDate(date);
      setTaskInitialEnd(undefined);
      setTaskEditorReturn(undefined);
      setTaskEditor(null);
    }
    document.addEventListener('click', handleDateHeaderClick, true);
    return () =>
      document.removeEventListener('click', handleDateHeaderClick, true);
  }, []);

  const today = localDateKey(new Date().toISOString());
  const hierarchy = taskHierarchy(tasks);
  const activeTasks = sortedTasks(
    hierarchy.roots.filter(
      (task) =>
        !task.completed &&
        task.status !== 'cancelled' &&
        taskReleased(task, Date.now(), tasks),
    ),
  );
  const completedTasks = sortedTasks(
    hierarchy.roots.filter(
      (task) => task.completed || task.status === 'cancelled',
    ),
  );
  const taskGroups = {
    Overdue: activeTasks.filter((task) => {
      const date = task.due ?? task.start;
      return date ? localDateKey(date) < today : false;
    }),
    Today: activeTasks.filter((task) => {
      const date = task.due ?? task.start;
      return date ? localDateKey(date) === today : false;
    }),
    Upcoming: activeTasks.filter((task) => {
      const date = task.due ?? task.start;
      return date ? localDateKey(date) > today : false;
    }),
    Completed: sortedTasks(
      hierarchy.roots.filter(
        (task) => task.completed || task.status === 'cancelled',
      ),
    ),
    Undated: activeTasks.filter((task) => !task.due && !task.start),
  };

  const loadEvents = useCallback(
    async (
      info: { start: Date; end: Date },
      success: (events: object[]) => void,
      failure: (error: Error) => void,
    ) => {
      try {
        const range = {
          start: info.start,
          end: info.end,
          calendarIds: [...selected],
        };
        const [events, tasksInRange] = await Promise.all([
          getEvents(range),
          getTasks(range),
        ]);
        const colors = new Map(
          calendars.map((calendar, index) => [
            calendar.id,
            colorFor(calendar, index),
          ]),
        );
        const calendarEntries: object[] = events.map((event: CalendarEvent) => {
          const color =
            event.color ?? colors.get(event.calendarId) ?? DEFAULT_EVENT_COLOR;
          return {
            id: event.id,
            title: event.title,
            start: event.start,
            end: event.end,
            allDay: event.allDay,
            backgroundColor: color,
            borderColor: color,
            textColor: entryTextColor(color),
            editable: !event.readOnly,
            startEditable: !event.readOnly,
            durationEditable: false,
            classNames: [
              ...(event.category ? ['sl-palette-' + event.category] : []),
              ...(new Date(event.end ?? event.start).getTime() <= Date.now()
                ? ['leo-past-event']
                : []),
            ],
            extendedProps: event,
          };
        });
        const linkedChildren = new Set(
          tasksInRange.flatMap((task) => task.childUids ?? []),
        );
        calendarEntries.push(
          ...tasksInRange.flatMap((task) => {
            if (
              task.parentUid ||
              linkedChildren.has(task.uid) ||
              task.completed ||
              !taskReleased(task, Date.now(), [...tasks, ...tasksInRange])
            )
              return [];
            const range = taskCalendarRange(task);
            if (!range) return [];
            const color = defaultTaskColor(task.priority, task.color);
            return [
              {
                id: `task-${task.id}`,
                title: task.title,
                ...range,
                allDay: task.allDay,
                backgroundColor: color,
                borderColor: color,
                textColor: entryTextColor(color),
                editable: true,
                startEditable: true,
                durationEditable: false,
                classNames: [
                  'task-entry',
                  ...(task.category ? ['sl-palette-' + task.category] : []),
                ],
                extendedProps: { ...task, entryType: 'todo' as const },
              },
            ];
          }),
        );
        success(calendarEntries);
        setError(undefined);
      } catch (reason: unknown) {
        const eventError =
          reason instanceof Error ? reason : new Error('Event loading failed.');
        setError('DayFront could not load events for this date range.');
        failure(eventError);
      }
    },
    [calendars, selected, tasks],
  );

  function toggleCalendar(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function moveCalendarEntry(info: EventDropArg) {
    const taskResult = calendarTaskSchema.safeParse(info.event.extendedProps);
    const eventResult = calendarEventSchema.safeParse(info.event.extendedProps);
    try {
      if (taskResult.success) {
        const task = taskResult.data;
        const movedStart = task.allDay
          ? info.event.startStr.slice(0, 10)
          : info.event.start?.toISOString();
        if (!movedStart) throw new Error('Dropped task has no start.');
        const movedEnd = task.allDay
          ? info.event.endStr
            ? previousDate(info.event.endStr)
            : undefined
          : info.event.end?.toISOString();
        await updateTask(task.resourceId, task.version, {
          calendarId: task.calendarId,
          title: task.title,
          ...(task.start ? { start: movedStart } : {}),
          ...(task.due
            ? { due: task.start && movedEnd ? movedEnd : movedStart }
            : {}),
          allDay: task.allDay,
          ...(task.description ? { description: task.description } : {}),
          status: task.status,
          priority: task.priority,
          ...(task.category ? { category: task.category } : {}),
          ...(task.color ? { color: task.color } : {}),
          ...(task.startTaskUid ? { startTaskUid: task.startTaskUid } : {}),
          ...(task.startGate !== undefined
            ? { startGate: task.startGate }
            : {}),
          recurrenceRule: task.recurrenceRule ?? null,
          ...(task.recurrenceId
            ? {
                recurrenceId: task.recurrenceId,
                occurrenceStart: task.start ?? task.due,
                recurrenceScope: 'occurrence' as const,
              }
            : {}),
          ...(task.parentUid ? { parentUid: task.parentUid } : {}),
        });
        await refreshTasks();
      } else if (eventResult.success && !eventResult.data.readOnly) {
        const event = eventResult.data;
        const movedStart = event.allDay
          ? info.event.startStr.slice(0, 10)
          : info.event.start?.toISOString();
        if (!movedStart) throw new Error('Dropped event has no start.');
        const movedEnd = event.allDay
          ? info.event.endStr
            ? info.event.endStr.slice(0, 10)
            : undefined
          : info.event.end?.toISOString();
        await updateEvent(event.resourceId, event.version, {
          calendarId: event.calendarId,
          title: event.title,
          start: movedStart,
          ...(movedEnd ? { end: movedEnd } : {}),
          allDay: event.allDay,
          ...(event.description ? { description: event.description } : {}),
          ...(event.location ? { location: event.location } : {}),
          ...(event.category ? { category: event.category } : {}),
          ...(event.color ? { color: event.color } : {}),
          recurrenceRule: event.recurrenceRule ?? null,
          ...(event.recurrenceId
            ? {
                recurrenceId: event.recurrenceId,
                occurrenceStart: event.start,
                recurrenceScope: 'occurrence' as const,
              }
            : {}),
        });
        calendarRef.current?.getApi().refetchEvents();
      } else {
        info.revert();
      }
      setError(undefined);
    } catch {
      info.revert();
      setError(
        'The entry could not be moved. It may have changed on the CalDAV server; the calendar has been refreshed.',
      );
      await refreshTasks().catch(() => undefined);
      calendarRef.current?.getApi().refetchEvents();
    }
  }

  async function saveEvent(input: EventMutation) {
    if (editor?.event) {
      await updateEvent(editor.event.resourceId, editor.event.version, input);
    } else {
      await createEvent(input);
    }
    setEditor(undefined);
    calendarRef.current?.getApi().refetchEvents();
  }

  async function removeEvent(scope: 'series' | 'occurrence') {
    if (!editor?.event) return;
    await deleteEvent(
      editor.event.resourceId,
      editor.event.version,
      scope === 'occurrence' && editor.event.recurrenceId
        ? { recurrenceId: editor.event.recurrenceId }
        : undefined,
    );
    setEditor(undefined);
    calendarRef.current?.getApi().refetchEvents();
  }

  async function refreshTasks() {
    setTasks(await getTaskList([...selected]));
    calendarRef.current?.getApi().refetchEvents();
  }

  async function refreshCalendars(preferredId?: string) {
    const items = await getCalendars();
    const validIds = new Set(items.map((calendar) => calendar.id));
    const nextSelected = new Set(
      [...selected].filter((id) => validIds.has(id)),
    );
    if (preferredId && validIds.has(preferredId)) nextSelected.add(preferredId);
    setCalendars(items);
    setSelected(nextSelected);
    setTasks(nextSelected.size > 0 ? await getTaskList([...nextSelected]) : []);
    calendarRef.current?.getApi().refetchEvents();
  }

  async function saveCalendar(
    calendar: Calendar | undefined,
    input: CalendarMutation,
  ) {
    const saved = calendar
      ? await updateCalendar(calendar.id, input)
      : await createCalendar(input);
    await refreshCalendars(saved.id);
  }

  async function removeCalendar(calendar: Calendar) {
    await deleteCalendar(calendar.id);
    await refreshCalendars();
  }

  function descendantsOf(task: CalendarTask): CalendarTask[] {
    const descendants: CalendarTask[] = [];
    const seen = new Set([task.uid]);
    const pending = [...(hierarchy.childrenByUid.get(task.uid) ?? [])];
    while (pending.length > 0) {
      const child = pending.shift();
      if (!child || seen.has(child.uid)) continue;
      seen.add(child.uid);
      descendants.push(child);
      pending.push(...(hierarchy.childrenByUid.get(child.uid) ?? []));
    }
    return descendants;
  }

  async function completeDescendants(task: CalendarTask): Promise<number> {
    const incomplete = descendantsOf(task).filter((child) => !child.completed);
    const results = await Promise.allSettled(
      incomplete.map((child) =>
        updateTask(
          child.resourceId,
          child.version,
          taskStatusInput(child, 'completed'),
        ),
      ),
    );
    return results.filter((result) => result.status === 'rejected').length;
  }

  async function saveTask(input: TaskMutation, subtasks: readonly string[]) {
    const returnEditor = taskEditorReturn;
    let failedCompletions = 0;
    let failedMoves = 0;
    if (taskEditor) {
      await updateTask(taskEditor.resourceId, taskEditor.version, input);
      if (input.calendarId !== taskEditor.calendarId) {
        const results = await Promise.allSettled(
          descendantsOf(taskEditor).map((child) =>
            updateTask(child.resourceId, child.version, {
              calendarId: input.calendarId,
              title: child.title,
              ...(child.start ? { start: child.start } : {}),
              ...(child.due ? { due: child.due } : {}),
              allDay: child.allDay,
              ...(child.description ? { description: child.description } : {}),
              status: input.status === 'completed' ? 'completed' : child.status,
              priority: child.priority,
              ...(child.category ? { category: child.category } : {}),
              ...(child.color ? { color: child.color } : {}),
              ...(child.startTaskUid
                ? { startTaskUid: child.startTaskUid }
                : {}),
              ...(child.startGate !== undefined
                ? { startGate: child.startGate }
                : {}),
              recurrenceRule: child.recurrenceRule ?? null,
              ...(child.parentUid ? { parentUid: child.parentUid } : {}),
            }),
          ),
        );
        failedMoves = results.filter(
          (result) => result.status === 'rejected',
        ).length;
      }
      if (
        input.calendarId === taskEditor.calendarId &&
        input.status === 'completed' &&
        !taskEditor.completed
      )
        failedCompletions = await completeDescendants(taskEditor);
    } else {
      const parent = await createTask(input);
      const results = await Promise.allSettled(
        subtasks.map((title) =>
          createTask({
            calendarId: parent.calendarId,
            title,
            allDay: true,
            status: 'needs-action',
            priority: 0,
            recurrenceRule: null,
            parentUid: parent.uid,
          }),
        ),
      );
      const failed = results.filter((result) => result.status === 'rejected');
      if (failed.length > 0)
        setError(
          `The task was created, but ${failed.length} subtask${failed.length === 1 ? '' : 's'} could not be saved.`,
        );
    }
    if (failedCompletions > 0)
      setError(
        `The task was completed, but ${failedCompletions} subtask${failedCompletions === 1 ? '' : 's'} could not be completed.`,
      );
    if (failedMoves > 0)
      setError(
        `The task was moved, but ${failedMoves} subtask${failedMoves === 1 ? '' : 's'} could not be moved.`,
      );
    await refreshTasks();
    setTaskEditor(returnEditor);
    setTaskEditorReturn(undefined);
  }

  async function addSubtask(title: string) {
    if (!taskEditor) return;
    await createTask({
      calendarId: taskEditor.calendarId,
      title,
      allDay: true,
      status: 'needs-action',
      priority: 0,
      recurrenceRule: null,
      parentUid: taskEditor.uid,
    });
    await refreshTasks();
  }

  async function removeSubtask(task: CalendarTask) {
    await deleteTaskTree(task);
    await refreshTasks();
  }

  async function deleteTaskTree(
    task: CalendarTask,
    occurrence?: { recurrenceId: string },
  ) {
    if (!occurrence) {
      // CalDAV stores every subtask as its own resource. Delete descendants
      // from the leaves upward so no orphaned children remain.
      for (const descendant of descendantsOf(task).reverse())
        await deleteTask(descendant.resourceId, descendant.version);
    }
    await deleteTask(task.resourceId, task.version, occurrence);
  }

  async function removeTask(scope: 'series' | 'occurrence') {
    if (!taskEditor) return;
    const returnEditor = taskEditorReturn;
    await deleteTaskTree(
      taskEditor,
      scope === 'occurrence' && taskEditor.recurrenceId
        ? { recurrenceId: taskEditor.recurrenceId }
        : undefined,
    );
    await refreshTasks();
    setTaskEditor(returnEditor);
    setTaskEditorReturn(undefined);
  }

  async function toggleSubtask(task: CalendarTask, completed: boolean) {
    if (updatingTaskIds.has(task.id)) return;
    setUpdatingTaskIds((current) => new Set(current).add(task.id));
    try {
      await updateTask(
        task.resourceId,
        task.version,
        taskStatusInput(task, completed ? 'completed' : 'needs-action'),
      );
      if (completed) {
        const failed = await completeDescendants(task);
        if (failed > 0)
          setError(
            `The task was completed, but ${failed} subtask${failed === 1 ? '' : 's'} could not be completed.`,
          );
      }
      await refreshTasks();
    } catch {
      setError(
        `The subtask “${task.title}” could not be updated. The task list has been refreshed.`,
      );
      await refreshTasks();
    } finally {
      setUpdatingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  async function removeCompletedTasks() {
    const completed = completedTasks;
    if (completed.length === 0 || deletingCompleted) return;
    if (
      !window.confirm(
        `Permanently delete ${completed.length} completed ${completed.length === 1 ? 'task' : 'tasks'} and all of their subtasks? This cannot be undone.`,
      )
    )
      return;

    setDeletingCompleted(true);
    setError(undefined);
    const unique = new Map<string, CalendarTask>();
    completed.forEach((task) => {
      [...descendantsOf(task)].reverse().forEach((descendant) => {
        unique.set(
          `${descendant.resourceId}:${descendant.recurrenceId ?? 'series'}`,
          descendant,
        );
      });
      unique.set(`${task.resourceId}:${task.recurrenceId ?? 'series'}`, task);
    });
    try {
      for (const task of unique.values()) {
        await deleteTask(
          task.resourceId,
          task.version,
          task.recurrenceId ? { recurrenceId: task.recurrenceId } : undefined,
        );
      }
    } catch {
      setError(
        'Some completed tasks could not be deleted. The task list has been refreshed.',
      );
    } finally {
      setDeletingCompleted(false);
      await refreshTasks();
    }
  }

  function navigateWithWheel(event: WheelEvent<HTMLElement>) {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isOnScrollableSurface(event.target, event.currentTarget) ||
      (event.target instanceof Element &&
        event.target.closest(
          'button, input, select, textarea, a, [role="dialog"]',
        ))
    )
      return;

    const movement =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
    if (movement === 0) return;
    event.preventDefault();
    wheelDistance.current += movement;
    clearTimeout(wheelReset.current);
    wheelReset.current = setTimeout(() => {
      wheelDistance.current = 0;
    }, 180);
    if (Math.abs(wheelDistance.current) < 40) return;
    const calendar = calendarRef.current?.getApi();
    if (wheelDistance.current > 0) calendar?.next();
    else calendar?.prev();
    wheelDistance.current = 0;
  }

  function beginTouchNavigation(event: ReactTouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    const target = event.target instanceof Element ? event.target : null;
    if (
      event.touches.length !== 1 ||
      !touch ||
      target?.closest(
        'button, input, select, textarea, .fc-event, .fc-popover',
      ) ||
      isOnHorizontallyScrollableSurface(event.target, event.currentTarget)
    ) {
      touchStart.current = undefined;
      return;
    }
    touchStart.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
    clearTimeout(swipeReset.current);
    event.currentTarget.classList.remove('is-swipe-settling');
    event.currentTarget.classList.add('is-swipe-tracking');
    event.currentTarget.style.setProperty('--calendar-swipe-x', '0px');
  }

  function moveTouchNavigation(event: ReactTouchEvent<HTMLElement>) {
    const start = touchStart.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    const horizontal = touch.clientX - start.x;
    const vertical = touch.clientY - start.y;
    if (Math.abs(horizontal) <= Math.abs(vertical) || Math.abs(horizontal) < 6)
      return;
    const offset = Math.max(-48, Math.min(48, horizontal * 0.24));
    event.currentTarget.style.setProperty('--calendar-swipe-x', `${offset}px`);
  }

  function settleTouchNavigation(surface: HTMLElement) {
    surface.classList.remove('is-swipe-tracking');
    surface.classList.add('is-swipe-settling');
    requestAnimationFrame(() =>
      surface.style.setProperty('--calendar-swipe-x', '0px'),
    );
    clearTimeout(swipeReset.current);
    swipeReset.current = setTimeout(
      () => surface.classList.remove('is-swipe-settling'),
      200,
    );
  }

  async function toggleCalendarFullscreen() {
    const surface = calendarMainRef.current;
    if (!surface) return;
    if (calendarFullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        fullscreenFallback.current = false;
        setCalendarFullscreen(false);
      }
      return;
    }
    if (surface.requestFullscreen) {
      try {
        await surface.requestFullscreen();
        return;
      } catch {
        // Fall through to a CSS viewport mode on unsupported mobile browsers.
      }
    }
    fullscreenFallback.current = true;
    setCalendarFullscreen(true);
  }

  function finishTouchNavigation(event: ReactTouchEvent<HTMLElement>) {
    const start = touchStart.current;
    const touch = event.changedTouches[0];
    touchStart.current = undefined;
    if (!start || !touch || Date.now() - start.time > 700) {
      settleTouchNavigation(event.currentTarget);
      return;
    }
    const horizontal = touch.clientX - start.x;
    const vertical = touch.clientY - start.y;
    if (
      Math.abs(horizontal) < 50 ||
      Math.abs(horizontal) < Math.abs(vertical) * 1.25
    ) {
      settleTouchNavigation(event.currentTarget);
      return;
    }
    const calendar = calendarRef.current?.getApi();
    if (horizontal < 0) calendar?.next();
    else calendar?.prev();
    settleTouchNavigation(event.currentTarget);
  }

  const sidebarVisible = sidebarSettings.enabled && sidebarOpen;

  return (
    <div className={`app-shell${sidebarVisible ? '' : ' sidebar-collapsed'}`}>
      {sidebarSettings.enabled && (
        <aside className="sidebar" id="sidebar" hidden={!sidebarOpen}>
          <div className="sidebar-scroll-region">
            {sidebarSettings.showBrand && (
              <header className="brand">
                <img
                  className="mark"
                  src="/sl-calendar-icon.png"
                  alt=""
                  aria-hidden="true"
                />
                <div>
                  <p className="eyebrow">
                    Own your day.
                    <br />
                    Own your data.
                  </p>
                  <h1>SL Calendar</h1>
                </div>
              </header>
            )}

            {sidebarSettings.showCalendars && calendars.length > 1 && (
              <details
                className="calendar-picker"
                open={calendarPickerOpen}
                onToggle={(event) =>
                  setCalendarPickerOpen(event.currentTarget.open)
                }
              >
                <summary className="picker-summary">
                  <h2 id="calendar-heading">Calendars</h2>
                  {!loadingCalendars && (
                    <span>
                      {selected.size}/{calendars.length}
                    </span>
                  )}
                </summary>
                {loadingCalendars && (
                  <p className="muted">Discovering calendars…</p>
                )}
                {!loadingCalendars && calendars.length === 0 && (
                  <p className="muted">No event calendars were found.</p>
                )}
                <div className="calendar-list">
                  {calendars.map((calendar, index) => (
                    <label className="calendar-option" key={calendar.id}>
                      <input
                        type="checkbox"
                        checked={selected.has(calendar.id)}
                        onChange={() => toggleCalendar(calendar.id)}
                      />
                      <span
                        className="calendar-color"
                        style={{ backgroundColor: colorFor(calendar, index) }}
                        aria-hidden="true"
                      />
                      <span>{calendar.displayName}</span>
                      {calendar.readOnly && (
                        <span
                          className="calendar-readonly"
                          aria-label="Read-only calendar"
                          title="Read-only calendar"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                            <circle cx="12" cy="12" r="2.75" />
                          </svg>
                        </span>
                      )}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="manage-calendars-button"
                  onClick={() => setCalendarManagerOpen(true)}
                >
                  Manage calendars
                </button>
              </details>
            )}
            {sidebarSettings.showTasks && (
              <details
                className="task-list"
                open={taskPickerOpen}
                onToggle={(event) =>
                  setTaskPickerOpen(event.currentTarget.open)
                }
              >
                <summary className="picker-summary">
                  <h2 id="task-list-heading">Tasks</h2>
                </summary>
                {!loadingTasks && tasks.length > 0 && (
                  <div className="task-overview">
                    <div className="task-overview-heading">
                      <div>
                        <span className="task-overview-kicker">Your focus</span>
                        <strong>
                          {taskGroups.Overdue.length + taskGroups.Today.length}{' '}
                          due now
                        </strong>
                      </div>
                      <span className="task-overview-score">
                        {completedTasks.length}/{hierarchy.roots.length}
                      </span>
                    </div>
                    <div
                      className="task-progress"
                      aria-label={`${completedTasks.length} of ${hierarchy.roots.length} tasks completed`}
                    >
                      <span
                        style={{
                          width: `${hierarchy.roots.length ? (completedTasks.length / hierarchy.roots.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                <div className="task-actions">
                  <button
                    type="button"
                    className="task-action primary-task-action"
                    onClick={() => {
                      setTaskInitialDate(undefined);
                      setTaskInitialEnd(undefined);
                      setTaskEditorReturn(undefined);
                      setTaskEditor(null);
                    }}
                  >
                    <span aria-hidden="true">＋</span>
                    New task
                  </button>
                  {completedTasks.length > 0 && (
                    <button
                      type="button"
                      className="task-action clear-task-action"
                      aria-label="Clear completed"
                      disabled={deletingCompleted}
                      onClick={() => void removeCompletedTasks()}
                    >
                      <svg
                        className="task-action-icon"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path d="M8.5 4.5h7M5.5 7.5h13M9 7.5v11m6-11v11M7 7.5l.7 12h8.6l.7-12M10 4.5l.5-1h3l.5 1" />
                      </svg>
                      {deletingCompleted ? 'Deleting…' : 'Completed'}
                    </button>
                  )}
                </div>
                {loadingTasks ? (
                  <p className="muted">Loading tasks…</p>
                ) : (
                  Object.entries(taskGroups).map(([title, items]) => (
                    <TaskGroup
                      title={title}
                      tasks={items}
                      childrenByUid={hierarchy.childrenByUid}
                      updatingIds={updatingTaskIds}
                      onToggle={(task, completed) =>
                        void toggleSubtask(task, completed)
                      }
                      onSelect={(task) => {
                        setTaskInitialDate(undefined);
                        setTaskInitialEnd(undefined);
                        setTaskEditorReturn(undefined);
                        setTaskEditor(task);
                      }}
                      key={title}
                    />
                  ))
                )}
              </details>
            )}
          </div>
          {onLogout && (
            <div className="account-menu">
              <span title={username}>{username}</span>
              <button type="button" onClick={onLogout}>
                Sign out
              </button>
            </div>
          )}
        </aside>
      )}

      {historyStatus && (
        <span role="status" className="sl-history-status" aria-live="polite">
          {historyStatus}
        </span>
      )}
      <main
        className={`calendar-main${calendarControlsOpen ? ' calendar-controls-open' : ''}${calendarFullscreen ? ' calendar-is-fullscreen' : ''}`}
        ref={calendarMainRef}
        onWheel={navigateWithWheel}
        onTouchStart={beginTouchNavigation}
        onTouchMove={moveTouchNavigation}
        onTouchEnd={finishTouchNavigation}
        onTouchCancel={(event) => {
          touchStart.current = undefined;
          settleTouchNavigation(event.currentTarget);
        }}
      >
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button
              type="button"
              onClick={() => calendarRef.current?.getApi().refetchEvents()}
            >
              Retry
            </button>
          </div>
        )}
        <FullCalendar
          ref={calendarRef}
          {...(initialCalendarDate ? { initialDate: initialCalendarDate } : {})}
          plugins={[
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            interactionPlugin,
          ]}
          views={{
            timeGridThreeDay: {
              type: 'timeGrid',
              visibleRange: (current: Date) => {
                const start = new Date(current);
                start.setHours(0, 0, 0, 0);
                start.setDate(start.getDate() - 1);
                const end = new Date(start);
                end.setDate(end.getDate() + 3);
                return { start, end };
              },
              buttonText: '3 Days',
            },
            timeGridFourDay: {
              type: 'timeGrid',
              visibleRange: (current: Date) => {
                const start = new Date(current);
                start.setHours(0, 0, 0, 0);
                start.setDate(start.getDate() - 1);
                const end = new Date(start);
                end.setDate(end.getDate() + 4);
                return { start, end };
              },
              buttonText: '4 Days',
            },
          }}
          initialView={(() => {
            try {
              const mobile = window.matchMedia('(max-width:720px)').matches;
              const saved = localStorage.getItem(
                mobile ? 'sl-mobile-view' : 'sl-calendar-view',
              );
              const allowed = [
                'dayGridMonth',
                'timeGridWeek',
                'timeGridThreeDay',
                'timeGridFourDay',
                'timeGridDay',
                'listMonth',
              ];
              return saved && allowed.includes(saved)
                ? saved
                : mobile
                  ? 'timeGridDay'
                  : 'timeGridWeek';
            } catch {
              return 'timeGridWeek';
            }
          })()}
          customButtons={{
            prev: {
              icon: 'chevron-left',
              hint: 'Previous',
              click: () => {
                const api = calendarRef.current?.getApi();
                if (!api) return;
                if (api.view.type === 'timeGridThreeDay') {
                  const d = api.getDate();
                  d.setDate(d.getDate() - 3);
                  api.gotoDate(d);
                } else if (api.view.type === 'timeGridFourDay') {
                  const d = new Date(api.view.activeStart);
                  d.setDate(d.getDate() - 3);
                  api.gotoDate(d);
                } else api.prev();
              },
            },
            next: {
              icon: 'chevron-right',
              hint: 'Next',
              click: () => {
                const api = calendarRef.current?.getApi();
                if (!api) return;
                if (api.view.type === 'timeGridThreeDay') {
                  const d = api.getDate();
                  d.setDate(d.getDate() + 3);
                  api.gotoDate(d);
                } else if (api.view.type === 'timeGridFourDay') {
                  const d = new Date(api.view.activeStart);
                  d.setDate(d.getDate() + 5);
                  api.gotoDate(d);
                } else api.next();
              },
            },
            quickEvent: {
              text: '',
              hint: 'New event',
              click: () =>
                setEditor({
                  initialDate: localDateKey(new Date().toISOString()),
                }),
            },
            quickTask: {
              text: '',
              hint: 'New task',
              click: () => {
                setTaskInitialDate(undefined);
                setTaskInitialEnd(undefined);
                setTaskEditorReturn(undefined);
                setTaskEditor(null);
              },
            },
            fullScreen: {
              text: '',
              hint: calendarFullscreen
                ? 'Exit fullscreen calendar'
                : 'Open fullscreen calendar',
              click: () => void toggleCalendarFullscreen(),
            },
            compactMenu: {
              text: '☰',
              hint: calendarControlsOpen
                ? 'Hide calendar controls'
                : 'Show calendar controls',
              click: () => setCalendarControlsOpen((open) => !open),
            },
            sidebarToggle: {
              text: sidebarOpen ? 'Hide sidebar' : 'Show sidebar',
              hint: sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar',
              click: () => setSidebarOpen((open) => !open),
            },
            signOut: {
              text: '',
              hint: 'Sign out',
              click: () => onLogout?.(),
            },
            search: {
              text: '',
              hint: 'Search events',
              click: () => setSearchOpen(true),
            },
          }}
          headerToolbar={{
            left: sidebarSettings.enabled
              ? 'fullScreen search compactMenu sidebarToggle prev,next today'
              : 'fullScreen search compactMenu prev,next today',
            center: 'title',
            right: `dayGridMonth,timeGridWeek,timeGridFourDay,timeGridDay,listMonth${onLogout && !sidebarVisible ? ' signOut' : ''}`,
          }}
          buttonText={{
            today: 'Today',
            month: 'Month',
            week: 'Week',
            day: 'Day',
            list: 'Agenda',
            timeGridFourDay: '4 Days',
            timeGridThreeDay: '3 Days',
          }}
          eventTimeFormat={{
            hour: '2-digit',
            minute: '2-digit',
            hour12: timeFormat === '12h',
          }}
          slotLabelFormat={{
            hour: '2-digit',
            minute: '2-digit',
            hour12: timeFormat === '12h',
          }}
          events={loadEvents}
          datesSet={(info) => {
            updateUrlDate(
              localDateKey(info.view.calendar.getDate().toISOString()),
            );
            try {
              const mobile = window.matchMedia('(max-width:720px)').matches;
              localStorage.setItem(
                mobile ? 'sl-mobile-view' : 'sl-calendar-view',
                info.view.type,
              );
            } catch {
              /* private browsing may disable storage */
            }
            (
              window as unknown as { slMobileCalendar?: unknown }
            ).slMobileCalendar = {
              calendar: info.view.calendar,
              createEvent: (start: string, end?: string) =>
                setEditor({
                  initialDate: start,
                  ...(end ? { initialEnd: end } : {}),
                }),
              createTask: (due: string) => {
                setTaskInitialDate(due);
                setTaskInitialEnd(undefined);
                setTaskEditorReturn(undefined);
                setTaskEditor(null);
              },
              openEntry: (entry: unknown) => {
                const payload =
                  entry && typeof entry === 'object' && 'extendedProps' in entry
                    ? entry.extendedProps
                    : entry;
                const task = calendarTaskSchema.safeParse(payload);
                if (task.success) {
                  setTaskEditor(task.data);
                  return;
                }
                const ev = calendarEventSchema.safeParse(payload);
                if (ev.success && !ev.data.readOnly)
                  setEditor({ event: ev.data });
              },
            };
            window.dispatchEvent(new Event('slm-date-changed'));
          }}
          eventsSet={() =>
            window.dispatchEvent(new Event('slm-events-changed'))
          }
          eventDidMount={(info) => {
            const task = calendarTaskSchema.safeParse(info.event.extendedProps);
            const event = calendarEventSchema.safeParse(
              info.event.extendedProps,
            );
            const entry = task.success
              ? task.data
              : event.success
                ? event.data
                : undefined;
            if (!entry) return;
            applySemanticEventAppearance(info.el, entry);
            if (entry.color || (task.success && task.data.priority === 1)) {
              const color = task.success
                ? defaultTaskColor(task.data.priority, task.data.color)
                : event.success
                  ? event.data.color
                  : undefined;
              if (color) {
                info.el.style.setProperty(
                  'background-color',
                  color,
                  'important',
                );
                info.el.style.setProperty('border-color', color, 'important');
                info.el
                  .querySelector<HTMLElement>('.fc-event-main')
                  ?.style.setProperty('color', '#fff', 'important');
              }
            }
          }}
          eventContent={(info) => {
            const entry = calendarEventSchema
              .or(calendarTaskSchema)
              .safeParse(info.event.extendedProps);
            return entry.success ? (
              <CalendarEntryContent
                entry={entry.data}
                timeText={info.timeText}
                {...(entry.data.entryType === 'todo'
                  ? {
                      onToggle: () => {
                        const task = calendarTaskSchema.safeParse(entry.data);
                        if (task.success)
                          void toggleSubtask(task.data, !task.data.completed);
                      },
                    }
                  : {})}
              />
            ) : (
              info.event.title
            );
          }}
          eventDrop={(info) => void moveCalendarEntry(info)}
          height="100%"
          nowIndicator
          dayMaxEvents={responsiveDayMaxEvents}
          eventDisplay="block"
          selectable
          selectMinDistance={6}
          select={(info) => {
            setEditor({
              initialDate: info.startStr,
              initialEnd: info.allDay ? previousDate(info.endStr) : info.endStr,
            });
            info.view.calendar.unselect();
          }}
          dateClick={(info) => {
            setTaskInitialDate(info.dateStr);
            setTaskInitialEnd(undefined);
            setTaskEditorReturn(undefined);
            setTaskEditor(null);
          }}
          eventClassNames={(info) =>
            info.event.extendedProps.resourceId === pingResourceId
              ? ['event-search-ping']
              : []
          }
          eventClick={(info) => {
            const task = calendarTaskSchema.safeParse(info.event.extendedProps);
            if (task.success) {
              setTaskInitialDate(undefined);
              setTaskInitialEnd(undefined);
              setTaskEditorReturn(undefined);
              setTaskEditor(task.data);
              return;
            }
            const result = calendarEventSchema.safeParse(
              info.event.extendedProps,
            );
            if (result.success && !result.data.readOnly)
              setEditor({ event: result.data });
          }}
        />
      </main>
      {editor && (
        <EventDialog
          calendars={calendars.filter(
            (calendar) =>
              !calendar.readOnly && calendar.components.includes('VEVENT'),
          )}
          {...(editor.event ? { event: editor.event } : {})}
          {...(editor.initialDate ? { initialDate: editor.initialDate } : {})}
          {...(editor.initialEnd ? { initialEnd: editor.initialEnd } : {})}
          timeFormat={timeFormat}
          onCancel={() => setEditor(undefined)}
          onSave={saveEvent}
          {...(editor.event ? { onDelete: removeEvent } : {})}
        />
      )}
      {taskEditor !== undefined && (
        <TaskDialog
          key={taskEditor?.id ?? 'new-task'}
          calendars={calendars.filter(
            (calendar) =>
              !calendar.readOnly && calendar.components.includes('VTODO'),
          )}
          {...(taskEditor ? { task: taskEditor } : {})}
          simple={Boolean(
            taskEditor && hierarchy.childUids.has(taskEditor.uid),
          )}
          availableTasks={tasks}
          subtasks={
            taskEditor
              ? (hierarchy.childrenByUid.get(taskEditor.uid) ?? [])
              : []
          }
          {...(taskInitialDate ? { initialDate: taskInitialDate } : {})}
          {...(taskInitialEnd ? { initialEnd: taskInitialEnd } : {})}
          timeFormat={timeFormat}
          onCancel={() => {
            setTaskEditor(taskEditorReturn);
            setTaskEditorReturn(undefined);
          }}
          onSave={saveTask}
          {...(taskEditor && !hierarchy.childUids.has(taskEditor.uid)
            ? {
                onAddSubtask: addSubtask,
                onRemoveSubtask: removeSubtask,
                onToggleSubtask: toggleSubtask,
                onEditSubtask: (task: CalendarTask) => {
                  setTaskEditorReturn(taskEditor);
                  setTaskEditor(task);
                },
              }
            : {})}
          {...(taskEditor ? { onDelete: removeTask } : {})}
        />
      )}
      {searchOpen && (
        <SearchOverlay
          calendars={calendars.filter((calendar) => selected.has(calendar.id))}
          onClose={() => setSearchOpen(false)}
          onSelect={(event) => {
            setSearchOpen(false);
            setPingResourceId(event.resourceId);
            calendarRef.current?.getApi().gotoDate(event.start);
            window.setTimeout(() => setPingResourceId(undefined), 1200);
          }}
        />
      )}
      {calendarManagerOpen && (
        <CalendarManager
          calendars={calendars.filter((calendar) => !calendar.readOnly)}
          onClose={() => setCalendarManagerOpen(false)}
          onSave={saveCalendar}
          onDelete={removeCalendar}
        />
      )}
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState<{
    loading: boolean;
    mode?: 'single-user' | 'caldav-login';
    authenticated?: boolean;
    username?: string;
  }>({ loading: true });
  const authMode = useRef(auth.mode);

  useEffect(() => {
    authMode.current = auth.mode;
  }, [auth.mode]);

  useEffect(() => {
    const requireAuthentication = () => {
      if (authMode.current !== 'caldav-login') return;
      setAuth({
        loading: false,
        mode: 'caldav-login',
        authenticated: false,
      });
      void logout().catch(() => undefined);
    };
    window.addEventListener(authenticationRequiredEvent, requireAuthentication);
    return () =>
      window.removeEventListener(
        authenticationRequiredEvent,
        requireAuthentication,
      );
  }, []);

  useEffect(() => {
    let active = true;
    void getPublicConfig()
      .then(async (config) => {
        if (config.authentication.mode === 'single-user') {
          if (active)
            setAuth({
              loading: false,
              mode: 'single-user',
              authenticated: true,
            });
          return;
        }
        const session = await getAuthSession();
        if (active) setAuth({ loading: false, ...session });
      })
      .catch(() => {
        if (active)
          setAuth({ loading: false, mode: 'single-user', authenticated: true });
      });
    return () => {
      active = false;
    };
  }, []);

  if (auth.loading)
    return (
      <main className="login-shell">
        <p className="muted">Loading DayFront…</p>
      </main>
    );
  if (auth.mode === 'caldav-login' && !auth.authenticated)
    return (
      <LoginPage
        onLogin={async (username, password) => {
          const session = await login(username, password);
          setAuth({ loading: false, ...session });
        }}
      />
    );
  return (
    <CalendarApp
      {...(auth.username ? { username: auth.username } : {})}
      {...(auth.mode === 'caldav-login'
        ? {
            onLogout: () => {
              void logout().finally(() =>
                setAuth({
                  loading: false,
                  mode: 'caldav-login',
                  authenticated: false,
                }),
              );
            },
          }
        : {})}
    />
  );
}
