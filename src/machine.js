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
	synthU, chamberU, grade, orbit, gaze, echoSize, echoLag, rack,
}) {
	const levels = {};
	const lvl = (id, title, parent, layout) => {
		const graph = createGraph();
		levels[id] = { id, title, parent, graph, layout };
		return graph;
	};

	// ---- the few new tunables, addressed like everything else ------------
	if (rack) {
		// ranges are CONTRACTS, set by sweeping the extremes on screen:
		// below cohesion 0.3 the mass sheds droplets into the text column;
		// below damp ~0.45 the whip's fling smears sheets across the page.
		// Anything scrubbable must be unable to break the piece.
		if (noise) rack.add('/flubber/noise', bindUniform(noise.uniforms.uAmt), { min: 0, max: 2 });
		if (cohesion) rack.add('/flubber/cohesion', bindUniform(cohesion.uniforms.uStr), { min: 0.3, max: 2 });
		if (flubber) {
			rack.add('/flubber/damp', bindUniform(flubber.u.uDamp), { min: 0.45, max: 2, unit: '/s' });
			// refract swept 0→0.8: at 0 the glass dies into a flat cutout (the
			// clearest demo of what the echo feeds it); at 0.8 the lensing goes
			// heavy and the room swims inside the body. Both legible, both safe.
			rack.add('/flubber/refract', bindUniform(flubber.u.uRefract), { min: 0, max: 0.8 });
		}
		// synth/chamber ranges swept 2026-07 (screenshot extremes): all safe.
		// speed 0 freezes the nebula (self-feed still drifts it faintly), 3 churns;
		// pink 0 drops the filaments to a cool mono wash; feed 0.08 brightens and
		// softens but can NOT run away — the warp source re-anchors the loop
		// every frame, so the feedback has no pure-gain path; haste 0 stills the
		// accents, 4 makes them breathe fast; gain 0 darkens only the flanks
		// (the hero wall carries the view); accents 4 stays tasteful.
		if (synthU) {
			rack.add('/synth/speed', bindUniform(synthU.speed), { min: 0, max: 3 });
			rack.add('/synth/pink', bindUniform(synthU.pink), { min: 0, max: 1.2 });
			rack.add('/synth/feed', bindUniform(synthU.feed), { min: 0, max: 0.08 });
			rack.add('/synth/haste', bindUniform(synthU.haste), { min: 0, max: 4 });
		}
		if (chamberU) {
			rack.add('/chamber/gain', bindUniform(chamberU.gain), { min: 0, max: 2.5 });
			rack.add('/chamber/accents', bindUniform(chamberU.rim), { min: 0, max: 4 });
		}
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
		caption: 'one isosurface raymarched as glass, bending last frame around itself',
		min: 0, max: 0.8, knobs: ['/flubber/refract'],
		inputs: [{ from: 'splat' }],
	});

	// ---- synth interior: the patches and their shared feedback rail -------
	// The self-feed loop is drawn as its own node — every patch's output
	// passes through it (kept one frame) and comes back as an input. That
	// delay node IS why the synth can run forever without exploding.
	const gs = lvl('synth', 'synth', 'machine', {
		o0: { x: 0.54, y: 0.16, color: '#ffd9fb' },
		feed: { x: 0.87, y: 0.40, color: '#e4699b' },
		accents: { x: 0.56, y: 0.68, color: '#f2b75c' },
	});
	const nO0 = gs.tap('o0', {
		label: 'o0 nebula', init: '—',
		caption: 'domain-warped fbm — the patch the hero wall shows live',
		knobs: ['/synth/speed', '/synth/pink'],
		inputs: [{ from: 'feed' }],
	});
	gs.tap('feed', {
		label: 'self-feed', init: '1 frame late',
		caption: 'each patch drinks its own last frame — drift without smear',
		knobs: ['/synth/feed'],
		inputs: [{ from: 'o0' }, { from: 'accents' }],
	});
	gs.tap('accents', {
		label: 'o1 · o2 · o3', init: 'ember · mandala · strata',
		caption: 'three quiet loops the chamber samples sparsely',
		knobs: ['/synth/haste'],
		inputs: [{ from: 'feed' }],
	});

	// ---- chamber interior --------------------------------------------------
	const gc = lvl('chamber', 'chamber', 'machine', {
		hero: { x: 0.56, y: 0.18, color: '#ffd9fb' },
		walls: { x: 0.84, y: 0.46, color: '#b8b8b4' },
		accents: { x: 0.62, y: 0.76, color: '#f2b75c' },
	});
	const nHero = gc.tap('hero', {
		label: 'hero wall', init: 'o0, nearly raw',
		caption: 'the back wall shows the live patch almost untouched',
	});
	gc.tap('walls', {
		label: 'walls', init: '4 more planes',
		caption: 'floor, ceiling, flanks — dimmer mixes of all four patches',
		knobs: ['/chamber/gain'],
	});
	gc.tap('accents', {
		label: 'accents', init: 'ember + cyan',
		caption: 'sparse warm/cool bands riding every wall',
		knobs: ['/chamber/accents'],
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
	const nRead = ge.tap('read', {
		label: 'read', min: 0, max: 60,
		caption: 'the glass refracts this — the whole room, one frame late',
		inputs: [{ from: 'write' }],
		fmt: (v) => `lag ${(+v).toFixed(1)} ms`,
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
	const nGaze = gy.tap('gaze', {
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
		if (kind === 'patch') {
			nHand.set(`patch ${detail}`); nPatch.set(detail); nO0.set(detail);
			nHero.set(detail); top.get('synth').set(detail);
		}
	};
	// the eye's φ, recomputed from the same pacing formula the camera uses
	const phase = (t) => {
		if (!orbit) return 0;
		const m = (2 * Math.PI / orbit.period) * t;
		const th = m + orbit.ecc * Math.sin(m);
		return ((th * 180 / Math.PI) % 360 + 360) % 360;
	};
	let lagMs = 0;
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
		// the echo's price, measured: one frame of real time (reported by the
		// frame loop — this update runs at 10Hz, so it can't time it itself),
		// smoothed a little so the readout breathes instead of flickering
		if (echoLag) {
			lagMs += (echoLag() - lagMs) * 0.3;
			nRead.set(lagMs);
		}
		const deg = phase(t);
		nEyeTop.set(deg);
		nOrbit.set(deg);
		if (gaze) nGaze.set(
			`bank ${(gaze.roll * Math.sin(t * gaze.fr + gaze.pr) * 180 / Math.PI).toFixed(1)}°`);
	};

	return { levels, top: 'machine', update, note, tension };
}
