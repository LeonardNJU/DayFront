# SL Calendar custom deployment snapshot

This directory preserves the self-hosted **SL Calendar** customizations based on
[DayFront](https://github.com/Erik-A-Smith/DayFront). It is a **snapshot of the
customized running deployment**, not a rebase of all local changes into the
upstream TypeScript source tree.

The fork's upstream DayFront source, history, and other feature branches remain
unchanged. These files can be used to audit the differences and eventually port
features to the upstream source code.

## Layout

- **`live/`** — production-file snapshot copied from the deployment's
  `/opt/leo-dayfront/` on 2026-11-18, including the active calendar front-end
  bundle, desktop theme, mobile interface, styling, manifest, brand assets,
  and a copy of the locally customized API bundle (`server.js`). The API
  bundle's runtime loading mode was not validated as part of this archive.
- **`src/sl-history-bridge.js`** — readable JavaScript source for CalDAV
  client-side change history, keyboard shortcuts and undo/redo. The feature
  is integrated into `live/frontend-calendar-v2.js`.
- **`src/test-sl-history.cjs`** — isolated Node.js tests of task/event CRUD,
  undo/redo, recurring occurrences, shortcuts and ETag conflict handling.
- **`legacy-tools/`** — historical, potentially stale mobile development and
  deployment helpers. They are retained for reference; **do not run
  `deploy_mobile.py` against the current deployment** without reviewing and
  updating its assumptions first.

## Deployed UI behavior

- **Undo:** `Ctrl+Z` or `Cmd+Z`; **redo:** `Ctrl+Shift+Z` or `Cmd+Shift+Z`.
  Shortcuts leave text-field editing to the browser. Undo history is kept in
  the current tab only, not in CalDAV or persistent storage. Complex destructive
  operations may be excluded from undo. The history uses CalDAV ETag/version
  checks to avoid silently overwriting another client's changes.
- **P1 tasks:** default *Tomato Red* (`#D50000`) when a custom color has not
  been set. Other tasks keep *Grape* (`#8E24AA`) as the default. Users may
  choose another color.
- Additional local desktop/mobile view, task handling, appearance, branding,
  gestures and scheduling customizations are included in the live assets.

## Validation

With Node.js installed:

```sh
node --check custom/sl-calendar/live/frontend-calendar-v2.js
node custom/sl-calendar/src/test-sl-history.cjs
```

The front-end bundle is generated/minified JavaScript, *not* a standalone
source-level build of all local changes. Do not use `pnpm build` in the upstream
root expecting it to recreate the archived custom UI: a full source-level
migration would be needed. Deploying these assets also depends on the existing
site's reverse-proxy routing. This repository does not contain its live nginx
configuration, authentication credentials, CalDAV data, or TLS private keys.

## Upstream relationship

- `origin`: `LeonardNJU/DayFront` (this fork)
- `upstream`: `Erik-A-Smith/DayFront`

Changes are isolated under `custom/sl-calendar/` to avoid pretending that
archived generated artifacts are drop-in source replacements.
