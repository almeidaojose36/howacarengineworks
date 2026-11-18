# Twin-Turbo V8 — 3D teardown video (production source)

Everything here regenerates the video. All 3D is procedural three.js (PBR materials, studio lighting, bloom, film grade), rendered deterministically frame-by-frame in headless Chromium.

| File | Purpose |
|---|---|
| `script.json` | Final narration script (improved from `twin_turbo_v8_teardown_blueprint (1).md`): line id, shot tag, text |
| `audio/` | ElevenLabs narration (voice: Brian) + per-character timestamps |
| `sfx/` | ElevenLabs sound design + music bed |
| `timeline.py` → `timeline.json` | Places every line on the timeline from the real audio durations |
| `engine.js` / `index.html` | The 3D engine model, cutaway cylinder rig, camera direction, labels, captions |
| `render.mjs` | Renderer: `node render.mjs video <f0> <f1> out.mp4 1600 900 30` (serve this folder on :8765 first) |
| `mix.py` | Mixes narration, ducked music, and SFX → `soundtrack.m4a` |
| `YOUTUBE.md`, `captions.srt` | Title, description, chapters, captions |

Mechanics are locked: crank 1×, cams 0.5×, cross-plane 90° V8 with a real firing order, valve lift from cam phase, so valves never clip pistons.
