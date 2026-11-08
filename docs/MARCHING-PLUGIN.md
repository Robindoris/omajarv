# Jarvis Marching Plugin — Plan

## Goal
While the model/agent is still thinking, show a rotating deck of cool
phrases in the writing indicator instead of a static "thinking…" label.

## UX
- Indicator appears immediately when a reply is requested.
- Phrases rotate every ~1.8s with a subtle fade.
- First streamed token clears the indicator and shows the answer.
- Works on desktop and mobile without layout shift.
- Respects reduced-motion: no rotation, single phrase.

## Phrase deck (examples)
- "Marching through the codebase…"
- "Consulting the oracle…"
- "Sharpening the bits…"
- "Brewing a clever reply…"
- "Untangling the wires…"
- "Asking the silicon nicely…"

## Implementation steps
1. Add a phrase list + rotation timer in the frontend chat view.
2. Toggle visibility from the existing chat busy/streaming state.
3. Clear on first token / done / error.
4. Keep indicator height stable to avoid reflow.
5. Add tests for busy→idle transitions.

## Risks
- Race between rotation and token arrival.
- Mobile viewport overflow.
- Accessibility: announce only on change, not every rotation.