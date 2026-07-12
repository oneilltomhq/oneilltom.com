// ---- the machine: the WHOLE experience as one directed graph -------------
// The sling's circuit was true but partial — one chapter shown as the book.
// This is the complete picture at ≤7 components, each an honest container
// with its own interior (drill in): the overlay renders one level at a
// time. The top level IS frame(): its evaluation order is the topological
// sort of this graph, and every cycle in it passes through a one-frame
// delay (echo; each synth patch feeding on its own last output) — which is
// exactly why the whole thing is crankable.
//
// Layout convention: x/y are viewport fractions (the overlay adds the
// plate drift); `probe` pins a node to projected world positions;
// `enter` names the level a click drills into.
import { bindKey, bindUniform } from '@oneilltom/lib3/rack';
import { createGraph } from './graph.js';

export function createMachine({
	sling, wells, flubber, noise, cohesion, burst,
	grade, orbit, echoSize, rack,
}) {
	const levels = {};
	const lvl = (id, title, parent, layout) => {
		const graph = createGraph();
		levels[id] = { id, title, parent, graph, layout };
		return graph;
	};

	// ---- the few new tunables, addressed like everything else ------------
	if (rack) {
		if (noise) rack.add('/flubber/noise', bindUniform(noise.uniforms.uAmt), { min: 0, max: 2 });
		if (cohesion) rack.add('/flubber/cohesion', bindUniform(cohesion.uniforms.uStr), { min: 0, max: 2 });
		if (flubber) rack.add('/flubber/damp', bindUniform(flubber.u.uDamp), { min: 0.05, max: 2, unit: '/s' });
		if (orbit) rack.add('/eye/period', bindKey(orbit, 'period'), { min: 12, max: 90, unit: 's' });
		if (grade) {
			rack.add('/eye/exposure', bindUniform(grade.exposure), { min: 0.4, max: 2 });
			rack.add('/eye/contrast', bindUniform(grade.contrast), { min: 0.8, max: 2.2 });
		}
	}

	// ---- top level: seven organs ------------------------------------------
	const top = lvl('machine', 'machine', null, {
		hand: { x: 0.52, y: 0.12, color: '#b8b8b4', enter: 'hand' },
		synth: { x: 0.71, y: 0.09, color: '#ffd9fb', enter: 'synth' },
		chamber: { x: 0.90, y: 0.17, color: '#b8b8b4', enter: 'chamber' },
		sling: { x: 0.49, y: 0.62, color: '#5ee8e0', enter: 'sling' },
		mass: { probe: 'mid', color: '#5ee8e0', enter: 'mass' },
		echo: { x: 0.91, y: 0.54, color: '#e4699b', enter: 'echo' },
		eye: { x: 0.71, y: 0.87, color: '#f2b75c', enter: 'eye' },
	});
	const nHand = top.tap('hand', {
		label: 'hand', init: '—',
		caption: 'you — clicks burst the mass, scrubs turn knobs, picks swap the patch',
	});
	top.tap('synth', {
		label: 'synth', init: '—',
		caption: 'four video patches, each feeding on its own last frame',
		inputs: [{ from: 'hand' }],
	});
	top.tap('chamber', {
		label: 'chamber', init: '5 planes · o0 hero',
		caption: 'a room built from the patches — the world the glass refracts',
		inputs: [{ from: 'synth' }],
	});
	const nSlingTop = top.tap('sling', {
		label: 'sling', min: 0, max: 8,
		caption: 'two tips, one band, stirred forever — the choreography',
		inputs: [{ from: 'hand' }],
		fmt: (v) => `T ${(+v).toFixed(2)}`,
	});
	const nMassTop = top.tap('mass', {
		label: 'mass', min: 0, max: 22,
		caption: 'the liquid glass — particles falling toward the tips',
		inputs: [{ from: 'sling' }, { from: 'hand' }, { from: 'synth' }, { from: 'echo' }],
		fmt: (v) => `${flubber?.count ?? 0} drops · burst ${(+v).toFixed(1)}`,
	});
	top.tap('echo', {
		label: 'echo', init: '—',
		caption: 'last frame, kept — every loop pays one frame of delay',
		inputs: [{ from: 'mass' }, { from: 'chamber' }],
	});
	const nEyeTop = top.tap('eye', {
		label: 'eye', min: 0, max: 360, unit: '°',
		caption: 'an orbiting camera, one committed grade on the way out',
		inputs: [{ from: 'echo' }],
		fmt: (v) => `φ ${Math.round(v)}°`,
	});

	// ---- sling interior: the graph createSling already authored ----------
	levels.sling = {
		id: 'sling', title: 'sling', parent: 'machine',
		graph: sling.graph,
		layout: {
			anchor: { x: 0.56, y: 0.10, color: '#b8b8b4' },
			stir: { x: 0.86, y: 0.12, color: '#ffd9fb' },
			stretch: { x: 0.52, y: 0.78, color: '#b8b8b4' },
			tension: { x: 0.68, y: 0.88, color: '#f2b75c' },
			omega: { x: 0.86, y: 0.78, color: '#e4699b' },
			'tip.a': { probe: 0, color: '#5ee8e0' },
			'tip.b': { probe: 1, color: '#5ee8e0' },
		},
	};

	// ---- mass interior: forces → integrate → splat → march ---------------
	const gm = lvl('mass', 'mass', 'machine', {
		wells: { x: 0.52, y: 0.12, color: '#5ee8e0' },
		burst: { x: 0.86, y: 0.10, color: '#f2b75c' },
		forces: { x: 0.62, y: 0.38, color: '#ffd9fb' },
		integrate: { x: 0.86, y: 0.50, color: '#b8b8b4' },
		splat: { x: 0.62, y: 0.68, color: '#b8b8b4' },
		march: { x: 0.82, y: 0.86, color: '#e4699b' },
	});
	const nWells = gm.tap('wells', {
		label: 'wells', min: 0, max: 9,
		caption: 'the two tips, arrived from the sling',
		fmt: (v) => `pull ${(+v).toFixed(1)}`,
	});
	const nBurst = gm.tap('burst', {
		label: 'burst', min: 0, max: 22,
		caption: 'the click shockwave, decaying away',
	});
	gm.tap('forces', {
		label: 'forces',
		caption: 'gravity toward the tips, a noise breeze, a pull to the middle',
		min: 0, max: 2, knobs: ['/flubber/noise', '/flubber/cohesion'],
		inputs: [{ from: 'wells' }, { from: 'burst' }],
	});
	gm.tap('integrate', {
		label: 'integrate',
		caption: 'velocity damped each second, speed softly governed',
		min: 0, max: 2, knobs: ['/flubber/damp'],
		inputs: [{ from: 'forces' }],
	});
	gm.tap('splat', {
		label: 'splat', init: flubber ? `${flubber.grid}³ grid` : '—',
		caption: 'every particle splats its density into one shared field',
		inputs: [{ from: 'integrate' }],
	});
	gm.tap('march', {
		label: 'march', init: 'one skin',
		caption: 'a single isosurface raymarched — the mass has one body',
		inputs: [{ from: 'splat' }],
	});

	// ---- synth interior: four self-feeding patches ------------------------
	const gs = lvl('synth', 'synth', 'machine', {
		o0: { x: 0.56, y: 0.16, color: '#ffd9fb' },
		o1: { x: 0.86, y: 0.16, color: '#f2b75c' },
		o2: { x: 0.56, y: 0.64, color: '#5ee8e0' },
		o3: { x: 0.86, y: 0.64, color: '#b8b8b4' },
	});
	const nO0 = gs.tap('o0', {
		label: 'o0 nebula', init: '—',
		caption: 'domain-warped fbm, fed a sliver of itself — the hero wall, live-switchable',
	});
	gs.tap('o1', { label: 'o1 ember', init: 'self-fed', caption: 'a warm oscillator chewing its own last frame' });
	gs.tap('o2', { label: 'o2 mandala', init: 'self-fed', caption: 'kaleided noise, spinning on its own output' });
	gs.tap('o3', { label: 'o3 strata', init: 'self-fed', caption: 'slow haze — the quietest feedback loop' });

	// ---- chamber interior --------------------------------------------------
	const gc = lvl('chamber', 'chamber', 'machine', {
		hero: { x: 0.58, y: 0.22, color: '#ffd9fb' },
		walls: { x: 0.82, y: 0.60, color: '#b8b8b4' },
	});
	gc.tap('hero', {
		label: 'hero wall', init: 'o0, nearly raw',
		caption: 'the back wall shows the live patch almost untouched',
	});
	gc.tap('walls', {
		label: 'walls', init: '4 more planes',
		caption: 'floor, ceiling, flanks — dimmer mixes of all four patches',
	});

	// ---- echo interior: the feedback rail ---------------------------------
	const ge = lvl('echo', 'echo', 'machine', {
		write: { x: 0.58, y: 0.24, color: '#e4699b' },
		read: { x: 0.82, y: 0.62, color: '#e4699b' },
	});
	const nWrite = ge.tap('write', {
		label: 'write', init: '—',
		caption: 'this frame renders here',
	});
	ge.tap('read', {
		label: 'read', init: '1 frame late',
		caption: 'last frame, sampled by the glass — swapped every crank',
		inputs: [{ from: 'write' }],
	});

	// ---- eye interior ------------------------------------------------------
	const gy = lvl('eye', 'eye', 'machine', {
		orbit: { x: 0.56, y: 0.18, color: '#f2b75c' },
		gaze: { x: 0.84, y: 0.44, color: '#b8b8b4' },
		grade: { x: 0.64, y: 0.76, color: '#ffd9fb' },
	});
	const nOrbit = gy.tap('orbit', {
		label: 'orbit', min: 0, max: 360, unit: '°',
		caption: 'an eccentric tilted ellipse, precessing — no lap retraces',
		knobs: ['/eye/period'],
		fmt: (v) => `φ ${Math.round(v)}°`,
	});
	gy.tap('gaze', {
		label: 'gaze', init: 'drifts + banks',
		caption: 'the look-at wanders; a faint roll banks the horizon',
		inputs: [{ from: 'orbit' }],
	});
	gy.tap('grade', {
		label: 'grade', init: 'display only',
		caption: 'pivoted contrast, split tone, dither — never inside the loop',
		knobs: ['/eye/exposure', '/eye/contrast'],
	});

	// ---- hand interior -----------------------------------------------------
	const gh = lvl('hand', 'hand', 'machine', {
		pointer: { x: 0.56, y: 0.18, color: '#f2b75c' },
		scrub: { x: 0.84, y: 0.44, color: '#ffd9fb' },
		patch: { x: 0.64, y: 0.76, color: '#b8b8b4' },
	});
	const nPointer = gh.tap('pointer', {
		label: 'pointer', init: 'click me',
		caption: 'a click detonates a shockwave at the blob’s depth',
	});
	const nScrub = gh.tap('scrub', {
		label: 'scrub', init: '—',
		caption: 'artist mode: every knob row writes straight into the rack',
	});
	const nPatch = gh.tap('patch', {
		label: 'patch', init: '—',
		caption: 'the #hash picks which patch the hero wall runs',
	});

	// ---- live wiring -------------------------------------------------------
	const tension = sling.graph.get('tension');
	const note = (kind, detail = '') => {
		if (kind === 'burst') { nHand.set('click — burst'); nPointer.set('burst!'); }
		if (kind === 'scrub') { nHand.set(`scrub ${detail.split('/').pop()}`); nScrub.set(detail); }
		if (kind === 'patch') { nHand.set(`patch ${detail}`); nPatch.set(detail); nO0.set(detail); top.get('synth').set(detail); }
	};
	// the eye's φ, recomputed from the same pacing formula the camera uses
	const phase = (t) => {
		if (!orbit) return 0;
		const m = (2 * Math.PI / orbit.period) * t;
		const th = m + orbit.ecc * Math.sin(m);
		return ((th * 180 / Math.PI) % 360 + 360) % 360;
	};
	const update = (t) => {
		nSlingTop.set(tension.value);
		const b = burst ? burst.uniforms.uStr.value : 0;
		nMassTop.set(b);
		nBurst.set(b);
		if (wells) nWells.set((wells[0].gm ?? 0) + (wells[1].gm ?? 0));
		if (echoSize) {
			const s = echoSize();
			const label = `${s.w}×${s.h}`;
			top.get('echo').set(label);
			nWrite.set(label);
		}
		const deg = phase(t);
		nEyeTop.set(deg);
		nOrbit.set(deg);
	};

	return { levels, top: 'machine', update, note, tension };
}
