# Local model onboarding

`jarvis setup` opens the installer; `jarvis models` reruns just model selection.
The Assistant tab shows Open setup if configuration or voice models are missing.
Text chat works without speech models. No download starts without an explicit yes.

Discovery checks the configured model paths and bounded common Whisper/Piper model
folders. It never searches the whole home directory. A found model can be reused in
place; it is neither copied nor uploaded. Piper needs an ONNX file and matching JSON.
Custom paths use `stt.modelPath` and `tts.modelPath`; ~ is expanded in these paths.

Optional default downloads are Whisper base.en (~148 MB) and Piper LJ Speech medium
(~64 MB with its configuration). The installer displays choices and source before
asking. Revisions, exact sizes and SHA-256 values are recorded in `server/setup.mjs`.
Downloads use .part files, are verified, then renamed. A failed verification removes
the partial file. No model weights are bundled in the plugin or release archive.

Sources and terms:

- Whisper weights: https://huggingface.co/ggerganov/whisper.cpp . Whisper upstream
  code and weights are MIT licensed: https://github.com/openai/whisper .
- Piper LJ Speech model card: https://huggingface.co/rhasspy/piper-voices/blob/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_US/ljspeech/medium/MODEL_CARD .
  This card describes the training dataset as public domain. Review the upstream
  model, runtime and dataset terms for your use; JARVIS's MIT license covers JARVIS
  source only and does not relicense dependencies or downloaded models.
- Existing Lessac or other voices can be reused, but their individual terms still
  apply. The public installer does not download the personal Lessac default.

Whisper/Piper binaries must be installed separately; setup offers missing packages
through the system package manager. Piper may require an AUR package and its own
license terms. Downloaded files and package-manager builds remain external trust.
