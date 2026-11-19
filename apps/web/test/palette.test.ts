import { describe, expect, it } from 'vitest';
import {
  defaultTaskColor,
  DEFAULT_TASK_COLOR,
  P1_TASK_COLOR,
} from '../src/palette.js';
import { semanticCategory } from '../src/semantic.js';
import type { CalendarTask, CalendarEvent } from '@dayfront/shared';

const task: CalendarTask = {
  id: 't1',
  resourceId: 'r1',
  calendarId: 'personal',
  uid: 't1',
  title: 'Urgent review',
  allDay: true,
  status: 'needs-action',
  completed: false,
  priority: 1,
  version: '"v1"',
  entryType: 'todo',
  recurring: false,
};

describe('SL Calendar palette semantics', () => {
  it('makes P1 Tomato Red but retains manually selected colors', () => {
    expect(defaultTaskColor(1)).toBe(P1_TASK_COLOR);
    expect(defaultTaskColor(0)).toBe(DEFAULT_TASK_COLOR);
    expect(defaultTaskColor(1, '#33B679')).toBe('#33B679');
    expect(defaultTaskColor(2, '#3F51B5')).toBe('#3F51B5');
  });
  it('prioritizes explicit CalDAV categories before text-based classification', () => {
    expect(semanticCategory({ ...task, category: 'routine' })).toBe('routine');
    expect(semanticCategory(task)).toBe('urgent');
    const event: CalendarEvent = {
      id: 'e1',
      resourceId: 'e1',
      calendarId: 'personal',
      uid: 'e1',
      title: 'ESE 503 lecture',
      start: '2026-11-18T14:00:00Z',
      allDay: false,
      version: '"v1"',
      entryType: 'event',
      recurring: false,
    };
    expect(semanticCategory(event)).toBe('fixed');
    expect(semanticCategory({ ...event, category: 'fun' })).toBe('fun');
  });
});
