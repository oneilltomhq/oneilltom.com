// ---- the circuitry overlay: the artwork exposing its own frame circuit ---
// A dim SVG rendering of the score's live signal graph (src/graph.js),
// drawn WITH the art, not on it: it sits between the canvas and the scrim
// (the scrim's left-heavy gradient dims it over the text column for free),
// composites with screen blending so hairlines add light into the nebula,
// and its opacity breathes with the score's own mood. Values tick at 10Hz;
// stage-gated sub-circuits dim when their stage is dead (dim = dead — the
// essentials-notebook doctrine). The three well nodes are probes pinned to
// the projected screen positions of the actual wells: the math visibly
// tethered to the blob it drives.
//
// Build once (createElementNS + one getBBox pass), then only textContent /
// stroke-opacity / class / ≤4 transforms per frame — no layout thrash.
import { Vector3 } from 'three/webgpu';
import { LAYOUT, KINDS, STYLE } from './circuit-layout.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => {
	const e = document.createElementNS(NS, tag);
	for (const k in attrs) e.setAttribute(k, attrs[k]);
	return e;
};

const CSS = `
#circuitry {
	position: fixed; inset: 0; z-index: 1;
	pointer-events: none;
	contain: strict;
	will-change: opacity;
}
#circuitry svg { width: 100%; height: 100%; display: block; }
#circuitry text {
	font-family: ${STYLE.font};
	fill: var(--c, #b8b8b4);
}
#circuitry .lbl { font-size: ${STYLE.labelSize}px; font-weight: 400; letter-spacing: 0.04em; }
#circuitry .val { font-size: ${STYLE.valueSize}px; opacity: 0.92; }
#circuitry .cap { font-size: ${STYLE.captionSize}px; opacity: 0.55; }
#circuitry .box {
	fill: rgba(10,10,12,0.42);
	stroke: var(--c, #b8b8b4);
	stroke-opacity: 0.4;
	stroke-width: 1;
	rx: 4;
}
#circuitry .edge { stroke: var(--c, #b8b8b4); fill: none; stroke-width: 1; }
#circuitry g.node, #circuitry line.edge { transition: opacity 0.6s ease; }
#circuitry .dead { opacity: 0.16; }
/* ---- artist mode: the résumé steps back, the knobs step in ---- */
body.artist { user-select: none; }
body.artist main { opacity: 0.18; transition: opacity 0.15s ease; }
body.artist main:hover { opacity: 0.8; }
body.artist #scrim { opacity: 0.35; }
#circuitry .knob, #circuitry .knob-edge { display: none; }
body.artist #circuitry .knob { display: block; cursor: ns-resize; pointer-events: all; }
body.artist #circuitry .knob-edge { display: inline; stroke-dasharray: 2 3; }
#circuitry .knob .box { fill: rgba(10,10,12,0.6); stroke-dasharray: 3 2; }
#circuitry .knob .lbl { font-size: 8.5px; }
#circuitry .knob .val { font-size: 9px; }
#circuitry-pop {
	position: fixed; z-index: 3; display: none;
	background: rgba(12,12,16,0.92); border: 1px solid #2a2a30;
	border-radius: 6px; padding: 10px 12px; min-width: 220px;
	font-family: ${STYLE.font}; font-size: 11px; color: #b8b8b4;
}
#circuitry-pop .path { color: #8a8a86; font-size: 9.5px; margin-bottom: 6px; }
#circuitry-pop .cur { color: #f2f2f0; margin-left: 6px; }
#circuitry-pop input[type=range] { width: 100%; accent-color: #ffd9fb; margin: 8px 0 6px; }
#circuitry-pop .ramps { display: flex; gap: 6px; }
#circuitry-pop .ramps button {
	background: none; border: 1px solid #2a2a30; border-radius: 4px;
	color: #8a8a86; font: inherit; font-size: 9.5px; padding: 2px 8px; cursor: pointer;
}
#circuitry-pop .ramps button.on { color: #ffd9fb; border-color: #ffd9fb; }
#circuitry-snaps {
	position: fixed; right: clamp(1.25rem, 6vw, 6rem); bottom: 4.2rem; z-index: 3;
	display: none; gap: 6px; flex-wrap: wrap; justify-content: flex-end; max-width: 40vw;
	font-family: ${STYLE.font}; font-size: 9.5px;
}
body.artist #circuitry-snaps { display: flex; }
#circuitry-snaps button {
	background: rgba(12,12,16,0.75); border: 1px solid #2a2a30; border-radius: 4px;
	color: #b8b8b4; font: inherit; padding: 3px 9px; cursor: pointer;
}
#circuitry-snaps button:hover { color: #ffd9fb; border-color: #ffd9fb; }
#circuitry-snaps button.snapnew { color: #ffd9fb; }
`;

const fmtNum = (v) => (v >= 0 ? ' ' : '') + v.toFixed(2);

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
	const boxes = new Map(); // id → {node, g, rect, valEl, cx, cy, w, h, probe, sx, sy}
	const edges = [];        // {from, to, line}

	// -- build ------------------------------------------------------------
	const mkBox = (n, lay) => {
		const kind = KINDS[n.kind] ?? KINDS.tap;
		const g = el('g', { class: `node k-${n.kind}` });
		g.style.setProperty('--c', kind.color);
		const rect = el('rect', { class: 'box' });
		g.appendChild(rect);
		const lbl = el('text', { class: 'lbl', x: 0, y: 0 });
		lbl.textContent = n.label;
		const val = el('text', { class: 'val', x: 0, y: 13 });
		val.textContent = '';
		g.appendChild(lbl);
		g.appendChild(val);
		let capH = 0;
		if (n.caption && lay.probe === undefined) {
			// wrap the plain-words caption to short lines so boxes stay
			// narrow — the grid pitch is ~0.11 viewport widths
			const lines = [];
			let line = '';
			for (const w of n.caption.split(' ')) {
				if (line && (line + ' ' + w).length > 24) { lines.push(line); line = w; }
				else line = line ? `${line} ${w}` : w;
			}
			if (line) lines.push(line);
			lines.slice(0, 3).forEach((s, i) => {
				const cap = el('text', { class: 'cap', x: 0, y: 25 + i * 10 });
				cap.textContent = s;
				g.appendChild(cap);
				capH += 10;
			});
			capH += 2;
		}
		nodeLayer.appendChild(g);
		const b = {
			node: graph.get(n.id), g, rect, valEl: val, lastVal: '',
			probe: lay.probe, lay, cx: 0, cy: 0, w: 0, h: 0,
			sx: null, sy: null, // probe smoothing state
			dead: false, lastQ: -1,
		};
		// one measure pass, then never again
		const bb = g.getBBox();
		b.w = Math.max(bb.width, 46) + STYLE.pad * 2;
		b.h = 20 + capH + STYLE.pad * 2;
		rect.setAttribute('x', -STYLE.pad);
		rect.setAttribute('y', -STYLE.labelSize - STYLE.pad + 2);
		rect.setAttribute('width', b.w);
		rect.setAttribute('height', b.h);
		boxes.set(n.id, b);
		return b;
	};

	for (const n of graph.nodes()) {
		const lay = LAYOUT[n.id];
		if (!lay) continue; // knobs + untabled nodes: artist mode's business
		mkBox(n, lay);
	}
	// knob satellites: every rack knob joins the circuitry as a small
	// dashed box — stacked above the node it tunes, or on a rail along the
	// right edge when its target roams (well probes) or doesn't exist.
	// Hidden until artist mode.
	const rackMeta = new Map((rack?.params() ?? []).map((p) => [p.path, p]));
	const satellites = new Map(); // target box → [knob boxes]
	const rail = [];
	if (rack) {
		for (const n of graph.nodes()) {
			if (n.kind !== 'param' || !n.rackPath) continue;
			let target = null;
			for (const b of boxes.values()) {
				if (b.node.inputs?.some((i) => i.from === n.id)) { target = b; break; }
			}
			const m = rackMeta.get(n.rackPath);
			const kb = mkBox({ ...n, label: m?.label ?? n.label, caption: null },
				{ x: 0, y: 0 });
			kb.g.classList.add('knob');
			kb.g.dataset.circuitHit = '1';
			kb.g.dataset.path = n.rackPath;
			kb.isKnob = true;
			if (target && target.probe === undefined) {
				if (!satellites.has(target)) satellites.set(target, []);
				satellites.get(target).push(kb);
			} else rail.push(kb);
		}
	}
	// edges between rendered nodes (knob → target edges included; the CSS
	// hides knob edges outside artist mode)
	for (const [id, b] of boxes) {
		for (const inp of b.node.inputs ?? []) {
			const from = boxes.get(inp.from);
			if (!from) continue;
			const line = el('line', { class: 'edge', 'stroke-opacity': STYLE.edgeBase });
			line.style.setProperty('--c', (KINDS[from.node.kind] ?? KINDS.tap).color);
			if (from.isKnob) line.classList.add('knob-edge');
			edgeLayer.appendChild(line);
			edges.push({ from, to: b, line });
		}
	}

	// -- geometry ---------------------------------------------------------
	// anchor an edge on the box border along the line between centres
	const anchor = (b, dx, dy) => {
		const hw = b.w / 2, hh = b.h / 2;
		const s = Math.min(
			hw / Math.max(Math.abs(dx), 1e-6),
			hh / Math.max(Math.abs(dy), 1e-6));
		return [b.cx + dx * s, b.cy + dy * s];
	};
	const placeEdge = (e) => {
		const dx = e.to.cx - e.from.cx, dy = e.to.cy - e.from.cy;
		const len = Math.hypot(dx, dy) || 1;
		const [x1, y1] = anchor(e.from, dx / len, dy / len);
		const [x2, y2] = anchor(e.to, -dx / len, -dy / len);
		e.line.setAttribute('x1', x1); e.line.setAttribute('y1', y1);
		e.line.setAttribute('x2', x2); e.line.setAttribute('y2', y2);
	};
	const placeBox = (b) => {
		// the group's local origin is the label baseline — offset so
		// (cx, cy) is the visual centre of the rect
		const ox = b.cx - b.w / 2 + STYLE.pad;
		const oy = b.cy - b.h / 2 + STYLE.labelSize + STYLE.pad - 2;
		b.g.setAttribute('transform', `translate(${ox},${oy})`);
	};
	const layoutAll = () => {
		W = innerWidth; H = innerHeight;
		for (const b of boxes.values()) {
			if (b.probe !== undefined || b.isKnob) continue;
			b.cx = b.lay.x * W;
			b.cy = b.lay.y * H;
			placeBox(b);
		}
		for (const [target, kbs] of satellites) {
			kbs.forEach((kb, i) => {
				kb.cx = target.cx;
				kb.cy = target.cy - target.h / 2 - 16 - i * 26;
				placeBox(kb);
			});
		}
		rail.forEach((kb, i) => {
			kb.cx = 0.955 * W;
			kb.cy = 0.10 * H + i * 32;
			placeBox(kb);
		});
		for (const e of edges) placeEdge(e);
	};
	layoutAll();
	addEventListener('resize', layoutAll);

	// -- artist mode: drag to scrub, click for precision, snap to keep ------
	let artistOn = false;
	let pop = null, popPath = null, popRamp = 400;
	let snapsEl = null;
	let liveTimer = 0;

	// any human tweak keeps a rolling __live snapshot (artist mode only) —
	// reload as artist and the tuning is still there; viewers always get
	// the authored defaults
	const markHuman = () => {
		clearTimeout(liveTimer);
		liveTimer = setTimeout(() => rack.snap('__live'), 1000);
	};

	const buildPop = () => {
		pop = document.createElement('div');
		pop.id = 'circuitry-pop';
		pop.innerHTML = `
			<div class="path"></div>
			<div><span class="lblx"></span><span class="cur"></span></div>
			<input type="range">
			<div class="ramps"></div>`;
		const ramps = pop.querySelector('.ramps');
		for (const [label, ms] of [['now', 0], ['400ms', 400], ['2s', 2000]]) {
			const btn = document.createElement('button');
			btn.textContent = label;
			btn.onclick = () => {
				popRamp = ms;
				ramps.querySelectorAll('button').forEach((b2) =>
					b2.classList.toggle('on', b2 === btn));
			};
			if (ms === popRamp) btn.classList.add('on');
			ramps.appendChild(btn);
		}
		const slider = pop.querySelector('input');
		slider.addEventListener('input', () => {
			rack.set(popPath, +slider.value, popRamp, 'human');
			pop.querySelector('.cur').textContent = (+slider.value).toFixed(3);
			markHuman();
		});
		document.body.appendChild(pop);
		addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePop(); });
		addEventListener('pointerdown', (ev) => {
			if (pop.style.display === 'block' && !ev.target.closest('#circuitry-pop')) closePop();
		}, true);
	};
	const closePop = () => { if (pop) pop.style.display = 'none'; popPath = null; };
	const openPop = (path, x, y) => {
		if (!pop) buildPop();
		const m = rackMeta.get(path) ?? {};
		popPath = path;
		pop.querySelector('.path').textContent = path;
		pop.querySelector('.lblx').textContent = m.label ?? path;
		pop.querySelector('.cur').textContent = (+rack.get(path)).toFixed(3);
		const slider = pop.querySelector('input');
		slider.min = m.min ?? 0;
		slider.max = m.max ?? 1;
		slider.step = ((m.max ?? 1) - (m.min ?? 0)) / 200;
		slider.value = rack.get(path);
		pop.style.display = 'block';
		pop.style.left = `${Math.min(x, innerWidth - 250)}px`;
		pop.style.top = `${Math.min(y + 14, innerHeight - 140)}px`;
	};

	const refreshSnaps = () => {
		if (!snapsEl) {
			snapsEl = document.createElement('div');
			snapsEl.id = 'circuitry-snaps';
			document.body.appendChild(snapsEl);
		}
		snapsEl.textContent = '';
		const add = (label, cls, fn) => {
			const b = document.createElement('button');
			b.textContent = label;
			if (cls) b.className = cls;
			b.onclick = fn;
			snapsEl.appendChild(b);
		};
		add('+ snap', 'snapnew', () => { rack.snap(); refreshSnaps(); });
		for (const s of rack.snaps()) {
			if (s.name === '__live') continue;
			add(s.name, '', async (ev) => {
				if (ev.altKey) { rack.dropSnap(s.name); refreshSnaps(); return; }
				await rack.apply(s.name, 400);
			});
		}
	};

	// drag-to-scrub on knob boxes; a click (no drag) opens the popover
	const drag = { path: null, y0: 0, v0: 0, moved: false, raf: 0, next: null };
	svg.addEventListener('pointerdown', (ev) => {
		const g = ev.target.closest?.('g.knob');
		if (!artistOn || !g) return;
		ev.stopPropagation();
		ev.preventDefault();
		drag.path = g.dataset.path;
		drag.y0 = ev.clientY;
		drag.v0 = rack.get(drag.path);
		drag.moved = false;
		g.setPointerCapture?.(ev.pointerId);
	});
	svg.addEventListener('pointermove', (ev) => {
		if (!drag.path) return;
		const dy = ev.clientY - drag.y0;
		if (Math.abs(dy) > 3) drag.moved = true;
		if (!drag.moved) return;
		const m = rackMeta.get(drag.path) ?? {};
		const span = (m.max ?? 1) - (m.min ?? 0);
		const fine = ev.shiftKey ? 0.1 : 1;
		drag.next = drag.v0 - dy / 150 * span * fine;
		if (!drag.raf) {
			drag.raf = requestAnimationFrame(() => {
				drag.raf = 0;
				if (drag.next !== null) rack.set(drag.path, drag.next, 0, 'human');
			});
		}
	});
	svg.addEventListener('pointerup', (ev) => {
		if (!drag.path) return;
		if (!drag.moved) openPop(drag.path, ev.clientX, ev.clientY);
		else markHuman();
		drag.path = null; drag.next = null;
	});

	const setArtist = (on) => {
		artistOn = on;
		document.body.classList.toggle('artist', on);
		if (on) refreshSnaps();
		else closePop();
	};
	addEventListener('keydown', (ev) => {
		if (ev.ctrlKey && ev.altKey && ev.code === 'KeyA') setArtist(!artistOn);
	});
	if (artist && rack) {
		setArtist(true);
		// restore the artist's rolling tune-in-progress, if any
		if (rack.snapshot('__live')) rack.apply('__live', 0).catch(() => {});
	}

	// -- live updates -----------------------------------------------------
	const probeV = new Vector3();
	const stageNode = graph.get('phrase.stage');
	const moodNode = graph.get('mood');
	const glitchNode = graph.get('glitch');
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
		// breathe with the score (cheap: one style write when it moves)
		const mood = moodNode.value;
		let op = STYLE.baseOpacity + STYLE.moodOpacity * Math.min(1, mood / 1.7);
		if (glitchNode.value) op = STYLE.glitchOpacity;
		if (artistOn) op = 0.92; // tuning wants a steady lamp, not a breathing one
		if (Math.abs(op - lastOpacity) > 0.01) {
			wrap.style.opacity = op.toFixed(2);
			lastOpacity = op;
		}
		// well probes chase the projected wells every frame (≤3 transforms)
		if (view?.camera && view?.wells) {
			let moved = false;
			for (const b of boxes.values()) {
				if (b.probe === undefined || b.probe === null) continue;
				probeV.copy(view.wells[b.probe].p).project(view.camera);
				let sx = (probeV.x + 1) / 2 * W;
				let sy = (1 - probeV.y) / 2 * H;
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
			if (moved) for (const e of edges) {
				if (e.from.probe != null || e.to.probe != null) placeEdge(e);
			}
		}
		// the 10Hz pass: values, dead-gating, edge activity
		if (t - lastTick < 0.1) return;
		lastTick = t;
		const stage = stageNode.value;
		for (const b of boxes.values()) {
			const s = fmt(b.node);
			if (s !== b.lastVal) { b.valEl.textContent = s; b.lastVal = s; }
			const dead = !!(b.node.stages && !b.node.stages.includes(stage));
			if (dead !== b.dead) { b.g.classList.toggle('dead', dead); b.dead = dead; }
		}
		for (const e of edges) {
			const q = Math.round(activity(e.from.node) * 16) / 16;
			if (q !== e.lastQ) {
				e.line.setAttribute('stroke-opacity',
					(STYLE.edgeBase + STYLE.edgeActive * q).toFixed(3));
				e.lastQ = q;
			}
			const dead = e.from.dead || e.to.dead;
			if (dead !== e.dead) { e.line.classList.toggle('dead', dead); e.dead = dead; }
		}
	};

	const destroy = () => {
		removeEventListener('resize', layoutAll);
		pop?.remove();
		snapsEl?.remove();
		wrap.remove();
	};

	return { tick, setArtist, destroy, element: wrap };
}
