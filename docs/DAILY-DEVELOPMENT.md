# Jarvis 2.0 daily development handoff

Opt-in for an Omarchy development machine. Runs independently of the Jarvis app and publishes reports only to the Jarvis 2.0 development board, not the installed 1.0 service.

- **21:00 local time:** a persistent user timer fetches `origin/jarvis-2.0` (not a pull), reviews local commits and dirty paths, and writes a proposed next step to `~/.local/state/jarvis-daily/plan.md`. It rolls in the most recent morning summary and any agent notes. If it cannot fetch, it labels the plan as cached or offline. A missed timer runs after the machine is available again.
- **First Omarchy desktop startup before noon:** a post-boot hook opens the handoff terminal. Press Enter to start the current Omarchy default coding agent. It reads the plan, proposes a task, and is instructed to wait for approval before editing. No agent prompt is sent until you press Enter. An absent, stale or offline plan is refreshed first.
- **Choose the next task:** in Jarvis 2.0, open **Kanban → Morning task**, pick an unfinished card with notes, and press **Use for morning**. This saves the selection on the host so the next morning session can read it even before the bridge starts. Replacing or clearing the selection applies to the next session, not one already open. Completing, deleting or queuing the selected card clears it. Choosing a card does not run it or approve edits. With no selection, the morning agent proposes a task from the evening plan.
- **During and after the session:** the agent is asked to update `sessions/<timestamp>/notes.md` after each approved task. On session exit, the runner writes `sessions/<timestamp>/summary.md` from Git changes observed between start and end. Close the agent normally for the final summary; after a hard interruption the evening plan can still use notes saved so far. These files live under `$XDG_STATE_HOME/jarvis-daily` if set consistently for the desktop and user service.
- **Jarvis 2.0 → Kanban → Done:** each saved session summary becomes one dated morning report card, with the agent's work, test results and follow-ups when available. Done means the session report is ready, not that every follow-up is complete. The job never queues an agent. Reports are visible to anyone who can access that board; do not include secrets, private data or transcripts in agent notes. If the 2.0 bridge isn't running, the reports remain on disk and sync is retried at the next evening run or session exit. To retry immediately after starting the bridge, run `~/.local/bin/jarvis-daily publish`.

The evening run does not invoke a model or run project code. It does not commit, merge, push, or modify checked-out files. The interactive agent uses the existing checkout and its configured permissions: preserve pre-existing changes, review proposed edits, and do not rely on this workflow as a sandbox.

## Install and operate

Run `bash scripts/install-jarvis-daily.sh` from the `jarvis-2.0` checkout to install or refresh the user-local copy. No sudo is needed. Set a default agent in Omarchy if you haven't already.

```sh
systemctl --user start jarvis-daily-evening.service  # prepare now
systemctl --user list-timers jarvis-daily-evening.timer
journalctl --user -u jarvis-daily-evening.service -n 20
~/.local/bin/jarvis-daily morning                    # open the handoff now
~/.local/bin/jarvis-daily task                       # show selection and eligible card IDs
~/.local/bin/jarvis-daily task TASK_ID               # choose the same way as the frontend
~/.local/bin/jarvis-daily task clear                 # clear the selection
~/.local/bin/jarvis-daily publish                    # retry unsynced Kanban reports
python3 tests/jarvis-daily.py -v                     # isolated local Git and fake-agent tests
```

To disable both entry points, stop and disable `jarvis-daily-evening.timer` with `systemctl --user disable --now jarvis-daily-evening.timer`, and remove `~/.config/omarchy/hooks/post-boot.d/jarvis-daily-morning`. Reports are kept for reference.
