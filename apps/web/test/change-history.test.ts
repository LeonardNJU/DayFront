import { describe, expect, it, vi } from 'vitest';
import type { CalendarTask, TaskMutation } from '@dayfront/shared';
import { CalendarHistory } from '../src/change-history.js';

function task(
  version: string,
  title = 'Draft',
  color = '#8E24AA',
): CalendarTask {
  return {
    id: 'test-task',
    resourceId: 'task.ics',
    calendarId: 'personal',
    uid: 'stable-uid',
    title,
    allDay: true,
    status: 'needs-action',
    completed: false,
    priority: 0,
    color,
    version,
    entryType: 'todo',
    recurring: false,
  };
}

describe('typed CalDAV undo/redo history', () => {
  it('undoes and redoes create without losing ETag state', async () => {
    const history = new CalendarHistory();
    const created = task('"v1"');
    const deleted = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue(task('"v2"'));
    history.register({
      createTask: create,
      updateTask: vi.fn(),
      deleteTask: deleted,
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
    });
    history.created(
      'task',
      {
        calendarId: 'personal',
        title: 'Draft',
        allDay: true,
        priority: 0,
        status: 'needs-action',
      },
      created,
    );
    expect(history.canUndo).toBe(true);
    await history.undo();
    expect(deleted).toHaveBeenCalledWith('task.ics', '"v1"');
    expect(history.canRedo).toBe(true);
    await history.redo();
    expect(create).toHaveBeenCalledOnce();
    expect(history.undoStack.at(-1)?.current?.version).toBe('"v2"');
  });

  it('reverts an edit using prior data and the updated version, then reapplies it', async () => {
    const history = new CalendarHistory();
    const prior = task('"v1"', 'Before', '#8E24AA');
    const after = task('"v2"', 'After', '#D50000');
    const update = vi
      .fn()
      .mockResolvedValueOnce(task('"v3"', 'Before', '#8E24AA'))
      .mockResolvedValueOnce(task('"v4"', 'After', '#D50000'));
    history.register({
      createTask: vi.fn(),
      updateTask: update,
      deleteTask: vi.fn(),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
    });
    const mutation: TaskMutation = {
      calendarId: 'personal',
      title: 'After',
      allDay: true,
      priority: 1,
      status: 'needs-action',
      color: '#D50000',
    };
    history.changed('task', prior, mutation, after);
    await history.undo();
    expect(update).toHaveBeenNthCalledWith(
      1,
      'task.ics',
      '"v2"',
      expect.objectContaining({ title: 'Before', color: '#8E24AA' }),
    );
    await history.redo();
    expect(update).toHaveBeenNthCalledWith(
      2,
      'task.ics',
      '"v3"',
      expect.objectContaining({ title: 'After', color: '#D50000' }),
    );
    expect(history.redoStack).toHaveLength(0);
  });

  it('preserves a conflicting edit without dropping the undo action', async () => {
    const history = new CalendarHistory();
    const update = vi.fn().mockRejectedValue(new Error('412 VERSION_CONFLICT'));
    history.register({
      createTask: vi.fn(),
      updateTask: update,
      deleteTask: vi.fn(),
      createEvent: vi.fn(),
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
    });
    history.changed(
      'task',
      task('"v1"'),
      {
        calendarId: 'personal',
        title: 'Remote',
        allDay: true,
        priority: 1,
        status: 'needs-action',
      },
      task('"v2"', 'Remote'),
    );
    const listener = vi.fn();
    window.addEventListener('sl-history-error', listener);
    const warning = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    try {
      await history.undo();
      expect(listener).toHaveBeenCalledOnce();
      expect(history.canUndo).toBe(true);
      expect(history.canRedo).toBe(false);
    } finally {
      warning.mockRestore();
      window.removeEventListener('sl-history-error', listener);
    }
  });
});
