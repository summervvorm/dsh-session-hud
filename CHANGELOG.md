# Changelog

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
