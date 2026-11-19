import type { CalendarEvent, CalendarTask } from '@dayfront/shared';

type CalendarEntry = CalendarEvent | CalendarTask;
export type SemanticCategory =
  'fixed' | 'urgent' | 'fun' | 'routine' | 'default';

const routine =
  /每日|每天|日记|daily\s+(?:schedule|journal|routine)|journal|habit|routine/i;
const urgent =
  /🚨|⚠️|\burgent\b|\basap\b|\bcritical\b|\bdeadline\b|\bexam\b|\bpart[\s-]*2\b|\bddl\b|紧急|截止|考试|重要任务|必须完成/i;
const leisure =
  /桌游|魔术|聚餐|出游|娱乐|放松|休息|聚会|\b(?:board\s*game|game\s*night|social|party|hangout|movie\s*night|leisure|fun)\b|\bCNA\b.*\bLIC\b/i;
const fixed =
  /\b(?:ESE\s*\d{3}|GRD\s*\d{3}|lab|laboratory|class|lecture|course|seminar|office\s*hours|recitation)\b|\bTA\b|课程|上课|值班|授课|实验课|助教/i;

/** Use explicit CalDAV categories before title heuristics; never mutate CalDAV data. */
export function semanticCategory(entry: CalendarEntry): SemanticCategory {
  if (entry.category) return entry.category;
  const todo = 'priority' in entry;
  if (todo && routine.test(entry.title)) return 'routine';
  if ((todo && entry.priority === 1) || urgent.test(entry.title))
    return 'urgent';
  if (!todo && leisure.test(entry.title)) return 'fun';
  if (!todo && fixed.test(entry.title)) return 'fixed';
  return 'default';
}

/** Use title categorization only where no explicit color overrides the appearance. */
export function applySemanticEventAppearance(
  element: HTMLElement,
  entry: CalendarEntry,
): void {
  if (!entry.color && !('priority' in entry && entry.priority === 1))
    element.dataset.leoColor = semanticCategory(entry);
  else delete element.dataset.leoColor;
  if (element.classList.contains('fc-timegrid-event'))
    element.classList.toggle(
      'leo-compact-event',
      element.getBoundingClientRect().height < 90,
    );
}
