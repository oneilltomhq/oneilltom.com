// ---- the signal graph: named nodes for the score's circuitry -----------
// Every stateful primitive in the score (spring, one-pole, latch,
// accumulator) owns its state inside a node object here, and every named
// derived quantity writes through a tap node at the moment it's computed.
// The imperative step() remains the single source of truth — its statement
// order IS the topological sort of this graph (the e1 doctrine: "the code
// is the linearization") — but the graph is honest: node state is the ONLY
// place spring/slew state lives, and a tap write is the only output path a
// derived value has. The overlay renders exactly what runs.
//
// Zero dependencies, zero site knowledge — pure JS + Math.
export function createGraph() {
	const list = [];
	const byId = new Map();
	const def = (kind, id, spec = {}) => {
		const n = {
			kind, id,
			label: spec.label ?? id,       // human name for the overlay
			caption: spec.caption,         // plain-words phrase (e1 style)
			unit: spec.unit,
			min: spec.min,
			max: spec.max,
			inputs: spec.inputs ?? [],     // upstream node ids: [{ from }]
			stages: spec.stages ?? null,   // null = always live; else the
			                               // phrase stages where this node
			                               // is alive ("dim = dead" gating)
			rate: spec.rate ?? 'substep',  // 'substep' (1/60) | 'frame' (fdt)
			value: spec.init ?? 0,
			fmt: spec.fmt,                 // optional value formatter
			rackPath: spec.rackPath,       // set iff registered in the rack
		};
		list.push(n);
		byId.set(id, n);
		return n;
	};
	return {
		// damped spring — EXACT vendored conductor math (see score.js);
		// internal 1/120 sub-loop and the min(dt, 0.25) clamp are contract
		spring: (id, spec) => Object.assign(def('spring', id, spec), {
			vel: 0,
			target: spec.init ?? 0,
			freq: spec.freq,
			zeta: spec.zeta,
			step(dt) {
				const w = 2 * Math.PI * this.freq;
				let rem = Math.min(dt, 0.25);
				while (rem > 0) {
					const h = Math.min(rem, 1 / 120);
					this.vel += (-w * w * (this.value - this.target) - 2 * this.zeta * w * this.vel) * h;
					this.value += this.vel * h;
					rem -= h;
				}
			},
		}),
		// one-pole slew: the exact 1−exp form — never "simplify" to k·dt
		onepole: (id, spec) => Object.assign(def('onepole', id, spec), {
			follow(target, k, dt) {
				this.value += (target - this.value) * (1 - Math.exp(-k * dt));
				return this.value;
			},
		}),
		// tap: a named derived value — set() returns v so taps inline:
		//   const strain = n.strain.set(...)
		tap: (id, spec) => Object.assign(def('tap', id, spec), {
			set(v) { this.value = v; return v; },
		}),
		// latch: one-shot / windowed booleans and counters
		latch: (id, spec) => Object.assign(def('latch', id, spec), {
			set(v) { this.value = v; return v; },
		}),
		// vec: a Vector3 held by reference (bary, well positions)
		vec: (id, ref, spec = {}) => def('vec', id, {
			...spec,
			init: ref,
			fmt: spec.fmt ?? ((v) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`),
		}),
		// param: a rack-address mirror — knobs appear as leaf nodes in the
		// circuitry, and a future modulator has a node to draw its edge into
		param: (id, get, spec = {}) => {
			const n = def('param', id, spec);
			Object.defineProperty(n, 'value', { get, configurable: true });
			return n;
		},
		// enumeration for the overlay — plain objects, cheap at ~10Hz
		nodes: () => list.map((n) => ({
			id: n.id, kind: n.kind, label: n.label, caption: n.caption,
			value: n.fmt ? n.fmt(n.value) : n.value, raw: n.value,
			unit: n.unit, min: n.min, max: n.max,
			inputs: n.inputs, stages: n.stages, rate: n.rate,
			rackPath: n.rackPath,
		})),
		// zero-alloc live read for hot paths / overlay diffing
		get: (id) => byId.get(id),
	};
}

// a rack knob as a circuitry leaf node: `knob:<path>` mirrors the rack
// param's live value and (optionally) draws an edge into the node it tunes.
// The future modulator layer attaches at these nodes — see the contract in
// score.js.
export function knob(graph, rack, path, into, spec = {}) {
	const n = graph.param(`knob:${path}`, () => rack.get(path), {
		label: spec.label ?? path.split('/').filter(Boolean).slice(-2).join(' '),
		rackPath: path,
		...spec,
	});
	if (into) graph.get(into)?.inputs.push({ from: n.id });
	return n;
}
