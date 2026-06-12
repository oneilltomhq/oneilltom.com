# oneilltom.com

My personal site. One page; everything moving on it is the interesting part.

## The visuals

A live [Hydra](https://hydra.ojack.xyz/) video synth — but instead of
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

And because each compiled patch is a TSL node graph rather than a fullscreen
shader string, an output isn't bound to a screen quad the way real Hydra is —
it's just a `colorNode` you can hang on any material. The page demonstrates
that: the background is one synth output (`scene.backgroundNode`), and the
tumbling cube wears three more as ordinary mesh materials, all fed by the same
ping-pong feedback passes each frame.

## The cube physics

No engine — a single body ricocheting inside the camera frustum is ~90 lines
of integration: linear + angular velocity, quaternion update, and exact
oriented-box-vs-wall contact (the cube's three rotated half-edge vectors
projected onto the wall normal, so it visibly touches the wall it bounces
off).

The energy model is the deliberately non-physical part: walls act as springs
that launch the cube at a fixed speed, and flight has real exponential drag —
so momentum peaks leaving a wall and eases off mid-screen, the speed profile
of a gravity floor-bounce mapped onto all four viewport edges, in zero-G.
Impacts squash the cube along the wall normal (per-axis damped springs on a
holder group) and transfer a little spin. Pointer raycast applies an impulse
at the hit point — off-centre pokes impart torque. Rapier/Jolt/cannon would
be ~1.5MB of WASM to do the same job worse here.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

No build step. `vendor/` contains the three.js (r185+) WebGPU builds (MIT,
© Three.js Authors). Hydra is by [Olivia Jack](https://github.com/hydra-synth/hydra) (AGPL-3.0);
hydra-tsl is an independent reimplementation of the transform/compiler idea.
