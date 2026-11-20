# Calendar reminders in the Omarchy top bar

Stage 1 inspection and implementation contract, 2026-11-12. This is a design;
no native notification behavior is implemented by this document.

## Source and ownership

The checkout origin is Robindoris/omajarv and the working tree was clean at
inspection. Use this source, preserve later user changes, and inspect deployment
ownership before installation. No installed configuration or service was changed.

| Concern | Existing owner |
| --- | --- |
| Calendar, recurrence, notification lifecycle and persistence | `server/lib/planner.mjs` |
| Authenticated calendar/notification routes and scheduler | `server/jarvis-server.mjs` |
| Calendar editor and shared inbox | `frontend/src/calendar.jsx` |
| Dashboard notification badge | `frontend/src/dashboard.jsx` |
| Native icon, health polling and panel lifecycle | `plugin/h3man.jarvis/BarWidget.qml` |
| Native panel and line-delimited command transport | `plugin/h3man.jarvis/Panel.qml`, `server/desktop.mjs` |
| CLI dispatch | `bin/jarvis` |

## Current contract

All API calls require bridge authentication. GET `/api/calendar` returns
`revision`, `events`, `occurrences`, and host `timeZone`; optional numeric `from`
and `to` bound a range of at most 400 days. Event fields include `id`, `title`,
`notes`, epoch-millisecond `startAt`/`endAt`, IANA `timeZone`, `reminderMinutes`,
`recurrence`, `createdAt`, `updatedAt`, and scheduler cursor `nextStart`.
Calendar writes use ISO date inputs, revision and requestId checks.

GET `/api/notifications` returns `{items, unread}`. Items are newest insertion
first, excluding dismissed items and items whose snooze has not expired.
`unread` counts all visible unread items, including Kanban alerts. Each item has
`id`, deduplication `key`, `source`, `targetId`, `title`, `body`, `createdAt`,
`read`, `dismissed`, `snoozedUntil`; calendar items also have `when` (occurrence
start in epoch milliseconds). The item does not contain event notes, end time,
or a separate timezone field. Its body already includes event-zone start time.

POST `/api/notifications` accepts JSON with `id` and action:

- `notification:read`: sets read true; item remains visible.
- `notification:dismiss`: hides the item persistently.
- `notification:snooze`: minutes must be 5, 15 or 60; hides until expiry and
  resets read to false. Dashboard currently offers 15 minutes.

Success returns `{ok:true}`; fetch a new snapshot after mutation. Missing IDs
return 404; invalid actions/minutes return 400; storage failures return 503.
These notification writes currently have no revision/requestId protection.
Do not add transparent mutation retries: snooze is relative to server time and
replaying it extends the delay. Preserve errors and refresh before user retry.
Cross-site requests and non-JSON mutation bodies are rejected.

## Reminder lifecycle

The bridge alone ticks at startup, every 15 seconds, and after calendar or
notification mutations. GET does not itself tick. An overlap guard prevents
concurrent scheduler ticks; planner transactions serialize writes. State lives
in PostgreSQL planner_state when configured, otherwise private atomic JSON.
A configured database failure does not silently switch storage backends.

At `nextStart - reminderMinutes`, collection creates an unread item once using
`event:eventId:updatedAt:occurrenceStart` as its deduplication key and advances
the saved cursor. One-time cursors become null. Repeated ticks/restarts preserve
identity. Calendar edit/delete removes existing notifications for that event;
an edit resets its cursor and may legitimately create a replacement reminder.

Catch-up emits only occurrences whose end has not passed; it does not replay
all reminders missed while the bridge was stopped. Long recurrence gaps use a
bounded catch-up loop. Recurrence preserves event-zone wall time across DST,
moves nonexistent times forward and clamps monthly dates to month end using
the original anchor. No native client may calculate or schedule occurrences.
Retention is capped at 500 notification records across sources, including hidden
ones; dismissed records eventually evicted by that cap are not a permanent ledger.

The browser polls every 10 seconds while visible, even outside its inbox page.
Its badge includes calendar and Kanban notifications. Open marks an item read,
selects calendar/Kanban and emits `jarvis-notification-open`; calendar selects
the occurrence day using `when`. It does not open a specific event editor.
The native bar has no inbox today: it polls `jarvis status --json` at a default
20 seconds (minimum 5), and that timer currently stops when animate is false.
Left click toggles the panel; right click refreshes status. Assistant and Phone
are the two native top-level tabs.

## Proposed native experience

Keep the reactor and health indicator. Add a small calendar badge showing only
visible unread calendar items, calculated from the shared snapshot, capped
visually at 99+. Do not use the mixed-source unread total for this badge.
A zero count hides the badge. A reminder is due when the server delivers it;
no local countdown changes notification state. Read items remain in the inbox.

Retain left-click panel toggle, right-click refresh, IPC open/close/toggle/phone
and Assistant/Phone tabs. Place an accessible calendar-notifications button in
the existing Assistant panel, showing the count and opening a bounded inline
inbox. When calendar unread items exist, opening the panel reveals that inbox
without marking items read. Badge rendering stays inside iconComponent and
must remain legible without widening or shifting the bar unpredictably.

Rows show title, server-supplied body, received time, and unread state as plain
text. Provide Mark read, Snooze 15 min, Dismiss and Show event details. The latter
loads the calendar event by targetId, displays description and occurrence time
in the existing inline native view, and marks read only after successful loading.
Use `when`, not the recurring event's original start, for the selected occurrence;
derive end from original duration. A missing target refreshes the inbox and
shows an unavailable message. No credential-bearing browser deep link is needed.
Local received times must be labelled as local; preserve the event timezone
explicitly for occurrence details. Never parse formatted body strings as dates.

Poll notifications independently of animation and chat work, every 10 seconds
while the bar exists, immediately on opening/reconnect and after mutations.
Allow at most one snapshot request in flight. Normal delivery latency is up to
roughly 25 seconds from scheduler and polling intervals, excluding failures.
Reject late snapshots superseded by a mutation/refresh using a client generation
counter. On failure retain the last snapshot as stale, show disconnected state,
disable mutations, and retry reads on the normal bounded cadence. Do not show a
false zero count or infer authentication failure means an empty inbox.

## Ordered implementation

1. Stage 2: extend `server/desktop.mjs` with read and notification-action commands
   and typed JSON output, reusing its authenticated certificate-verified request
   helper. Keep credentials inside the process, never QML arguments or output.
   Expose an allowlisted one-shot notifications read through the CLI for the bar
   if needed so polling does not depend on an open panel. Centralize snapshot
   ownership to avoid duplicate bar/panel pollers; forward snapshots to the panel.
   Use existing API routes, not another scheduler or duplicate storage. Snapshot
   reads and notification actions must not take the chat execution lock.
2. Stage 3: add calendar badge and independent refresh timer to BarWidget;
   add the inline inbox/details and safe command handling to Panel. Use Omarchy
   tokens, plain text, visible focus, labelled controls and bounded scrolling.
   Keep notification errors separate from chat/activity state. Respect reduced
   motion and test with animation disabled. No desktop toast/sound is required;
   this avoids duplicate announcements alongside the shared dashboard inbox.
3. Stage 4: verify both consumers, document user behavior and limitations, and
   validate plugin packaging. Identify live installation before any authorized
   deployment; do not restart a busy bridge or change installed files speculatively.

## Targeted verification and evidence

Stage 1 ran `node tests/planner.mjs`: PASS with isolated JSON state and fake clock.
It covers CRUD validation/revision conflicts, recurrence/DST/month-end behavior,
reminder deduplication, read/snooze, task alerts and persistence. PostgreSQL mode
and browser/native rendering were not run for this documentation-only stage.

Implementation acceptance checks:

- Extend planner fixtures for dismiss, snooze expiry, edit/delete invalidation,
  catch-up before/after event end, recurrence at DST fall-back and restart identity.
- Run `node tests/kanban-bridge.mjs` and extend authenticated notification route
  coverage for all actions, malformed input, missing IDs and storage failure.
- Test desktop command allowlists, sanitized failure output, mixed-source filtering,
  empty inbox, reconnect, one request in flight and stale response suppression
  with fake transport. Assert notification commands work during an active reply.
- Extend `tests/theme-browser.mjs` for shared read/snooze/dismiss, replacement after
  edits, and target selection; run its desktop/mobile fixtures if web behavior changes.
- With isolated synthetic calendar data, inspect native badge and details against
  the same bridge snapshot as the dashboard. Verify independent polling with
  animation disabled, long/hostile titles, keyboard/Escape focus, short screens,
  theme changes, offline recovery, repeated opening, and preserved phone/toggle IPC.
- Run planner integration against a dedicated test PostgreSQL schema when available;
  test transactional failures/restart without touching real calendar data. Record
  separately when database/native checks are unavailable rather than claiming them.

Stage 1 is complete when this contract is reviewed against the owning source and
its recorded planner check passes. Later stages must record their own evidence;
this design does not establish that the native feature works yet.

## Stage 2 implemented contract

The native desktop process accepts these line-delimited JSON commands:

| Input action | Additional fields | Output event |
| --- | --- | --- |
| notifications | none | notifications: items, unread |
| notificationRead | id | refreshed notifications |
| notificationDismiss | id | refreshed notifications |
| notificationSnooze | id, minutes (5, 15, 60) | refreshed notifications |
| notificationDetails | id | notificationDetails: id, event |

Snapshots contain calendar items only; unread is recalculated for that subset.
Original IDs, body and occurrence timestamps are preserved. Details return id,
title, notes, IANA timeZone, recurrence and occurrence-specific startAt/endAt.
Details lookup does not mark read: the UI sends notificationRead after displaying
successfully. Failures emit notificationError with a fixed safe error; callers
retain their last snapshot. Commands serialize independently of chat and do not
emit chat activity states. Transport uses existing pinned loopback TLS and token
headers. Calendar/notification requests time out after ten seconds. Mutations
are never retried automatically.

The CLI command `jarvis notifications` reads once, emits one notifications JSON
event and exits zero; failure emits notificationError and exits nonzero.
Credentials never enter arguments. Stage 3 should use one BarWidget-owned poller
and forward snapshots to the panel. Explicit HTTP dev instances remain unsupported
by the pinned TLS native helper; there is no insecure fallback.

Verification: isolated native contract and planner tests pass with fake clocks,
including due delivery, edit/delete invalidation, shared read/snooze/dismiss,
DST, restart identity, missed ended events, reconnect, serialization and safe
errors. The TLS integration fixture checks matching native/dashboard IDs,
native read propagation and one-shot polling. Desktop model and private-socket
bridge regression tests also pass. Live reminders, native rendering, PostgreSQL
deployment and service restarts were not used for this stage.

## Stage 3 and final verification

The native bar now displays a calendar unread count using the shell's standard
count label, capped at 99+. Zero hides it. Visual inspection found an overlaid
count inside the small reactor was illegible; the final design uses the label
beside the reactor instead. The reactor remains inside iconComponent. Count
changes use the native button's normal sizing and cannot expand with event titles.
The tooltip distinguishes calendar availability from bridge health.

Left click retains toggle behavior and opens the reminders view when unread
calendar items exist. Assistant also has an explicit Calendar reminders button;
Assistant/Phone remain the two top-level tabs. The modal reminders view has a
bounded scroll area, close control, Escape handling and focus return. It displays
plain-text titles and server-supplied event-zone schedule text; actions are Mark
read, Snooze 15 min, Dismiss and Show event details. Details show occurrence times
labelled device-local plus the saved IANA timezone and event description. Opening
the inbox alone does not mark read. Successfully loading details does.

The bar owns one read-only poll every ten seconds regardless of the animate
setting; opening and manual refresh trigger a read too. Pending native actions
suspend polling and invalidate older in-flight snapshots. Native action results
update the bar and panel together. Failures retain the last snapshot with an
offline message and disabled actions. Healthy reads restore availability. No
extra reminder scheduler, toast, sound or browser permission is introduced.

Verification on 2026-11-12:

- Planner and native contract tests: PASS, isolated JSON storage and fake clocks.
  Covers due reminders, recurrence/DST including fall-back, monthly clamping,
  snooze expiry, read/dismiss, edits/cancellations, missed ended events, stable
  IDs over restart, mixed-source filtering and unavailable-bridge recovery.
- Desktop TLS integration: PASS. Real authenticated pinned TLS with a fake agent
  verifies matching dashboard/native reminder IDs, read propagation and the
  one-shot polling command. Existing chat, attachment, Stop and privacy checks pass.
- Private-socket bridge tests: PASS, including notification authentication,
  read/snooze/dismiss, invalid snooze/action and missing IDs, plus existing board
  and voice regressions. Desktop model metadata regression: PASS.
- Browser fixtures: PASS at 1280, 390 and 320 pixels, including calendar creation
  and notification inbox rendering, plus existing layout/theme/interaction checks.
- Native Wayland smoke: PASS using installed Omarchy UI components and a fake CLI
  in an isolated home. Covers multiple unread reminders, actual panel opening,
  repeated close/open, shared read/dismiss results, retained stale state, reconnect,
  theme accent changes, and polling with animation disabled. The test is
  tests/native-calendar-smoke.mjs; set JARVIS_NATIVE_WAYLAND_RUNTIME to an accessible
  Wayland runtime when running it. It does not invoke real service managers.
- Separate rendered inbox previews inspected: multiple reminders, long wrapped
  titles, read/unread rows, empty inbox, offline disabled actions and theme changes.
  Count-label screenshots inspected before and after theme changes. QML fixture
  warnings about missing DBus and a model-list field came from isolated fixture
  context; the full panel loaded and lifecycle/action assertions passed.

Operational limits: the bridge must run to generate reminders; ended occurrences
missed during downtime do not generate old alerts. Normal polling delivery is
approximately 25 seconds at worst before transport delays. The desktop helper
requires pinned TLS and does not support HTTP-only dev bridges. Notification
retention remains 500 mixed-source records. PostgreSQL-specific tests were not run
in this verification; no storage logic changed. Live installation/deployment was
not performed and no real calendar entries or active services were changed.

Board audit: stages 1 and 2 were completed. Stage 3's runner recorded "Codex timed
out", leaving it failed even though its source changes were present. This review
finished visual verification and corrected count readability. Its task execution
state was deliberately not changed by this running task. Implementation checks
above describe verified source behavior, not a repaired board lifecycle record.

### Stage 3 retry verification

The explicit stage 3 retry confirmed stages 1 and 2 are completed and retained
all existing source edits. The native Wayland smoke, fake-clock native shared
notification contract and authenticated TLS integration tests were rerun against
the final implementation: all PASS. The readable count label, theme changes,
multiple reminders, shared read/dismiss, offline snapshot retention, reconnect
and repeated panel lifecycle remain verified. The earlier timeout above is a
historical runner outcome; this retry made no manual board execution changes.
Live deployment is still separate from these source and isolated rendering checks.

## Native popup delivery and live integration correction

The user clarified that native Omarchy notification popups are required, like
other desktop applications. This supersedes the earlier design excluding toasts.
The installed widget was still the older version and the dashboard's development
bridge uses a separate state directory. Deploying source alone had not connected
these two running instances.

The native notifications CLI now uses the authenticated, owner-checked mode-0600
Unix socket, with no TCP fallback. It accepts an optional explicit state directory
so calendar polling/actions can target Jarvis 2.0 without redirecting the older
assistant's chat or changing either server. The bar's calendarStateDir setting
selects this store. When selected, calendar mutations/details use the same separate
CLI process, with command JSON through stdin. Existing installed panel edits were
preserved and rollback copies were saved before deployment.

The bar passes --deliver by default (nativeCalendarToasts can disable popups).
The CLI sends visible unread calendar reminders using notify-send, app name
Jarvis 2.0, normal urgency and a ten-second requested timeout. The desktop daemon
owns popup appearance and Do Not Disturb behavior. Popup text is markup-escaped.
No reminder content is written to logs. Delivery records contain only reminder
IDs and snooze timestamps, privately persisted beside the selected state.
Successful delivery is suppressed on subsequent polls/reloads; a later snooze
expiry may notify again. A lock avoids overlapping deliveries across bar instances;
a batch is limited to five reminders. Failed sends are retried on later polls.
Delivery and receipt persistence cannot be atomic across the external notification
daemon: a crash between them may cause a duplicate. Popups do not automatically
mark the shared inbox read or dismiss it.

Live verification: the selected Jarvis 2.0 inbox contained one unread calendar
reminder. The installed CLI delivered it successfully to the Quickshell desktop
notification service and recorded one delivery receipt. Existing user calendar
entries were not edited. The plugin was validated and rescanned without restarting
the bridge. Toast unit tests pass for persistent deduplication, snooze redelivery,
read/source filters, retry, bounded batches, private modes and markup escaping.
Private-socket integration tests verify reads, read propagation and details against
an isolated HTTP-mode bridge, confirming no certificate or insecure TCP fallback
is needed for the native local consumer.
