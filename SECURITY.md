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

Remaining trust boundaries:

Anyone holding a valid access link can issue requests to your coding agent. Full
access is equivalent to trusting that requester with your Linux account. Agent
providers and tool execution remain outside JARVIS's control. Remote authentication
is a shared bearer token, not per-device accounts or an enterprise identity system.
The development HTTP mode is for local tests, not remote use. This review does not
independently audit Whisper, Piper, Node.js, Cloudflare, Tailscale, agents, or models.

Uninstall with `jarvis uninstall` before removing a marketplace copy; this stops and
disables the user service and removes its launcher. Models, config and local history
are intentionally retained. Generic removal in the marketplace cannot stop an
independently installed systemd service. Delete retained data separately if desired.
