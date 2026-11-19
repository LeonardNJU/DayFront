# SL Calendar — maintained TypeScript source

This fork migrates the previously patched, minified SL Calendar customizations
into the normal DayFront source tree. The old deployed JS and CSS remain
archived under custom/sl-calendar/live for visual comparisons and rollback;
do not edit those files to implement new features.

## Source locations

- packages/shared/src/calendar.ts: typed event/task mutation and mapping schema,
  including category, color, prerequisite start task UID and start gate.
- apps/api/src/caldav/xml.ts, apps/api/src/calendar/: Stalwart compatibility and
  iCalendar X-LEO-COLOR, X-LEO-CATEGORY, X-LEO-START-GATE and
  X-LEO-START-TASK-UID fields.
- apps/web/src/App.tsx: calendar events/tasks, responsive 3/4-day views,
  direct task completion, date selection, drag-to-create, task visibility,
  history keyboard shortcuts and mobile state bridge.
- apps/web/src/TaskDialog.tsx, EventDialog.tsx, ColorPicker.tsx, palette.ts:
  editor UI, priority 1 default Tomato Red, categories/colors, prerequisites.
- apps/web/src/change-history.ts: per-tab Undo/Redo and ETag If-Match checks.
- apps/web/src/semantic.ts, keyboard.ts: semantic categories, navigation,
  help overlay, Escape dialog dismissal.
- apps/web/src/mobile.ts, sl-mobile.css: fully typed mobile dual-half-day,
  three-day timelines, tap/swipe/long-press gestures.
- apps/web/src/sl-calendar.css, sl-theme.css, apps/web/public/: styling and
  branded images/favicon.

## Build and checks

Run from this repository root with Node.js 24+ and pnpm:

    pnpm install --frozen-lockfile
    pnpm verify

This checks formatting, ESLint, TypeScript, tests and builds both frontend and
API. The production outputs are apps/web/dist and apps/api/dist.

## Deployment note

The migration updates GitHub source **only**, not dav.shangao.li. The old
nginx config rewrites one upstream JS asset and injects additional JS/CSS.
Switching to the new source build needs an explicit deployment adjustment
and browser regression validation for desktop and mobile.

Do not inject the old sl-mobile.js, leo-theme.js or frontend-calendar-v2.js
on top of the TypeScript-generated bundle: equivalent functionality now
comes from native source, and running both would duplicate event listeners.

The historical deploy_mobile.py script in custom/sl-calendar/legacy-tools
must not be run against the new source build.
