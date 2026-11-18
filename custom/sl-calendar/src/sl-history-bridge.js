// SL Calendar live-frontend history bridge. Tracks successful CalDAV writes per tab.
// Session-only history; record snapshots before each update and use If-Match on replay.
var slHistoryState = { undo: [], redo: [], busy: false, limit: 60 };
var slHistoryCalendarIndex = new Map();
var slHistoryOccurIndex = new Map();
function slHistoryOccurrenceKey(kind,id,rid) { return kind+"|"+id+"|"+rid; }
var slHistoryRaw = { createTask: by, updateTask: xy, deleteTask: Sy,
  createEvent: Cy, updateEvent: wy, deleteEvent: Ty };
function slHistoryIndex(entries) {
  for (const item of entries) if (item && item.resourceId && item.calendarId)
    { slHistoryCalendarIndex.set(item.resourceId, item.calendarId);
      if (item.recurrenceId) slHistoryOccurIndex.set(slHistoryOccurrenceKey(
        item.entryType === 'todo' ? 'task' : 'event', item.resourceId, item.recurrenceId), item); }
  return entries;
}
function slHistoryInvalidate() {
  slHistoryState.undo.length = 0; slHistoryState.redo.length = 0;
}
function slHistoryPush(item) {
  slHistoryState.undo.push(item);
  if (slHistoryState.undo.length > slHistoryState.limit) slHistoryState.undo.shift();
  slHistoryState.redo.length = 0;
}
async function slHistoryRead(kind, resourceId, calendarId) {
  const suffix = kind === 'task' ? 'tasks' : 'events';
  const uri = '/api/v1/' + suffix + '/' + encodeURIComponent(resourceId) +
    '?calendarId=' + encodeURIComponent(calendarId);
  const response = await fetch(uri, { cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to read prior calendar state.');
  const body = await response.json();
  if (!body.data || !body.data.version) throw new Error('Incomplete calendar snapshot.');
  return body.data;
}
function slHistoryInput(kind, item) {
  const common = { calendarId:item.calendarId, title:item.title, allDay:item.allDay,
    ...(item.description ? {description:item.description} : {}),
    ...(item.color ? {color:item.color} : {}),
    ...(item.category ? {category:item.category} : {}),
    recurrenceRule:item.recurrenceRule ?? null };
  if (kind === 'event') return { ...common, start:item.start,
    ...(item.end ? {end:item.end} : {}),
    ...(item.location ? {location:item.location} : {}) };
  return { ...common, ...(item.start ? {start:item.start} : {}),
    ...(item.due ? {due:item.due} : {}),
    status:item.status || 'needs-action', priority:item.priority ?? 0,
    ...(item.parentUid ? {parentUid:item.parentUid} : {}),
    ...(item.startTaskUid ? {startTaskUid:item.startTaskUid} : {}),
    ...(item.startGate !== undefined ? {startGate:item.startGate} : {}) };
}
function slHistoryAlert(message, isError) {
  let node = document.getElementById('sl-history-status');
  if (!node) {
    node = document.createElement('div'); node.id = 'sl-history-status';
    node.setAttribute('role', 'status');
    node.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:10px 14px;border-radius:10px;background:#24252a;color:white;font:14px system-ui,sans-serif;box-shadow:0 4px 20px #0004;max-width:360px;pointer-events:none';
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.style.background = isError ? '#8c2730' : '#24252a';
  clearTimeout(slHistoryAlert.timeout);
  slHistoryAlert.timeout = setTimeout(() => node.remove(), 2700);
}
function slHistoryNotify() {
  window.dispatchEvent(new Event('sl-history-changed'));
}
async function slHistoryTravel(redo) {
  const state = slHistoryState;
  const from = redo ? state.redo : state.undo;
  const to = redo ? state.undo : state.redo;
  if (state.busy || !from.length) return;
  const entry = from[from.length - 1];
  const raw = entry.kind === 'task'
    ? {create:slHistoryRaw.createTask, update:slHistoryRaw.updateTask, delete:slHistoryRaw.deleteTask}
    : {create:slHistoryRaw.createEvent, update:slHistoryRaw.updateEvent, delete:slHistoryRaw.deleteEvent};
  state.busy = true;
  try {
    if (entry.operation === 'create') {
      if (redo) entry.current = await raw.create(entry.payload);
      else { await raw.delete(entry.current.resourceId, entry.current.version); entry.current = null; }
    } else if (entry.operation === 'delete') {
      if (redo) { await raw.delete(entry.current.resourceId, entry.current.version); entry.current = null; }
      else entry.current = await raw.create(slHistoryInput(entry.kind, entry.before));
    } else {
      const requested = redo ? entry.payload : { ...slHistoryInput(entry.kind, entry.before),
        ...(entry.occurrence || {}) };
      // The last returned ETag is required: reject changes from another client.
      entry.current = await raw.update(entry.current.resourceId, entry.current.version, requested);
    }
    if (entry.current) slHistoryIndex([entry.current]);
    from.pop(); to.push(entry);
    slHistoryNotify();
    slHistoryAlert(redo ? 'Redone' : 'Undone', false);
  } catch (error) {
    const msg = String(error && error.message || error);
    slHistoryAlert(/412|VERSION_CONFLICT|If-Match/.test(msg)
      ? 'Calendar changed elsewhere. Refresh before trying again.'
      : 'Undo/redo failed; calendar data was not overwritten.', true);
    console.warn('SL Calendar history replay failed:', error);
    slHistoryNotify();
  } finally { state.busy = false; }
}
function slHistoryEditable(target) {
  return target instanceof Element && Boolean(target.closest(
    'input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="textbox"]'));
}
window.addEventListener('keydown', function(event) {
  if (event.defaultPrevented || event.repeat || event.altKey ||
      !((event.ctrlKey && !event.metaKey) || (event.metaKey && !event.ctrlKey)) ||
      event.key.toLowerCase() !== 'z' ||
      slHistoryEditable(event.target) ||
      document.querySelector('[role="dialog"],.dialog-backdrop')) return;
  const stack = event.shiftKey ? slHistoryState.redo : slHistoryState.undo;
  if (!stack.length) return;
  event.preventDefault(); event.stopImmediatePropagation();
  void slHistoryTravel(event.shiftKey);
}, true);
window.slCalendarHistory = {
  undo: () => slHistoryTravel(false), redo: () => slHistoryTravel(true),
  state: slHistoryState
};
// Cache source calendar IDs for cross-calendar moves, whose GET endpoint takes a calendarId.
const slHistoryRawListTasks = yy, slHistoryRawEvents = _y, slHistoryRawRangeTasks = vy;
yy = async function(...args) { return slHistoryIndex(await slHistoryRawListTasks(...args)); };
_y = async function(...args) { return slHistoryIndex(await slHistoryRawEvents(...args)); };
vy = async function(...args) { return slHistoryIndex(await slHistoryRawRangeTasks(...args)); };
by = async function(input) {
  const result = await slHistoryRaw.createTask(input); slHistoryIndex([result]);
  if (!slHistoryState.busy) slHistoryPush({kind:'task', operation:'create', payload:input, current:result});
  return result;
};
Cy = async function(input) {
  const result = await slHistoryRaw.createEvent(input); slHistoryIndex([result]);
  if (!slHistoryState.busy) slHistoryPush({kind:'event', operation:'create', payload:input, current:result});
  return result;
};
xy = async function(resourceId, version, input) {
  if (slHistoryState.busy) return slHistoryRaw.updateTask(resourceId,version,input);
  const calendarId = slHistoryCalendarIndex.get(resourceId) || input.calendarId;
  const occurrence = input.recurrenceScope === 'occurrence' ?
    {recurrenceScope:'occurrence',recurrenceId:input.recurrenceId,occurrenceStart:input.occurrenceStart} : null;
  const before = occurrence ?
    slHistoryOccurIndex.get(slHistoryOccurrenceKey('task',resourceId,input.recurrenceId)) :
    await slHistoryRead('task', resourceId, calendarId).catch(() => null);
  const after = await slHistoryRaw.updateTask(resourceId,version,input);
  slHistoryIndex([after]);
  if (before) slHistoryPush({kind:'task',operation:'update',before,payload:input,current:after,occurrence});
  else slHistoryInvalidate();
  return after;
};
wy = async function(resourceId, version, input) {
  if (slHistoryState.busy) return slHistoryRaw.updateEvent(resourceId,version,input);
  const calendarId = slHistoryCalendarIndex.get(resourceId) || input.calendarId;
  const occurrence = input.recurrenceScope === 'occurrence' ?
    {recurrenceScope:'occurrence',recurrenceId:input.recurrenceId,occurrenceStart:input.occurrenceStart} : null;
  const before = occurrence ?
    slHistoryOccurIndex.get(slHistoryOccurrenceKey('event',resourceId,input.recurrenceId)) :
    await slHistoryRead('event', resourceId, calendarId).catch(() => null);
  const after = await slHistoryRaw.updateEvent(resourceId,version,input);
  slHistoryIndex([after]);
  if (before) slHistoryPush({kind:'event',operation:'update',before,payload:input,current:after,occurrence});
  else slHistoryInvalidate();
  return after;
};
Sy = async function(resourceId, version, occurrence) {
  if (slHistoryState.busy) return slHistoryRaw.deleteTask(resourceId,version,occurrence);
  const calendarId = slHistoryCalendarIndex.get(resourceId);
  const before = !occurrence && calendarId ?
    await slHistoryRead('task',resourceId,calendarId).catch(() => null) : null;
  await slHistoryRaw.deleteTask(resourceId,version,occurrence);
  // A recreated dependent/recurring task would lose its stable UID or exceptions.
  if (before && !before.recurring && !before.parentUid && !before.childUids?.length)
    slHistoryPush({kind:'task',operation:'delete',before,current:null});
  else slHistoryInvalidate();
};
Ty = async function(resourceId, version, occurrence) {
  if (slHistoryState.busy) return slHistoryRaw.deleteEvent(resourceId,version,occurrence);
  const calendarId = slHistoryCalendarIndex.get(resourceId);
  const before = !occurrence && calendarId ?
    await slHistoryRead('event',resourceId,calendarId).catch(() => null) : null;
  await slHistoryRaw.deleteEvent(resourceId,version,occurrence);
  if (before && !before.recurring)
    slHistoryPush({kind:'event',operation:'delete',before,current:null});
  else slHistoryInvalidate();
};