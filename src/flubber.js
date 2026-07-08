// FlubberField — the metaball surface, route B: no spheres, the shape is
// EMERGENT. Ported from lib3's flubber-compute example, but the motion driver
// is this site's own gravity wells (not the example's musical noise-advection),
// so the field keeps the reactive, roaming character of the old CPU metaballs
// while gaining the GPU storage substrate and the fixed refraction.
//
// Three GPU passes per frame:
//   sim    (compute, per particle) — N particles live in storage buffers,
//          pulled+swirled by the same roaming wells the rest of the scene uses,
//          plus a little noise for surface life and a click shockwave. State
//          persists in the buffers frame to frame.
//   splat  (compute, per voxel)    — each GRID³ voxel sums a compact-support
//          kernel over all particles into a Storage3DTexture. Density, not
//          geometry — the mass can tear apart and re-merge, which a smooth-min
//          of spheres never does.
//   march  (fragment)              — fixed-step march through the density box,
//          isosurface where density crosses uIso, gradient normal, then the
//          same glass read as the old RaymarchedMetaballs: refract the scene
//          behind (aspect-correct, so equal normals shift equal PIXELS not UV),
//          fresnel, rim.

import {
	Storage3DTexture, LinearFilter, HalfFloatType, BoxGeometry, Mesh,
	MeshBasicNodeMaterial, BackSide, Vector3,
} from 'three/webgpu';
import {
	Break, cameraPosition, clamp, Discard, float, Fn, hash, If, instancedArray,
	instanceIndex, Loop, mx_noise_vec3, normalize, positionWorld, screenSize,
	screenUV, smoothstep, texture, texture3D, textureStore, uniform, vec2, vec3, vec4,
} from 'three/tsl';

// force constants — carried over from the site's CPU well physics so the feel
// matches. Gravity/spin scale per-well come in as uniforms (mood-modulated).
const GRAV = 2.6;          // G·M base, per-well gm·mood folds into uWellG
const SOFT2 = 0.24 * 0.24; // softening radius² — no singularity slingshots
const SPIN = 1.4;          // spin force vs gravity — spiral arms, not circles

export class FlubberField {
	/**
	 * @param {Object} o
	 * @param {THREE.WebGPURenderer} o.renderer
	 * @param {THREE.PerspectiveCamera} o.camera
	 * @param {Array} o.wells   the same CPU-updated wells the scene physics uses
	 * @param {THREE.Texture} o.sceneTexture  refraction source (scene behind glass)
	 * @param {THREE.Texture} o.rimTexture    additive rim accent
	 * @param {number} [o.count]   particle count
	 * @param {number} [o.grid]    density grid resolution (grid³ voxels)
	 * @param {Vector3} [o.center] density box centre (world)
	 * @param {Vector3} [o.half]   density box half-extents (world)
	 */
	constructor({
		renderer, camera, wells, sceneTexture, rimTexture,
		count = 160,
		grid = 64,
		center = new Vector3(0.75, 0.0, 0.3),
		// box sized snug to the cohesive mass — smaller box = finer voxels.
		// The old coin-stack crust was march-step banding, now killed by the
		// binary-search hit refinement, so 64³ is plenty here.
		half = new Vector3(2.3, 1.6, 1.2),
	}) {
		this.renderer = renderer;
		this.camera = camera;
		this.wells = wells;
		this.count = count;
		this.grid = grid;
		this.center = center.clone();
		this.half = half.clone();

		const N = count;
		const GRID = grid;
		const cx = center.x, cy = center.y, cz = center.z;
		const hx = half.x, hy = half.y, hz = half.z;
		// box AABB + per-axis size / voxel size, baked as literals into the shaders
		const bMin = vec3(cx - hx, cy - hy, cz - hz);
		const bMax = vec3(cx + hx, cy + hy, cz + hz);
		const size = vec3(2 * hx, 2 * hy, 2 * hz);

		// ---- storage substrate ------------------------------------------------
		// particles seeded in a ball near the box centre; per-particle influence
		// radius follows the old skewed distribution — a crowd of droplets, a
		// few heavies — so the density field has the same size variety and the
		// same tear/merge richness.
		const initPos = new Float32Array(N * 3);
		const initRad = new Float32Array(N);
		for (let i = 0; i < N; i++) {
			const r = 0.7 * Math.cbrt(Math.random());
			const a = Math.random() * Math.PI * 2;
			const z = Math.random() * 2 - 1;
			const s = Math.sqrt(1 - z * z);
			initPos[i * 3 + 0] = cx + r * s * Math.cos(a);
			initPos[i * 3 + 1] = cy + r * z;
			initPos[i * 3 + 2] = cz + r * s * Math.sin(a);
			// bigger kernels than a droplet's-eye view wants: neighbouring
			// influence radii must overlap generously or the summed field is
			// lumpy. Skewed so there are still a few heavies among the crowd.
			initRad[i] = 0.22 + Math.pow(Math.random(), 1.4) * 0.42; // 0.22 → 0.64
		}
		const pPos = instancedArray(initPos, 'vec3');
		const pVel = instancedArray(N, 'vec3');
		const pRad = instancedArray(initRad, 'float');
		this.pPos = pPos; // exposed for readback (frame-continuity test)

		// ---- uniforms ---------------------------------------------------------
		const uDt = uniform(0);
		const uT = uniform(0);
		const uFlowFreq = uniform(1.2);
		const uFlowAmt = uniform(0.4);   // noise advection — surface life, gentle
		const uCohesion = uniform(0.45); // spring to box centre — keeps the mass coherent, less spray
		const uDamp = uniform(0.6);      // per-second exponential (was CPU DRAG)
		const uSpeedCap = uniform(3.2);
		// three wells → flat uniforms (only three, unroll in JS)
		const uWellPos = [uniform(new Vector3()), uniform(new Vector3()), uniform(new Vector3())];
		const uWellAxis = [uniform(new Vector3()), uniform(new Vector3()), uniform(new Vector3())];
		const uWellG = [uniform(0), uniform(0), uniform(0)]; // GRAV·gm·mood
		const uWellSpin = [uniform(0), uniform(0), uniform(0)]; // SPIN·sm
		// click shockwave — set on burst, decays in update()
		const uBurstPos = uniform(new Vector3());
		const uBurstStr = uniform(0);
		const uBurstR = uniform(1.8);

		this.u = {
			uDt, uT, uFlowFreq, uFlowAmt, uCohesion, uDamp, uSpeedCap,
			uWellPos, uWellAxis, uWellG, uWellSpin, uBurstPos, uBurstStr, uBurstR,
		};

		// ---- pass 1: particle sim (wells + noise + cohesion + burst) ----------
		this.simCompute = Fn(() => {
			const pos = pPos.element(instanceIndex);
			const vel = pVel.element(instanceIndex);
			const pull = hash(instanceIndex).mul(0.5).add(0.75); // per-particle mass

			// gravity + spin, summed over the three wells (unrolled)
			for (let w = 0; w < 3; w++) {
				const to = uWellPos[w].sub(pos); // toAttractor, NOT normalized (spin wants full vec)
				const d2 = to.dot(to).add(SOFT2);
				const g = uWellG[w].mul(pull).div(d2);
				vel.addAssign(to.mul(g.div(d2.sqrt()).mul(uDt)));            // inverse-square gravity
				vel.addAssign(uWellAxis[w].cross(to).mul(g.mul(uWellSpin[w]).mul(uDt))); // tangential spin
			}

			// noise advection — desynced surface wander so the mass never crystallises
			const flow = mx_noise_vec3(
				pos.mul(uFlowFreq).add(vec3(0, uT.mul(0.25), uT.mul(0.11)))
			).mul(uFlowAmt);
			vel.addAssign(flow.mul(uDt));

			// cohesion: spring back to the box centre, stiffening with distance so
			// noise/scatter can stretch the mass but never fling a particle out
			const rel = pos.sub(bMin.add(size.mul(0.5)));
			const stiffen = rel.dot(rel).mul(0.6).add(1);
			vel.subAssign(rel.mul(uCohesion.mul(stiffen).mul(uDt)));

			// click shockwave: radial kick away from the burst point, falloff to 0
			const bto = pos.sub(uBurstPos);
			const bd = bto.length();
			const bf = uBurstStr.mul(clamp(float(1).sub(bd.div(uBurstR)), 0, 1));
			vel.addAssign(normalize(bto.add(vec3(1e-4))).mul(bf.mul(uDt)));

			vel.mulAssign(clamp(float(1).sub(uDamp.mul(uDt)), 0, 1));
			// soft speed governor
			const sp = vel.length();
			vel.mulAssign(clamp(uSpeedCap.div(sp.max(1e-4)), 0, 1));
			pos.addAssign(vel.mul(uDt));
		})().compute(N);

		// ---- pass 2: splat density + analytic gradient into the 3D texture ----
		// R = density, GBA = world-space density gradient. The default
		// Storage3DTexture type is UnsignedByteType → RGBA8Unorm: density
		// quantized to 1/255 steps and clamped at 1 — the bisection then finds
		// exact crossings of a STAIRCASED field, which is precisely the fine
		// topographic-contour grain on the surface. Half float kills it.
		const volume = new Storage3DTexture(GRID, GRID, GRID);
		volume.type = HalfFloatType; // RGBA16Float — continuous density, no 8-bit contours
		volume.generateMipmaps = false;
		volume.magFilter = LinearFilter;
		volume.minFilter = LinearFilter;
		volume.name = 'flubberDensity';
		this.volume = volume;

		this.splatCompute = Fn(() => {
			const id = instanceIndex;
			const x = id.mod(GRID);
			const y = id.div(GRID).mod(GRID);
			const z = id.div(GRID * GRID);
			// voxel centre → world position inside the box AABB
			const wp = vec3(x, y, z).add(0.5).div(GRID).mul(size).add(bMin);

			const dens = float(0).toVar();
			const grad = vec3(0).toVar(); // analytic ∇density, world units
			Loop(N, ({ i }) => {
				const dp = wp.sub(pPos.element(i));
				const r = pRad.element(i);
				const r2 = r.mul(r);
				const w = clamp(float(1).sub(dp.dot(dp).div(r2)), 0, 1);
				dens.addAssign(w.mul(w).mul(w)); // compact-support cubic falloff
				// ∇(w³) = 3w²·∇w = −6w²·dp/r² — smooth per particle, so the
				// trilinearly interpolated gradient is smooth too (unlike
				// finite differences of the C1-discontinuous density field)
				grad.addAssign(dp.mul(w.mul(w).mul(-6).div(r2)));
			});
			// soft window: density → 0 just inside the box faces so the
			// isosurface never hard-clips against a face (no visible cube edge;
			// satellites that reach the wall dissolve instead of popping)
			const uvw = vec3(x, y, z).add(0.5).div(GRID); // 0..1 across the box
			const m = 0.07;
			const win = (u) => smoothstep(0, m, u).mul(smoothstep(0, m, u.oneMinus()));
			// d/du smoothstep(0,m,u) = 6t(1−t)/m with t = clamp(u/m, 0, 1)
			const sd = (u) => {
				const t = clamp(u.div(m), 0, 1);
				return t.mul(t.oneMinus()).mul(6 / m);
			};
			const winD = (u) => sd(u).mul(smoothstep(0, m, u.oneMinus()))
				.sub(smoothstep(0, m, u).mul(sd(u.oneMinus())));
			const wx = win(uvw.x), wy = win(uvw.y), wz = win(uvw.z);
			const fade = wx.mul(wy).mul(wz);
			// product rule: ∇(dens·fade) = fade·∇dens + dens·∇fade
			// (∇fade in uvw → world via /size)
			const gradFade = vec3(
				winD(uvw.x).mul(wy).mul(wz),
				winD(uvw.y).mul(wx).mul(wz),
				winD(uvw.z).mul(wx).mul(wy),
			).div(size);
			const gradOut = grad.mul(fade).add(gradFade.mul(dens));
			textureStore(volume, vec3(x, y, z), vec4(dens.mul(fade), gradOut));
		})().compute(GRID * GRID * GRID);

		// ---- pass 3: march the isosurface -------------------------------------
		const uIso = uniform(0.8);            // higher iso → tighter shell, less crust
		const uRefract = uniform(0.22);       // site-tuned glass (was RaymarchedMetaballs)
		const uFresnelStrength = uniform(0.95);
		const uFresnelBase = uniform(0.48);
		const uRimStrength = uniform(0.24);
		const MARCH_STEPS = 110;
		Object.assign(this.u, { uIso, uRefract, uFresnelStrength, uFresnelBase, uRimStrength });

		const densityTex = texture3D(volume, null, 0);
		this._sceneTex = texture(sceneTexture);
		this._rimTex = texture(rimTexture);
		const sceneTex = this._sceneTex;
		const rimTex = this._rimTex;
		// world point → density UVW inside the box. R = density, GBA = ∇density
		const fieldAt = (p) => densityTex.sample(p.sub(bMin).div(size));
		const densityAt = (p) => fieldAt(p).r;

		const mat = new MeshBasicNodeMaterial();
		mat.transparent = true;
		mat.depthWrite = false;
		mat.side = BackSide; // back faces: rays exist even when the camera is inside the box

		mat.colorNode = Fn(() => {
			const ro = cameraPosition;
			const rd = normalize(positionWorld.sub(cameraPosition));

			// slab intersection with the density box AABB
			const inv = vec3(1).div(rd);
			const tA = bMin.sub(ro).mul(inv);
			const tB = bMax.sub(ro).mul(inv);
			const tLo = tA.min(tB);
			const tHi = tA.max(tB);
			const tNear = tLo.x.max(tLo.y).max(tLo.z).max(0);
			const tFar = tHi.x.min(tHi.y).min(tHi.z);
			If(tFar.lessThanEqual(tNear), () => Discard());

			const stepLen = tFar.sub(tNear).div(MARCH_STEPS);
			const t = tNear.toVar();
			const tHit = float(-1).toVar();

			Loop(MARCH_STEPS, () => {
				const d = densityAt(ro.add(rd.mul(t)));
				If(d.greaterThanEqual(uIso), () => {
					// crossing bracketed in [t-stepLen, t]; binary-search the
					// isosurface instead of a single lerp — the linear guess
					// leaves step-height contour banding on grazing surfaces,
					// bisection converges sub-step and the grooves vanish
					const lo = t.sub(stepLen).toVar();
					const hi = t.toVar();
					Loop(4, () => {
						const mid = lo.add(hi).mul(0.5);
						If(densityAt(ro.add(rd.mul(mid))).greaterThanEqual(uIso),
							() => { hi.assign(mid); }).Else(() => { lo.assign(mid); });
					});
					tHit.assign(lo.add(hi).mul(0.5));
					Break();
				});
				t.addAssign(stepLen);
			});
			If(tHit.lessThan(0), () => Discard());

			const p = ro.add(rd.mul(tHit));
			// normal from the splatted analytic gradient (GBA channels) — one
			// sample, and the interpolated field is a blend of per-particle
			// smooth gradients, so no finite-difference quantization and no
			// trilinear-facet banding. Gradient points into the mass; the
			// outward normal is its negation.
			const n = normalize(fieldAt(p).gba.negate());

			// same glass read as the old RaymarchedMetaballs
			const fres = rd.dot(n).abs().oneMinus().pow(2);
			// aspect-correct offset: equal normals shift equal PIXELS, not UV
			const refractOffset = n.xy
				.mul(vec2(screenSize.y.div(screenSize.x), 1))
				.mul(uRefract.negate());
			const refracted = sceneTex.sample(screenUV.add(refractOffset));
			const rim = rimTex.sample(screenUV).mul(fres.mul(uRimStrength));
			return refracted.mul(fres.mul(uFresnelStrength).add(uFresnelBase)).add(rim);
		})();

		this.material = mat;
		this.mesh = new Mesh(new BoxGeometry(2 * hx, 2 * hy, 2 * hz), mat);
		this.mesh.position.set(cx, cy, cz);
		this.mesh.frustumCulled = false;
	}

	setSceneTexture(tex) { this._sceneTex.value = tex; }
	setRimTexture(tex) { this._rimTex.value = tex; }

	// copy the CPU-updated wells into the sim uniforms. gm·mood folds into the
	// gravity scale, sm into the spin scale — matching the old per-body force.
	uploadWells() {
		const { uWellPos, uWellAxis, uWellG, uWellSpin } = this.u;
		for (let i = 0; i < 3; i++) {
			const w = this.wells[i];
			uWellPos[i].value.copy(w.p);
			uWellAxis[i].value.copy(w.axis);
			uWellG[i].value = GRAV * w.gm * (w.mood ?? 1);
			uWellSpin[i].value = SPIN * w.sm;
		}
	}

	// click/tap shockwave — a decaying radial kick from a world point
	burst(worldPos, radius = 1.8, strength = 22) {
		this.u.uBurstPos.value.copy(worldPos);
		this.u.uBurstR.value = radius;
		this.u.uBurstStr.value = strength;
	}

	// advance one frame: decay the burst, run the two compute passes. Must be
	// called BEFORE the scene render (the march samples the density texture).
	update(dt, t) {
		this.u.uDt.value = dt;
		this.u.uT.value = t;
		this.u.uBurstStr.value *= Math.exp(-7 * dt);
		this.renderer.compute(this.simCompute);
		this.renderer.compute(this.splatCompute);
	}
}
