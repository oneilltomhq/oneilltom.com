# oneilltom.com

My personal site. One page; everything moving on it is the point.

The background is a live [Hydra](https://hydra.ojack.xyz/)-style video synth I
rebuilt on **Three.js TSL** — the same patch source compiles to **WGSL on
WebGPU** (with GLSL/WebGL fallback) instead of hand-written shader strings.
In front of it: raymarched metaballs from my shader library
[`@oneilltom/lib3`](https://www.npmjs.com/package/@oneilltom/lib3), and a small
body simulation with hand-rolled physics — no engine. The patch names in the
footer recompile the background shader live.

## Run locally

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # → dist/ (deployed by Vercel)
```

The build is intentionally **unminified** so the deployed source stays readable.

## Notes

- `src/hydra-tsl.js` is the synth core: Hydra transforms → TSL node graph →
  WGSL, with ping-pong framebuffer feedback.
- `test/frame-continuity.mjs` (Playwright) asserts the simulation never
  teleports between consecutive frames — a real bug once shipped as a
  GlitchPass-style double-image where each frame was individually correct but
  the *sequence* wasn't.

Three.js is MIT (© Three.js Authors); Hydra is by
[Olivia Jack](https://github.com/hydra-synth/hydra) (AGPL-3.0) — hydra-tsl is an
independent reimplementation of the transform/compiler idea.
