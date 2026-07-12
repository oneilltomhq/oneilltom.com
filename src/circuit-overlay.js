// ---- the circuitry overlay: the artwork exposing its own frame circuit ---
// Renders ONE level of the machine graph (src/machine.js) at a time: the
// seven-organ top level by default, and any container's interior on click
// (the ◂ crumb or Escape goes back up). Drawn WITH the art, not on it —
// between the canvas and the scrim — and its opacity flares with the
// sling's band tension.
//
// Coherence law learned the hard way: a diagram is legible through STABLE
// RELATIVE POSITIONS. So each level is a fixed authored formation, and all
// the motion is spent where meaning is: the whole formation drifts as one
// organism (tethered to the mass's projected midpoint), probe nodes ride
// the projection itself, values animate, and every edge carries a slow
// directed dash flow — the signal visibly runs from cause to effect.
//
// Knobs stay folded INTO the box of the node they tune; in artist mode
// (?artist=1 or Ctrl+Alt+A) every row scrubs — drag, shift for fine.
import { Vector3 } from 'three/webgpu';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
	const e = document.createElementNS(NS, tag);
	for (const k in attrs) e.setAttribute(k, attrs[k]);
	return e;
};

const STYLE = {
	font: "'Source Code Pro', ui-monospace, Menlo, Consolas, monospace",
	pad: 7,
	baseOpacity: 0.55,
	flareOpacity: 0.30, // added as tension/3 → 1
	edgeBase: 0.42,
	edgeActive: 0.45,
};

// the one-organism drift: how far the formation strays from its authored
// pose, and how hard it leans toward the mass's projected midpoint
const PLATE = {
	chase: 0.10,  // fraction of the focal's offset the plate follows
	swayX: 16, swayY: 12, // px of slow lissajous wander
	focalLag: 1.2, // /s — frames the mass, doesn't twitch with it
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
   (paint-order stroke) keeps the glyphs legible over the bright synth */
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
/* containers open on click — they get a hit target even for plain viewers */
#circuitry .hub .box { pointer-events: all; cursor: pointer; }
#circuitry .crumb { font-size: 10.5px; opacity: 0.7; pointer-events: all; cursor: pointer; }
#circuitry .crumb:hover { opacity: 1; }
/* the signal visibly flows from cause to effect — the dash offset is
   stepped from the 10Hz pass (a CSS animation here would invalidate every
   edge every frame and the whole overlay gets expensive) */
#circuitry .edge {
	stroke: var(--c, #b8b8b4); fill: none; stroke-width: 1.2;
	stroke-dasharray: 1 11; stroke-linecap: round;
}
@media (prefers-reduced-motion: reduce) {
	#circuitry .edge { stroke-dasharray: none; }
}
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

export function createCircuitOverlay({ machine, rack, artist = false }) {
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
	const chromeLayer = el('g'); // the ◂ crumb
	svg.appendChild(edgeLayer);
	svg.appendChild(nodeLayer);
	svg.appendChild(chromeLayer);
	// insert under the scrim: canvas < circuitry < scrim < text
	const scrim = document.getElementById('scrim');
	scrim.parentNode.insertBefore(wrap, scrim);

	let W = innerWidth, H = innerHeight;
	const rackMeta = new Map((rack?.params() ?? []).map((p) => [p.path, p]));
	let boxes = new Map(); // id → box record (rebuilt per level)
	let edges = [];        // { from, to, line } (rebuilt per level)
	let levelId = machine.top;
	const focal = { x: null, y: null }; // smoothed projected mass midpoint

	// -- build one level ------------------------------------------------------
	const crumb = el('text', { class: 'crumb', x: 0, y: 0 });
	chromeLayer.appendChild(crumb);
	const build = (id) => {
		levelId = id;
		const level = machine.levels[id];
		edgeLayer.textContent = '';
		nodeLayer.textContent = '';
		boxes = new Map();
		edges = [];
		for (const n of level.graph.nodes()) {
			const lay = level.layout[n.id];
			if (!lay) continue;
			const enterable = lay.enter && machine.levels[lay.enter];
			const g = el('g', { class: enterable ? 'node hub' : 'node' });
			g.style.setProperty('--c', lay.color);
			if (enterable) g.dataset.enter = lay.enter;
			g.dataset.id = n.id;
			const rect = el('rect', { class: 'box' });
			g.appendChild(rect);
			const lbl = el('text', { class: 'lbl', x: 0, y: 0 });
			lbl.textContent = n.label + (enterable ? ' ▸' : '');
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
			const bb = g.getBBox(); // one measure pass per build, then never again
			const b = {
				node: level.graph.get(n.id), lay, g, rect, valEl: val, lastVal: '',
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
		crumb.textContent = level.parent ? `◂ ${machine.levels[level.parent].title}` : '';
		layoutAll();
	};

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
		let [x1, y1] = anchorPt(e.from, dx / len, dy / len);
		let [x2, y2] = anchorPt(e.to, -dx / len, -dy / len);
		// a small consistent sidestep, so an A→B and B→A pair (the echo
		// loop) rides parallel rails instead of one smeared line
		const ox = -dy / len * 4, oy = dx / len * 4;
		x1 += ox; y1 += oy; x2 += ox; y2 += oy;
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
	// the formation, drifting as one organism around its authored pose
	const placeFormation = (t) => {
		const dx = (focal.x === null ? 0 : (focal.x - 0.70 * W) * PLATE.chase)
			+ PLATE.swayX * (Math.sin(0.047 * t + 1.3) + 0.6 * Math.sin(0.013 * t));
		const dy = (focal.y === null ? 0 : (focal.y - 0.48 * H) * PLATE.chase)
			+ PLATE.swayY * (Math.sin(0.061 * t) + 0.6 * Math.sin(0.017 * t + 0.7));
		let moved = false;
		for (const b of boxes.values()) {
			if (b.probe !== undefined) continue;
			// half-extent-aware clamps: the text column stays sacred even for
			// a wide pane, and nothing slides off the viewport
			const nx = Math.min(Math.max(b.lay.x * W + dx, 0.445 * W + b.w / 2), 0.99 * W - b.w / 2);
			const ny = Math.min(Math.max(b.lay.y * H + dy, 0.03 * H + b.h / 2), 0.97 * H - b.h / 2);
			if (Math.abs(nx - b.cx) + Math.abs(ny - b.cy) > 0.25) {
				b.cx = nx; b.cy = ny;
				placeBox(b);
				b.dirty = true;
				moved = true;
			}
		}
		return moved;
	};
	const layoutAll = () => {
		W = innerWidth; H = innerHeight;
		placeFormation(0);
		crumb.setAttribute('x', 0.455 * W);
		crumb.setAttribute('y', 0.06 * H);
		for (const e of edges) placeEdge(e);
	};
	addEventListener('resize', layoutAll);

	// -- drill in / out ---------------------------------------------------------
	svg.addEventListener('pointerdown', (ev) => {
		const hub = ev.target.closest?.('.hub');
		if (hub?.dataset.enter) {
			ev.stopPropagation();
			build(hub.dataset.enter);
		}
	});
	crumb.addEventListener('pointerdown', (ev) => {
		ev.stopPropagation();
		const parent = machine.levels[levelId].parent;
		if (parent) build(parent);
	});
	addEventListener('keydown', (ev) => {
		if (ev.code === 'Escape') {
			const parent = machine.levels[levelId].parent;
			if (parent) build(parent);
		}
	});

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
		machine.note('scrub', drag.path);
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
	let lastTick = 0, lastOpacity = -1, lastForm = 0, lastEdge = 0;

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
		// the circuit flares when the band tension does (one style write)
		let op = STYLE.baseOpacity
			+ STYLE.flareOpacity * Math.min(1, machine.tension.value / 3);
		if (artistOn) op = 0.92; // tuning wants a steady lamp
		if (Math.abs(op - lastOpacity) > 0.01) {
			wrap.style.opacity = op.toFixed(2);
			lastOpacity = op;
		}
		// ALL movement runs at 30Hz: smoothed labels don't need 60, and the
		// SVG repaint (text halos, screen-spanning edges) is the overlay's
		// whole cost — per-frame work below the gate is one opacity write
		if (t - lastEdge < 1 / 30) return;
		const dt = Math.min(t - lastEdge, 0.1); // time since the last pass
		lastEdge = t;
		let moved = false; // any box moved → its edges re-anchor
		if (view?.camera && view?.wells) {
			// raw screen projections of the two tips: they pin the probe
			// nodes, and their midpoint is the focal the formation frames
			const raw = [];
			for (let i = 0; i < 2; i++) {
				probeV.copy(view.wells[i].p).project(view.camera);
				raw.push([(probeV.x + 1) / 2 * W, (1 - probeV.y) / 2 * H]);
			}
			raw.mid = [(raw[0][0] + raw[1][0]) / 2, (raw[0][1] + raw[1][1]) / 2];
			const kf = 1 - Math.exp(-PLATE.focalLag * dt);
			focal.x = focal.x === null ? raw.mid[0] : focal.x + (raw.mid[0] - focal.x) * kf;
			focal.y = focal.y === null ? raw.mid[1] : focal.y + (raw.mid[1] - focal.y) * kf;
			for (const b of boxes.values()) {
				if (b.probe === undefined) continue;
				let [sx, sy] = b.probe === 'mid' ? raw.mid : raw[b.probe];
				sx = Math.min(Math.max(sx, 0.44 * W), 0.96 * W);
				sy = Math.min(Math.max(sy, 0.05 * H), 0.94 * H);
				const k = 1 - Math.exp(-8 * dt);
				b.sx = b.sx === null ? sx : b.sx + (sx - b.sx) * k;
				b.sy = b.sy === null ? sy : b.sy + (sy - b.sy) * k;
				if (Math.abs(b.sx - b.cx) + Math.abs(b.sy - b.cy) > 0.5) {
					b.cx = b.sx; b.cy = b.sy;
					placeBox(b);
					b.dirty = true;
					moved = true;
				}
			}
		}
		// the formation drifts slowly — 20Hz placement is invisible and
		// spares the repaint (the probes above stay per-frame; they chase)
		if (t - lastForm >= 0.05) {
			lastForm = t;
			if (placeFormation(t)) moved = true;
		}
		// edges re-anchor only where a box moved: every placeEdge dirties
		// the whole span it crosses
		if (moved) {
			for (const e of edges) {
				if (e.from.dirty || e.to.dirty) placeEdge(e);
			}
			for (const b of boxes.values()) b.dirty = false;
		}
		// the 10Hz pass: machine taps, values, knob rows, edge activity+flow
		if (t - lastTick < 0.1) return;
		lastTick = t;
		machine.update(t);
		const dash = (-(t * 8) % 12).toFixed(1); // the crawl along the wires
		for (const e of edges) e.line.setAttribute('stroke-dashoffset', dash);
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

	build(machine.top);

	const destroy = () => {
		removeEventListener('resize', layoutAll);
		wrap.remove();
	};

	return { tick, setArtist, destroy, element: wrap, build, level: () => levelId };
}
