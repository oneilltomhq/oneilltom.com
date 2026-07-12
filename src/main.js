import { HydraTSL } from './hydra-tsl.js';
import {
	FlubberField, wellDriver, noiseFlowDriver, cohesionDriver, burstDriver,
} from '@oneilltom/lib3/flubber';
import { Rack } from '@oneilltom/lib3/rack';
import { createSling } from './sling.js';
import {
	Scene, PerspectiveCamera, Mesh, PlaneGeometry, MeshBasicNodeMaterial,
	Vector2, Vector3, Quaternion, Raycaster,
	RenderTarget, QuadMesh, HalfFloatType, LinearFilter, ClampToEdgeWrapping, RepeatWrapping,
	AdditiveBlending, DoubleSide,
} from 'three/webgpu';
import {
	texture, screenUV, uv, vec2, vec3, mix, positionWorld, smoothstep,
	uniform, screenCoordinate,
} from 'three/tsl';

async function main() {
	const params = new URLSearchParams(location.search);

	// ?dom=1 — display-panel diagnostic: bounce a plain DOM element, no
	// canvas/WebGL/GPU at all. If this also ghosts/doubles on a screen,
	// the artifact is the panel's pixel response, not the renderer.
	if (params.get('dom') === '1') {
		const el = document.createElement('div');
		el.style.cssText = 'position:fixed;left:0;top:0;width:180px;height:180px;' +
			'border-radius:18px;background:#5ee8e0;z-index:3;will-change:transform';
		document.body.appendChild(el);
		let x = 100, y = 100, vx = 420, vy = 300, prev = performance.now();
		const loop = (now) => {
			const dt = Math.min((now - prev) / 1000, 0.05); prev = now;
			x += vx * dt; y += vy * dt;
			if (x < 0) { x = 0; vx = -vx; } else if (x > innerWidth - 180) { x = innerWidth - 180; vx = -vx; }
			if (y < 0) { y = 0; vy = -vy; } else if (y > innerHeight - 180) { y = innerHeight - 180; vy = -vy; }
			el.style.transform = `translate(${x}px, ${y}px)`;
			requestAnimationFrame(loop);
		};
		requestAnimationFrame(loop);
		window.__ready = true;
		return;
	}

	try {
		// The page works without this script: visuals are progressive enhancement.
	
		const canvas = document.getElementById('view');
		const forceWebGL = params.get('webgl') === '1';
		// Default is the autonomous drift camera (readable text, click to
		// splash); ?inspect=1 opts into the manual drag-to-orbit camera.
		const INSPECT = params.get('inspect') === '1';
		const clampNumber = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
		if (INSPECT) document.body.classList.add('inspect');
		// patch buffers stay 960×540; the canvas itself renders at viewport size
		const synth = new HydraTSL({ canvas, width: 960, height: 540, antialias: true, forceWebGL });
		await synth.init();
		const { osc, noise, voronoi, warp, src, o0, o1, o2, o3 } = synth.api;

		// ---- background patches (o0) — domain-warped fbm nebula ------------
		// All five are the same look (the `warp` source: q→r→f domain-warp fbm,
		// dark base, warm/cool mid, pink filaments gated right so the text side
		// stays calm) and differ only by preset — scale / warm / cool / pink /
		// seed / speed — exactly as the design system's per-page presets do.
		// A faint self-feedback (src(o0)) keeps every patch a genuinely live
		// feedback loop (the "Hydra → WGSL, live" claim) and adds organic drift
		// without smearing at these tiny modulate amounts.
		const backgrounds = {
			// ink — cool, dim, minimal pink (calmest; near-monochrome nebula)
			ink: () =>
				warp(3.0, 0.30, 0.74, 0.38, 21, 0.9)
					.modulate(src(o0).scale(1.008).rotate(0.0014), 0.014)
					.out(o0),
			// silk — balanced warm/cool, soft filaments
			silk: () =>
				warp(3.4, 0.36, 0.66, 0.52, 12, 1.0)
					.modulate(src(o0).scale(1.006).rotate(0.0022), 0.018)
					.out(o0),
			// melt — warmer, larger slow-drifting blobs
			melt: () =>
				warp(2.6, 0.42, 0.60, 0.46, 33, 0.8)
					.modulate(src(o0).scale(1.012).rotate(-0.0016), 0.02)
					.out(o0),
			// signal (default) — the reference landing preset, brighter pink
			signal: () =>
				warp(3.2, 0.34, 0.72, 0.60, 21, 1.0)
					.modulate(src(o0).scale(1.01).rotate(0.0018), 0.016)
					.out(o0),
			// cells — tighter scale, filament-heavy, most pink
			cells: () =>
				warp(4.2, 0.38, 0.64, 0.72, 47, 1.15)
					.modulate(src(o0).scale(1.009).rotate(0.0026), 0.02)
					.out(o0),
		};
	
		// ---- accent patches (o1..o3) — sampled sparsely in the chamber -----
		osc(6, 0.06, 0.4)
			.modulate(src(o1).scale(1.018).rotate(-0.01), 0.08)
			.modulate(noise(2.6, 0.08), 0.35)
			.color(1.25, 0.55, 0.32)
			.saturate(0.82)
			.contrast(1.4)
			.out(o1); // ember
		noise(2.8, 0.05)
			.kaleid(7)
			.modulate(src(o2).scale(1.03).rotate(0.012), 0.07)
			.modulate(osc(5, 0.03, 0.7), 0.08)
			.color(0.38, 0.9, 1.15)
			.contrast(1.45)
			.out(o2); // mandala
		noise(1.6, 0.07)
			.modulate(src(o3).scale(1.006).rotate(0.003), 0.1)
			.modulate(osc(1.4, 0.025, 0.2).rotate(-0.55), 0.08)
			.color(0.42, 0.54, 0.82)
			.saturate(0.55)
			.contrast(1.06)
			.brightness(-0.08)
			.out(o3); // slow strata/haze; avoid posterized room-scale stripes
	
		// ---- stable display copies of each output ---------------------------
		// The scene must NEVER sample the ping-pong buffers directly: their
		// textures swap roles every frame, and binding them in the scene pass
		// cross-contaminates the feedback loops (scene content leaks into the
		// buffers and the patches recycle it into ghost trails). Instead each
		// output is blitted to a dedicated, never-swapped target; the scene
		// samples only those.
		const mkDisplay = (out) => {
			const rt = new RenderTarget(960, 540, {
				type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter,
				wrapS: RepeatWrapping, wrapT: RepeatWrapping, depthBuffer: false,
			});
			const mat = new MeshBasicNodeMaterial();
			mat.colorNode = out.texNode; // always points at out.read post-swap
			return { rt, quad: new QuadMesh(mat) };
		};
		const displays = [o0, o1, o2, o3].map(mkDisplay);
		const blitDisplays = () => {
			for (const d of displays) {
				synth.renderer.setRenderTarget(d.rt);
				d.quad.render(synth.renderer);
			}
		};
	
		// ---- composite scene: synth outputs as a background + materials ----
		const scene = new Scene();
		scene.backgroundNode = texture(displays[0].rt.texture, screenUV).mul(0.1)
			.add(texture(displays[3].rt.texture, screenUV).mul(0.08));
	
		// ---- atmospheric signal chamber -----------------------------------
		// Stable Hydra display textures are mapped onto actual room planes so
		// the liquid samples a surrounding environment, not a screen wallpaper.
		const roomTex = (i, scaleX, scaleY, offX = 0, offY = 0) =>
			texture(displays[i].rt.texture, uv().mul(vec2(scaleX, scaleY)).add(vec2(offX, offY)));
		const mkChamberMat = (sx, sy, ox, oy, gain, rimGain, opacity, additive = false, hero = false) => {
			const m = new MeshBasicNodeMaterial();
			m.side = DoubleSide;
			m.transparent = true;
			m.opacity = 1;
			m.depthWrite = false;
			if (additive) m.blending = AdditiveBlending;
			const u = uv();
			const uvFade = smoothstep(0.0, 0.18, u.x)
				.mul(smoothstep(0.0, 0.18, u.y))
				.mul(smoothstep(0.0, 0.18, u.x.oneMinus()))
				.mul(smoothstep(0.0, 0.18, u.y.oneMinus()));
			m.opacityNode = uvFade.mul(opacity);
			const base = roomTex(0, sx, sy, ox, oy);
			const strata = roomTex(3, sx * 0.72, sy * 0.58, ox + 0.13, oy + 0.29);
			const ember = roomTex(1, sx * 1.12, sy * 0.82, ox + 0.41, oy + 0.07);
			const cyan = roomTex(2, sx * 0.9, sy * 1.05, ox + 0.08, oy + 0.53);
			const x = positionWorld.x, y = positionWorld.y, z = positionWorld.z;
			const edgeX = smoothstep(-5.5, -2.4, x).mul(smoothstep(3.2, 6.0, x).oneMinus());
			const edgeY = smoothstep(-3.3, -1.8, y).mul(smoothstep(2.0, 3.5, y).oneMinus());
			const edgeDark = edgeX.mul(edgeY).mul(0.32).add(0.62);
			const depthFade = smoothstep(-4.8, 1.2, z).mul(0.28).add(0.52);
			const verticalBand = smoothstep(0.42, 1.0,
				y.mul(1.45).add(z.mul(-0.5)).add(ox * 4.0).sin().mul(0.5).add(0.5));
			const diagonalBand = smoothstep(0.48, 1.0,
				x.mul(0.7).add(y.mul(1.1)).add(z.mul(0.35)).add(oy * 5.0).sin().mul(0.5).add(0.5));
			const sparse = smoothstep(0.5, 0.88, strata.r).mul(verticalBand.mul(0.55).add(diagonalBand.mul(0.45)));
			const haze = strata.mul(0.34).add(base.mul(0.66));
			if (hero) {
				// hero wall: show o0 (the live-switchable background patch)
				// nearly raw — this is the surface that earns the page's
				// "Hydra → WGSL, live" claim. Masking is deliberately minimal:
				// just an edge feather, a touch of depth, and a left→right
				// brightness ramp so the text side stays calm while the synth
				// reads vividly on the right where the wells live.
				const rightBias = smoothstep(-4.0, 5.0, x).mul(0.62).add(0.5); // ~0.5 L → ~1.12 R
				m.colorNode = base.mul(0.84).add(strata.mul(0.16))
					.mul(gain)
					.mul(rightBias)
					.mul(depthFade.mul(0.45).add(0.62))
					.mul(uvFade.mul(0.32).add(0.68))
					.add(ember.mul(sparse.mul(0.06 * rimGain)))
					.add(cyan.mul(diagonalBand.mul(sparse).mul(0.05 * rimGain)))
					.add(vec3(0.012, 0.02, 0.028).mul(depthFade));
				return m;
			}
			m.colorNode = haze
				.mul(gain)
				.mul(uvFade.mul(0.45).add(0.55))
				.mul(edgeDark.mul(depthFade))
				.add(strata.mul(verticalBand.mul(0.055)))
				.add(ember.mul(sparse.mul(0.11 * rimGain)))
				.add(cyan.mul(diagonalBand.mul(sparse).mul(0.08 * rimGain)))
				.add(vec3(0.012, 0.02, 0.028).mul(depthFade));
			return m;
		};
		const addPlane = (w, h, mat, pos, rot) => {
			const mesh = new Mesh(new PlaneGeometry(w, h, 18, 18), mat);
			mesh.position.set(pos[0], pos[1], pos[2]);
			mesh.rotation.set(rot[0], rot[1], rot[2]);
			mesh.frustumCulled = false;
			scene.add(mesh);
			return mesh;
		};
		// A coherent box: five planes (back / floor / ceiling / left / right)
		// arranged as actual room walls that meet at right-angle corners,
		// rather than a splayed funnel. The front is left open toward the
		// camera. ROOM defines the box; each wall is sized to its two spans
		// (back = w×h, floor/ceiling = w×d, sides = d×h) and positioned at a
		// face centre, so adjacent edges line up at the corners.
		const HALF_PI = Math.PI / 2;
		const ROOM = { cx: 0.8, cy: 0.0, cz: 0.3, w: 15.0, h: 9.5, d: 9.0 };
		const { cx, cy, cz, w: rw, h: rh, d: rd } = ROOM;
		addPlane(rw, rh, mkChamberMat(0.62, 0.48, 0.02, 0.04, 1.18, 0.9, 0.96, false, true),
			[cx, cy, cz - rd / 2], [0, 0, 0]);                 // back wall — hero (o0, live)
		addPlane(rw, rd, mkChamberMat(0.58, 0.42, 0.18, 0.23, 0.54, 0.65, 0.62),
			[cx, cy - rh / 2, cz], [-HALF_PI, 0, 0]);          // floor
		addPlane(rw, rd, mkChamberMat(0.52, 0.36, 0.28, 0.61, 0.28, 0.35, 0.38, true),
			[cx, cy + rh / 2, cz], [HALF_PI, 0, 0]);           // ceiling
		addPlane(rd, rh, mkChamberMat(0.44, 0.5, 0.37, 0.08, 0.28, 0.42, 0.42),
			[cx - rw / 2, cy, cz], [0, HALF_PI, 0]);           // left wall
		addPlane(rd, rh, mkChamberMat(0.5, 0.54, 0.08, 0.44, 0.34, 0.5, 0.42),
			[cx + rw / 2, cy, cz], [0, -HALF_PI, 0]);          // right wall
	
		// ---- the scene's own ping-pong: previous frame as a texture --------
		// Every frame the whole scene is rendered into one of these two
		// targets and presented from it; next frame the flubber glass
		// refracts it. Same read/write discipline as the synth buffers:
		// sample only the half not being rendered into.
		const mkSceneRT = () => new RenderTarget(1, 1, {
			type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter,
			wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping, depthBuffer: true,
		});
		const ping = { read: mkSceneRT(), write: mkSceneRT() };

		// ---- display grade: one committed look on the way out --------------
		// Lives ONLY on the present pass: the synth buffers and the scene
		// feedback recursion sample ungraded signal, so this is a display
		// transform, never part of the loop. Pivoted-power tone contrast
		// (anchors shadows near true black instead of the floating gray),
		// a cool-shadow / warm-highlight split tone (separates the single
		// lavender wash into a deliberate palette that agrees with the page
		// accent #ffd9fb), gentle vibrance, and interleaved-gradient-noise
		// dither so the dark gradients don't band on 8-bit panels.
		// Uniforms exposed on window.__grade for live tuning.
		const grade = {
			exposure: uniform(1.05),
			contrast: uniform(1.32), // pivoted power: >1 steepens around pivot
			pivot: uniform(0.11),
			split: uniform(0.6),
			sat: uniform(1.28),
		};
		const LUMA = vec3(0.2126, 0.7152, 0.0722);
		const SHADOW_TINT = vec3(0.82, 0.93, 1.14); // cool blue shadows
		const HIGH_TINT = vec3(1.14, 0.96, 1.04);   // warm pink highlights
		const gradeNode = (c0) => {
			let c = c0.rgb.mul(grade.exposure).max(0.0);
			c = c.div(grade.pivot).pow(grade.contrast).mul(grade.pivot);
			const y = c.dot(LUMA);
			const shadows = smoothstep(0.02, 0.32, y).oneMinus().mul(grade.split);
			const highs = smoothstep(0.22, 0.72, y).mul(grade.split);
			c = c.mul(mix(vec3(1), SHADOW_TINT, shadows));
			c = c.mul(mix(vec3(1), HIGH_TINT, highs));
			c = mix(vec3(c.dot(LUMA)), c, grade.sat);
			// IGN dither: ±0.5/255, breaks up quantization steps invisibly
			const ign = screenCoordinate.x.mul(0.06711056)
				.add(screenCoordinate.y.mul(0.00583715)).fract()
				.mul(52.9829189).fract();
			return c.add(ign.sub(0.5).mul(1 / 255));
		};
		window.__grade = grade;

		const presentMat = new MeshBasicNodeMaterial();
		const presentTex = texture(ping.read.texture, screenUV);
		presentMat.colorNode = gradeNode(presentTex);
		const presentQuad = new QuadMesh(presentMat);
	
		// ---- globules: the metaball surface (GPU flubber field) ------------
		// The shape lives in a GPU storage substrate now — particles in storage
		// buffers, driven by the same roaming wells, splatted into a density
		// texture and marched as one emergent isosurface (FlubberField from
		// @oneilltom/lib3/flubber). No CPU sphere sources anymore. Constructed
		// below, once the wells it reads are defined. Disable with ?globs=0.
		const GLOBS = params.get('globs') !== '0';
		let flubber = null;
		let flubberBurst = null; // click-shockwave driver, triggered on pointerdown
		let flubNoise = null, flubCohesion = null; // live surface/cohesion uniforms
	
		const camera = new PerspectiveCamera(38, 1, 0.1, 50);
		camera.position.z = 6;
		const inspectTarget = new Vector3(0.8, 0.0, -0.35);
		const inspectState = {
			radius: 6.2,
			theta: -0.08,
			phi: Math.PI * 0.5,
			dragging: false,
			dragged: false,
			x: 0,
			y: 0,
		};
		// ---- default camera: a slow, deliberate orbit ----------------------
		// The GR rosette read as texture without travel — nobody could feel
		// the path. Now the camera rides ONE legible ellipse around its
		// resting pose: slightly eccentric (Kepler pacing — long glide out
		// wide, a quicker swing through the near side), tilted off the flat
		// so the sway has a vertical breath, the whole loop slowly
		// precessing about Y so no two laps trace the same line. Amplitudes
		// stay inside the drift envelope: the open room front never shows.
		const camRest = new Vector3(0, 0, 6);
		const ORBIT = {
			period: 44,   // s per lap — drift, not a ride
			a: 0.8,       // semi-major axis, world units
			b: 0.42,      // semi-minor — the ellipse, not a circle
			tilt: 0.5,    // off-flat inclination, rad
			ecc: 0.3,     // pacing: faster near, slower far
			nodal: 0.011, // loop precession about Y, rad/s (~9.5 min/rev)
		};
		const rollAxis = new Vector3(0, 0, 1); // camera local forward/back
		const qRoll = new Quaternion(), qNode = new Quaternion();
		const yAxis = new Vector3(0, 1, 0), xAxis = new Vector3(1, 0, 0);
		// the camera's live offset from rest — the circuitry overlay
		// parallaxes its panes against this, so the readouts ride the same
		// orbit the world does
		const sway = new Vector3();
		const applyDriftCamera = (t) => {
			const m = (2 * Math.PI / ORBIT.period) * t;
			const th = m + ORBIT.ecc * Math.sin(m); // equation-of-center pacing
			sway.set(ORBIT.a * Math.cos(th), 0, ORBIT.b * Math.sin(th));
			sway.applyAxisAngle(xAxis, ORBIT.tilt);
			qNode.setFromAxisAngle(yAxis, ORBIT.nodal * t);
			sway.applyQuaternion(qNode);
			camera.position.copy(camRest).add(sway);
			camera.lookAt(
				0.10 * Math.sin(t * 0.043 + 2.1),
				0.08 * Math.sin(t * 0.061 + 0.4),
				0);
			// roll: a faint bank about the view axis — the one motion lookAt
			// can't express (it always keeps the horizon level). Built as a
			// quaternion about the camera's local Z and post-multiplied onto
			// the gaze, so it composes in view space without gimbal issues.
			qRoll.setFromAxisAngle(rollAxis, 0.05 * Math.sin(t * 0.037 + 0.5));
			camera.quaternion.multiply(qRoll);
		};
		const applyInspectCamera = () => {
			if (!INSPECT) return;
			const s = Math.sin(inspectState.phi);
			camera.position.set(
				inspectTarget.x + inspectState.radius * s * Math.sin(inspectState.theta),
				inspectTarget.y + inspectState.radius * Math.cos(inspectState.phi),
				inspectTarget.z + inspectState.radius * s * Math.cos(inspectState.theta));
			camera.lookAt(inspectTarget);
		};
		if (INSPECT) {
			applyInspectCamera();
			addEventListener('pointerdown', (ev) => {
				if (ev.target.closest('a, .patch, #circuitry .knobrow')) return;
				ev.preventDefault();
				inspectState.dragging = true;
				inspectState.dragged = false;
				inspectState.x = ev.clientX;
				inspectState.y = ev.clientY;
				canvas.setPointerCapture?.(ev.pointerId);
			});
			addEventListener('pointermove', (ev) => {
				if (!inspectState.dragging) return;
				ev.preventDefault();
				const dx = ev.clientX - inspectState.x;
				const dy = ev.clientY - inspectState.y;
				inspectState.x = ev.clientX;
				inspectState.y = ev.clientY;
				if (Math.abs(dx) + Math.abs(dy) > 2) inspectState.dragged = true;
				inspectState.theta -= dx * 0.006;
				inspectState.phi = clampNumber(inspectState.phi + dy * 0.005, 0.28, Math.PI - 0.28);
				applyInspectCamera();
			});
			addEventListener('pointerup', (ev) => {
				inspectState.dragging = false;
				canvas.releasePointerCapture?.(ev.pointerId);
			});
			addEventListener('wheel', (ev) => {
				ev.preventDefault();
				inspectState.radius = clampNumber(inspectState.radius * Math.exp(ev.deltaY * 0.001), 2.2, 11);
				applyInspectCamera();
			}, { passive: false });
		}
	
		const resize = () => {
			const pr = Math.min(devicePixelRatio, 1.75);
			synth.renderer.setPixelRatio(pr);
			synth.renderer.setSize(innerWidth, innerHeight);
			// scene feedback targets track the drawing buffer so the
			// mirror recursion stays crisp and aspect-true
			ping.read.setSize(Math.round(innerWidth * pr), Math.round(innerHeight * pr));
			ping.write.setSize(Math.round(innerWidth * pr), Math.round(innerHeight * pr));
			camera.aspect = innerWidth / innerHeight;
			camera.updateProjectionMatrix();
			applyInspectCamera();
		};
		resize();
		addEventListener('resize', resize);
	
		// FlubberField is created below, once the wells it reads are defined.
	
		// ---- the wells: the two tips of the sling ---------------------------
		// The particle mass falls toward (and swirls around) these two
		// points; src/sling.js owns their motion, pull (gm) and swirl (sm).
		// Inverse-square gravity + axis×toAttractor swirl live in lib3's
		// wellDriver on the GPU.
		const wells = [
			{ p: new Vector3(), axis: new Vector3(0, 0, 1), gm: 1.3, sm: 0.7 }, // tip A: heavy
			{ p: new Vector3(), axis: new Vector3(0, 0, 1), gm: 0.8, sm: 1.6 }, // tip B: light
		];
		// GPU metaball field: storage-buffer particles driven by these wells,
		// splatted to a density texture, marched with the site-tuned glass
		// (refraction samples the scene ping-pong, aspect-correct).
		if (GLOBS) {
			// same motion feel as the old inline field: gravity wells + a little
			// noise for surface life + cohesion to keep the mass coherent, plus a
			// click shockwave. FlubberField's defaults (count/grid/box/glass) match
			// the site's tuned values, so only the drivers and textures differ.
			flubberBurst = burstDriver();
			flubNoise = noiseFlowDriver();
			// firmer than the old default: no score curates cohesion anymore,
			// so the standing pull must survive the whips on its own
			flubCohesion = cohesionDriver({ strength: 0.8 });
			flubber = new FlubberField({
				renderer: synth.renderer,
				camera,
				drivers: [wellDriver({ wells, count: 2 }), flubNoise, flubCohesion, flubberBurst],
				sceneTexture: ping.read.texture,
				rimTexture: displays[1].rt.texture,
			});
			flubber.u.uDamp.value = 0.75; // eat the whip's fling a little faster
			scene.add(flubber.mesh);
			window.__flubber = flubber;
		}

		// ---- the rack: every tunable gets an address -------------------------
		// lib3's control plane. The sling registers the few chosen knobs
		// (/sling/*, /flubber/noise) inside createSling; nothing persists —
		// a reload always serves the authored defaults.
		const rack = new Rack();
		window.__rack = rack;

		// ---- the sling (src/sling.js): the perpetual mechanism --------------
		const sling = createSling({ wells, noise: flubNoise, rack });
		const { graph } = sling;
		const slingStep = sling.step;

		// click/tap: a shockwave where the pointer ray crosses the blob's
		// depth plane — the mass scatters, cohesion gathers it back up
		const raycaster = new Raycaster(), pointer = new Vector2();
		addEventListener('pointerdown', (ev) => {
			// artist-mode scrubs must not fire the burst shockwave
			if (INSPECT || ev.target.closest('a, .patch, #circuitry .knobrow')) return;
			if (!flubberBurst) return;
			pointer.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
			raycaster.setFromCamera(pointer, camera);
			const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
			const tz = Math.abs(rd.z) > 1e-3 ? (flubber.center.z - ro.z) / rd.z : 6;
			const bp = ro.clone().addScaledVector(rd, Math.max(0.5, tz));
			flubberBurst.trigger(bp, 1.8, 22);
		});

		let circuit = null; // the circuitry overlay (created below, post-reduced check)
		let last = 0;
		const sim = { t: 0 }; // accumulated *stepped* time — test hook
		const SUBSTEP = 1 / 60; // fixed-ish step: stable forces
		const frame = (t) => {
			const fdt = Math.min(t - last, 1 / 20); // clamp: tab refocus, hitches
			let dt = fdt;
			last = t;
			sim.t += dt;
			// advance any in-flight rack glides BEFORE the substeps read the
			// bound constants — a no-op when nothing is ramping
			rack.update(fdt);
			// drift the default camera before stepping: the flubber field and
			// the render see one consistent camera pose this frame. Inspect
			// mode and reduced motion keep their fixed poses.
			if (!INSPECT && !reduced) applyDriftCamera(t);
			while (dt > 0) {
				const h = Math.min(dt, SUBSTEP);
				slingStep(h, t - dt + h);
				dt -= h;
			}
			// GPU metaball field: push the freshly-stepped wells to the sim,
			// point refraction at last frame's presented buffer, run the two
			// compute passes — all BEFORE the scene render marches the density.
			if (flubber) {
				flubber.setSceneTexture(ping.read.texture);
				flubber.update(fdt, t);
			}
			synth.update(t);
			blitDisplays();
			// scene → write, present write, swap
			synth.renderer.setRenderTarget(ping.write);
			synth.renderer.render(scene, camera);
			presentTex.value = ping.write.texture;
			synth.renderer.setRenderTarget(null);
			presentQuad.render(synth.renderer);
			const r = ping.read; ping.read = ping.write; ping.write = r;
			// the circuitry overlay: DOM/SVG, outside the GPU loop entirely
			circuit?.tick(t, { camera, wells, sway });
		};
		window.__wells = wells; window.__sim = sim;
		window.__sling = sling; window.__graph = graph;
		window.__camera = camera; window.__inspect = inspectState; // test hooks
	
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		// the artwork exposes its own circuitry: a dim live rendering of the
		// sling's signal graph, part of the piece for every viewer. Hard
		// escape: ?circuit=0. Small screens skip it — the text owns them.
		if (params.get('circuit') !== '0' && matchMedia('(min-width: 720px)').matches) {
			const { createCircuitOverlay } = await import('./circuit-overlay.js');
			circuit = createCircuitOverlay({
				graph, rack, artist: params.get('artist') === '1',
			});
		}
		const setBg = (name) => {
			backgrounds[name]();
			document.querySelectorAll('.patch').forEach(
				(el) => el.classList.toggle('on', el.dataset.p === name));
			if (reduced) {
				for (let i = 0; i < 45; i++) synth.update(i / 10);
				// let the field settle from its seeded ball into a wells-shaped
				// mass before the single presented frame
				for (let i = 1; i <= 40; i++) frame(0.05 * i);
			}
		};
		setBg(backgrounds[location.hash.slice(1)] ? location.hash.slice(1) : 'signal');
		document.querySelectorAll('.patch').forEach((el) =>
			el.addEventListener('click', () => setBg(el.dataset.p)));
	
		const isWebGPU = synth.backend === 'WebGPU';
		document.getElementById('backend').textContent = synth.backend;
		document.getElementById('lang').textContent = isWebGPU ? 'WGSL' : 'GLSL';
		document.getElementById('caption-live').hidden = false;
	
		const t0 = performance.now();
		function loop() {
			frame((performance.now() - t0) / 1000);
			if (!reduced) requestAnimationFrame(loop);
		}
		if (!reduced) loop();
		window.__ready = true;
	} catch (e) {
		// no WebGPU and no WebGL — leave the plain dark page
		console.warn('background synth unavailable:', e);
	}
}

main();
