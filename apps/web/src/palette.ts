export const calendarPalette = [
  ['Blueberry', '#3F51B5'],
  ['Lavender', '#7986CB'],
  ['Peacock', '#039BE5'],
  ['Sage', '#33B679'],
  ['Basil', '#0B8043'],
  ['Banana', '#F6BF26'],
  ['Tangerine', '#F4511E'],
  ['Flamingo', '#E67C73'],
  ['Tomato', '#D50000'],
  ['Grape', '#8E24AA'],
  ['Graphite', '#616161'],
] as const;

export const DEFAULT_EVENT_COLOR = '#039BE5';
export const DEFAULT_TASK_COLOR = '#8E24AA';
export const P1_TASK_COLOR = '#D50000';

export function defaultTaskColor(priority: number, explicit?: string): string {
  return explicit ?? (priority === 1 ? P1_TASK_COLOR : DEFAULT_TASK_COLOR);
}
