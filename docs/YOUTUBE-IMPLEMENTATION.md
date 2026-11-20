# YouTube chat and voice implementation

## Preserved request

Find requested YouTube videos from chat or voice commands and play them in the integrated video player
Goal: When a user asks by voice or chat to play a video about a topic or a named video, search YouTube and play the relevant result in the existing integrated video player.
Scope: Inspect the current request routing, YouTube integration and player. Extract the search query, retrieve relevant results, select a clear match and ask the user to choose when results are ambiguous. Load the selected video in the integrated player, show its title and support existing playback controls. Handle no results, network errors, unavailable or embedding-disabled videos, and browser autoplay restrictions with a clear user action when needed. Keep credentials private.
Acceptance: Verify topic searches and named-video requests from chat and voice, ambiguous results, no results, playback controls, unavailable videos and autoplay fallback on desktop and phone. Record actual changes, test results and limitations before marking complete. Do not manage your own running task lifecycle.

Previous report: blocked. Reported implementation of search/selection/player and
passing build/unit/component-browser checks, plus five live search results. Live
 audiovisual playback and physical-phone autoplay were unverified; no active bridge
restart was performed. These earlier claims were inspected against the source;
they were not treated as proof of end-to-end functionality.

## Follow-up changes — 2026-11-20

Inspected existing query parser, yt-dlp invocation, authenticated chat SSE, browser
SSE receiver, voice automatic-send route and integrated React player. Preserved the
other pending Files, project and Kanban changes. No running task lifecycle changed.

Expanded explicit video intent parsing for polite/named/quoted/search requests.
Only unique exact-title or single-result matches start automatically; other result
sets require the user to choose. Filtered known restricted or non-embeddable search
entries. Search is bounded, ignores yt-dlp config, downloads no media and uses no
YouTube API key; provider execution is bypassed for explicit video commands.

Added visible no-result/search-error states, safe result validation, guarded iframe
messages, unavailable/embed-denied errors, autoplay instructions, loading timeout,
and Play/Pause/Restart/Retry actions alongside native YouTube controls. Closing or
switching project removes playback. Parent page executes no YouTube script; iframe
messages require both the exact source window and privacy-enhanced YouTube origin.
The embed URL/referrer include no bridge token. Minimum iframe height is 200px.

## Actual verification

- `npm run build:frontend`: passed; source and generated assets rebuilt.
- `node tests/youtube.mjs`: passed parsing, exact/ambiguous selection, filtering,
  empty/malformed results, safe bounded subprocess invocation and sanitized errors.
- `node tests/youtube-browser.mjs`: passed component checks at 1280/390/320px.
- `node tests/youtube-bridge.mjs`: passed actual isolated bridge and built frontend
  tests at 1280/390/320px. Exercises chat submit and the actual browser recording ->
  STT -> automatic voice chat -> video SSE -> integrated player route. Search,
  recording and STT are synthetic fixtures; no provider calls or model downloads.
  Includes authentication, named/topic requests, ambiguous choice, no results,
  network failure/private diagnostic sanitization, title/URL/control parameters,
  spoofed-message rejection, error 100/150, autoplay-blocked action, playback control
  clicks/state feedback, retry, Escape/close and responsive bounds. Search errors
  replace old playback with a recoverable message. Screenshots inspected.
- `node --check server/lib/youtube.mjs`, server syntax and `git diff --check`: passed.

## Remaining limitations

No live audiovisual playback, physical microphone recognition or physical iOS/Android
browser behavior was verified in this follow-up. YouTube network requests are blocked
in end-to-end fixtures; player messages are simulated. This verifies application
routing/recovery, not YouTube's current availability or real autoplay permission.
The earlier five-result live-search claim was not repeated. yt-dlp must be installed
on the host and may need updates when YouTube changes. Search results may not expose
embedding restrictions until playback. Cross-origin iframe messaging is best effort;
native controls, timeout guidance and an external YouTube link remain available if
status messages do not arrive. Browser policy can still require a tap inside the
video. Broad searches intentionally ask for a choice. Voice follow-up selections
such as “the second one” and persistent playback history are outside this version.
No live deployment or active bridge restart was performed.


## Direct link routing correction

The reported `https://www.youtube.com/watch?v=KNknduZ3NsQ open it` request did
not match the topic-search grammar and fell through to the agent. Added a separate
strict YouTube-link parser for bare links and explicit open/play/show/watch requests.
Validated watch, short, shorts, live and embed links become selected video SSE
results directly, without search, browser tools, provider execution or credential
forwarding. Non-playback requests such as summarization remain in the agent flow.
The native embed can report the actual title; until then the video ID labels the
player. Added unit and real-bridge/browser regressions for the exact reported input
at desktop/phone widths. Build and isolated tests passed; live audiovisual playback
and physical-phone behavior remain unverified. Active service not restarted.


## Automatic playback and contextual requests

Removed the special-phrase requirement: a single valid YouTube link with ordinary
surrounding text now loads directly in the built-in player. Requests to summarize,
translate, download, copy or otherwise analyze a link keep their original intent.
“Open it” / “play that in the built-in player” resolve a single link from recent
user messages in the active conversation. Assistant-supplied links, multiple links,
unrelated intervening user requests and archived/project conversations are not used.
This routing happens before agent execution; no browser tool or rewritten request
is needed. Unit and real chat/browser regressions passed at desktop and phone
widths, alongside existing voice routing checks. Backend restart is required to
activate source changes; no running task lifecycle changed.


## Natural channel / any-video requests

Added “find robindorak and play video any”, “find robindorak channel and play any
video” and “play any video from robindorak”. An explicit any/a/one-video request
permits automatic selection. Matching channel display names/handles are preferred;
explicit from/by/channel requests require a matching channel result, otherwise the
player shows choices instead of silently playing another creator. Ordinary topic
search ambiguity remains unchanged. Search still uses bounded yt-dlp metadata.
Added parser/selection and actual typed/voice browser fixtures at all three widths.


Live verification: `searchVideos('robindorak',{chooseAny:true,creator:'robindorak'})`
returned five public videos from display channel RobindoriS with handle @robindorak.
Selected `PmX9sc-00SU` (Solo freefly skydiving jump from 3000m). No account
credentials or audiovisual playback were used. Fixtures now use the differing
RobindoriS display name so handle matching is explicitly exercised. Unit and
chat/voice end-to-end checks passed at 1280/390/320px.


## Channel URL request correction

The exact request “open any video from this chanel https://www.youtube.com/@robindorak”
previously fell through because the URL parser handled videos but not channel links.
Added validated YouTube handle/channel-ID URL routing, independent of the surrounding
“channel” spelling. The backend lists up to five videos directly from the canonical
channel videos tab and selects a result when the user asks for any video. A bare
channel URL shows choices. Known non-playback intent and unsafe hosts/credentials
remain excluded. Channel metadata fills missing uploader fields in flat results.
Added exact-input unit and actual chat/voice integration regressions at all widths.

Verification: unit tests and `tests/youtube-bridge.mjs` passed, including the exact
reported misspelled command from typed chat and actual voice auto-send at
1280/390/320px. Live channel-specific lookup returned five videos from
RobindoriS/@robindorak and selected X10FNIbaeR8 (Pačky a ohen); the listing also
included KNknduZ3NsQ. Live lookup used no credentials and did not play media.
Server syntax and diff checks passed. Active backend not restarted.
