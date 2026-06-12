# oneilltom.com

My personal site. One page; the background is the interesting part.

## The background

It's a live [Hydra](https://hydra.ojack.xyz/) video synth — but instead of
hydra-synth's hand-built GLSL strings, the Hydra core is **compiled to Three.js
TSL**, so the same patch source emits **WGSL on WebGPU** with automatic
GLSL/WebGL fallback:

```js
noise(3.5, 0.1)
  .modulate(src(o0).scale(1.02).rotate(0.01), 0.025)
  .kaleid(6)
  .color(1.2, 0.8, 1.6)
  .contrast(1.3)
  .out(o0)          // ← real Hydra syntax → TSL node graph → WGSL
```

The whole core is [`hydra-tsl.js`](hydra-tsl.js) (~300 lines): transform
definitions, a compiler (a port of hydra-synth's `generateGlsl()` recursion
that emits TSL node closures instead of strings), ping-pong framebuffer
feedback, and the synth class. The patch names in the page footer recompile
the shader live in your tab.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

No build step. `vendor/` contains the three.js (r185+) WebGPU builds (MIT,
© Three.js Authors). Hydra is by [Olivia Jack](https://github.com/hydra-synth/hydra) (AGPL-3.0);
hydra-tsl is an independent reimplementation of the transform/compiler idea.
