import type {
  CalendarEvent,
  CalendarTask,
  EventMutation,
  TaskMutation,
} from '@dayfront/shared';

type Entry = CalendarEvent | CalendarTask;
type Mutation = EventMutation | TaskMutation;
type Kind = 'task' | 'event';
type Action = 'create' | 'update' | 'delete';
type Occurrence = {
  recurrenceId: string;
  occurrenceStart?: string;
  recurrenceScope: 'occurrence';
};

interface Change {
  kind: Kind;
  action: Action;
  before?: Entry;
  payload?: Mutation;
  current?: Entry | undefined;
  occurrence?: Occurrence;
}
interface Actions {
  createTask(input: TaskMutation): Promise<CalendarTask>;
  updateTask(
    id: string,
    version: string,
    input: TaskMutation,
  ): Promise<CalendarTask>;
  deleteTask(id: string, version: string): Promise<void>;
  createEvent(input: EventMutation): Promise<CalendarEvent>;
  updateEvent(
    id: string,
    version: string,
    input: EventMutation,
  ): Promise<CalendarEvent>;
  deleteEvent(id: string, version: string): Promise<void>;
}

const UPDATED = 'sl-history-changed';

export function toEventMutation(entry: CalendarEvent): EventMutation {
  return {
    calendarId: entry.calendarId,
    title: entry.title,
    start: entry.start,
    ...(entry.end ? { end: entry.end } : {}),
    allDay: entry.allDay,
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.location ? { location: entry.location } : {}),
    ...(entry.category ? { category: entry.category } : {}),
    ...(entry.color ? { color: entry.color } : {}),
    recurrenceRule: entry.recurrenceRule ?? null,
  };
}
export function toTaskMutation(entry: CalendarTask): TaskMutation {
  return {
    calendarId: entry.calendarId,
    title: entry.title,
    ...(entry.start ? { start: entry.start } : {}),
    ...(entry.due ? { due: entry.due } : {}),
    allDay: entry.allDay,
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.category ? { category: entry.category } : {}),
    ...(entry.color ? { color: entry.color } : {}),
    ...(entry.startTaskUid ? { startTaskUid: entry.startTaskUid } : {}),
    ...(entry.startGate !== undefined ? { startGate: entry.startGate } : {}),
    ...(entry.parentUid ? { parentUid: entry.parentUid } : {}),
    status: entry.status,
    priority: entry.priority,
    recurrenceRule: entry.recurrenceRule ?? null,
  };
}

export class CalendarHistory {
  readonly undoStack: Change[] = [];
  readonly redoStack: Change[] = [];
  private actions?: Actions;
  private readonly resourceCalendar = new Map<string, string>();
  private readonly instances = new Map<string, Entry>();
  busy = false;

  register(actions: Actions) {
    this.actions = actions;
  }
  observe<T extends Entry>(entries: readonly T[]): readonly T[] {
    for (const entry of entries) {
      this.resourceCalendar.set(entry.resourceId, entry.calendarId);
      if (entry.recurrenceId) {
        this.instances.set(
          this.instanceKey(
            entry.entryType === 'todo' ? 'task' : 'event',
            entry.resourceId,
            entry.recurrenceId,
          ),
          entry,
        );
      }
    }
    return entries;
  }
  private instanceKey(kind: Kind, id: string, recurrenceId: string) {
    return kind + '|' + id + '|' + recurrenceId;
  }
  private announce() {
    window.dispatchEvent(new Event(UPDATED));
  }
  private record(change: Change) {
    if (this.busy) return;
    this.undoStack.push(change);
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
    this.announce();
  }
  clear() {
    if (this.busy) return;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.announce();
  }
  created(kind: Kind, payload: Mutation, result: Entry) {
    this.observe([result]);
    this.record({ kind, action: 'create', payload, current: result });
  }
  changed(
    kind: Kind,
    before: Entry | undefined,
    payload: Mutation,
    result: Entry,
  ) {
    this.observe([result]);
    if (!before) {
      this.clear();
      return;
    }
    const scope =
      payload.recurrenceScope === 'occurrence' && payload.recurrenceId
        ? {
            recurrenceScope: 'occurrence' as const,
            recurrenceId: payload.recurrenceId,
            ...(payload.occurrenceStart
              ? { occurrenceStart: payload.occurrenceStart }
              : {}),
          }
        : undefined;
    this.record({
      kind,
      action: 'update',
      before,
      payload,
      current: result,
      ...(scope ? { occurrence: scope } : {}),
    });
  }
  deleted(kind: Kind, before: Entry | undefined) {
    // Recreating a recurring or related resource changes its UID/relationships.
    if (
      !before ||
      before.recurring ||
      ('parentUid' in before && (before.parentUid || before.childUids?.length))
    ) {
      this.clear();
      return;
    }
    this.record({ kind, action: 'delete', before });
  }
  async before(
    kind: Kind,
    id: string,
    calendarId: string,
    mutation?: Mutation,
  ): Promise<Entry | undefined> {
    if (this.busy) return undefined;
    if (mutation?.recurrenceScope === 'occurrence' && mutation.recurrenceId)
      return this.instances.get(
        this.instanceKey(kind, id, mutation.recurrenceId),
      );
    const cid = this.resourceCalendar.get(id) || calendarId;
    const response = await fetch(
      '/api/v1/' +
        (kind === 'task' ? 'tasks' : 'events') +
        '/' +
        encodeURIComponent(id) +
        '?calendarId=' +
        encodeURIComponent(cid),
      { cache: 'no-store' },
    );
    if (!response.ok) return undefined;
    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null || !('data' in data))
      return undefined;
    return data.data as Entry;
  }
  get canUndo() {
    return this.undoStack.length > 0 && !this.busy;
  }
  get canRedo() {
    return this.redoStack.length > 0 && !this.busy;
  }
  async undo() {
    await this.travel(false);
  }
  async redo() {
    await this.travel(true);
  }
  private async travel(redo: boolean): Promise<void> {
    const from = redo ? this.redoStack : this.undoStack;
    const to = redo ? this.undoStack : this.redoStack;
    const change = from.at(-1);
    const api = this.actions;
    if (!change || !api || this.busy) return;
    this.busy = true;
    try {
      const { kind, action } = change;
      const current = change.current;
      if (action === 'create') {
        if (redo) {
          if (!change.payload) throw Error('Create input missing');
          change.current =
            kind === 'task'
              ? await api.createTask(change.payload as TaskMutation)
              : await api.createEvent(change.payload as EventMutation);
        } else {
          if (!current) throw Error('Create resource missing');
          if (kind === 'task')
            await api.deleteTask(current.resourceId, current.version);
          else await api.deleteEvent(current.resourceId, current.version);
          change.current = undefined;
        }
      } else if (action === 'delete') {
        if (redo) {
          if (!current) throw Error('Deleted resource missing');
          if (kind === 'task')
            await api.deleteTask(current.resourceId, current.version);
          else await api.deleteEvent(current.resourceId, current.version);
          change.current = undefined;
        } else {
          if (!change.before) throw Error('Deleted snapshot missing');
          change.current =
            kind === 'task'
              ? await api.createTask(
                  toTaskMutation(change.before as CalendarTask),
                )
              : await api.createEvent(
                  toEventMutation(change.before as CalendarEvent),
                );
        }
      } else {
        if (!current || !change.before || !change.payload)
          throw Error('Update history incomplete');
        const payload: Mutation = redo
          ? change.payload
          : kind === 'task'
            ? toTaskMutation(change.before as CalendarTask)
            : toEventMutation(change.before as CalendarEvent);
        const target: Mutation = { ...payload, ...change.occurrence };
        change.current =
          kind === 'task'
            ? await api.updateTask(
                current.resourceId,
                current.version,
                target as TaskMutation,
              )
            : await api.updateEvent(
                current.resourceId,
                current.version,
                target as EventMutation,
              );
      }
      if (change.current) this.observe([change.current]);
      from.pop();
      to.push(change);
      this.announce();
    } catch (error) {
      // Keep the action on its stack. Version/ETag failures never overwrite server changes.
      console.warn('Unable to replay SL Calendar change:', error);
      window.dispatchEvent(
        new CustomEvent('sl-history-error', {
          detail:
            'Undo/redo failed. The resource may have changed in another client.',
        }),
      );
    } finally {
      this.busy = false;
    }
  }
}
export const calendarHistory = new CalendarHistory();
export const calendarHistoryChangedEvent = UPDATED;
