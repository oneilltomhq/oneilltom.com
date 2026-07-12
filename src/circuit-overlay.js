// ---- the circuitry overlay: the artwork exposing its own frame circuit ---
// A dim SVG rendering of the sling's live signal graph (src/graph.js),
// drawn WITH the art, not on it: it sits between the canvas and the scrim
// (the scrim's left-heavy gradient dims it over the text column for free)
// and its opacity flares with the band tension — the circuit lights up
// when the sling whips. The two tip nodes are probes pinned to the
// projected screen positions of the actual wells: the math visibly
// tethered to the mass it drives.
//
// The knobs live INSIDE the box of the node they tune (a `knobs` row is
// part of the node, not a satellite): in artist mode (?artist=1 or
// Ctrl+Alt+A) every row scrubs — drag up/down, shift for fine.
//
// Build once (createElementNS + one getBBox pass), then only textContent /
// stroke-opacity / ≤2 transforms per frame — no layout thrash.
import { Vector3 } from 'three/webgpu';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
	const e = document.createElementNS(NS, tag);
	for (const k in attrs) e.setAttribute(k, attrs[k]);
	return e;
};

// the swarm score: the readout panes are not pinned to the viewport —
// they CIRCLE the mass. Each fixed node rides its own slow ellipse around
// the pair's smoothed screen midpoint: one shared direction, staggered
// phases, breathing radii — swarm framing with sentinel energy, never
// static, never settled. Per node: r = orbit radius (fraction of viewport
// height), w = angular rate (rad/s; the close-in panes circle faster,
// Kepler-fashion), ph = phase. Color feeds the edges only — the text is
// one faint white. The text column (x < ~0.42) stays sacred via clamp.
const LAYOUT = {
	anchor: { r: 0.30, w: 0.10, ph: 0.0, color: '#b8b8b4' },
	stir: { r: 0.37, w: 0.085, ph: 1.05, color: '#ffd9fb' },
	stretch: { r: 0.25, w: 0.13, ph: 2.2, color: '#b8b8b4' },
	tension: { r: 0.21, w: 0.16, ph: 3.3, color: '#f2b75c' },
	omega: { r: 0.29, w: 0.115, ph: 4.4, color: '#e4699b' },
	skin: { r: 0.36, w: 0.07, ph: 5.4, color: '#8a8a86' },
	'tip.a': { probe: 0, color: '#5ee8e0' },
	'tip.b': { probe: 1, color: '#5ee8e0' },
};

const STYLE = {
	font: "'Source Code Pro', ui-monospace, Menlo, Consolas, monospace",
	pad: 7,
	baseOpacity: 0.55,
	flareOpacity: 0.30, // added as tension/3 → 1
	edgeBase: 0.42,
	edgeActive: 0.45,
};

// the circling itself: screen ellipse shape + the slow radius breath
const SWARM = {
	ecc: 1.25,     // x stretch of each orbit (screens are wide)
	squish: 0.62,  // y squash — circling reads as a ring seen at an angle
	breathe: 0.15, // ± radius modulation: closing in, drifting off
	focalLag: 1.2, // /s — the swarm frames the mass, it doesn't twitch with it
};

const CSS = `
#circuitry {
	position: fixed; inset: 0; z-index: 1;
	pointer-events: none;
	contain: strict;
	will-change: opacity;
}
#circuitry svg { width: 100%; height: 100%; display: block; }
/* one faint white voice for every readout — no chrome; a thin dark halo
   (paint-order stroke) keeps the glyphs legible over the bright synth
   without giving the panes a background */
#circuitry text {
	font-family: ${STYLE.font}; fill: #dcdce0;
	paint-order: stroke; stroke: rgba(6,6,9,0.55);
	stroke-width: 2px; stroke-linejoin: round;
}
#circuitry .lbl { font-size: 10.5px; letter-spacing: 0.04em; }
#circuitry .val { font-size: 10px; opacity: 0.85; }
#circuitry .cap { font-size: 8px; opacity: 0.55; }
#circuitry .knobrow { font-size: 9.5px; opacity: 0.75; }
#circuitry .knobrow tspan.kv { fill: #f2f2f5; }
#circuitry .box { fill: none; stroke: none; rx: 4; }
#circuitry .edge { stroke: var(--c, #b8b8b4); fill: none; stroke-width: 1.2; }
/* ---- artist mode: the résumé steps back, the rows scrub ---- */
body.artist { user-select: none; }
body.artist main { opacity: 0.18; transition: opacity 0.15s ease; }
body.artist main:hover { opacity: 0.8; }
body.artist #scrim { opacity: 0.35; }
/* tuning wants targets: the boxes come back, faintly, in artist mode only */
body.artist #circuitry .box { fill: rgba(10,10,12,0.5); stroke: rgba(220,220,224,0.28); stroke-width: 1; }
body.artist #circuitry .knobrow { opacity: 1; pointer-events: all; cursor: ns-resize; }
body.artist #circuitry .knobrow:hover, #circuitry .knobrow.live { fill: #ffd9fb; }
`;

const fmtNum = (v) => (v >= 0 ? ' ' : '') + v.toFixed(2);

export function createCircuitOverlay({ graph, rack, artist = false }) {
	const wrap = document.createElement('div');
	wrap.id = 'circuitry';
	wrap.setAttribute('aria-hidden', 'true');
	const style = document.createElement('style');
	style.textContent = CSS;
	wrap.appendChild(style);
	const svg = el('svg');
	wrap.appendChild(svg);
	const edgeLayer = el('g');
	const nodeLayer = el('g');
	svg.appendChild(edgeLayer);
	svg.appendChild(nodeLayer);
	// insert under the scrim: canvas < circuitry < scrim < text
	const scrim = document.getElementById('scrim');
	scrim.parentNode.insertBefore(wrap, scrim);

	let W = innerWidth, H = innerHeight;
	const rackMeta = new Map((rack?.params() ?? []).map((p) => [p.path, p]));
	const boxes = new Map(); // id → box record
	const edges = [];        // { from, to, line }

	// -- build --------------------------------------------------------------
	for (const n of graph.nodes()) {
		const lay = LAYOUT[n.id];
		if (!lay) continue;
		const g = el('g', { class: 'node' });
		g.style.setProperty('--c', lay.color);
		const rect = el('rect', { class: 'box' });
		g.appendChild(rect);
		const lbl = el('text', { class: 'lbl', x: 0, y: 0 });
		lbl.textContent = n.label;
		const val = el('text', { class: 'val', x: 0, y: 13 });
		g.appendChild(lbl);
		g.appendChild(val);
		let rowY = 13;
		if (n.caption && lay.probe === undefined) {
			// wrap the plain-words caption to short lines — boxes stay narrow
			const lines = [];
			let line = '';
			for (const w of n.caption.split(' ')) {
				if (line && (line + ' ' + w).length > 26) { lines.push(line); line = w; }
				else line = line ? `${line} ${w}` : w;
			}
			if (line) lines.push(line);
			for (const s of lines.slice(0, 3)) {
				rowY += 10;
				const cap = el('text', { class: 'cap', x: 0, y: rowY });
				cap.textContent = s;
				g.appendChild(cap);
			}
			rowY += 2;
		}
		// the knobs of this node, folded into its box — every one scrubs
		const knobEls = [];
		for (const path of n.knobs ?? []) {
			rowY += 12;
			const row = el('text', { class: 'knobrow', x: 0, y: rowY });
			row.dataset.path = path;
			const name = document.createElementNS(NS, 'tspan');
			name.textContent = path.split('/').pop() + ' ';
			const kv = el('tspan', { class: 'kv' });
			row.appendChild(name);
			row.appendChild(kv);
			g.appendChild(row);
			knobEls.push({ path, kv, last: '' });
		}
		nodeLayer.appendChild(g);
		const bb = g.getBBox(); // one measure pass, then never again
		const b = {
			node: graph.get(n.id), lay, g, rect, valEl: val, lastVal: '',
			knobEls, probe: lay.probe,
			w: Math.max(bb.width, 46) + STYLE.pad * 2,
			h: rowY + 10 + STYLE.pad * 2,
			cx: 0, cy: 0, sx: null, sy: null,
		};
		rect.setAttribute('x', -STYLE.pad);
		rect.setAttribute('y', -10.5 - STYLE.pad + 2);
		rect.setAttribute('width', b.w);
		rect.setAttribute('height', b.h);
		boxes.set(n.id, b);
	}
	for (const [, b] of boxes) {
		for (const inp of b.node.inputs ?? []) {
			const from = boxes.get(inp.from);
			if (!from) continue;
			const line = el('line', { class: 'edge', 'stroke-opacity': STYLE.edgeBase });
			line.style.setProperty('--c', from.lay.color);
			edgeLayer.appendChild(line);
			edges.push({ from, to: b, line, lastQ: -1 });
		}
	}

	// -- geometry -------------------------------------------------------------
	// anchor an edge on the box border along the line between centres
	const anchorPt = (b, dx, dy) => {
		const s = Math.min(
			(b.w / 2) / Math.max(Math.abs(dx), 1e-6),
			(b.h / 2) / Math.max(Math.abs(dy), 1e-6));
		return [b.cx + dx * s, b.cy + dy * s];
	};
	const placeEdge = (e) => {
		const dx = e.to.cx - e.from.cx, dy = e.to.cy - e.from.cy;
		const len = Math.hypot(dx, dy) || 1;
		const [x1, y1] = anchorPt(e.from, dx / len, dy / len);
		const [x2, y2] = anchorPt(e.to, -dx / len, -dy / len);
		e.line.setAttribute('x1', x1); e.line.setAttribute('y1', y1);
		e.line.setAttribute('x2', x2); e.line.setAttribute('y2', y2);
	};
	const placeBox = (b) => {
		// the group's local origin is the label baseline — offset so
		// (cx, cy) is the visual centre of the rect
		const ox = b.cx - b.w / 2 + STYLE.pad;
		const oy = b.cy - b.h / 2 + 10.5 + STYLE.pad - 2;
		b.g.setAttribute('transform', `translate(${ox},${oy})`);
	};
	// where the swarm looks when it hasn't seen the mass yet
	const focal = { x: null, y: null };
	// boids separation: when two panes' rects (plus a margin) overlap in
	// the normalized ellipse metric, push them apart along the offset —
	// mutual between panes, one-sided against the pinned tip probes
	const shove = (p, q, mutual) => {
		const sx = (p.b.w + q.b.w) / 2 + 14, sy = (p.b.h + q.b.h) / 2 + 10;
		const dx = q.x - p.x, dy = q.y - p.y;
		const ox = dx / sx, oy = dy / sy;
		const d2 = ox * ox + oy * oy;
		if (d2 >= 1) return;
		if (d2 < 1e-6) { p.y -= sy * 0.5; return; } // dead-centred: just duck
		const d = Math.sqrt(d2);
		const f = (1 - d) / d * (mutual ? 0.5 : 1);
		p.x -= dx * f; p.y -= dy * f;
		if (mutual) { q.x += dx * f; q.y += dy * f; }
	};
	// the whole swarm, at time t, circling (fx, fy):
	// orbit attractor → separation → clamp → commit
	const pack = [];
	const placeSwarm = (t, fx, fy) => {
		pack.length = 0;
		for (const b of boxes.values()) {
			if (b.probe !== undefined) continue;
			const th = b.lay.ph + b.lay.w * t;
			const br = b.lay.r * H
				* (1 + SWARM.breathe * Math.sin(0.037 * t + b.lay.ph * 2));
			pack.push({
				b,
				x: fx + Math.cos(th) * br * SWARM.ecc,
				y: fy + Math.sin(th) * br * SWARM.squish,
			});
		}
		// clamp INSIDE the relaxation: two panes shoved to the same boundary
		// must separate again along it, or they re-stack at the clamp
		for (let it = 0; it < 3; it++) {
			for (const p of pack) {
				// half-extent-aware: the text column stays sacred even for a
				// wide pane, and nothing slides off the viewport
				p.x = Math.min(Math.max(p.x, 0.445 * W + p.b.w / 2), 0.985 * W - p.b.w / 2);
				p.y = Math.min(Math.max(p.y, 0.03 * H + p.b.h / 2), 0.97 * H - p.b.h / 2);
			}
			for (let i = 0; i < pack.length; i++) {
				for (let j = i + 1; j < pack.length; j++) shove(pack[i], pack[j], true);
				for (const b of boxes.values()) {
					if (b.probe === undefined || b.sx === null) continue;
					shove(pack[i], { b, x: b.cx, y: b.cy }, false);
				}
			}
		}
		let moved = false;
		for (const p of pack) {
			const b = p.b;
			const nx = Math.min(Math.max(p.x, 0.445 * W + b.w / 2), 0.985 * W - b.w / 2);
			const ny = Math.min(Math.max(p.y, 0.03 * H + b.h / 2), 0.97 * H - b.h / 2);
			if (Math.abs(nx - b.cx) + Math.abs(ny - b.cy) > 0.25) {
				b.cx = nx; b.cy = ny;
				placeBox(b);
				moved = true;
			}
		}
		return moved;
	};
	const layoutAll = () => {
		W = innerWidth; H = innerHeight;
		placeSwarm(0, focal.x ?? 0.62 * W, focal.y ?? 0.46 * H);
		for (const e of edges) placeEdge(e);
	};
	layoutAll();
	addEventListener('resize', layoutAll);

	// -- artist mode: every knob row scrubs -----------------------------------
	let artistOn = false;
	const drag = { path: null, row: null, y0: 0, v0: 0, raf: 0, next: null };
	svg.addEventListener('pointerdown', (ev) => {
		const row = ev.target.closest?.('.knobrow');
		if (!artistOn || !row) return;
		ev.stopPropagation();
		ev.preventDefault();
		drag.path = row.dataset.path;
		drag.row = row;
		drag.y0 = ev.clientY;
		drag.v0 = rack.get(drag.path);
		row.classList.add('live');
		row.setPointerCapture?.(ev.pointerId);
	});
	svg.addEventListener('pointermove', (ev) => {
		if (!drag.path) return;
		const m = rackMeta.get(drag.path) ?? {};
		const span = (m.max ?? 1) - (m.min ?? 0);
		const fine = ev.shiftKey ? 0.1 : 1;
		drag.next = drag.v0 - (ev.clientY - drag.y0) / 150 * span * fine;
		if (!drag.raf) {
			drag.raf = requestAnimationFrame(() => {
				drag.raf = 0;
				if (drag.next !== null) rack.set(drag.path, drag.next, 0, 'human');
			});
		}
	});
	svg.addEventListener('pointerup', () => {
		drag.row?.classList.remove('live');
		drag.path = null; drag.row = null; drag.next = null;
	});
	const setArtist = (on) => {
		artistOn = on;
		document.body.classList.toggle('artist', on);
	};
	addEventListener('keydown', (ev) => {
		if (ev.ctrlKey && ev.altKey && ev.code === 'KeyA') setArtist(!artistOn);
	});
	if (artist && rack) setArtist(true);

	// -- live updates ----------------------------------------------------------
	const probeV = new Vector3();
	const tensionNode = graph.get('tension');
	let lastTick = 0, lastOpacity = -1, lastT = 0;

	const fmt = (n) => {
		const v = n.value;
		if (n.fmt) return n.fmt(v);
		if (typeof v === 'number') return fmtNum(v) + (n.unit ? ` ${n.unit}` : '');
		return String(v);
	};
	const activity = (n) => {
		const v = n.value;
		if (typeof v !== 'number') return 0;
		const span = Math.max(Math.abs(n.min ?? 0), Math.abs(n.max ?? 1)) || 1;
		return Math.min(1, Math.abs(v) / span);
	};

	const tick = (t, view) => {
		const dt = Math.min(t - lastT, 0.1); lastT = t;
		// the circuit flares when the band tension does (one style write)
		let op = STYLE.baseOpacity
			+ STYLE.flareOpacity * Math.min(1, tensionNode.value / 3);
		if (artistOn) op = 0.92; // tuning wants a steady lamp
		if (Math.abs(op - lastOpacity) > 0.01) {
			wrap.style.opacity = op.toFixed(2);
			lastOpacity = op;
		}
		let moved = false;
		if (view?.camera && view?.wells) {
			// raw screen projections of the two tips: they pin the probes AND
			// their midpoint is the focal the whole swarm circles
			const raw = [];
			for (let i = 0; i < 2; i++) {
				probeV.copy(view.wells[i].p).project(view.camera);
				raw.push([(probeV.x + 1) / 2 * W, (1 - probeV.y) / 2 * H]);
			}
			const fx = (raw[0][0] + raw[1][0]) / 2;
			const fy = (raw[0][1] + raw[1][1]) / 2;
			const kf = 1 - Math.exp(-SWARM.focalLag * dt);
			focal.x = focal.x === null ? fx : focal.x + (fx - focal.x) * kf;
			focal.y = focal.y === null ? fy : focal.y + (fy - focal.y) * kf;
			// the tip probes first (smoothed, clamped) — the swarm yields to
			// them, so they must sit where they'll be this frame
			for (const b of boxes.values()) {
				if (b.probe === undefined) continue;
				let [sx, sy] = raw[b.probe];
				sx = Math.min(Math.max(sx, 0.44 * W), 0.96 * W);
				sy = Math.min(Math.max(sy, 0.05 * H), 0.94 * H);
				const k = 1 - Math.exp(-8 * dt);
				b.sx = b.sx === null ? sx : b.sx + (sx - b.sx) * k;
				b.sy = b.sy === null ? sy : b.sy + (sy - b.sy) * k;
				if (Math.abs(b.sx - b.cx) + Math.abs(b.sy - b.cy) > 0.5) {
					b.cx = b.sx; b.cy = b.sy;
					placeBox(b);
					moved = true;
				}
			}
			// then the pack circles the mass
			if (placeSwarm(t, focal.x, focal.y)) moved = true;
		}
		if (moved) for (const e of edges) placeEdge(e);
		// the 10Hz pass: values, knob rows, edge activity
		if (t - lastTick < 0.1) return;
		lastTick = t;
		for (const b of boxes.values()) {
			const s = fmt(b.node);
			if (s !== b.lastVal) { b.valEl.textContent = s; b.lastVal = s; }
			for (const k of b.knobEls) {
				const kv = (+rack.get(k.path)).toFixed(2);
				if (kv !== k.last) { k.kv.textContent = kv; k.last = kv; }
			}
		}
		for (const e of edges) {
			const q = Math.round(activity(e.from.node) * 16) / 16;
			if (q !== e.lastQ) {
				e.line.setAttribute('stroke-opacity',
					(STYLE.edgeBase + STYLE.edgeActive * q).toFixed(3));
				e.lastQ = q;
			}
		}
	};

	const destroy = () => {
		removeEventListener('resize', layoutAll);
		wrap.remove();
	};

	return { tick, setArtist, destroy, element: wrap };
}
