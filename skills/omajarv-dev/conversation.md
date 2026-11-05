# Conversation settings, memory and files

## Personality and live memory

`server/lib/personality.mjs` owns private `personality.json` under `paths.stateDir`.
First-run chat collects assistant name, personality, then user name before invoking
an agent. Both clients expose a Personality editor via GET/POST `/api/personality`;
the desktop actions are `personality` and `savePersonality`. Updates carry the
current revision; stale edits fail with 409 rather than overwriting newer settings.
Routine `/api/history` profile summaries omit the personality prompt.

The module refreshes the state file before reads, prompt construction and revision
checks. Learned preferences saved to disk appear when reopening the editor and in
the next agent prompt without a service restart. When authorized to remember a
preference, preserve existing personality text and every other state field, append
the new fact without duplication, increment revision, and replace the private file
atomically with mode 0600. Do not put user-specific facts into this development skill.
A conversation reset clears onboarding transcript messages but preserves personality.

## Attachments and clipboard images

`server/lib/attachments.mjs` manages per-process temporary uploads outside the web
root. Authenticated raw-byte POST `/api/attachments?name=<encoded filename>` returns
only `{id,name,size,type}`. Chat accepts `attachments: [id, ...]` and permits files
without text after personality setup. POST `/api/attachments/remove` removes unsent
uploads; referenced files are retained for follow-up turns. Both clients clear the
pending list on the server's `meta` acceptance event, not optimistically on Send.

Preserve the implemented boundaries:

- 10 MiB per nonempty file, four distinct IDs per message, two concurrent uploads,
  100 MiB/100-file storage quota, and a 30-second upload inactivity timeout.
- Random IDs and exclusive 0600 files in a 0700 directory. Reject filename control
  characters, separators and oversized names. Client-provided paths are never read.
- No HTTP file downloads, active previews or automatic execution. Render names as
  plain text. Inspect raster signatures rather than trusting MIME or extensions.
- Files expire after 24 hours except during an active turn. New conversation and
  normal shutdown delete uploads; startup reaps abandoned directories older than
  24 hours without following directory symlinks. Restart invalidates attachment IDs.

The prompt includes private local paths and explicitly treats names/content as
untrusted data. Codex additionally gets recognized PNG/JPEG/WebP via `--image`,
including resumed turns. Other supported agents use file-reading tools; their file
format support and permissions differ. These controls are not malware scanning or
a guarantee against prompt injection. Files may reach the agent provider, and its
session retention is separate from local cleanup.

Desktop `server/desktop.mjs` owns the pending list. `attachFiles` invokes zenity;
`pasteClipboard` reads wl-paste only after a user gesture, supports image-only mode,
and emits `clipboardText` for ordinary Ctrl+V text. `removeAttachment` removes a
pending ID; `attachments` events synchronize QML. Preserve bounded subprocess
output/timeouts and regular-file checks with no symlink following. Dependencies:
zenity and wl-clipboard. A helper restart can lose its unsent list.

Phone uses a multi-file picker, paste events on the composer, and a Clipboard API
button. Browser permissions/platform support vary; keep the picker fallback.
Prevent sending/resetting during uploads and keep errors actionable. On narrow
screens bound composer and attachment widths and scroll the pending list.

## Agent model selection

`server/lib/agent-models.mjs` and GET `/api/models` expose agent-specific metadata;
POST `/api/agent/model` validates choices and stores `config.agentModels[agentId]`.
Desktop actions are `models` and `setModel`. OpenCode lists provider/model IDs with
free variants first; Hermes currently supplies a note directing users to `hermes
model`, not a selectable list. Codex/Claude do not expose this picker. Do not invent
models for unsupported agents. Selection/reset must respect an active chat, and
model lookup must not take the chat/recording lock or change the activity label.
