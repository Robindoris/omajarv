# Security review and reporting

This is a source review and regression-test result, not an independent penetration
test or a guarantee against every disclosure. Report vulnerabilities privately to
the repository owner's GitHub private vulnerability reporting channel when enabled.
Do not post access links, tokens, private keys, transcripts, or your configuration
in public issues. If private reporting is unavailable, first open an issue asking
for a private contact without including exploit details or credentials.

Publication-preparation changes:

- Removed anonymous token redirects on every network path (including Tailscale).
- Replaced ordinary string token comparisons with timing-safe comparisons.
- New installs use loopback only; Cloudflare requires opt-in.
- New installs do not bypass agent permissions; personal opt-ins remain local.
- Removed access links and recognized speech from normal/verbose server logging.
- Local CLI calls use verified loopback HTTPS with credentials passed over stdin.
- Restricted voice names and speech speeds before invoking Piper.
- Added private runtime permissions and a dedicated default agent workspace.
- Model downloads require consent, pinned revision, expected size and SHA-256.
- Added first-run model discovery without scanning the whole home directory.
- Release builder uses a source allowlist and rejects symlinks and credential patterns.
- Raw tool/provider diagnostics are replaced by application-authored errors.
- Cloudflare forwards to the protected private Unix socket instead of a loopback TCP origin.
- Audio decoding reads a restricted pipe and cannot follow uploaded network/file playlists.
- Native labels render as plain text; phone pages restrict external resources and framing.
- Routine phone API calls use an authentication header rather than bearer query strings.
- Personality and history writes are atomic private files, including replacements of older files.

Remaining trust boundaries:

Phone sudo authorization uses a per-turn Unix socket in a mode-0700 directory,
with a mode-0600 socket and random capability. Requests exist only during an active
HTTPS-backed chat. Each askpass invocation creates an RSA-3072 key pair in memory;
the phone uses RSA-OAEP/SHA-256 to encrypt the password, and the bridge relays only
ciphertext. The private key and decrypted password stay in the askpass process,
whose stdout is sudo's password pipe. The API rejects plaintext password fields,
requires authentication and JSON submissions, and does not log request bodies.
Replies are one-use; cancellation, expiry, Stop and turn completion remove pending
requests. No password cache or sudoers bypass is added. Password buffers are
cleared after use, although JavaScript cannot guarantee erasure of all memory
copies or protection from same-user inspection. A hostile full-access local agent
can modify helpers or impersonate a request; this is not a separate OS security
principal. HTTPS intermediaries remain trusted to serve unmodified frontend code.

Anyone holding a valid access link can issue requests to your coding agent. Full
access is equivalent to trusting that requester with your Linux account. Agent
providers and tool execution remain outside JARVIS's control. Remote authentication
is a shared bearer token, not per-device accounts or an enterprise identity system.
The development HTTP mode is for local tests, not remote use. This review does not
independently audit Whisper, Piper, Node.js, Cloudflare, Tailscale, agents, or models.

Personality instructions are intentionally sent to the selected coding agent and
can be retained or repeated by that agent/provider. They are not a secret vault.
The full prompt is available through authenticated personality settings; routine
history responses include only names, onboarding stage and revision. Answers
typed during onboarding remain part of the user's local transcript until cleared.
Initial phone links and installed-app manifests still contain the bearer token by
design; keep them private. See [the source privacy audit](docs/PRIVACY-AUDIT.md).

Uninstall with `jarvis uninstall` before removing a marketplace copy; this stops and
disables the user service and removes its launcher. Models, config and local history
are intentionally retained. Generic removal in the marketplace cannot stop an
independently installed systemd service. Delete retained data separately if desired.

Local process visibility: phone QR and clipboard helpers receive bearer links on
stdin. Offline status also passes its bearer URL to jq over stdin. Browser opening uses a private temporary HTML handoff, removed after a
short delay (an interrupted launcher can leave it in the private temp directory).
Agent requests use stdin with Codex, Claude, OpenCode and Hermes; other adapters
fail closed rather than put requests in process arguments. OpenCode uses a private
standalone server. Hermes uses ACP session loading, text updates and explicit
`session/cancel`, so stopping a request does not merely detach from gateway work.
OpenCode auto-approval and approving Hermes ACP permission requests require the
explicit `agentFullAccess` setting. Otherwise Hermes permission requests are
denied, and OpenCode retains its configured permission rules.
Speech uses whisper-cli even with an older server configuration. Unauthenticated
localhost whisper-server listeners are never used; install whisper-cli for voice.

Cloudflare Quick Tunnels and private Tailscale Serve forward HTTP over a Unix socket in JARVIS's private state
directory, with socket permissions restricted to the current user. It does not
trust a replacement listener on the bridge's TCP port. Startup, stop and uninstall
retire the legacy certificate-unverified TCP mapping; uninstall removes JARVIS's
socket mapping too. Cleanup preserves other applications' Serve routes and fails
closed when an installed Tailscale service cannot be inspected.

Attachments require the existing authenticated API. Storage uses randomized IDs,
mode-0700 directories and exclusive mode-0600 files outside the web root; clients
cannot supply filesystem paths. Filenames are bounded and reject separators and
control characters, and both UIs render them as plain text. Upload size, count,
concurrency, lifetime and storage quotas are bounded. Native selection rejects
symlinks and special files, and clipboard reads occur only on explicit paste.
Raster image type is detected from bytes for Codex's image input. Other files are
provided as private local paths for agent tools; the bridge never executes or
previews them. Attachment instructions mark contents as untrusted, but this is not
malware scanning or a guarantee against prompt injection: the selected agent's
permissions remain the boundary for any tool actions it chooses to take.


Native clipboard and process limits (marketplace review #14823): keyboard paste
and middle-click PRIMARY paste in chat and all three personality editors are
intercepted before Qt's native paste handler. Right-click native paste menus are
suppressed. Only explicit paste starts an external `wl-paste` process: text is
limited to 64 KiB/5 seconds, MIME listings to 16 KiB/5 seconds, and images to
10 MiB/10 seconds. The field's remaining character allowance applies before
insertion. The helper kills its process group on timeout, overflow or cancellation.

Piper help is limited to 4 seconds/64 KiB. Synthesis permits one active request,
no waiting queue, 30 seconds per attempt, 64 KiB combined stdout/stderr, and a
16 MiB kernel-enforced output-file limit through util-linux `prlimit`. A legacy
flag retry occurs only after an unsuccessful exit, so total synthesis runtime
is at most two attempts plus discovery. Temporary WAV files are removed after
success or failure. Installation no longer automatically falls back to
`piper-tts-bin`; this change does not attest provenance of user-installed binaries.

The desktop bridge bounds each JSON response (2 MiB; audio 16 MiB), a chat stream
(4 MiB total, 512 KiB pending block, 8192 events), accumulated reply (256 Ki
characters), pending stdout (2 MiB), stdin lines (64 KiB) and simultaneous command
dispatches (8, with no waiting queue). HTTP requests have absolute deadlines as
well as idle timeouts. Finite native status/setup/QR/service helpers run outside
the shell with a 2 MiB combined output cap and 15-second deadline (120 seconds
for service lifecycle and Tailscale-enable commands). Playback has a 120-second deadline; recording
has its configured duration plus a 5-second hard deadline and 16 MiB file cap.
Exit/cancellation kills tracked process groups; recording finish gives SIGINT
one second before SIGKILL. These limits cover the native bridge/helper paths,
not an independent security audit of all dependencies or agent/provider queues.

Agent CLI stdout is capped at 4 MiB per turn and stderr at 1 MiB; emitted text
is capped at 256 Ki characters and cumulative-message sources at 4096. Hermes
also caps events (8192), pending RPCs (8) and queued stdin (256 KiB); cancellation
still uses ACP acknowledgement where the bounded transport remains available.
An oversized raw Hermes transport is terminated with cancellation explicitly
reported as unconfirmed. Outgoing HTTP chat streams cap total bytes (4 MiB),
events (8192) and queued writes (512 KiB), aborting the turn on overflow.
