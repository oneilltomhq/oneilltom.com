// ---- the score: choreography clock for the wells -----------------------
// The wells stop roaming on independent sines and dance a phrase:
// ORBIT → CONVERGENCE → HELD TENSION → RELEASE (crash), repeating,
// with the drifter as a slow ostinato underneath. Every control
// signal reaches its target through a spring or a slew limit, so
// velocity stays continuous and acceleration ramps — jerk-limited,
// nothing pops.
//
// This module is deliberately host-agnostic: it needs only Vector3 and
// Math, so it can be stepped headlessly (see tmp/golden-score.mjs) —
// the same code that runs the site is the code the golden trace pins.
import { Vector3 } from 'three/webgpu';
import { bindKey } from '@oneilltom/lib3/rack';
import { createGraph, knob } from './graph.js';

// deterministic pseudo-noise — the sim must stay reproducible under the
// virtual test clock, so no Math.random in the score
const prand = (x) => {
	const s = Math.sin(x * 12.9898) * 43758.5453;
	return s - Math.floor(s);
};

/**
 * @param {object} o
 *   wells — the three well objects the score choreographs ({p, axis, ph, mood, ...})
 *   flub  — { burst, noise, cohesion, lattice, field } flubber drivers +
 *           the FlubberField itself; every entry nullable (?globs=0)
 *   grade — { exposure } display-grade uniforms the score breathes on
 *   rack  — optional lib3 Rack; the score registers its tunables on it
 */
export function createScore({ wells, flub = {}, grade, rack }) {
	const SCORE = {
		phrase: 24,                  // seconds per cycle (the macro scale)
		// stage boundaries (phrase01) — one circulation of the room:
		rise: 0.12,                  // floor scatter ends; the swirl up begins
		build: 0.34,                 // arrived at the ceiling; duet build starts
		shifts: [0.38, 0.48, 0.56],  // build-phase "gear shifts"
		brake: 0.62,                 // brake-late convergence begins (still up top)
		hang: 0.86,                  // weightless at the ceiling
		drop: 0.94,                  // gravity yanks to the floor — the plummet
		// geometry (world units; density box is ±1.6 in y):
		floorY: -0.95, topY: 0.95,   // where the splash lands / where it hangs
		riseTurns: 1.75,             // helix revolutions on the way up
		rWide: 1.35, rTight: 0.34,   // partner separation: orbit vs apex
		omegaBase: 0.55, omegaMax: 2.9, // orbital drive (rad/s)
		noiseBase: 0.4, cohBase: 0.45,  // flubber surface/cohesion rest values
		dampBase: 0.6, capBase: 3.2,    // flubber damping / speed-cap rest values
	};
	// the signal graph: the score's stateful primitives live in named nodes
	// (spring/one-pole state is ONLY here), so the circuitry overlay renders
	// exactly what runs. The springs are the vendored lib3 conductor math
	// (Spring), pending a package export.
	const graph = createGraph();
	// separation: near-critical (clean brake, no wobble); drive:
	// underdamped so the gear shifts lurch and settle instead of stepping
	// -- the clock and its stages
	const nP01 = graph.tap('phrase.p01', {
		label: 'phrase clock', caption: 'where we are in the circulation',
		min: 0, max: 1,
	});
	const nStage = graph.tap('phrase.stage', {
		label: 'stage', caption: 'floor → rise → build → brake → hang → drop',
		init: 'floor', inputs: [{ from: 'phrase.p01' }],
	});
	const nWrap = graph.latch('phrase.wrap', {
		label: 'the splash', caption: 'phrase head — the mass crashes on the floor',
		inputs: [{ from: 'phrase.p01' }], stages: ['floor'],
	});
	// -- the ledger and its ostinato
	const nEnergy = graph.tap('energy', {
		label: 'energy ledger', caption: 'charged by perigee whips, spent at the splash',
		init: 0.2, min: 0, max: 1,
		inputs: [{ from: 'phrase.stage' }, { from: 'sling' }],
	});
	const nPulse = graph.tap('pulse', {
		label: 'throb phase', caption: 'swells come quicker as the ledger charges',
		min: 0, max: 2 * Math.PI, unit: 'rad',
		inputs: [{ from: 'energy' }], stages: ['build', 'brake'],
	});
	const nThrob = graph.tap('throb', {
		label: 'throb', caption: 'the accumulating ostinato under the surge',
		min: 0, max: 0.55,
		inputs: [{ from: 'pulse' }, { from: 'energy' }], stages: ['build', 'brake'],
	});
	const nShift = graph.latch('shift', {
		label: 'gear shift', caption: 'declutch dip, then a higher plateau',
		inputs: [{ from: 'phrase.p01' }], stages: ['build'],
	});
	// -- the reactor
	const nStrain = graph.tap('strain', {
		label: 'strain', caption: 'the tight whirl straining against containment',
		min: 0, max: 1,
		inputs: [{ from: 'phrase.stage' }, { from: 'energy' }], stages: ['brake'],
	});
	const nSlip = graph.latch('slip', {
		label: 'containment slip', caption: 'aperiodic partial escapes off the core',
		inputs: [{ from: 'strain' }], stages: ['brake'],
	});
	const nGlitch = graph.latch('glitch', {
		label: 'outer world', caption: 'a stronger world punches through, 60–140ms',
		inputs: [{ from: 'strain' }], stages: ['brake'],
	});
	const nFlicker = graph.tap('flicker', {
		label: 'flicker', caption: 'stepped 13Hz gravity stutter under strain',
		min: -0.3, max: 0.3,
		inputs: [{ from: 'strain' }], stages: ['brake'],
	});
	// -- the orbit
	const sep = graph.spring('sep', {
		label: 'separation', caption: 'how far apart the pair rides',
		init: SCORE.rWide, freq: 0.45, zeta: 0.9, min: 0, max: 2.5, unit: 'u',
		inputs: [{ from: 'phrase.stage' }, { from: 'phrase.wrap' }],
	});
	const drive = graph.spring('drive', {
		label: 'orbital drive', caption: 'how hard the whirl is pushed',
		init: SCORE.omegaBase, freq: 0.8, zeta: 0.5, min: 0, max: 8, unit: 'rad/s',
		inputs: [{ from: 'phrase.stage' }, { from: 'energy' }, { from: 'shift' },
			{ from: 'throb' }, { from: 'slip' }, { from: 'glitch' }],
	});
	const nEcc = graph.onepole('ecc', {
		label: 'eccentricity', caption: 'the pendulum in the slingshot',
		init: 0.05, min: 0, max: 1,
		inputs: [{ from: 'phrase.stage' }, { from: 'energy' }],
	});
	const nRf = graph.tap('rf', {
		label: 'radial factor', caption: 'out wide and slow, in tight and fast',
		init: 1, min: 0, max: 2,
		inputs: [{ from: 'ecc' }, { from: 'theta' }],
	});
	const nWhip = graph.tap('whip', {
		label: 'whip', caption: 'equal areas in equal times: dθ ∝ 1/r²',
		init: 1, min: 0, max: 5,
		inputs: [{ from: 'rf' }],
	});
	const nTheta = graph.tap('theta', {
		label: 'orbit angle', caption: 'the pair’s whirl, driven through the whip',
		unit: 'rad',
		inputs: [{ from: 'drive' }, { from: 'whip' }],
	});
	const nSling = graph.latch('sling', {
		label: 'slingshot', caption: 'perigee whip — pumps the ledger, flings the mass',
		inputs: [{ from: 'theta' }, { from: 'ecc' }], stages: ['build', 'brake'],
	});
	// -- the anchor
	const nBaryK = graph.tap('bary.k', {
		label: 'chase rate', caption: 'how hard the barycentre chases its target',
		init: 2, min: 0, max: 10,
		inputs: [{ from: 'phrase.stage' }, { from: 'strain' }, { from: 'glitch' }],
	});
	const nMood = graph.onepole('mood', {
		label: 'mood', caption: 'gravity strength, breathing with the phrase',
		init: 0.6, min: 0, max: 3.5,
		inputs: [{ from: 'phrase.stage' }, { from: 'energy' }],
	});
	const nFlat = graph.onepole('flat', {
		label: 'flatten', caption: 'y squash: ~0 pins the pair to the floor',
		init: 1, min: 0, max: 1,
		inputs: [{ from: 'phrase.stage' }],
	});
	const nExposure = graph.tap('exposure', {
		label: 'exposure', caption: 'the light breathes with the mood',
		init: 1.05, min: 0.5, max: 1.6,
		inputs: [{ from: 'mood' }, { from: 'glitch' }], rackPath: '/grade/exposureBase',
	});
	// -- the flubber substrate: stage targets, then per-frame followers.
	// The score writes the targets each substep; the followers chase them
	// once per FRAME (fdt) at the stage's own rate k.
	const nFlubT = {
		noise: graph.tap('flub.noiseT', {
			label: 'noise target', caption: 'the stage’s call for surface turbulence',
			init: 0.4, min: 0, max: 2,
			inputs: [{ from: 'phrase.stage' }, { from: 'strain' }],
		}),
		coh: graph.tap('flub.cohT', {
			label: 'cohesion target', caption: 'the stage’s call for holding-together',
			init: 0.45, min: 0, max: 2,
			inputs: [{ from: 'phrase.stage' }, { from: 'strain' }],
		}),
		damp: graph.tap('flub.dampT', {
			label: 'damping target', caption: 'the stage’s call for stillness',
			init: 0.6, min: 0, max: 3,
			inputs: [{ from: 'phrase.stage' }],
		}),
		cap: graph.tap('flub.capT', {
			label: 'cap target', caption: 'the cap rides the surge',
			init: 3.2, min: 0, max: 10,
			inputs: [{ from: 'phrase.stage' }, { from: 'energy' }],
		}),
		lat: graph.tap('flub.latT', {
			label: 'lattice target', caption: 'how crystalline the stage wants the mass',
			init: 0, min: 0, max: 6,
			inputs: [{ from: 'phrase.stage' }, { from: 'strain' }],
		}),
		k: graph.tap('flub.k', {
			label: 'follow rate', caption: 'how fast the substrate chases its targets',
			init: 1.6, min: 0, max: 8, unit: '/s',
			inputs: [{ from: 'phrase.stage' }],
		}),
	};
	const nFlubNoise = graph.onepole('flub.noise', {
		label: 'surface noise', caption: 'turbulent life on the blob skin',
		init: 0.4, min: 0, max: 2, rate: 'frame',
		inputs: [{ from: 'flub.noiseT' }, { from: 'flub.k' }, { from: 'phrase.wrap' }],
	});
	const nFlubCoh = graph.onepole('flub.coh', {
		label: 'cohesion', caption: 'the pull holding the mass together',
		init: 0.45, min: 0, max: 2, rate: 'frame',
		inputs: [{ from: 'flub.cohT' }, { from: 'flub.k' }, { from: 'phrase.wrap' }],
	});
	const nFlubDamp = graph.onepole('flub.damp', {
		label: 'damping', caption: 'how fast particle motion bleeds away',
		init: 0.6, min: 0, max: 3, rate: 'frame',
		inputs: [{ from: 'flub.dampT' }, { from: 'flub.k' }],
	});
	const nFlubCap = graph.onepole('flub.cap', {
		label: 'speed cap', caption: 'the governor on particle speed',
		init: 3.2, min: 0, max: 10, rate: 'frame', unit: 'u/s',
		inputs: [{ from: 'flub.capT' }, { from: 'flub.k' }, { from: 'glitch' }],
	});
	const nFlubLat = graph.onepole('flub.lat', {
		label: 'lattice grip', caption: '0 free cloud → high crystalline body',
		init: 0, min: 0, max: 6, rate: 'frame',
		inputs: [{ from: 'flub.latT' }, { from: 'flub.k' }],
	});
	// mechanics that are NOT signals — schedulers, latch bookkeeping, the
	// stage-target carrier. Everything a viewer would call a signal lives
	// in a node above.
	const score = {
		last: 0,         // previous phrase01, for wrap detection
		released: false, // one-shot latch for the cast-out at the hang boundary
		nextSlip: 0,     // when the next containment slip may fire (reactor)
		hangMode: 0,     // how this phrase settles: 0 = one held glob, 1 = cast wide
		nextGlitch: 0,   // when the outer world may next punch through
		glitchUntil: 0,  // glitch window end (split-second)
		lastOrbit: 0,    // perigee-pass counter
		lastPump: 0,     // last whip time (rate-limits the pump)
		// flubber stage targets, followed in followFlub() at rate k (per-second)
		flub: { noise: 0.4, coh: 0.45, damp: 0.6, cap: 3.2, lat: 0, k: 1.6 },
	};
	// console/tooling compat: the node-owned signals still read as fields
	// of the state object (window.__score.state.mood etc.)
	Object.defineProperties(score, {
		theta: { get: () => nTheta.value, set: (v) => { nTheta.value = v; } },
		energy: { get: () => nEnergy.value, set: (v) => { nEnergy.value = v; } },
		pulse: { get: () => nPulse.value, set: (v) => { nPulse.value = v; } },
		shift: { get: () => nShift.value, set: (v) => { nShift.value = v; } },
		baryK: { get: () => nBaryK.value, set: (v) => { nBaryK.value = v; } },
		glitching: {
			get: () => nGlitch.value === 1,
			set: (v) => { nGlitch.value = v ? 1 : 0; },
		},
		e: { get: () => nEcc.value, set: (v) => { nEcc.value = v; } },
		mood: { get: () => nMood.value, set: (v) => { nMood.value = v; } },
		flat: { get: () => nFlat.value, set: (v) => { nFlat.value = v; } },
	});
	// the score drives exposure = base + swell·f(mood); these two are the
	// rack-addressable halves of that composition (exposure itself is owned
	// by the score every frame, so binding it directly would be a fight)
	const gradeScore = { exposureBase: 0.99, swell: 0.11 };
	const bary = new Vector3(1.0, -0.95, 0.3); // starts at the floor point
	const baryT = new Vector3(), partnerU = new Vector3();
	const splashAt = new Vector3(); // burst origin, above the floor contact
	const slipAt = new Vector3();   // containment-slip burst origin (reactor)
	const glitchOff = new Vector3(); // where the outer world drags the anchor
	const tangent = new Vector3();  // whip exit direction at perigee
	const slingVel = new Vector3(); // barycentre momentum from the slingshot
	// vec nodes hold these by reference — always live, no copying
	graph.vec('bary.target', baryT, {
		label: 'bary target', caption: 'the stage’s anchor point for the mass',
		inputs: [{ from: 'phrase.stage' }, { from: 'strain' }, { from: 'glitch' }],
	});
	graph.vec('bary', bary, {
		label: 'barycentre', caption: 'where the mass actually is (one-pole chase)',
		inputs: [{ from: 'bary.target' }, { from: 'bary.k' }, { from: 'sling' }],
	});
	graph.vec('well.heavy', wells[0].p, {
		label: 'heavy', caption: 'duet partner A — deep, slow',
		inputs: [{ from: 'bary' }, { from: 'sep' }, { from: 'theta' }, { from: 'flat' }],
	});
	graph.vec('well.spinner', wells[1].p, {
		label: 'spinner', caption: 'duet partner B — violent, fast',
		inputs: [{ from: 'bary' }, { from: 'sep' }, { from: 'theta' }, { from: 'flat' }],
	});
	graph.vec('well.drifter', wells[2].p, {
		label: 'drifter', caption: 'the slow ostinato under the duet',
		inputs: [{ from: 'phrase.p01' }],
	});

	if (rack) {
		rack.add('/score/phrase', bindKey(SCORE, 'phrase'), { min: 8, max: 60, unit: 's' });
		rack.add('/score/omegaBase', bindKey(SCORE, 'omegaBase'), { min: 0, max: 2, unit: 'rad/s' });
		rack.add('/score/omegaMax', bindKey(SCORE, 'omegaMax'), { min: 0.5, max: 6, unit: 'rad/s' });
		rack.add('/score/rWide', bindKey(SCORE, 'rWide'), { min: 0.5, max: 2.5 });
		rack.add('/score/rTight', bindKey(SCORE, 'rTight'), { min: 0.05, max: 1 });
		rack.add('/score/sep/freq', bindKey(sep, 'freq'), { min: 0.05, max: 3, unit: 'Hz' });
		rack.add('/score/sep/zeta', bindKey(sep, 'zeta'), { min: 0, max: 2 });
		rack.add('/score/drive/freq', bindKey(drive, 'freq'), { min: 0.05, max: 3, unit: 'Hz' });
		rack.add('/score/drive/zeta', bindKey(drive, 'zeta'), { min: 0, max: 2 });
		rack.add('/flubber/noiseBase', bindKey(SCORE, 'noiseBase'), { min: 0, max: 2 });
		rack.add('/flubber/cohBase', bindKey(SCORE, 'cohBase'), { min: 0, max: 2 });
		rack.add('/flubber/dampBase', bindKey(SCORE, 'dampBase'), { min: 0, max: 3 });
		rack.add('/flubber/capBase', bindKey(SCORE, 'capBase'), { min: 0.5, max: 8 });
		rack.add('/grade/exposureBase', bindKey(gradeScore, 'exposureBase'), { min: 0.5, max: 1.6 });
		rack.add('/grade/swell', bindKey(gradeScore, 'swell'), { min: 0, max: 0.5 });
		// every racked path appears as a knob node feeding the node it
		// tunes — the knobs are leaf nodes of the circuitry, and the future
		// modulator layer attaches to them (contract below)
		knob(graph, rack, '/score/phrase', 'phrase.p01');
		knob(graph, rack, '/score/omegaBase', 'drive');
		knob(graph, rack, '/score/omegaMax', 'drive');
		knob(graph, rack, '/score/rWide', 'sep');
		knob(graph, rack, '/score/rTight', 'sep');
		knob(graph, rack, '/score/sep/freq', 'sep');
		knob(graph, rack, '/score/sep/zeta', 'sep');
		knob(graph, rack, '/score/drive/freq', 'drive');
		knob(graph, rack, '/score/drive/zeta', 'drive');
		knob(graph, rack, '/flubber/noiseBase', 'flub.noiseT');
		knob(graph, rack, '/flubber/cohBase', 'flub.cohT');
		knob(graph, rack, '/flubber/dampBase', 'flub.dampT');
		knob(graph, rack, '/flubber/capBase', 'flub.capT');
		knob(graph, rack, '/grade/exposureBase', 'exposure');
		knob(graph, rack, '/grade/swell', 'exposure');
	}

	// ---- the modulator seam (design contract; nothing built yet) --------
	// A modulator is { node, target, update(dt, t) }:
	//   node    — a graph node of kind 'mod' (an LFO, envelope, follower…)
	//             whose edge points at the knob node of its target path,
	//             so it renders in the circuitry like any other source
	//   target  — a rack address, e.g. '/wells/heavy/gm'
	//   update  — called by the host once per frame, right after
	//             rack.update(fdt); it writes through the rack's command
	//             channel WITHOUT recording (sessions stay human-authored):
	//               rack.dispatch({ type: 'set', path: target,
	//                               value: v, ramp: 0 }, 'mod', false)
	// A "recipe" is a named set of modulators + their parameter values —
	// snapshot-adjacent, carried the same way (localStorage / JSON).

	const step = (dt, t) => {
		// ---- score: one circulation of the room per phrase --------------
		// The throw is spatially coherent with the chamber now: the mass
		// CRASHES on the floor at the phrase head (the splash), skitters
		// dispersed along the bottom, then gravity SHIFTS — the attractor
		// swirls up the sides in a helix and carries the whirling mass to
		// the ceiling, where the duet builds through its gear shifts,
		// brakes late into the tight pair, HANGS weightless at the top —
		// and then gravity yanks it back down: the drop, the fastest
		// moment, one coherent glob falling to its splash.
		const p01 = nP01.set((t / SCORE.phrase) % 1);
		// the stage is computed ONCE; every stage-shaped signal below picks
		// its target with a switch on this — one clock, many voices
		const stage = nStage.set(
			p01 < SCORE.rise ? 'floor'
				: p01 < SCORE.build ? 'rise'
					: p01 < SCORE.brake ? 'build'
						: p01 < SCORE.hang ? 'brake'
							: p01 < SCORE.drop ? 'hang' : 'drop');
		if (nWrap.set(p01 < score.last ? 1 : 0)) {
			// impact: the splash. The shockwave fires from slightly ABOVE
			// the contact point, so the mass is squashed down-and-outward
			// along the floor plane (a radial burst AT the contact would
			// launch the ejecta back to the ceiling). Ledger spent,
			// partners flung wide for the scatter.
			score.energy = 0.18;
			score.shift = 0;
			score.released = false;
			sep.vel += 2.8;
			drive.target = SCORE.omegaBase;
			if (flub.burst) {
				splashAt.set(bary.x, bary.y + 0.9, bary.z);
				flub.burst.trigger(splashAt, 2.4, 20);
			}
			// spike the followers directly — the splash is an impulse, not a
			// target change; the one-poles relax back from it
			nFlubNoise.value = 1.5;
			nFlubCoh.value = 0.12;
		}
		score.last = p01;
		// the wave builds. Trickle charge only — the real energy source is
		// the SLINGSHOT below: each perigee whip pumps the ledger. The
		// compounding shape survives (bigger e → harder whips → faster
		// pumps → bigger e), but now it's mechanical, not administrative.
		if (stage === 'floor' || stage === 'rise') score.energy = Math.min(1, score.energy + dt / 40);
		else if (stage === 'build' || stage === 'brake') score.energy = Math.min(1, score.energy * (1 + 0.06 * dt));
		// the throb: an accumulating ostinato under the surge — swells come
		// quicker AND deeper as the ledger charges, and each one kicks the
		// drive a little harder than the last
		if (stage === 'build' || stage === 'brake') {
			score.pulse += (0.35 + 1.15 * score.energy) * Math.PI * 2 * dt;
			if (score.pulse > Math.PI * 2) {
				score.pulse -= Math.PI * 2;
				drive.vel += 0.4 + 1.3 * score.energy;
			}
		} else score.pulse = 0;
		const throb = nThrob.set(Math.pow(Math.max(0, Math.sin(score.pulse)), 3)
			* 0.55 * score.energy);
		// gear shifts: declutch dip + a higher plateau; underdamped ring
		if (score.shift < SCORE.shifts.length && p01 >= SCORE.shifts[score.shift] && p01 < SCORE.brake) {
			drive.vel -= 2.2;
			drive.target += (SCORE.omegaMax * 0.5 - SCORE.omegaBase) / SCORE.shifts.length;
			score.shift++;
		}
		// ---- the reactor: brake window = a tight whirl straining against
		// its own containment. strain ramps in with the window and rides
		// the ledger — it drives the core wobble, the gravity flicker,
		// and the slips below.
		const strain = nStrain.set(stage === 'brake'
			? score.energy * Math.min(1, (p01 - SCORE.brake) / 0.06) : 0);
		// containment slips: at high strain, aperiodic partial escapes — a
		// small burst jets mass off the core, cohesion drags it back, and
		// the drive lurches (biased toward MORE speed: instability feeds)
		if (nSlip.set(strain > 0.5 && t >= score.nextSlip ? 1 : 0)) {
			score.nextSlip = t + 0.7 + 1.6 * prand(t * 7.77);
			if (flub.burst) {
				slipAt.set(
					bary.x + (prand(t * 3.1) - 0.5) * 0.8,
					bary.y + (prand(t * 5.2) - 0.5) * 0.8,
					bary.z + (prand(t * 9.4) - 0.5) * 0.5);
				flub.burst.trigger(slipAt, 0.9, 5 + 5 * score.energy);
			}
			drive.vel += (prand(t * 4.4) - 0.35) * 3.0;
		}
		// ---- outer-world interference: at PEAK surge only, split-second
		// glitches where a world more powerful than this one punches
		// through. Gravity ×10 and the speed governor pierced for
		// 60–140ms, then gone — applied and removed with NO smoothing;
		// the discontinuity is the point. Some glitches also TEAR: a
		// violent burst from a random point, force arriving from
		// somewhere that has no location in this world.
		if (strain > 0.6 && t >= score.nextGlitch) {
			score.nextGlitch = t + 0.8 + 1.8 * prand(t * 6.13);
			score.glitchUntil = t + 0.07 + 0.10 * prand(t * 8.31);
			drive.vel += (prand(t * 4.9) - 0.4) * 8.0;
			// every glitch tears now, and hard
			if (flub.burst) {
				slipAt.set(
					bary.x + (prand(t * 6.7) - 0.5) * 1.2,
					bary.y + (prand(t * 8.9) - 0.5) * 1.0,
					bary.z + (prand(t * 11.3) - 0.5) * 0.6);
				flub.burst.trigger(slipAt, 1.6, 55);
			}
			// and the ANCHOR of this world is dragged elsewhere for the
			// duration — the mass lurches toward a point that shouldn't
			// exist, then the world snaps back
			glitchOff.set(
				(prand(t * 3.9) - 0.5) * 1.6,
				(prand(t * 7.1) - 0.5) * 1.4,
				(prand(t * 10.7) - 0.5) * 0.9);
		}
		score.glitching = t < score.glitchUntil;
		// the cast-out: one breath after the crest the drive is let go —
		// released, not parked — and the phrase picks how it settles:
		// INTEGRATED (one held glob, substance not dispersed) or CAST WIDE
		// (a soft fling, then everything suspended in relaxation)
		if (!score.released && stage === 'hang') {
			score.released = true;
			score.hangMode = Math.floor(t / SCORE.phrase) % 2;
			drive.vel *= 0.2;
			if (score.hangMode === 1) {
				sep.vel += 2.0;
				if (flub.burst) flub.burst.trigger(bary, 2.6, 7);
			} else {
				sep.vel += 0.4;
			}
		}
		// separation: wide floor scatter → medium rising pair → wide duet
		// → late brake (change concentrated at the window's end) → tight
		// through the hang and the drop
		switch (stage) {
			case 'floor': sep.target = SCORE.rWide; break;
			case 'rise': sep.target = 0.7; break;
			case 'build': sep.target = SCORE.rWide; break;
			case 'brake': {
				// hard brake INTO the corner: clamp down over ~2s, then HOLD
				// the tight whirl — the reactor needs dwell time at full
				// compression, not a convergence that only arrives at the end
				const b = Math.min(1, (p01 - SCORE.brake) / 0.08);
				sep.target = SCORE.rWide + (SCORE.rTight - SCORE.rWide) * Math.pow(b, 1.5);
				break;
			}
			default: // hang + drop
				sep.target = score.hangMode === 1 ? 1.1 : SCORE.rTight;
		}
		// orbital drive: calm floor → whirling rise → geared build →
		// energy-fast brake → near-still hang and drop
		switch (stage) {
			case 'floor': drive.target = SCORE.omegaBase; break;
			case 'rise': drive.target = 1.25; break;
			case 'build': break; // HELD — the gear shifts own the target here
			case 'brake':
				// energy² so the top of the surge owns most of the range —
				// the last stretch before the crest is where it gets violent
				drive.target = SCORE.omegaBase
					+ (SCORE.omegaMax - SCORE.omegaBase)
					* (0.25 + 0.75 * score.energy * score.energy);
				break;
			default: drive.target = 0.12; // hang + drop: released
		}
		sep.step(dt);
		drive.step(dt);
		// ---- the pendulum-slingshot. The orbit is ECCENTRIC, and more so
		// as the ledger charges: the pair swings out wide and slow, then
		// WHIPS through perigee — equal areas in equal times, dθ ∝ 1/r²
		// (clamped ×5). The perigee direction precesses, so the whip
		// sweeps around the well like a whirling pendulum.
		const eT = (stage === 'build' || stage === 'brake')
			? 0.2 + 0.7 * score.energy : 0.05;
		nEcc.follow(eT, 1.5, dt);
		const nu = score.theta - 0.15 * t;      // anomaly vs precessing perigee
		const rf = nRf.set(1 - score.e * Math.cos(nu)); // radial factor: (1-e)..(1+e)
		const whip = nWhip.set(Math.min(5, 1 / (rf * rf)));
		score.theta += drive.value * whip * dt;
		// perigee pass = the slingshot. THIS is where the energy comes
		// from now: the whip pumps the ledger, kicks the swing, and slings
		// mass along the exit tangent — a burst fired from just behind the
		// whipping partner throws everything in the whip's direction.
		const orbitN = Math.floor(nu / (2 * Math.PI));
		// gate on the STAGE, not just eccentricity — e decays slowly, and
		// a sling landing a second into the hang would kick the sigh
		if (nSling.set(orbitN > score.lastOrbit && t - score.lastPump > 0.7
			&& score.e > 0.25 && (stage === 'build' || stage === 'brake') ? 1 : 0)) {
			score.lastPump = t;
			score.energy = Math.min(1, score.energy + 0.08 + 0.06 * score.e);
			drive.vel += 0.5;
			tangent.set(
				-0.72 * Math.sin(score.theta),
				0.55 * Math.cos(score.theta) * score.flat,
				0.38 * 0.83 * Math.cos(score.theta * 0.83 + 1.1)).normalize();
			slingVel.addScaledVector(tangent, 0.5 + 1.0 * score.energy);
			// the fling is a gesture, not a bomb — cohesion must be able
			// to reel the slung mass back in between whips, or the duet
			// sheds everything and the room coherence dies
			if (flub.burst) {
				slipAt.copy(wells[0].p).addScaledVector(tangent, -0.45);
				flub.burst.trigger(slipAt, 0.9, 8 + 8 * score.energy);
			}
		}
		score.lastOrbit = orbitN;
		// barycentre: a stage target chased by a one-pole — the attractor
		// may dart, the mass it drags stays continuous
		switch (stage) {
			case 'floor':
				// scattered along the bottom, gentle sideways wash
				baryT.set(1.0 + 0.35 * Math.sin(0.3 * t), SCORE.floorY, 0.3);
				score.baryK = 2.2;
				break;
			case 'rise': {
				// the swirl up the sides: a helix whose radius closes at both
				// ends so it joins the floor point and ceiling point smoothly
				const r01 = (p01 - SCORE.rise) / (SCORE.build - SCORE.rise);
				const phi = r01 * SCORE.riseTurns * Math.PI * 2;
				const rad = Math.sin(Math.PI * r01);
				baryT.set(
					1.0 + 0.9 * rad * Math.cos(phi),
					SCORE.floorY + (SCORE.topY - SCORE.floorY) * (r01 * r01 * (3 - 2 * r01)),
					0.3 + 0.55 * rad * Math.sin(phi));
				score.baryK = 4.0;
				break;
			}
			case 'build': case 'brake':
				// the duet drifts under the ceiling while it builds and brakes
				baryT.set(
					1.0 + 0.42 * Math.sin(0.11 * t + 1.2),
					SCORE.topY + 0.12 * Math.sin(0.09 * t),
					0.3 + 0.3 * Math.sin(0.07 * t + 2.0));
				// reactor core wobble: sin-of-sin is aperiodic to the eye —
				// the containment trembling, not a metronome. The chase rate
				// rises with strain so the jitter actually transmits instead
				// of being lowpassed away by the one-pole.
				baryT.x += 0.10 * strain * Math.sin(5.3 * t + 2.1 * Math.sin(3.7 * t));
				baryT.y += 0.08 * strain * Math.sin(6.1 * t + 1.7 * Math.sin(4.3 * t));
				baryT.z += 0.06 * strain * Math.sin(4.7 * t + 2.3 * Math.sin(5.9 * t));
				score.baryK = 1.8 + 4.0 * strain;
				break;
			case 'hang':
				// cast out onto the cloud: lifted a breath above the ceiling
				// point and held by a slow wind — bobbing, not pinned
				baryT.set(
					1.0 + 0.18 * Math.sin(0.45 * t),
					SCORE.topY + 0.08 + 0.05 * Math.sin(0.7 * t + 0.8),
					0.3 + 0.12 * Math.sin(0.5 * t + 2.1));
				score.baryK = 0.9;
				break;
			default: // drop
				baryT.set(1.0, SCORE.floorY, 0.3); // the plummet
				score.baryK = 3.5;
		}
		// glitch: the anchor is dragged to the outer world's point and the
		// chase rate spiked so the yank lands within the split second
		if (score.glitching) {
			baryT.add(glitchOff);
			score.baryK = 9.0;
		}
		bary.lerp(baryT, 1 - Math.exp(-score.baryK * dt));
		// slingshot momentum: each whip flings the barycentre along the
		// exit tangent; the chase above reels it back in — swing, recover
		slingVel.multiplyScalar(Math.exp(-2.2 * dt));
		bary.addScaledVector(slingVel, dt);
		// the floor is a POINT attractor, not a plane — a falling mass
		// would slingshot through it and back up. During the floor stage
		// the partner diameter squashes flat instead: two low anchors the
		// scatter spreads between, while raised damping eats the rebound.
		const flatT = stage === 'floor' ? 0.12 : 1;
		nFlat.follow(flatT, 2.5, dt);
		// partners: opposite ends of a tilted diameter through the
		// barycentre — x compressed so the duet never reaches the text
		// eccentric radius, normalised by (1+e) so the APOGEE never reaches
		// further than the old circular orbit did (the text column is
		// sacred) — all the eccentricity spends itself on the perigee whip
		partnerU.set(
			0.72 * Math.cos(score.theta) * sep.value,
			0.55 * Math.sin(score.theta) * sep.value * score.flat,
			0.38 * Math.sin(score.theta * 0.83 + 1.1) * sep.value)
			.multiplyScalar(rf / (1 + score.e));
		wells[0].p.copy(bary).add(partnerU);
		wells[1].p.copy(bary).sub(partnerU);
		// the drifter keeps its old slow roam — the voice under the duet —
		// but stays right of the text column
		wells[2].p.set(
			0.95 + 0.95 * Math.sin(0.26 * t + 4.82),
			0.6 * Math.sin(0.21 * t + 8.24),
			0.5 * Math.sin(0.15 * t + 9.66));
		// spin axes: unchanged precession voice
		for (let i = 0; i < 3; i++) {
			wells[i].axis.set(
				0.45 * Math.sin(0.06 * t + wells[i].ph),
				0.45 * Math.cos(0.08 * t + wells[i].ph * 1.3),
				i === 1 ? -1 : 1).normalize(); // middle well counter-rotates
		}
		// ---- stage envelopes: gravity strength + flubber substrate ------
		// FLOOR: pieces skitter dispersed along the bottom, energetic.
		// RISE: gravity carries the whirling mass up the side helix.
		// BUILD/BRAKE: the ledger is the mood — the duet surges as it charges.
		// HANG: forces cut, damping spiked — weightless under the ceiling.
		// DROP: gravity surges past every ceiling, cap raised, cohesion
		//   near max — ONE glob falls, the fastest moment in the phrase.
		// f01: normalised time INSIDE the drop — the fall accelerates
		// through its own window instead of lerping to one target
		const f01 = stage === 'drop'
			? (p01 - SCORE.drop) / (1 - SCORE.drop) : 0;
		let moodT, moodK;
		switch (stage) {
			case 'floor': moodT = 0.7; moodK = 2.5; break;
			case 'rise': moodT = 1.3; moodK = 2.0; break;
			case 'build': case 'brake':
				moodT = 0.4 + 1.5 * Math.pow(score.energy, 1.6); moodK = 1.8; break;
			case 'hang': moodT = 0.04; moodK = 5.0; break;       // the sigh: fast, deep cut
			default: moodT = 0.4 + 2.8 * f01 * f01; moodK = 6.0; // freefall: g compounds
		}
		nMood.follow(moodT, moodK, dt);
		// throb and flicker multiply AFTER the smoothing — the one-pole
		// would lowpass them away if they went through the target. The
		// flicker is stepped hash noise at ~13Hz: the reactor's gravity
		// stuttering under strain, not a clean oscillation.
		const flicker = nFlicker.set(strain * 0.3 * (prand(Math.floor(t * 13)) - 0.5) * 2);
		wells[0].mood = wells[1].mood = score.mood * (1 + throb + flicker)
			* (score.glitching ? 18 : 1);
		// the drifter breathes at half tempo underneath, untouched by the throw
		wells[2].mood = 0.85 + 0.4 * Math.sin(Math.PI * t / SCORE.phrase);
		// the light breathes with the score — a ±5% exposure swell riding
		// the smoothed mood: brightens into the crest, dims in the sigh.
		// Centred so the tuned 1.05 look is preserved on phrase average.
		grade.exposure.value = nExposure.set(
			gradeScore.exposureBase + gradeScore.swell * Math.min(1, score.mood / 1.7)
			+ (score.glitching ? 0.22 : 0)); // the light jolts too
		// flubber stage targets (applied each frame at rate k)
		switch (stage) {
			case 'floor':
				// scatter: no lattice — loose debris on the floor
				score.flub = { noise: 1.0, coh: 0.12, damp: 1.0, cap: 4.0, lat: 0, k: 2.2 };
				break;
			case 'rise':
				// the two bodies FORM on the way up
				score.flub = { noise: 0.35, coh: 0.5, damp: 0.5, cap: 3.6, lat: 1.2, k: 2.0 };
				break;
			case 'build': case 'brake':
				// the cap RIDES the surge: top speed genuinely climbs as the
				// ledger charges (a cap parked at rest value governed the
				// whole build — the surge could never actually arrive).
				// Under strain BOTH sides of the reactor stiffen: more
				// turbulence trying to escape, more cohesion holding it in —
				// instability AND containment, the tension between them.
				// the crystals TIGHTEN as the reactor strains — two coherent
				// bodies whipping through each other, not a smeared cloud
				score.flub = {
					noise: SCORE.noiseBase + 0.45 * strain,
					coh: SCORE.cohBase + 0.45 * strain,
					damp: SCORE.dampBase,
					cap: SCORE.capBase + 1.6 * score.energy * score.energy,
					lat: 3.0 + 2.5 * strain,
					k: 1.6,
				};
				break;
			case 'hang':
				// the settle, two ways. Either INTEGRATED — cohesion near max
				// gathers everything into one held glob — or CAST WIDE —
				// cohesion cut, the flung mass just hangs where it landed.
				// Both under a LOW cap: that's what holds the stillness.
				// cast wide: the lattice DISSOLVES with everything else.
				// Integrated: grip stays — one intercalated crystal, held.
				score.flub = score.hangMode === 1
					? { noise: 0.10, coh: 0.06, damp: 1.2, cap: 0.8, lat: 0, k: 3.0 }
					: { noise: 0.06, coh: 0.95, damp: 1.6, cap: 0.9, lat: 4.0, k: 3.0 };
				break;
			default:
				// freefall: the cap releases and RAMPS through the fall
				score.flub = { noise: 0.1, coh: 0.9, damp: 0.25, cap: 3.4 + 1.6 * f01, lat: 1.5, k: 5.0 };
		}
		// mirror the chosen targets into their taps — same substep, same
		// values; the taps are how the circuitry sees the stage's intent
		const g = score.flub;
		nFlubT.noise.set(g.noise); nFlubT.coh.set(g.coh); nFlubT.damp.set(g.damp);
		nFlubT.cap.set(g.cap); nFlubT.lat.set(g.lat); nFlubT.k.set(g.k);
	};

	// follow the score's stage targets: surface noise, cohesion, damping
	// and the speed cap all breathe with the phrase. Runs ONCE per frame
	// with the frame dt (not per substep). The glitch cap pierce stays in
	// the host frame() — it's an instantaneous override, not a follow.
	const followFlub = (fdt) => {
		if (!flub.field) return;
		const g = score.flub;
		flub.noise.uniforms.uAmt.value = nFlubNoise.follow(g.noise, g.k, fdt);
		flub.cohesion.uniforms.uStr.value = nFlubCoh.follow(g.coh, g.k, fdt);
		flub.field.u.uDamp.value = nFlubDamp.follow(g.damp, g.k, fdt);
		flub.field.u.uSpeedCap.value = nFlubCap.follow(g.cap, g.k, fdt);
		flub.lattice.uniforms.uStr.value = nFlubLat.follow(g.lat, g.k, fdt);
	};

	return { SCORE, sep, drive, state: score, bary, graph, step, followFlub };
}
