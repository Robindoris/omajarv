# omajarv

**Talk to your Omarchy coding agent from the bar—or from your phone.**

omajarv adds a J.A.R.V.I.S. reactor to the Omarchy bar. Open it, type a request or
record your voice, and get a reply from your default coding agent. Scan the QR in
the **Phone** tab to continue that same JARVIS conversation away from the desktop.

Whisper turns speech into text on your computer. Piper generates speech there;
replies play on the device you are using.
The coding agent handles the request using its own tools, permissions and provider.
**Local speech does not mean a local coding model.**

## Get it running

You need Omarchy Quattro, Node.js **22 or newer**, `curl`, `jq` and `openssl`, plus
an installed, signed-in coding agent selected in Omarchy. Codex, Claude Code and
OpenCode have conversation-session adapters; other included CLI adapters may have
more limited session support.

```bash
git clone https://github.com/Robindoris/omajarv.git ~/.local/share/omajarv
cd ~/.local/share/omajarv
bash install.sh
```

Keep this clone: the installer points the `jarvis` command and user service at it.
It also installs the bar plugin under `~/.config/omarchy/plugins/h3man.jarvis/`.
The plugin ID remains `h3man.jarvis`; the command is `jarvis`.

The installer walks through:

1. **Dependencies.** Ask before installing missing Whisper, Piper, FFmpeg and other
   packages. Piper may need an AUR build through `yay`.
2. **Models.** Detect existing models, offer to reuse them, download verified defaults,
   or skip voice entirely. Downloads require a separate confirmation.
3. **Networking.** Offer to review desktop/private Tailscale, home LAN, or Cloudflare
   access. Keeping the default leaves the bridge on loopback, with no public tunnel.
4. **Startup.** Install `omarchy-jarvis.service` and place the reactor in the bar.

If you install the source through the Omarchy marketplace, open the reactor and
choose **Assistant → Open setup** to run the same onboarding in a terminal.

Voice is optional. Choose **Skip** for both models to start with text chat.
To revisit setup later:

```bash
jarvis setup          # packages, models and optional network review
jarvis models         # model selection only; restart the bridge after changes
jarvis setup-status   # inspect local model readiness without changing anything
jarvis restart
```

### Which models?

| Component | Offered download | Approximate size |
| --- | --- | --- |
| Speech recognition | Whisper `base.en` | 148 MB |
| Spoken replies | Piper `en_US-ljspeech-medium` | 64 MB |

Setup checks the configured model paths and common Whisper/Piper directories. Reused
models stay in place. Downloaded models use pinned revisions and are checked against
expected sizes and SHA-256 hashes. Weights are **not** included in this repository.
See [model locations and upstream terms](docs/MODELS.md).

## At the desktop

Click the reactor to open **Assistant**.

- Type a request and press **Enter**, or click **Microphone** and then **Finish recording**.
- Watch the activity card for listening, transcription, agent processing, receiving
  a reply, or speech playback. It shows elapsed time and stopped/error states.
- Enable **Read aloud** for Piper playback. **Stop** interrupts the current request
  or playback; closing the panel while recording cancels microphone capture.
- **New conversation** clears JARVIS's shared transcript and remembered agent sessions.

Want a keyboard shortcut? Check for an existing binding, then add this to
`~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + CTRL + J", "JARVIS assistant", "jarvis toggle")
```

Phone and desktop share JARVIS history, including after bridge restarts. They do
not attach to an unrelated agent conversation already running in another terminal.
Only one agent request runs at a time.

## On your phone

Open **Phone**, choose a connection, and scan its QR with your phone camera.
Open the link in your browser and allow microphone access if you want voice input.
The computer must remain on and the JARVIS service must be running.

| Connection | When to use it | What to configure |
| --- | --- | --- |
| **Tailscale** | Private access away from home, with a stable address | Connect both devices to your tailnet, then press **Enable Tailscale tunnel**. Complete the HTTPS setup link if prompted. |
| **LAN** | Both devices are on your home network | Choose LAN in setup's network review. Accept the local HTTPS certificate in the phone browser. |
| **Cloudflare** | Access without joining a tailnet | Install `cloudflared` and explicitly choose Cloudflare in setup's network review. Cloudflare relays the traffic; the URL changes on restart. |

Tailscale uses private Serve, never public Funnel. JARVIS refuses to overwrite
another service already using the required Tailscale listener.

The phone interface follows your **active Omarchy theme**: background, text,
controls, reactor and particles. Open pages refresh their colors within five
seconds while visible. Supported browsers can install the page through **Add to
Home Screen** or **Install app**. Tailscale is the convenient choice for a saved app
because its address stays stable while the machine name and tailnet stay the same.

**The QR and access link are credentials.** Anyone holding them can send requests to
your agent. Do not put a real QR in screenshots, public issues or your README.

## What leaves the computer?

Speech recognition and synthesis run locally. The plugin has no analytics or
telemetry. Your selected **coding agent can still send prompts, file contents and
tool output to its provider**, depending on that agent's configuration. Cloudflare,
when enabled, also relays phone traffic. Setup downloads contact Hugging Face/CDNs;
package installation contacts your package repositories.

New installs use loopback-only networking, disable Cloudflare, and do not enable
unrestricted agent execution. Existing configuration is preserved. Explicitly
setting `codexFullAccess` or `agentFullAccess` can give requests your Linux user's
permissions; it does not grant passwordless root. An unrestricted agent can read
secrets if asked—JARVIS cannot guarantee against that.

Read the [privacy and data-flow description](PRIVACY.md) and [security review](SECURITY.md)
before exposing the bridge or enabling full access.

## Configuration and useful commands

| Location | Contents |
| --- | --- |
| `~/.config/omarchy-jarvis/config.json` | Agent, networking, voice and model settings |
| `~/.local/state/omarchy-jarvis/` | Access token, TLS key, agent sessions, local transcript and temporary audio |
| `~/.local/share/omarchy-jarvis/models/` | Models downloaded by setup |

```bash
jarvis status          # bridge, agent and speech readiness
jarvis start           # start the user service
jarvis stop            # stop the user service
jarvis toggle          # show or hide the desktop assistant
jarvis phone           # open the Phone tab
jarvis tailscale-status
jarvis reset           # clear the shared conversation
jarvis logs            # follow service logs; review before sharing
```

`jarvis token` deliberately prints your access credential. Keep its output private.
For endpoint details, see [the API reference](docs/API.md).

## Remove it

```bash
jarvis uninstall
```

Run this **before** removing a marketplace copy. It stops and disables the user
service and removes the launcher and plugin. Generic marketplace removal alone
cannot stop a separately installed systemd service.

Models, configuration and local history are retained. Back up or explicitly delete
those JARVIS directories yourself if you also want their contents erased.

## Development

There is no JavaScript build step or npm dependency install. The bridge uses Node's
built-in modules; the native panel uses Omarchy's QML components.

```bash
node tests/onboarding.mjs
node tests/install.mjs
node tests/theme.mjs
node tests/tailscale.mjs
node tests/integration.mjs
node tests/theme-browser.mjs  # requires Chromium
omarchy plugin validate .
```

The integration suite also needs OpenSSL, jq, qrencode and zbarimg.
Tests use temporary homes and fake agents. They do not download model weights or
change your JARVIS conversation. The browser test checks a theme change on an open
phone-sized page.

To prepare an allowlisted source package with checksums:

```bash
node scripts/build-release.mjs /absolute/path/to/empty/output
```

The builder excludes credentials, configuration, conversations, recordings, logs
and model weights, and rejects symlinks and recognizable credential patterns.
See the [publication review](docs/RELEASE-REVIEW.md) for the tested boundaries.

## License

[MIT](LICENSE) for omajarv source. Speech runtimes, coding agents and downloaded
models retain their own terms; this repository does not redistribute model weights.
