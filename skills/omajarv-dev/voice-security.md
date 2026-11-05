# Voice setup and privacy boundaries

Read the repository's PRIVACY.md, SECURITY.md and docs/MODELS.md when changing
permissions, authentication, model setup or downloads. This guide preserves product
behavior; it is not a request to expand ordinary UI work into another security audit.

## Model onboarding

server/lib/models.mjs discovers configured paths and bounded common model folders.
Do not recursively scan the entire home directory. Explicit model paths support ~;
Piper needs the model and matching .onnx.json. Allow reuse without copying or network
access. Missing voice models must not prevent text-only chat.

server/setup.mjs handles interactive selection. New downloads need explicit consent,
pinned upstream revisions, expected byte sizes and SHA-256 checks. Write .part files
and rename only after validation; remove failed partials. Do not bypass consent to
make an automated test pass. Tests inject fake downloads and temporary homes.

New setup offers Whisper base.en and Piper LJ Speech medium. Existing Lessac/other
models can be reused under their own terms. Model weights are not in the repo or
release. Changes to offered models require checking actual upstream artifacts,
hashes and terms; JARVIS's MIT license does not relicense models or dependencies.

Keep speech states honest: microphone capture -> transcription -> agent request ->
receiving text -> preparing voice -> playback. Release microphone/audio resources on
Stop, cancellation and errors. If speech binaries/models are absent, explain setup
and leave text chat usable. Audio limits come from config; avoid recording forever.

## Security invariants

- Fresh defaults: loopback, public tunnel off, unrestricted-agent flags off, private
  dedicated workspace. Preserve an existing user's config exactly on installer rerun.
- Tokens, private keys, sessions, histories and recordings stay in runtime state,
  outside source. Use private modes and verified loopback TLS. Do not print tokens
  or recognized speech in normal/verbose server logs.
- Anonymous requests get no access token, on any origin/proxy/LAN path. Do not restore
  the old anonymous LAN redirect. TLS failures must fail closed outside explicit
  development HTTP mode. Keep voice names/paths and speeds constrained.
- Full access is an explicit user setting. Do not weaken it for an existing opted-in
  user, and do not enable it for new users to conceal adapter permission errors.
- Local speech does not imply local inference by the coding agent. The agent can
  send prompts, tool output and file content to its own provider. Document this;
  never promise that an unrestricted agent cannot read or disclose system secrets.

Use a temporary HOME and mock systemctl, Omarchy/package-manager commands for
installer/removal tests. A temporary HOME alone does not isolate the real user
systemd bus; an unmocked test uninstall could stop the live JARVIS service.

## Encrypted phone sudo approval

`server/lib/sudo.mjs` creates a per-turn capability and a private Unix socket;
`server/sudo-run.mjs` and `server/sudo-askpass.mjs` implement the wrapper/askpass path.
The agent is given a temporary wrapper path, not a password. Use the wrapper
specified in the current request; never reuse a path from an earlier turn.

Authenticated `/api/sudo/pending` and `/api/sudo/reply` require the HTTPS-backed
bridge mode. The phone shows the requested command and working directory, encrypts
the user's response using WebCrypto RSA-OAEP, and sends ciphertext. Decryption
belongs only in the local askpass helper. Keep raw passwords out of chat, model
prompts, history, bridge logs and ordinary JSON APIs. Clear the phone input after
submission, cancellation and expiry; a polling hiccup must not silently dismiss a
pending request. Approval expires after 120 seconds and is single-use.

Keep the command in the foreground and allow the approval window to finish. The
server waits for pending approvals even if the agent finishes its textual reply.
Stop, cancellation, timeout and session close must release sockets and waiters.
Do not detach a privileged operation or finish a turn while approval is waiting.
