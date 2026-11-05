# Phone UI, QR and networking

The phone interface is server/public/, served by the HTTPS bridge. Changes here do
not require building a separate website or using a hosting provider. The desktop
Phone tab only displays connection choices and handoff; it is not the phone app.

The conversation view includes Personality editing, file attachments and image
paste; see [conversation.md](conversation.md). Phone sudo opens a separate approval
dialog; see [voice-security.md](voice-security.md). Keep all controls usable in both
conversation and voice views and test narrow/mobile safe-area layouts.

## QR contract

`jarvis qr --json` returns URL, module matrix/size and a PNG data URL. Explicit
--lan, --tunnel and --tailscale select transports. The QR must encode the complete
authenticated URL, preserve its quiet margin and render at integer module sizes.
Do not silently show a different transport's URL while a selected one is unavailable.
Discard stale results when transport/address changes. Display a useful connecting,
disabled, retry or error state instead of an endless "Generating" placeholder.

Test generated QR decoding with zbarimg, and use a clean fixture QR for public
screenshots. The actual desktop/phone token must never enter docs or shared images.

## Transports

- LAN is explicit network binding plus local HTTPS. The phone must accept the local
  certificate and grant microphone access; loopback-only mode is not LAN access.
- Cloudflare is an opt-in Quick Tunnel. It needs cloudflared, rotates hostname on
  restart and relays traffic through Cloudflare. Never enable it incidentally.
- Tailscale uses private Serve to the loopback bridge, with trusted phone HTTPS and
  a stable machine/tailnet address. Never enable public Funnel. Existing listeners
  belong to their owners; refuse to overwrite them. tests/tailscale.mjs covers this.

Transport choice belongs under Phone, alongside Cloudflare, LAN and Tailscale.
Authentication is required on all APIs; proxy/LAN headers never grant a token.
Installed-app manifests contain the token in start_url, so treat them as private.
A stable Tailscale address is useful for installation; rotating Cloudflare URLs are
not stable app identities across restarts.

Tailscale Serve now targets the private Unix-socket backend in
`server/lib/serve-socket.mjs`, not a replaceable loopback TCP listener. Preserve
socket ownership/mode checks, live-socket probing and retirement of legacy mappings;
HTTP on this private socket still passes through the shared authenticated handler.
The transport must not let another local process impersonate a restarted bridge.

## Theme updates

server/lib/theme.mjs reads active palette colors from
~/.local/state/omarchy/current/theme/colors.toml, with the older config path as a
fallback. /theme.css loads palette variables before first paint; authenticated
/api/theme refreshes open visible pages. Keep CSS chrome, canvas reactor, particles,
status colors, browser theme-color and light/dark color-scheme consistent.

Retain the last valid palette during atomic theme swaps. Do not change the user's
desktop theme just to test the phone. Use theme fixture/browser tests. The service
worker may cache palette CSS for offline colors, not APIs, conversations or access
pages. Keep browser assets cache-busted when changing their loading contract.
