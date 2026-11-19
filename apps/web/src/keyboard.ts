/**
 * SL Calendar keyboard bindings. Native shortcuts are suppressed while editing
 * text and when a modal dialog has focus. Undo/redo is owned by App.tsx.
 */
const viewKeys: Record<string, string> = {
  d: 'timeGridDay',
  w: 'timeGridWeek',
  f: 'timeGridFourDay',
  m: 'dayGridMonth',
  a: 'listMonth',
  '1': 'timeGridDay',
  '2': 'timeGridWeek',
  '3': 'dayGridMonth',
  '4': 'timeGridFourDay',
  '5': 'listMonth',
};

function action(name: string): boolean {
  const button = document.querySelector<HTMLButtonElement>(
    '.fc-' + name + '-button',
  );
  if (!button) return false;
  button.click();
  return true;
}
function closeHelp(): boolean {
  const el = document.getElementById('sl-keys');
  if (!el) return false;
  el.remove();
  return true;
}
function showHelp(): void {
  if (document.getElementById('sl-keys')) return;
  const backdrop = document.createElement('div');
  backdrop.id = 'sl-keys';
  backdrop.style.cssText =
    'position:fixed;inset:0;z-index:2147483000;background:#0009;display:grid;place-items:center';
  const card = document.createElement('div');
  card.style.cssText =
    'background:#212126;color:#eee;border:1px solid #555;border-radius:14px;padding:24px;min-width:310px;font:14px system-ui';
  const heading = document.createElement('h2');
  heading.textContent = 'SL Calendar shortcuts';
  card.append(heading);
  const shortcuts = [
    ['T', 'Today'],
    ['D / 1', 'Day'],
    ['W / 2', 'Week'],
    ['M / 3', 'Month'],
    ['F / 4', '4 Days'],
    ['A / 5', 'Agenda'],
    ['J / →', 'Next'],
    ['K / ←', 'Previous'],
    ['/', 'Search'],
    ['R', 'Reload'],
    ['?', 'Shortcuts'],
    ['Esc', 'Close dialog / cancel'],
    ['Ctrl / Cmd + Z', 'Undo'],
    ['Ctrl / Cmd + Shift + Z', 'Redo'],
  ];
  for (const [key, label] of shortcuts) {
    const row = document.createElement('p');
    row.textContent = key + ' — ' + label;
    card.append(row);
  }
  const note = document.createElement('small');
  note.textContent = 'Not active while typing. Esc to close.';
  card.append(note);
  backdrop.append(card);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) backdrop.remove();
  });
  document.body.append(backdrop);
}
function closeTopOverlay(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  if (closeHelp()) {
    event.preventDefault();
    return true;
  }
  const overlays: [string, string][] = [
    [
      '.clock-backdrop',
      '[aria-label="Close time picker"],.clock-footer button:last-child',
    ],
    ['.recurrence-action-backdrop', '.recurrence-action-cancel'],
    ['.search-backdrop', '[aria-label="Close search"]'],
    [
      '.dialog-backdrop',
      '[aria-label="Close"],.dialog-actions button:first-child',
    ],
  ];
  for (const [selector, buttonSelector] of overlays) {
    const overlay = [...document.querySelectorAll<HTMLElement>(selector)]
      .reverse()
      .find((el) => el.getClientRects().length > 0);
    if (!overlay) continue;
    const button =
      overlay.querySelector<HTMLButtonElement>(buttonSelector) ??
      [...overlay.querySelectorAll<HTMLButtonElement>('button')].find(
        (el) =>
          /^(cancel|close|×)$/i.test(el.textContent?.trim() ?? '') ||
          /^Close\b/i.test(el.getAttribute('aria-label') ?? ''),
      );
    if (button) button.click();
    else
      overlay.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      );
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  }
  return false;
}
export function installCalendarShortcuts(): () => void {
  function keydown(event: KeyboardEvent) {
    if (closeTopOverlay(event)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing ||
      target?.closest(
        'input,textarea,select,[contenteditable],[role="textbox"]',
      ) ||
      document.querySelector('[role="dialog"],.dialog-backdrop')
    )
      return;
    const key = event.key.toLowerCase();
    let handled = false;
    if (viewKeys[key]) handled = action(viewKeys[key]);
    else if (key === 't') handled = action('today');
    else if (key === 'j' || key === 'arrowright') handled = action('next');
    else if (key === 'k' || key === 'arrowleft') handled = action('prev');
    else if (key === '/') handled = action('search');
    else if (key === '?') {
      showHelp();
      handled = true;
    } else if (key === 'r') {
      location.reload();
      handled = true;
    }
    if (handled) event.preventDefault();
  }
  document.addEventListener('keydown', keydown, true);
  return () => document.removeEventListener('keydown', keydown, true);
}
