import { HydraTSL } from './hydra-tsl.js';
import {
	FlubberField, wellDriver, noiseFlowDriver, cohesionDriver, burstDriver,
} from '@oneilltom/lib3/flubber';
import {
	Scene, PerspectiveCamera, InstancedMesh, Mesh, BoxGeometry, TetrahedronGeometry,
	OctahedronGeometry, PlaneGeometry, MeshBasicNodeMaterial, DynamicDrawUsage,
	Vector2, Vector3, Quaternion, Matrix4, Raycaster,
	RenderTarget, QuadMesh, HalfFloatType, LinearFilter, ClampToEdgeWrapping, RepeatWrapping,
	AdditiveBlending, DoubleSide,
} from 'three/webgpu';
import {
	texture, screenUV, uv, normalLocal, instanceIndex, hash, select, uint,
	vec2, vec3, clamp, mix, length, normalize, positionWorld, smoothstep,
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
	
		// ---- the scene's own ping-pong: previous frame as a material -------
		// Every frame the whole scene is rendered into one of these two
		// targets and presented from it; next frame the boxes' faces sample
		// it. Each box face is a tiny screen showing the swarm, whose boxes
		// show the swarm — live video feedback, recursion until the pixels
		// run out. Same read/write discipline as the synth buffers: sample
		// only the half not being rendered into.
		const mkSceneRT = () => new RenderTarget(1, 1, {
			type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter,
			wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping, depthBuffer: true,
		});
		const ping = { read: mkSceneRT(), write: mkSceneRT() };
		const mirrorTex = texture(ping.read.texture, uv()); // .value re-pointed post-swap

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
	
		// tetra/octa faces wear the synth outputs — patch choice computed in
		// the shader from instanceIndex + dominant local axis, hash() tint.
		// The boxes are the mirrors: previous frame on every face, faintly
		// modulated by a patch so each recursion level drifts more synthward.
		const faceTex = [1, 2, 3].map((i) => texture(displays[i].rt.texture, uv()));
		const mkSwarmMaterial = (offset, mirror) => {
			const m = new MeshBasicNodeMaterial();
			const an = normalLocal.abs();
			const faceId = select(an.x.greaterThan(an.y).and(an.x.greaterThan(an.z)), uint(0),
				select(an.y.greaterThan(an.z), uint(1), uint(2)));
			const layer = instanceIndex.add(faceId).add(uint(offset)).mod(uint(3));
			const tint = hash(instanceIndex.add(uint(offset * 131 + 7))).mul(0.55).add(0.7);
			// sample all unconditionally (texture fetches inside non-uniform
			// branches degrade derivatives on WGSL); select on the values
			const patch = select(layer.equal(uint(0)), faceTex[0],
				select(layer.equal(uint(1)), faceTex[1], faceTex[2]));
			m.colorNode = mirror
				? mirrorTex.mul(patch.mul(0.7).add(0.75)).mul(1.25).mul(tint)
				: patch.mul(tint);
			return m;
		};
	
		// ?swarm=1 brings back the instanced-primitive swarm alongside the
		// globules; default is the minimal globules-only composition
		const SWARM = params.get('swarm') === '1';
		const KINDS = !SWARM ? [] : [
			{ geo: new BoxGeometry(0.3, 0.3, 0.3), count: 56, r: 0.26, mirror: true },
			{ geo: new TetrahedronGeometry(0.26), count: 36, r: 0.2 },
			{ geo: new OctahedronGeometry(0.24), count: 36, r: 0.2 },
		];
		const bodies = [];
		const meshes = KINDS.map((k, ki) => {
			const mesh = new InstancedMesh(k.geo, mkSwarmMaterial(ki, k.mirror), k.count);
			mesh.instanceMatrix.setUsage(DynamicDrawUsage);
			mesh.frustumCulled = false; // always fully in frame anyway
			scene.add(mesh);
			for (let i = 0; i < k.count; i++) {
				const s = 0.55 + Math.random() * 0.6; // size = mass variation
				bodies.push({
					mesh, idx: i, s, r: k.r * s,
					p: new Vector3((Math.random() - 0.5) * 5.2,
						(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2.4),
					v: new Vector3(Math.random() - 0.5, Math.random() - 0.5,
						Math.random() - 0.5).multiplyScalar(0.05), // wake up gently
					q: new Quaternion().random(),
					w: new Vector3(Math.random() - 0.5, Math.random() - 0.5,
						Math.random() - 0.5).normalize().multiplyScalar(0.15 + Math.random() * 0.5),
					pull: 0.75 + Math.random() * 0.5,
					wf: 0.5 + Math.random() * 0.6, // wander frequency
					ph: [Math.random(), Math.random(), Math.random()].map((x) => x * Math.PI * 2),
				});
			}
			return mesh;
		});
	
		// ---- globules: the metaball surface (GPU flubber field) ------------
		// The shape lives in a GPU storage substrate now — particles in storage
		// buffers, driven by the same roaming wells, splatted into a density
		// texture and marched as one emergent isosurface (FlubberField from
		// @oneilltom/lib3/flubber). No CPU sphere sources anymore. Constructed
		// below, once the wells it reads are defined. Disable with ?globs=0.
		const GLOBS = params.get('globs') !== '0';
		let flubber = null;
		let flubberBurst = null; // click-shockwave driver, triggered on pointerdown
		let flubNoise = null, flubCohesion = null; // score crash knobs (live uniforms)
		let flubLattice = null; // two-cohort crystal lattice (live uniforms)
	
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
		// ---- default camera: a slow, bounded drift (parallax, no path) ----
		// Same contract as before (breathe around the resting pose that
		// composes well: text calm left, open front off-screen) but the
		// breathing is now a general-relativistic orbit instead of stacked
		// sines. The offset from camRest traces a Schwarzschild rosette —
		// the Binet equation u'' = M/L² + 3Mu² − u from dynamics-notebook
		// rung 17 — paced by physical time (dφ = L·u²·dt), so the drift
		// inherits real orbital texture: long slow apoapsis glides, a
		// quicker swing through perihelion, and a perihelion that creeps
		// ~91° per lap so the path never retraces. The orbital plane is
		// tilted and its node slowly regresses about world Y (the
		// Lense-Thirring flavor), which turns the planar rosette into a
		// gentle 3D tumble. Amplitudes stay inside the old sine envelope
		// (~0.55 x/z, ~0.30 y): parallax without exposing the front wall.
		const camRest = new Vector3(0, 0, 6);
		const rollAxis = new Vector3(0, 0, 1); // camera local forward/back
		const qRoll = new Quaternion();
		// orbit constants (G = c = M = 1; radii in Schwarzschild M units).
		// Perihelion 11M with L = 1.1·√(M·p) gives apoapsis ≈ 33.6M,
		// e ≈ 0.51, precession ≈ 91°/orbit — measured numerically, the
		// GR term makes all three deviate from their Newtonian reads.
		const ORB_M = 1;
		const ORB_L = 1.1 * Math.sqrt(ORB_M * 11 * 1.55); // ≈ 4.542
		const ORB_TIME = 32;      // sim-units per real second → radial lap ≈ 23 s
		const ORB_SCALE = 0.55 / 33.6; // apoapsis maps to the old max amplitude
		const ORB_TILT = 1.0;     // plane inclination, rad (splits y vs z sway)
		const ORB_NODAL = 0.0016; // node drift, rad per sim-unit (~2 min/rev)
		const orb = { u: 1 / 11, du: 0, phi: 0, last: 0 };
		const qNode = new Quaternion(), yAxis = new Vector3(0, 1, 0);
		const xAxis = new Vector3(1, 0, 0);
		const orbPos = new Vector3();
		const applyDriftCamera = (t) => {
			const dtSim = Math.min(Math.max(t - orb.last, 0), 0.1) * ORB_TIME;
			orb.last = t;
			// substep the Binet integration (dφ = L·u²·dt keeps Kepler pacing)
			for (let rem = dtSim; rem > 0; rem -= 0.05) {
				const h = Math.min(rem, 0.05);
				const dphi = ORB_L * orb.u * orb.u * h;
				orb.du += (ORB_M / (ORB_L * ORB_L) + 3 * ORB_M * orb.u * orb.u - orb.u) * dphi;
				orb.u = clampNumber(orb.u + orb.du * dphi, 1 / 45, 1 / 8); // backstop only
				orb.phi += dphi;
			}
			const r = ORB_SCALE / orb.u;
			// rosette in the local plane → tilt → slow nodal precession
			orbPos.set(r * Math.cos(orb.phi), r * Math.sin(orb.phi), 0);
			qNode.setFromAxisAngle(yAxis, ORB_NODAL * t * ORB_TIME);
			orbPos.applyAxisAngle(xAxis, ORB_TILT).applyQuaternion(qNode);
			camera.position.set(
				camRest.x + orbPos.x,
				camRest.y + orbPos.y,
				camRest.z + orbPos.z);
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
				if (ev.target.closest('a, .patch')) return;
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
	
		// ---- physics: three invisible gravity wells with spin --------------
		// Force model adapted from three.js's webgpu_tsl_compute_attractors_
		// particles: real inverse-square gravity (softened — bodies are
		// visible, they must not singularity-slingshot), plus a spinning
		// force axis×toAttractor scaled by the SAME gravity strength, so
		// swirl peaks exactly where gravity peaks → spiral arms. Three
		// roaming wells with different precessing spin axes trade bodies
		// between basins. The spin term does work against damping, keeping
		// the discs circulating forever. NOT copied from the example: its
		// mod() box-wrap boundary — a position teleport, the exact bug
		// class behind 'the glitch'. Soft frustum walls instead. Positions
		// change ONLY via velocities (see test/frame-continuity.mjs).
		const GRAV = 2.6;                         // G·M, per-body mass in b.pull
		const SOFT2 = 0.24 * 0.24;               // softening radius² (d² += this)
		                                          // tighter core → sharper gravity
		                                          // peak → fast periapsis swoops,
		                                          // slow apoapsis drift (Kepler)
		const SPIN = 1.4;                         // spin force vs gravity strength —
		                                          // eased so gravity wins and orbits
		                                          // go elliptical, not a forced
		                                          // constant-speed circular limit cycle
		const SEP_K = 0.7, SEP_F_MAX = 2.5;       // soft mutual repulsion
		const WANDER = 0.1;
		const DRAG = 0.6;                         // per-second exponential — lighter,
		                                          // so velocity keeps its memory and
		                                          // bodies coast (momentum) instead of
		                                          // settling to a terminal speed
		const SPEED_MAX = 2.6, SPEED_CAP = 3.2;   // soft governor, hard ceiling
		                                          // (test budget = 3.4, keep in sync)
		const Z_RANGE = 1.5;
		const K_WALL_IN = 22, K_WALL_OUT = 34;    // soft frustum walls, backstop only
		// each well has a temperament: gm/sm scale its gravity/spin, sp its
		// roaming tempo, and a slow per-well mood swing (computed in step)
		// juxtaposes calm against violent over ~1.5min cycles
		const wells = [
			{ p: new Vector3(), axis: new Vector3(), ph: 0.0, ax: 1.45, ay: 0.5,
				gm: 1.5, sm: 0.7, sp: 0.65, mood: 1 },  // the heavy: deep, slow
			{ p: new Vector3(), axis: new Vector3(), ph: 2.1, ax: 1.0, ay: 0.8,
				gm: 0.7, sm: 2.1, sp: 1.6, mood: 1 },   // the spinner: violent, fast
			{ p: new Vector3(), axis: new Vector3(), ph: 4.2, ax: 1.3, ay: 0.6,
				gm: 1.0, sm: 1.2, sp: 1.0, mood: 1 },   // the drifter: in between
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
			flubCohesion = cohesionDriver();
			// two intercalating LATTICES. Each particle owns a home site in a
			// small crystal bound to one of the two duet partners (cohort by
			// index parity, 80 spheres each in a jittered 4×5×4 grid). Cohort
			// B's grid sits half a cell off A's, so when the anchors close the
			// two crystals slot into each other's interstices — and the
			// pendulum-slingshot swings them THROUGH each other at perigee.
			// uStr is the lattice grip, choreographed by the score:
			// 0 = free cloud, high = crystalline body.
			flubLattice = (() => {
				const uA = uniform(new Vector3());
				const uB = uniform(new Vector3());
				const uStr = uniform(0);
				const PITCH = 0.22;
				return {
					uniforms: { uA, uB, uStr },
					force({ pos, index }) {
						const half = index.div(uint(2));
						const isB = index.mod(uint(2)).toFloat();
						const site = vec3(
							half.mod(uint(4)).toFloat().sub(1.5),
							half.div(uint(4)).mod(uint(5)).toFloat().sub(2.0),
							half.div(uint(20)).mod(uint(4)).toFloat().sub(1.5))
							.add(isB.mul(0.5))
							.add(vec3(
								hash(index).sub(0.5),
								hash(index.add(uint(7))).sub(0.5),
								hash(index.add(uint(13))).sub(0.5)).mul(0.45))
							.mul(PITCH);
						return mix(uA, uB, isB).add(site).sub(pos).mul(uStr);
					},
					update() {
						uA.value.copy(wells[0].p);
						uB.value.copy(wells[1].p);
					},
				};
			})();
			flubber = new FlubberField({
				renderer: synth.renderer,
				camera,
				drivers: [wellDriver({ wells }), flubNoise, flubCohesion, flubberBurst, flubLattice],
				sceneTexture: ping.read.texture,
				rimTexture: displays[1].rt.texture,
			});
			scene.add(flubber.mesh);
			window.__flubber = flubber;
		}

		const dq = new Quaternion(), tmp = new Vector3(), tmp2 = new Vector3();
	
		const softWall = (b, axis, limit, dt) => {
			const c = 'xyz'[axis];
			let depth = 0, n = 0; // n: inward wall normal
			if (b.p[c] + b.r > limit) { depth = b.p[c] + b.r - limit; n = -1; }
			else if (b.p[c] - b.r < -limit) { depth = -limit - (b.p[c] - b.r); n = 1; }
			if (depth > 0) b.v[c] += n * (b.v[c] * n < 0 ? K_WALL_IN : K_WALL_OUT) * depth * dt;
		};
	
		// ---- the score: choreography clock for the wells --------------------
		// The wells stop roaming on independent sines and dance a phrase:
		// ORBIT → CONVERGENCE → HELD TENSION → RELEASE (crash), repeating,
		// with the drifter as a slow ostinato underneath. Every control
		// signal reaches its target through a spring or a slew limit, so
		// velocity stays continuous and acceleration ramps — jerk-limited,
		// nothing pops. The mini spring is vendored from lib3's conductor
		// (Spring) pending a package export.
		const springStep = (s, dt) => {
			const w = 2 * Math.PI * s.freq;
			let rem = Math.min(dt, 0.25);
			while (rem > 0) {
				const h = Math.min(rem, 1 / 120);
				s.vel += (-w * w * (s.value - s.target) - 2 * s.zeta * w * s.vel) * h;
				s.value += s.vel * h;
				rem -= h;
			}
		};
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
		// separation: near-critical (clean brake, no wobble); drive:
		// underdamped so the gear shifts lurch and settle instead of stepping
		const sep = { value: SCORE.rWide, target: SCORE.rWide, vel: 0, freq: 0.45, zeta: 0.9 };
		const drive = { value: SCORE.omegaBase, target: SCORE.omegaBase, vel: 0, freq: 0.8, zeta: 0.5 };
		const score = {
			theta: 0, energy: 0.2, last: 0, shift: 0, mood: 0.6, baryK: 2,
			pulse: 0,        // throb phase — the accumulating ostinato under the surge
			released: false, // one-shot latch for the cast-out at the hang boundary
			nextSlip: 0,     // when the next containment slip may fire (reactor)
			hangMode: 0,     // how this phrase settles: 0 = one held glob, 1 = cast wide
			nextGlitch: 0,   // when the outer world may next punch through
			glitchUntil: 0,  // glitch window end (split-second)
			glitching: false,
			e: 0.05,         // orbital eccentricity — the pendulum in the slingshot
			lastOrbit: 0,    // perigee-pass counter
			lastPump: 0,     // last whip time (rate-limits the pump)
			flat: 1, // partner-diameter y squash: ~0 = pair pinned to the floor plane
			// flubber stage targets, followed in frame() at rate k (per-second)
			flub: { noise: 0.4, coh: 0.45, damp: 0.6, cap: 3.2, lat: 0, k: 1.6 },
		};
		const bary = new Vector3(1.0, -0.95, 0.3); // starts at the floor point
		const baryT = new Vector3(), partnerU = new Vector3();
		const splashAt = new Vector3(); // burst origin, above the floor contact
		const slipAt = new Vector3();   // containment-slip burst origin (reactor)
		const glitchOff = new Vector3(); // where the outer world drags the anchor
		const tangent = new Vector3();  // whip exit direction at perigee
		const slingVel = new Vector3(); // barycentre momentum from the slingshot
		// deterministic pseudo-noise — the sim must stay reproducible under the
		// virtual test clock, so no Math.random in the score
		const prand = (x) => {
			const s = Math.sin(x * 12.9898) * 43758.5453;
			return s - Math.floor(s);
		};

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
			const p01 = (t / SCORE.phrase) % 1;
			if (p01 < score.last) {
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
				if (flubberBurst) {
					splashAt.set(bary.x, bary.y + 0.9, bary.z);
					flubberBurst.trigger(splashAt, 2.4, 20);
				}
				if (flubNoise) flubNoise.uniforms.uAmt.value = 1.5;
				if (flubCohesion) flubCohesion.uniforms.uStr.value = 0.12;
			}
			score.last = p01;
			// the wave builds. Trickle charge only — the real energy source is
			// the SLINGSHOT below: each perigee whip pumps the ledger. The
			// compounding shape survives (bigger e → harder whips → faster
			// pumps → bigger e), but now it's mechanical, not administrative.
			if (p01 < SCORE.build) score.energy = Math.min(1, score.energy + dt / 40);
			else if (p01 < SCORE.hang) score.energy = Math.min(1, score.energy * (1 + 0.06 * dt));
			// the throb: an accumulating ostinato under the surge — swells come
			// quicker AND deeper as the ledger charges, and each one kicks the
			// drive a little harder than the last
			if (p01 >= SCORE.build && p01 < SCORE.hang) {
				score.pulse += (0.35 + 1.15 * score.energy) * Math.PI * 2 * dt;
				if (score.pulse > Math.PI * 2) {
					score.pulse -= Math.PI * 2;
					drive.vel += 0.4 + 1.3 * score.energy;
				}
			} else score.pulse = 0;
			const throb = Math.pow(Math.max(0, Math.sin(score.pulse)), 3)
				* 0.55 * score.energy;
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
			const strain = (p01 >= SCORE.brake && p01 < SCORE.hang)
				? score.energy * Math.min(1, (p01 - SCORE.brake) / 0.06) : 0;
			// containment slips: at high strain, aperiodic partial escapes — a
			// small burst jets mass off the core, cohesion drags it back, and
			// the drive lurches (biased toward MORE speed: instability feeds)
			if (strain > 0.5 && t >= score.nextSlip) {
				score.nextSlip = t + 0.7 + 1.6 * prand(t * 7.77);
				if (flubberBurst) {
					slipAt.set(
						bary.x + (prand(t * 3.1) - 0.5) * 0.8,
						bary.y + (prand(t * 5.2) - 0.5) * 0.8,
						bary.z + (prand(t * 9.4) - 0.5) * 0.5);
					flubberBurst.trigger(slipAt, 0.9, 5 + 5 * score.energy);
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
				if (flubberBurst) {
					slipAt.set(
						bary.x + (prand(t * 6.7) - 0.5) * 1.2,
						bary.y + (prand(t * 8.9) - 0.5) * 1.0,
						bary.z + (prand(t * 11.3) - 0.5) * 0.6);
					flubberBurst.trigger(slipAt, 1.6, 55);
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
			if (!score.released && p01 >= SCORE.hang && p01 < SCORE.drop) {
				score.released = true;
				score.hangMode = Math.floor(t / SCORE.phrase) % 2;
				drive.vel *= 0.2;
				if (score.hangMode === 1) {
					sep.vel += 2.0;
					if (flubberBurst) flubberBurst.trigger(bary, 2.6, 7);
				} else {
					sep.vel += 0.4;
				}
			}
			// separation: wide floor scatter → medium rising pair → wide duet
			// → late brake (change concentrated at the window's end) → tight
			// through the hang and the drop
			if (p01 < SCORE.rise) sep.target = SCORE.rWide;
			else if (p01 < SCORE.build) sep.target = 0.7;
			else if (p01 < SCORE.brake) sep.target = SCORE.rWide;
			else if (p01 < SCORE.hang) {
				// hard brake INTO the corner: clamp down over ~2s, then HOLD
				// the tight whirl — the reactor needs dwell time at full
				// compression, not a convergence that only arrives at the end
				const b = Math.min(1, (p01 - SCORE.brake) / 0.08);
				sep.target = SCORE.rWide + (SCORE.rTight - SCORE.rWide) * Math.pow(b, 1.5);
			} else {
				sep.target = score.hangMode === 1 ? 1.1 : SCORE.rTight;
			}
			// orbital drive: calm floor → whirling rise → geared build →
			// energy-fast brake → near-still hang and drop
			if (p01 < SCORE.rise) drive.target = SCORE.omegaBase;
			else if (p01 < SCORE.build) drive.target = 1.25;
			else if (p01 >= SCORE.brake && p01 < SCORE.hang) {
				// energy² so the top of the surge owns most of the range —
				// the last stretch before the crest is where it gets violent
				drive.target = SCORE.omegaBase
					+ (SCORE.omegaMax - SCORE.omegaBase)
					* (0.25 + 0.75 * score.energy * score.energy);
			} else if (p01 >= SCORE.hang) drive.target = 0.12;
			springStep(sep, dt);
			springStep(drive, dt);
			// ---- the pendulum-slingshot. The orbit is ECCENTRIC, and more so
			// as the ledger charges: the pair swings out wide and slow, then
			// WHIPS through perigee — equal areas in equal times, dθ ∝ 1/r²
			// (clamped ×5). The perigee direction precesses, so the whip
			// sweeps around the well like a whirling pendulum.
			const eT = (p01 >= SCORE.build && p01 < SCORE.hang)
				? 0.2 + 0.7 * score.energy : 0.05;
			score.e += (eT - score.e) * (1 - Math.exp(-1.5 * dt));
			const nu = score.theta - 0.15 * t;      // anomaly vs precessing perigee
			const rf = 1 - score.e * Math.cos(nu);  // radial factor: (1-e)..(1+e)
			const whip = Math.min(5, 1 / (rf * rf));
			score.theta += drive.value * whip * dt;
			// perigee pass = the slingshot. THIS is where the energy comes
			// from now: the whip pumps the ledger, kicks the swing, and slings
			// mass along the exit tangent — a burst fired from just behind the
			// whipping partner throws everything in the whip's direction.
			const orbitN = Math.floor(nu / (2 * Math.PI));
			// gate on the STAGE, not just eccentricity — e decays slowly, and
			// a sling landing a second into the hang would kick the sigh
			if (orbitN > score.lastOrbit && t - score.lastPump > 0.7 && score.e > 0.25
				&& p01 >= SCORE.build && p01 < SCORE.hang) {
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
				if (flubberBurst) {
					slipAt.copy(wells[0].p).addScaledVector(tangent, -0.45);
					flubberBurst.trigger(slipAt, 0.9, 8 + 8 * score.energy);
				}
			}
			score.lastOrbit = orbitN;
			// barycentre: a stage target chased by a one-pole — the attractor
			// may dart, the mass it drags stays continuous
			if (p01 < SCORE.rise) {
				// scattered along the bottom, gentle sideways wash
				baryT.set(1.0 + 0.35 * Math.sin(0.3 * t), SCORE.floorY, 0.3);
				score.baryK = 2.2;
			} else if (p01 < SCORE.build) {
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
			} else if (p01 < SCORE.hang) {
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
			} else if (p01 < SCORE.drop) {
				// cast out onto the cloud: lifted a breath above the ceiling
				// point and held by a slow wind — bobbing, not pinned
				baryT.set(
					1.0 + 0.18 * Math.sin(0.45 * t),
					SCORE.topY + 0.08 + 0.05 * Math.sin(0.7 * t + 0.8),
					0.3 + 0.12 * Math.sin(0.5 * t + 2.1));
				score.baryK = 0.9;
			} else {
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
			const flatT = p01 < SCORE.rise ? 0.12 : 1;
			score.flat += (flatT - score.flat) * (1 - Math.exp(-2.5 * dt));
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
			const f01 = p01 >= SCORE.drop
				? (p01 - SCORE.drop) / (1 - SCORE.drop) : 0;
			let moodT, moodK;
			if (p01 < SCORE.rise) { moodT = 0.7; moodK = 2.5; }
			else if (p01 < SCORE.build) { moodT = 1.3; moodK = 2.0; }
			else if (p01 < SCORE.hang) { moodT = 0.4 + 1.5 * Math.pow(score.energy, 1.6); moodK = 1.8; }
			else if (p01 < SCORE.drop) { moodT = 0.04; moodK = 5.0; } // the sigh: fast, deep cut
			else { moodT = 0.4 + 2.8 * f01 * f01; moodK = 6.0; }     // freefall: g compounds
			score.mood += (moodT - score.mood) * (1 - Math.exp(-moodK * dt));
			// throb and flicker multiply AFTER the smoothing — the one-pole
			// would lowpass them away if they went through the target. The
			// flicker is stepped hash noise at ~13Hz: the reactor's gravity
			// stuttering under strain, not a clean oscillation.
			const flicker = strain * 0.3 * (prand(Math.floor(t * 13)) - 0.5) * 2;
			wells[0].mood = wells[1].mood = score.mood * (1 + throb + flicker)
				* (score.glitching ? 18 : 1);
			// the drifter breathes at half tempo underneath, untouched by the throw
			wells[2].mood = 0.85 + 0.4 * Math.sin(Math.PI * t / SCORE.phrase);
			// the light breathes with the score — a ±5% exposure swell riding
			// the smoothed mood: brightens into the crest, dims in the sigh.
			// Centred so the tuned 1.05 look is preserved on phrase average.
			if (window.__grade) {
				window.__grade.exposure.value =
					0.99 + 0.11 * Math.min(1, score.mood / 1.7)
					+ (score.glitching ? 0.22 : 0); // the light jolts too
			}
			// flubber stage targets (applied each frame at rate k)
			if (p01 < SCORE.rise) {
				// scatter: no lattice — loose debris on the floor
				score.flub = { noise: 1.0, coh: 0.12, damp: 1.0, cap: 4.0, lat: 0, k: 2.2 };
			} else if (p01 < SCORE.build) {
				// the two bodies FORM on the way up
				score.flub = { noise: 0.35, coh: 0.5, damp: 0.5, cap: 3.6, lat: 1.2, k: 2.0 };
			} else if (p01 < SCORE.hang) {
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
			} else if (p01 < SCORE.drop) {
				// the settle, two ways. Either INTEGRATED — cohesion near max
				// gathers everything into one held glob — or CAST WIDE —
				// cohesion cut, the flung mass just hangs where it landed.
				// Both under a LOW cap: that's what holds the stillness.
				// cast wide: the lattice DISSOLVES with everything else.
				// Integrated: grip stays — one intercalated crystal, held.
				score.flub = score.hangMode === 1
					? { noise: 0.10, coh: 0.06, damp: 1.2, cap: 0.8, lat: 0, k: 3.0 }
					: { noise: 0.06, coh: 0.95, damp: 1.6, cap: 0.9, lat: 4.0, k: 3.0 };
			} else {
				// freefall: the cap releases and RAMPS through the fall
				score.flub = { noise: 0.1, coh: 0.9, damp: 0.25, cap: 3.4 + 1.6 * f01, lat: 1.5, k: 5.0 };
			}
			// pairwise soft separation — O(n²)/2 ≈ 8k pairs, cheap at this n.
			// Strength (R²/d² − 1): zero at the support edge, ramps smoothly
			// as bodies approach, so nothing ever switches on with a pop.
			for (let i = 0; i < bodies.length; i++) {
				const a = bodies[i];
				for (let j = i + 1; j < bodies.length; j++) {
					const b = bodies[j];
					tmp.subVectors(a.p, b.p);
					const R = (a.r + b.r) * 2.2, d2 = tmp.lengthSq();
					if (d2 > R * R || d2 < 1e-8) continue;
					const f = Math.min(SEP_K * (R * R / d2 - 1), SEP_F_MAX) * dt;
					tmp.normalize();
					a.v.addScaledVector(tmp, f);
					b.v.addScaledVector(tmp, -f);
				}
			}
			for (const b of bodies) {
				for (const w of wells) {
					tmp.subVectors(w.p, b.p); // toAttractor (NOT normalized —
					// the spin cross-product wants the full vector, as in
					// the three.js example)
					const d2 = tmp.lengthSq() + SOFT2;
					const g = GRAV * w.gm * w.mood * b.pull / d2;
					// gravity: g along the unit direction
					b.v.addScaledVector(tmp, g / Math.sqrt(d2) * dt);
					// spin: (axis · g · SPIN) × toAttractor — tangential,
					// magnitude ∝ g·d, peaks just outside the softening core
					tmp2.crossVectors(w.axis, tmp);
					b.v.addScaledVector(tmp2, g * SPIN * w.sm * dt);
				}
				// slow desynced wander so the cloud never goes crystalline
				b.v.x += Math.sin(b.wf * t + b.ph[0]) * WANDER * dt;
				b.v.y += Math.sin(b.wf * 1.13 * t + b.ph[1]) * WANDER * dt;
				b.v.z += Math.sin(b.wf * 0.87 * t + b.ph[2]) * WANDER * dt * 0.6;
				b.v.multiplyScalar(Math.exp(-DRAG * dt));
				// frustum walls at the body's own depth — the attractor does
				// the real herding, these only stop strays leaving the frame
				const halfH = Math.tan((camera.fov / 2) * Math.PI / 180) * (camera.position.z - b.p.z);
				softWall(b, 0, halfH * camera.aspect, dt);
				softWall(b, 1, halfH, dt);
				softWall(b, 2, Z_RANGE, dt);
				// governor: excess speed (e.g. after a scatter) decays smoothly
				const sp = b.v.length();
				if (sp > SPEED_MAX) b.v.multiplyScalar(Math.exp(-2.5 * dt * (sp / SPEED_MAX - 1)));
				b.v.clampLength(0, SPEED_CAP);
				b.w.clampLength(0, 2.5);
				b.p.addScaledVector(b.v, dt);
				dq.set(b.w.x * dt / 2, b.w.y * dt / 2, b.w.z * dt / 2, 1);
				b.q.premultiply(dq).normalize();
			}
		};
	
		const mat4 = new Matrix4(), scl = new Vector3();
		const syncInstances = () => {
			for (const b of bodies) {
				if (!b.mesh) continue; // blob sources render via marching cubes
				scl.setScalar(b.s);
				mat4.compose(b.p, b.q, scl);
				b.mesh.setMatrixAt(b.idx, mat4);
			}
			for (const m of meshes) m.instanceMatrix.needsUpdate = true;
		};
	
		// click/tap: a radial shockwave along the pointer ray scatters the
		// swarm; the attractor gathers it back up
		const raycaster = new Raycaster(), pointer = new Vector2();
		addEventListener('pointerdown', (ev) => {
			if (INSPECT || ev.target.closest('a, .patch')) return;
			pointer.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
			raycaster.setFromCamera(pointer, camera);
			const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
			const BURST_R = 1.8, BURST = 3.0;
			for (const b of bodies) {
				tmp.subVectors(b.p, ro);
				tmp2.copy(ro).addScaledVector(rd, tmp.dot(rd)); // closest point on ray
				tmp.subVectors(b.p, tmp2);
				const d = tmp.length();
				if (d > BURST_R) continue;
				const f = BURST * (1 - d / BURST_R);
				if (d > 1e-4) b.v.addScaledVector(tmp.divideScalar(d), f);
				b.w.x += (Math.random() - 0.5) * 2 * f;
				b.w.y += (Math.random() - 0.5) * 2 * f;
				b.w.z += (Math.random() - 0.5) * 2 * f;
			}
			// GPU field shockwave: kick particles out from where the ray
			// crosses the blob's depth plane, under the cursor
			if (flubberBurst) {
				const tz = Math.abs(rd.z) > 1e-3 ? (flubber.center.z - ro.z) / rd.z : 6;
				const bp = ro.clone().addScaledVector(rd, Math.max(0.5, tz));
				flubberBurst.trigger(bp, 1.8, 22);
			}
		});
	
		let last = 0;
		const sim = { t: 0 }; // accumulated *stepped* time — test hook
		const SUBSTEP = 1 / 60; // fixed-ish step: stable forces, bounded n² cost
		const frame = (t) => {
			const fdt = Math.min(t - last, 1 / 20); // clamp: tab refocus, hitches
			let dt = fdt;
			last = t;
			sim.t += dt;
			// drift the default camera before stepping: downstream physics
			// (frustum walls), the flubber field and the render all see one
			// consistent camera pose this frame. Inspect mode and reduced
			// motion keep their fixed poses.
			if (!INSPECT && !reduced) applyDriftCamera(t);
			while (dt > 0) { const h = Math.min(dt, SUBSTEP); step(h, t - dt + h); dt -= h; }
			syncInstances();
			// GPU metaball field: push the freshly-stepped wells to the sim,
			// point refraction at last frame's presented buffer, run the two
			// compute passes — all BEFORE the scene render marches the density.
			if (flubber) {
				// follow the score's stage targets: surface noise, cohesion,
				// damping and the speed cap all breathe with the phrase
				const g = score.flub, relax = 1 - Math.exp(-g.k * fdt);
				flubNoise.uniforms.uAmt.value += (g.noise - flubNoise.uniforms.uAmt.value) * relax;
				flubCohesion.uniforms.uStr.value += (g.coh - flubCohesion.uniforms.uStr.value) * relax;
				flubber.u.uDamp.value += (g.damp - flubber.u.uDamp.value) * relax;
				flubber.u.uSpeedCap.value += (g.cap - flubber.u.uSpeedCap.value) * relax;
				flubLattice.uniforms.uStr.value += (g.lat - flubLattice.uniforms.uStr.value) * relax;
				// outer-world glitch pierces the governor INSTANTLY — the
				// followed value keeps evolving underneath, so when the
				// glitch ends the cap snaps straight back. No easing either way.
				if (score.glitching) flubber.u.uSpeedCap.value = 9.0;
				// wellDriver.update() pushes the freshly-stepped wells into the sim
				flubber.setSceneTexture(ping.read.texture);
				flubber.update(fdt, t);
			}
			synth.update(t);
			blitDisplays();
			// scene → write (mirror faces sample read), present write, swap
			mirrorTex.value = ping.read.texture;
			synth.renderer.setRenderTarget(ping.write);
			synth.renderer.render(scene, camera);
			presentTex.value = ping.write.texture;
			synth.renderer.setRenderTarget(null);
			presentQuad.render(synth.renderer);
			const r = ping.read; ping.read = ping.write; ping.write = r;
		};
		window.__body = bodies[0]; window.__bodies = bodies;
		window.__wells = wells; window.__sim = sim;
		window.__score = { SCORE, sep, drive, state: score };
		window.__camera = camera; window.__inspect = inspectState; // test hooks
	
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
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
