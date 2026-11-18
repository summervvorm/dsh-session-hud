# Session Status HUD

A small, always-available readout of what the harness is doing: how many sessions are **running**, how many **wait for you**, and how many have **finished**.

## What you get

- A pill in the top-right corner: `1 running · 2 waiting`, plus a green `3 completed` badge when finished sessions are waiting to be read.
- Click it — or let a completion open it — to see one row per session, titled the same way the sidebar titles it.
- **Open a session and its alert is gone.** The panel clears that row the moment the session becomes the visible one; there is no "mark all read".
- **Finished work in a background session is what alerts.** A session you are already looking at never pops a notification at you.
- The pill is draggable and its position is remembered; click outside or press `Escape` to collapse it.
- `Completed turns` accumulates across harness restarts.

## Requirements

DeepSeek Harness `>=0.2.1-rc.5` with the Web UI and the `webServer` service. No configuration is required; four optional switches live in the bundle's `cordis.patch.yml` row.
