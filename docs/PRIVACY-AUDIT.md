# Source privacy audit — 2026-11-05

Scope: bridge routes and authentication, personality/history/config persistence,
all agent adapters, phone and native rendering, sudo authorization, speech,
Cloudflare/Tailscale, CLI/browser handoff, installer/model downloads, service
worker and source packaging. This is a source review with regression tests, not
an independent penetration test or an audit of dependencies and providers.

## Findings fixed

| Boundary | Finding | Change and evidence |
| --- | --- | --- |
| Failure diagnostics | Agent/provider stderr and errors could echo personality prompts or requests into server logs, history and client errors. Speech diagnostics could echo content too. | Agent failures now use authored messages; speech diagnostics are suppressed. Integration fixtures deliberately echo the full private prompt to stderr and verify absence from error responses, logs and persisted history. Adapter tests cover OpenCode/Hermes error envelopes. |
| Cloudflare origin | `--no-tls-verify` trusted a replacement loopback server, potentially exposing phone credentials after a crash. | Tunnel arguments now specify the bridge certificate and localhost server name. A fake Cloudflare process verifies the arguments; no live Cloudflare connection was made. |
| Audio uploads | FFmpeg could interpret uploaded playlists and follow external references. | Input is restricted to the pipe protocol. Real FFmpeg tests accept WAV/M4A and reject an uploaded HLS network reference without contacting a separate fixture HTTP server. |
| Native rendering | Names and diagnostics could be interpreted as rich text, including image references. | Native Text labels explicitly use PlainText. Conversation TextEdit controls already use PlainText. QML parsing and source guards verify the rendering configuration. |
| Phone requests | Every API fetch included the bearer token in its URL. Browser errors could print raw exceptions. | Routine requests now use X-Jarvis-Token and no-referrer. Browser fixtures assert URL queries omit the token and headers contain it. Console errors are generic. Pages also restrict external resources and framing with CSP. |
| Persistence and routine output | Replacing an existing file did not necessarily restore mode 0600. Routine history polling resent the complete personality prompt; ordinary CLI start/status printed bearer links. | Private writes now use exclusive random temporary files and atomic replacement. Existing sensitive files are hardened on read. History sends a prompt-free profile summary. Explicit url/qr/token and machine-readable status remain private credential interfaces. |

## Intentional data flow and remaining limits

- Personality instructions must go to the selected coding agent to affect its
  behavior. The agent/provider may store them or repeat them in a response. Do not
  put passwords, API keys or other secrets in personality instructions. Authenticated
  settings can read/edit the prompt; this is expected shared-device functionality.
- Onboarding answers are user messages and remain in the local transcript until
  New conversation clears it. Editing personality does not erase previous messages
  or remove prompts already held by an agent/provider.
- Chat input, transcripts and privileged command output can reach the selected
  agent/provider. Whisper/Piper processing stays local. No telemetry collector was
  found in JARVIS source. Optional network transports and model/package downloads
  remain documented external contacts.
- The sudo bridge relays ciphertext. Plaintext is decrypted only in the askpass
  helper and sent to sudo's pipe. Tests use fixture passwords and fake sudo, never
  a real privileged command. Full-access same-user agents can inspect or modify
  local helpers; the design is not OS-level isolation from a hostile local agent.
- Initial QR/access links, session storage and installed-app manifests contain the
  bearer credential intentionally. Header authentication reduces recurring API URL
  exposure; it does not remove credentials from initial links or browser profiles.
- All API routes remain authenticated and uncached. Anonymous fixtures exercise
  private read/write routes. Tailscale uses a protected Unix socket; native HTTPS
  calls use the local certificate. The service worker caches only palette CSS.
- Normal server logs omit raw failures going forward. These changes do not erase
  older local logs, transcripts, browser histories or agent/provider records.

## Verification

`tests/privacy-audit.mjs`, `tests/integration.mjs`, `tests/agents.mjs`,
`tests/sudo.mjs`, `tests/local-privacy.mjs`, `tests/offline-status.mjs`,
`tests/personality.mjs`, `tests/theme-browser.mjs`, installer, onboarding,
Tailscale, protected-socket and theme tests cover these boundaries. Tests use
temporary homes, fake agents/system tools, a fixture browser and local fixture
servers. Additional checks include shell/Node syntax, QML parsing, plugin
validation and the allowlisted source-package scan.
