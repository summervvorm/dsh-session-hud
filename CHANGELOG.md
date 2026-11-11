# Changelog

## 1.0.1 — 2026-11-11

- Fix: the HUD was painted above the window title bar but could not be clicked
  there — the title bar is an Electron drag region, which takes the press for a
  window drag before the page sees it. The whole frame now sets
  `-webkit-app-region: no-drag`, so parking it at the very top stays clickable
  and draggable.
- Add: `alwaysOnTop` config switch (default `true`). On, the frame stays in a
  frame-wide top layer (above host chrome and the title bar); off, it drops to an
  ordinary overlay layer and is clamped below the title bar.
- Document all four config switches in `cordis.patch.yml` and the README.

## 1.0.0 — 2026-11-11

First public release.

- Floating session-status panel in the `shell.overlay` slot of the DeepSeek Harness Web UI.
- Counts running, waiting and finished sessions; completion alerts for background sessions.
- Opening a session clears its alert (session-scoped probe reports the visible session).
- Resident pill with idle state; alerts are the only dismissible part.
- Draggable with persisted position; click-outside and `Escape` collapse the panel.
- Cumulative finished-turn counter persisted in `$DSH_HOME/state/dsh-session-hud.json`.
- Local-only endpoints: SSE snapshot stream, one-shot state probe, active-session report.
- Localized display metadata for `zh` and `en`, original icon, theme-token styling.
