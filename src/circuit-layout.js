// ---- circuitry overlay: composition data ---------------------------------
// The hand-authored spatial score for the circuit graph. Coordinates are
// normalized viewport fractions {x, y} (node box centres); the overlay
// resolves them at build/resize. Dense on the right two-thirds — the text
// column (x < ~0.42) is sacred, and the scrim dims whatever strays left.
//
// This is the file the artist iterates on.

// node id → position. Nodes not listed here are not drawn in viewer mode
// (knob:* leaf nodes surface in artist mode as satellites of their target).
export const LAYOUT = {
	// the clock, across the top
	'phrase.p01': { x: 0.46, y: 0.08 },
	'phrase.stage': { x: 0.575, y: 0.08 },
	'phrase.wrap': { x: 0.69, y: 0.08 },
	// the ledger and its ostinato, top right
	energy: { x: 0.895, y: 0.10 },
	pulse: { x: 0.895, y: 0.21 },
	throb: { x: 0.805, y: 0.16 },
	shift: { x: 0.805, y: 0.27 },
	// the orbit chain, centre
	sep: { x: 0.46, y: 0.30 },
	drive: { x: 0.575, y: 0.30 },
	ecc: { x: 0.69, y: 0.30 },
	theta: { x: 0.46, y: 0.42 },
	whip: { x: 0.575, y: 0.42 },
	rf: { x: 0.69, y: 0.42 },
	sling: { x: 0.805, y: 0.42 },
	// the reactor, mid-low
	strain: { x: 0.46, y: 0.55 },
	slip: { x: 0.575, y: 0.55 },
	glitch: { x: 0.69, y: 0.55 },
	flicker: { x: 0.805, y: 0.55 },
	// the anchor
	'bary.k': { x: 0.46, y: 0.67 },
	'bary.target': { x: 0.575, y: 0.67 },
	bary: { x: 0.69, y: 0.67 },
	flat: { x: 0.805, y: 0.67 },
	// the light
	mood: { x: 0.895, y: 0.55 },
	exposure: { x: 0.895, y: 0.67 },
	// the flubber substrate rail, along the bottom
	'flub.noise': { x: 0.46, y: 0.88 },
	'flub.coh': { x: 0.5675, y: 0.88 },
	'flub.damp': { x: 0.675, y: 0.88 },
	'flub.cap': { x: 0.7825, y: 0.88 },
	'flub.lat': { x: 0.89, y: 0.88 },
	// the well probes chase the projected screen positions of the actual
	// wells — the math visibly tethered to the blob it drives
	'well.heavy': { probe: 0 },
	'well.spinner': { probe: 1 },
	'well.drifter': { probe: 2 },
};

// node kind → look. Colors quote the palette: teal is the site's diagnostic
// cyan, amber is the essentials-notebook accent (a deliberate quote), pink
// accent and hot are the page's own.
export const KINDS = {
	tap: { color: '#b8b8b4' },      // derived value — quiet grey
	spring: { color: '#f2b75c' },   // second-order: the conductor's voice
	onepole: { color: '#ffd9fb' },  // envelope/slew — the page accent
	latch: { color: '#e4699b' },    // one-shots and windows — hot
	vec: { color: '#5ee8e0' },      // spatial signal — diagnostic teal
	param: { color: '#8a8a86' },    // knobs — faint, artist-facing
};

export const STYLE = {
	font: "'Source Code Pro', ui-monospace, Menlo, Consolas, monospace",
	labelSize: 10.5,
	valueSize: 10,
	captionSize: 8,
	pad: 7,           // box padding, px
	baseOpacity: 0.42,
	moodOpacity: 0.22, // added as mood/1.7 → 1
	glitchOpacity: 0.85,
	edgeBase: 0.16,   // idle edge stroke opacity
	edgeActive: 0.5,  // added at full signal
};
