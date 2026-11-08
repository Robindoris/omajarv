# IP camera setup

Use a camera with RTSP video and an audio track. The computer running JARVIS must
be able to reach the camera on a trusted private LAN. Install FFmpeg separately if
missing. Whisper models remain necessary for speech recognition; Piper is optional
for spoken replies. Opening camera Settings does not install or download anything.

1. In the camera’s own app, enable RTSP and microphone audio. Find its RTSP stream
   address and camera account details. Some cameras expose audio only on their main
   stream. Use the stream documented by the camera manufacturer.
2. Open sidebar **Settings → IP camera and optional microphone**. Enter the RTSP
   address using the camera’s private IPv4 address. Enable streaming and save.
   The input is cleared after saving; a blank input keeps the private saved address.
3. Click **Test video stream**. A live preview should appear. Click **Stop camera
   test** when done. Video preview tests stop automatically after 30 seconds.
4. Lower speaker volume, then click **Test camera audio**. This plays camera sound
   locally and stops after 10 seconds of playback. Tests never send media to an AI
   or create transcription requests. Leaving Settings stops active tests.
5. Choose **Camera microphone**, save, and use the normal voice record control.
   Camera audio becomes the microphone input without requesting a device microphone.
   Stop/cancel releases the stream. A camera disconnection cancels the recording
   and shows an error rather than sending incomplete audio.
6. Select **This device’s microphone** to switch back. **Forget camera** asks for
   confirmation, removes the saved address, disables streaming and selects device input.

## Troubleshooting and limits

- Supported input: `rtsp://` on literal private IPv4 addresses in 10/8, 172.16/12,
  or 192.168/16. Hostnames, IPv6, public addresses, loopback, cloud-only cameras,
  HTTP/MJPEG-only input and RTSPS are not supported in this version.
- Check that the bridge computer, rather than just your phone, reaches the camera.
  Check the camera account and RTSP stream path in the manufacturer’s app.
- Video without audio usually means that stream has no audio track or the camera
  microphone is disabled. Test both separately before selecting camera input.
- Connection failures and missing FFmpeg are reported without raw camera diagnostics.
  The microphone never silently switches to another device after a camera failure.
- Save settings only after stopping tests and recording. At most three camera
  processes may run. Video sessions are bounded to 60 seconds; recording audio is
  bounded to the configured recording limit plus 10 seconds (30–610 seconds).
- Video is an 8fps, 640px-wide preview, without synchronized audio. Separate audio
  testing is for listening, not camera talkback. Video is never sent to the AI.
- RTSP traffic is not encrypted. Use a trusted LAN. Browser-to-bridge authentication
  is unchanged. The private saved address may contain credentials; API responses and
  media URLs omit it. Local administrators can inspect FFmpeg process arguments.
- First installation of the backend requires restarting the identified bridge while
  idle; frontend changes require refreshing the page. Never restart a running board
  task or active response to deploy this feature.

## Verification

Automated checks use fake RTSP process inputs, encoded JPEG frames and PCM audio;
no real camera or user credentials are required:

- `node tests/ip-camera.mjs`: address validation, credential redaction, persistence
  failure handling, audio/video bytes, process limits, client disconnect, shutdown
  cleanup, disabled input and sanitized errors.
- `node tests/camera-media.mjs`: explicit source selection, signed PCM conversion,
  track stop/fetch cancellation, no silent fallback, context cleanup and disconnect
  signaling.
- `node tests/voice-settings.mjs`: real bridge authentication, same-site validation,
  camera settings, credential omission, and disabled-stream handling.
- `npm run build:frontend` and `node tests/theme-browser.mjs`: desktop and mobile
  (1280px, 390px, 320px) save/forget, video preview, audio playback, camera-only
  push-to-talk, stop cleanup, disconnection without upload, stream errors and retry.

These checks pass. Real camera compatibility still requires using both test buttons
with that camera’s address and credentials. No real camera was available for this
verification.
