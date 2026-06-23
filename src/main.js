import { HydraTSL } from './hydra-tsl.js';
import { RaymarchedMetaballs } from '@oneilltom/lib3/metaballs';
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
		const { osc, noise, voronoi, src, o0, o1, o2, o3 } = synth.api;
	
		// ---- background patches (o0) — muted, text-friendly ----------------
		const backgrounds = {
			ink: () =>
				noise(1.7, 0.06)
					.modulate(src(o0).scale(1.012).rotate(0.004), 0.24)
					.modulate(osc(3, 0.03, 0.2).rotate(0.35), 0.04)
					.color(0.31, 0.36, 0.48)
					.contrast(1.28)
					.brightness(-0.09)
					.out(o0),
			silk: () =>
				osc(4, 0.04, 0.8)
					.modulate(noise(2.2, 0.06), 0.35)
					.modulate(src(o0).scale(1.01).rotate(0.008), 0.16)
					.color(0.44, 0.37, 0.58)
					.saturate(0.65)
					.contrast(1.32)
					.brightness(-0.06)
					.out(o0),
			melt: () =>
				osc(8, 0.05, 0.9)
					.rotate(0.4)
					.modulate(noise(3.8, 0.07), 0.18)
					.modulate(src(o0).scale(1.025).rotate(-0.006), 0.06)
					.color(0.58, 0.5, 0.66)
					.saturate(0.58)
					.contrast(1.42)
					.brightness(-0.23)
					.out(o0),
			signal: () =>
				osc(6.5, 0.07, 0.25)
					.kaleid(5)
					.modulate(noise(4.5, 0.08), 0.26)
					.modulate(src(o0).scale(1.045).rotate(0.015), 0.14)
					.color(0.62, 0.48, 0.74)
					.saturate(0.64)
					.contrast(1.36)
					.brightness(-0.14)
					.out(o0),
			// new transforms on show: voronoi cells, hue-cycled via colorama
			cells: () =>
				voronoi(6, 0.28, 0.2)
					.modulate(src(o0).scale(1.014).rotate(0.005), 0.16)
					.modulate(noise(2.4, 0.05), 0.04)
					.colorama(0.018)
					.color(0.46, 0.4, 0.6)
					.saturate(0.7)
					.contrast(1.22)
					.brightness(-0.12)
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
		const presentMat = new MeshBasicNodeMaterial();
		const presentTex = texture(ping.read.texture, screenUV);
		presentMat.colorNode = presentTex;
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
	
		// ---- globules: raymarched metaballs fed by invisible bodies --------
		// @oneilltom/lib3 RaymarchedMetaballs — same smooth-min SDF approach
		// as the former inline shader, now a maintained module. Disable with
		// ?globs=0.
		const GLOBS = params.get('globs') !== '0';
		let updateGlobules = () => {};
		let blobs = [];
		if (GLOBS) {
		// blob bodies ride the same gravity-well physics but render as
		// nothing — they are the SDF sources. Small separation radius lets
		// them huddle so globules merge, stretch and split as the wells
		// trade them.
		const NBLOB = SWARM ? 12 : 22;
		for (let i = 0; i < NBLOB; i++) {
			// skewed size distribution: a crowd of droplets, a few heavies
			const rr = 0.1 + Math.pow(Math.random(), 1.7) * 0.48;
			bodies.push({
				mesh: null, idx: 0, s: 1, r: Math.max(0.08, rr * 0.55), rr,
				p: new Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2.5,
					(Math.random() - 0.5) * 2),
				v: new Vector3(Math.random() - 0.5, Math.random() - 0.5,
					Math.random() - 0.5).multiplyScalar(0.05),
				q: new Quaternion(), w: new Vector3(),
				pull: 0.9 + Math.random() * 0.4,
				wf: 0.5 + Math.random() * 0.6,
				ph: [Math.random(), Math.random(), Math.random()].map((x) => x * Math.PI * 2),
				blob: true,
			});
		}
		blobs = bodies.filter((b) => b.blob);
		window.__blobs = blobs;
		} // end blob sources
	
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
		// The hard part of "move the camera in 3D" is the infinity of possible
		// paths. Sidestep it: don't pick a path, keep the resting pose that
		// already composes well (straight-on, text calm left, wells right,
		// open front off-screen) and let the camera *breathe* around it on
		// slow incommensurate sines — the same idiom the wells use to roam.
		// Amplitudes are deliberately small: enough that the globules gain
		// real parallax against the chamber walls, not so much that the front
		// opening shows or the text side swings. lookAt(~0) keeps the gaze
		// essentially down -Z (the current framing) with a faint sway.
		const camRest = new Vector3(0, 0, 6);
		const rollAxis = new Vector3(0, 0, 1); // camera local forward/back
		const qRoll = new Quaternion();
		const applyDriftCamera = (t) => {
			camera.position.set(
				camRest.x + 0.50 * Math.sin(t * 0.069) + 0.17 * Math.sin(t * 0.016 + 1.0),
				camRest.y + 0.30 * Math.sin(t * 0.052 + 1.3),
				camRest.z + 0.40 * Math.sin(t * 0.031 + 0.6));
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
	
		if (GLOBS && blobs.length) {
			const metaballs = new RaymarchedMetaballs({
				camera,
				sources: blobs,
				sceneTexture: ping.read.texture,
				rimTexture: displays[1].rt.texture,
				smoothing: 0.3,
				quadZ: 2.4,
				refractionStrength: 0.22,
				fresnelStrength: 0.95,
				fresnelBase: 0.48,
				rimStrength: 0.24,
			});
			scene.add(metaballs.mesh);
			updateGlobules = () => {
				metaballs.setSceneTexture(ping.read.texture);
				metaballs.update();
			};
		}
	
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
		const SOFT2 = 0.3 * 0.3;                  // softening radius² (d² += this)
		const SPIN = 2.4;                         // spin force vs gravity strength
		const SEP_K = 0.7, SEP_F_MAX = 2.5;       // soft mutual repulsion
		const WANDER = 0.1;
		const DRAG = 1.1;                         // per-second exponential — heavy,
		                                          // the spin term feeds energy back
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
		const dq = new Quaternion(), tmp = new Vector3(), tmp2 = new Vector3();
	
		const softWall = (b, axis, limit, dt) => {
			const c = 'xyz'[axis];
			let depth = 0, n = 0; // n: inward wall normal
			if (b.p[c] + b.r > limit) { depth = b.p[c] + b.r - limit; n = -1; }
			else if (b.p[c] - b.r < -limit) { depth = -limit - (b.p[c] - b.r); n = 1; }
			if (depth > 0) b.v[c] += n * (b.v[c] * n < 0 ? K_WALL_IN : K_WALL_OUT) * depth * dt;
		};
	
		const step = (dt, t) => {
			// the wells roam on slow incommensurate sines, biased right of
			// centre — the scrim (and the text) own the left side
			for (let i = 0; i < 3; i++) {
				const w = wells[i];
				w.p.set(
					0.7 + w.ax * Math.sin(0.26 * w.sp * t + w.ph + i * 0.31),
					w.ay * Math.sin(0.21 * w.sp * t + w.ph * 1.7 + 1.1),
					0.5 * Math.sin(0.15 * w.sp * t + w.ph * 2.3));
				// spin axes: mostly screen-facing (visible orbital motion),
				// each precessing differently so the orbit planes disagree
				w.axis.set(
					0.45 * Math.sin(0.06 * t + w.ph),
					0.45 * Math.cos(0.08 * t + w.ph * 1.3),
					i === 1 ? -1 : 1).normalize(); // middle well counter-rotates
				// mood: swing between ~0.45x (dormant) and ~1.55x (raging)
				w.mood = 1 + 0.55 * Math.sin(0.07 * w.sp * t + w.ph * 2.7);
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
		});
	
		let last = 0;
		const sim = { t: 0 }; // accumulated *stepped* time — test hook
		const SUBSTEP = 1 / 60; // fixed-ish step: stable forces, bounded n² cost
		const frame = (t) => {
			let dt = Math.min(t - last, 1 / 20); // clamp: tab refocus, hitches
			last = t;
			sim.t += dt;
			// drift the default camera before stepping: downstream physics
			// (frustum walls), the globule raymarcher and the render all see
			// one consistent camera pose this frame. Inspect mode and reduced
			// motion keep their fixed poses.
			if (!INSPECT && !reduced) applyDriftCamera(t);
			while (dt > 0) { const h = Math.min(dt, SUBSTEP); step(h, t - dt + h); dt -= h; }
			syncInstances();
			updateGlobules();
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
		window.__camera = camera; window.__inspect = inspectState; // test hooks
	
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const setBg = (name) => {
			backgrounds[name]();
			document.querySelectorAll('.patch').forEach(
				(el) => el.classList.toggle('on', el.dataset.p === name));
			if (reduced) { for (let i = 0; i < 45; i++) synth.update(i / 10); frame(4.6); }
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
