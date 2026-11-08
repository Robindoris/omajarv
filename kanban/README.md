# Kanban

A tiny personal kanban board that lives on this machine and is reachable from any
device on the Tailscale network. No dependencies — Python standard library plus
SQLite.

## Run and open it on H3man's Omarchy machine

The project is installed at `/home/h3man/Projects/kanban-omarchy-jarvis`.
It requires Python 3; there are no additional Python packages to install.

```sh
cd /home/h3man/Projects/kanban-omarchy-jarvis
python3 app.py
```

Keep that terminal open while using the board. In another terminal, print this
machine's board address:

```sh
cd /home/h3man/Projects/kanban-omarchy-jarvis
python3 kb url
```

Open the printed URL in your browser. With Tailscale connected, your phone and
other devices on the same tailnet can use that address too. Without Tailscale,
the default address is `http://127.0.0.1:8787`, accessible on this machine only.
On your phone, add the board to the Home Screen for an app-like window.

## Set up the CLI

```sh
mkdir -p ~/.local/bin
ln -s /home/h3man/Projects/kanban-omarchy-jarvis/kb ~/.local/bin/kb
```

Run this once, provided `~/.local/bin/kb` does not already exist. Ensure
`~/.local/bin` is on your `PATH`. You can also run `python3 kb` from the project
directory without installing the shortcut.

## Saving tasks from chat

When you ask JARVIS to remember a task, it runs `kb add`:

    kb add "Renew the domain" --col todo --priority high --due 2026-12-01
    kb add "Call the dentist" -c todo -n "ask about Friday"
    kb list
    kb move 12 doing
    kb done 12
    kb edit 12 --title "New title" --priority low
    kb rm 12
    kb cols
    kb url

Columns can be referenced by id (`backlog`, `todo`, `doing`, `done`) or by title
(`Backlog`, `Next up`, `In progress`, `Done`).

## Using the board

- `+ Add a task` at the bottom of a column: type, Enter to save.
- Click a card to edit title, notes, column, priority, due date, or delete it.
- Drag cards between columns (desktop via mouse, mobile by finger via touch).
  On phones, columns stack vertically without sideways scrolling, and cards can
  be dragged by finger with a small movement threshold. Tap a card to choose a
  column, or use the `›` button to advance it one column. Touch controls have
  larger tap targets.
- Double-click a column name to rename it; `+ New column` adds one.
- `/` focuses the filter box.

### Workflow automation

- Planning requests are recorded in **Backlog** by JARVIS.
- Moving a task into **In progress** queues it through the shared JARVIS conversation.
- If JARVIS is busy, the task shows **waiting for JARVIS…** and retries automatically.
- Completing a task promotes the oldest **Next up** task into **In progress**.
- Completed Kanban replies use JARVIS voice output when the local audio player and TTS are available.

If the board service is restarted, active runs are marked interrupted rather than silently resumed. Re-run the task from its card after the service is healthy.

## How it runs

The server binds to the detected Tailscale address, falling back to
`127.0.0.1`, on port `8787`. Override these defaults with `KANBAN_HOST` and
`KANBAN_PORT` when starting the server. The default binding does not expose the
board on every network interface.

No `kanban.service` user unit is currently installed on this machine. For an
optional persistent service, create `~/.config/systemd/user/kanban.service` with:

```ini
[Unit]
Description=H3man's Kanban board
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/h3man/Projects/kanban-omarchy-jarvis
ExecStart=/usr/bin/python3 /home/h3man/Projects/kanban-omarchy-jarvis/app.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Stop any manually started board before enabling the service:

```sh
systemctl --user daemon-reload
systemctl --user enable --now kanban.service
systemctl --user status kanban.service
```

To restart it or view logs:

```sh
systemctl --user restart kanban.service
journalctl --user -u kanban.service -f
```

No root privileges are required. If Tailscale becomes available after the board
starts, restart the service so it detects the Tailscale address.

## JARVIS integration

Run the board as H3man, in the same user session as JARVIS. The default runner
uses the local JARVIS bridge at `https://127.0.0.1:4317` and this account's local
authentication and certificate files. JARVIS must be running for task execution.
Set `KANBAN_JARVIS_URL` only if your bridge uses a different endpoint.
`KANBAN_RUNNER=direct` selects the alternative direct agent runner.

The CLI accesses the SQLite database directly. If you set `KANBAN_DB`, use the
same value for both the server and CLI so they work with the same board.

## Files

    app.py            HTTP server + REST API + SQLite layer
    kb                command line client (symlinked to ~/.local/bin/kb)
    web/              index.html, style.css, app.js
    data/kanban.db    the board (SQLite, WAL mode)

## Backup and restore

Create a consistent snapshot while the board is running, including committed
SQLite WAL data. The destination must be a new file; backups are created with
private permissions and checked for integrity and compatible board tables.

```sh
cd /home/h3man/Projects/kanban-omarchy-jarvis
python3 kb backup "data/kanban-backup-$(date +%Y%m%d-%H%M%S).db"
```

Store a copy of important backups on another disk. Commands use `KANBAN_DB` when
set, otherwise `data/kanban.db`.

Restore replaces the current board. Stop the service and **all manually started
board servers**, then explicitly confirm replacement with `--confirm-restore`.
The command refuses to restore while `kanban.service` is active. It validates
the source before changing anything and saves the existing board to a new
`<database>.before-restore-<timestamp>` snapshot first. Keep that file for rollback.

```sh
systemctl --user stop kanban.service
cd /home/h3man/Projects/kanban-omarchy-jarvis
python3 kb restore data/kanban-backup-YYYYMMDD-HHMMSS.db --confirm-restore
# Only after restore succeeds:
systemctl --user start kanban.service
```

Without the confirmation flag, restore makes no changes. Restored queued or
running tasks become interrupted; retry them explicitly from their cards.
To undo a restore, stop the server and restore the saved `before-restore` file
with the same command and confirmation flag. Do not copy a live SQLite database
file by itself: its WAL can contain committed changes.

## Verify the code

```sh
cd /home/h3man/Projects/kanban-omarchy-jarvis
python3 -m unittest discover -s tests
```

## API

    GET    /api/board
    POST   /api/tasks             {title, notes?, col?, priority?, due?}
    PATCH  /api/tasks/<id>        {title?, notes?, col?, priority?, due?, index?}
    DELETE /api/tasks/<id>
    POST   /api/tasks/<id>/move   {col, index?}
    POST   /api/columns           {title}
    PATCH  /api/columns/<id>      {title}
    DELETE /api/columns/<id>

## Recurring tasks

In a task's editor, set **Repeat** to Daily, Weekly, or Monthly. A completed
occurrence stays in Done and creates exactly one new occurrence in Next up,
copying the title, notes, priority and repeat setting. Reopening and completing
the same card does not create another duplicate.

The next due date is one interval after the later of the previous due date and
today in Europe/Bratislava. Monthly dates clamp to the last day of the next month.
Future recurring occurrences are skipped by automatic queue promotion until due;
there is no calendar timer that launches them. Move a card to In progress to
start it manually, or let completion of another task promote it once due. Set
Repeat to Does not repeat on the next occurrence to end the series.

## Dynamic Omarchy theme

The board follows the server account's current Omarchy palette from
`~/.local/state/omarchy/current/theme/colors.toml` (or `XDG_STATE_HOME`).
Open browsers check `/api/theme` every five seconds and when returning to the
page. Phones follow the server's theme too. Only allowlisted hex palette values
are returned; configuration files are not served. Missing or invalid theme files
fall back to the built-in palette. No desktop configuration changes are needed.
