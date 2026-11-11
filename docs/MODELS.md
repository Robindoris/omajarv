# Local model onboarding

`jarvis setup` opens the installer; `jarvis models` reruns just model selection.
The Assistant tab shows Open setup if configuration or voice models are missing.
Text chat works without speech models. No download starts without explicit consent in the installer or Settings.

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
  apply. The CLI installer keeps LJ Speech as its default.

Whisper/Piper binaries must be installed separately; setup offers missing packages
through the system package manager. Piper may require an AUR package and its own
license terms. Downloaded files and package-manager builds remain external trust.

## Dashboard setup

Settings contains a three-step guide: personalize JARVIS, select or download local
models, then check speech tools and microphone access. **Download missing models**
is explicit consent to fetch the pinned default Whisper/Piper files listed above.
Existing configured models are kept; discovered local models are reused before
network downloads. **Use installed models** applies those choices without network
access. You can skip voice and continue with text.

The bridge exposes authenticated `GET /api/voice-setup` for model/runtime readiness
and actual byte progress. `POST /api/voice-setup` with `{ "consent": true }` starts
one background setup job. Arbitrary URLs or model names cannot be supplied. Failed
downloads can be retried; configuration changes only after all required files are
verified. Settings edits are blocked during installation. No package-manager or
administrator command runs from this button: missing Whisper, Piper or FFmpeg
binaries are listed separately for installation on the computer.

Settings also offers explicit Whisper size choices: lightweight tiny.en (~78 MB),
balanced base.en (~148 MB), and heavy small.en (~488 MB). All are English-only,
from the same pinned whisper.cpp revision and upstream MIT-licensed Whisper weights.
The size selector keeps automatic reuse as its default. Selecting a size and pressing
Download / use selected model explicitly downloads that variant if missing and selects
it only after the whole setup succeeds. Piper setup remains independent of this choice.
The API accepts optional `whisperSize`: `lightweight`, `balanced`, or `heavy`; all
other values are rejected. GET reports the allowlisted choices and installed status.

Local model downloads are always visible in Settings, independently of the guided
setup step. Multilingual tiny (~78 MB) and small (~488 MB) are also offered at the
same pinned revision. Selecting them sets recognition language to auto; selecting
an English-only model sets English. The API choice IDs are `multilingualLight`
and `multilingualHeavy`. The current selection preview shows its size and status.

Piper has a separate **Voice output model** selector showing the pinned LJ Speech
medium download size (model plus configuration) and installed status. Its default
keeps the current voice or automatic reuse. Selecting LJ Speech and pressing
**Download / use selected model** downloads the verified pair if needed, or switches
to the installed pair. The API accepts optional `piperVoice: "ljspeech-medium"`
and GET exposes `piperChoices`; unsupported voices are rejected.


The dashboard also offers four optional, free-to-download Piper voices:
Cori high (UK English, ~114 MB), Ryan high (US English, ~121 MB),
Lili medium (Slovak, ~63 MB), and Jirka medium (Czech, ~63 MB).
Exact totals include configuration and model cards. Ryan's card specifies
CC BY-NC-SA 4.0 (noncommercial, attribution and share-alike); Cori's card lists
a public-domain dataset, and Lili/Jirka list CC0 datasets. Dataset terms do not
replace upstream model/runtime terms. Each selected voice shows its own terms
and model-card link before download.

Optional API `piperVoice` IDs are `ljspeech-medium`, `cori-high`, `ryan-high`,
`lili-medium`, and `jirka-medium`. Every file uses the same pinned Piper revision,
expected size and SHA-256 verification. Voice model cards use distinct local
filenames so installing another voice preserves previously downloaded cards.
