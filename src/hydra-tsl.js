// hydra-tsl — a proof-of-concept Hydra video-synth core compiled to Three.js TSL
// (WebGPU, with automatic WebGL fallback) instead of hand-built GLSL strings.
//
// The whole point: Hydra is ALREADY a typed node graph that it flattens into
// GLSL text. TSL is a node graph that compiles to WGSL *and* GLSL. So each Hydra
// transform becomes a small JS function that takes TSL nodes and returns TSL
// nodes — same compositional algorithm as hydra-synth's generateGlsl(), but the
// "emit" target is a TSL node graph rather than a string.

import {
	WebGPURenderer, RenderTarget, MeshBasicNodeMaterial, QuadMesh,
	HalfFloatType, LinearFilter, ClampToEdgeWrapping, Scene, Mesh, PlaneGeometry,
} from 'three/webgpu';

import {
	uv, uniform, texture, time,
	vec2, vec3, vec4, float,
	sin, cos, atan, floor, fract, abs, mod, length, dot,
	max, min, mix, clamp, smoothstep, pow, step, select,
	mx_noise_float, hue, saturation, luminance,
} from 'three/tsl';

// ---------------------------------------------------------------------------
// shared state (current time in seconds, used only for JS-side dynamic args)
// ---------------------------------------------------------------------------
const state = { t: 0, outputs: [], defaultOut: null };

// small helper: rotate a vec2 `p` (already centered on origin) by `ang` radians
const rot2 = ( p, ang ) => {
	const c = cos( ang ), s = sin( ang );
	return vec2( p.x.mul( c ).sub( p.y.mul( s ) ), p.x.mul( s ).add( p.y.mul( c ) ) );
};

// hydra's _rgbToHsv / _hsvToRgb (utility-functions.js) ported to TSL — used by
// colorama. Standard Sam Hocevar branchless conversions.
const rgbToHsv = ( c ) => {
	const K = vec4( 0, -1 / 3, 2 / 3, -1 );
	const p = mix( vec4( c.bg, K.wz ), vec4( c.gb, K.xy ), step( c.b, c.g ) );
	const q = mix( vec4( p.xyw, c.r ), vec4( c.r, p.yzx ), step( p.x, c.r ) );
	const d = q.x.sub( min( q.w, q.y ) );
	const e = 1e-10;
	return vec3(
		q.z.add( q.w.sub( q.y ).div( d.mul( 6 ).add( e ) ) ).abs(),
		d.div( q.x.add( e ) ),
		q.x,
	);
};
const hsvToRgb = ( c ) => {
	const K = vec4( 1, 2 / 3, 1 / 3, 3 );
	const p = fract( c.xxx.add( K.xyz ) ).mul( 6 ).sub( K.www ).abs();
	return mix( K.xxx, clamp( p.sub( K.xxx ), 0, 1 ), c.y ).mul( c.z );
};

// ---------------------------------------------------------------------------
// transform definitions — the TSL analogue of hydra-synth's glsl-functions.js
// each `fn` receives TSL nodes and returns a TSL node. `defaults` lists the
// default values for the *scalar* params only.
// ---------------------------------------------------------------------------
const defs = {

	// ---- sources : (st) -> vec4 -------------------------------------------
	osc: { type: 'src', defaults: [ 60, 0.1, 0 ], fn: ( st, freq, sync, offset ) => {
		const t = time.mul( sync );
		const r = st.x.sub( offset.mul( 2 ).div( freq ) ).add( t ).mul( freq ).sin().mul( 0.5 ).add( 0.5 );
		const g = st.x.add( t ).mul( freq ).sin().mul( 0.5 ).add( 0.5 );
		const b = st.x.add( offset.div( freq ) ).add( t ).mul( freq ).sin().mul( 0.5 ).add( 0.5 );
		return vec4( r, g, b, 1 );
	} },

	noise: { type: 'src', defaults: [ 10, 0.1 ], fn: ( st, scale, offset ) => {
		const n = mx_noise_float( vec3( st.mul( scale ), offset.mul( time ) ) );
		return vec4( vec3( n.mul( 0.5 ).add( 0.5 ) ), 1 );
	} },

	// 3×3 cellular noise — the JS loop unrolls at compile time into a flat node
	// expression (no GPU loop), tracking nearest feature point/distance.
	voronoi: { type: 'src', defaults: [ 5, 0.3, 0.3 ], fn: ( st, scale, speed, blending ) => {
		const s = st.mul( scale );
		const iSt = floor( s ), fSt = fract( s );
		let mDist = float( 10 ), mPoint = vec2( 0, 0 );
		for ( let j = -1; j <= 1; j ++ ) for ( let i = -1; i <= 1; i ++ ) {
			const neighbor = vec2( i, j );
			const p = iSt.add( neighbor );
			let point = fract( sin( vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) ) ).mul( 43758.5453 ) );
			point = sin( time.mul( speed ).add( point.mul( 6.2831 ) ) ).mul( 0.5 ).add( 0.5 );
			const dist = length( neighbor.add( point ).sub( fSt ) );
			mPoint = select( dist.lessThan( mDist ), point, mPoint );
			mDist = min( mDist, dist );
		}
		const c = dot( mPoint, vec2( 0.3, 0.6 ) ).mul( blending.mul( mDist ).oneMinus() );
		return vec4( vec3( c ), 1 );
	} },

	gradient: { type: 'src', defaults: [ 0 ], fn: ( st, speed ) =>
		vec4( st.x, st.y, time.mul( speed ).sin().mul( 0.5 ).add( 0.5 ), 1 ) },

	solid: { type: 'src', defaults: [ 0, 0, 0, 1 ], fn: ( st, r, g, b, a ) => vec4( r, g, b, a ) },

	shape: { type: 'src', defaults: [ 3, 0.3, 0.01 ], fn: ( st, sides, radius, smoothing ) => {
		const p = st.mul( 2 ).sub( 1 );
		const a = atan( p.x, p.y ).add( Math.PI );
		const r = float( Math.PI * 2 ).div( sides );
		const d = a.div( r ).add( 0.5 ).floor().mul( r ).sub( a ).cos().mul( length( p ) );
		const c = smoothstep( radius, radius.add( smoothing ).add( 1e-7 ), d ).oneMinus();
		return vec4( vec3( c ), 1 );
	} },

	// sample another output buffer — this is the feedback / ping-pong source
	src: { type: 'src', srcArg: true, defaults: [], fn: ( st, output ) => output.texNode.sample( st ) },

	// ---- coords : (st) -> st ----------------------------------------------
	rotate: { type: 'coord', defaults: [ 10, 0 ], fn: ( st, angle, speed ) =>
		rot2( st.sub( 0.5 ), angle.add( speed.mul( time ) ) ).add( 0.5 ) },

	scale: { type: 'coord', defaults: [ 1.5, 1, 1 ], fn: ( st, amount, xMult, yMult ) => {
		const p = st.sub( 0.5 );
		return vec2( p.x.div( amount.mul( xMult ) ), p.y.div( amount.mul( yMult ) ) ).add( 0.5 );
	} },

	pixelate: { type: 'coord', defaults: [ 20, 20 ], fn: ( st, px, py ) => {
		const xy = vec2( px, py );
		return st.mul( xy ).floor().add( 0.5 ).div( xy );
	} },

	kaleid: { type: 'coord', defaults: [ 4 ], fn: ( st, nSides ) => {
		const p = st.sub( 0.5 );
		const r = length( p );
		const seg = float( Math.PI * 2 ).div( nSides );
		let a = mod( atan( p.y, p.x ), seg );
		a = a.sub( seg.div( 2 ) ).abs();
		return vec2( cos( a ), sin( a ) ).mul( r );
	} },

	scroll: { type: 'coord', defaults: [ 0.5, 0.5, 0, 0 ], fn: ( st, sx, sy, spx, spy ) =>
		mod( vec2( st.x.add( sx ).add( time.mul( spx ) ), st.y.add( sy ).add( time.mul( spy ) ) ), 1 ) },

	// ---- color : (c) -> vec4 ----------------------------------------------
	brightness: { type: 'color', defaults: [ 0.4 ], fn: ( c, amount ) => vec4( c.rgb.add( amount ), c.a ) },

	contrast: { type: 'color', defaults: [ 1.6 ], fn: ( c, amount ) =>
		vec4( c.rgb.sub( 0.5 ).mul( amount ).add( 0.5 ), c.a ) },

	invert: { type: 'color', defaults: [ 1 ], fn: ( c, amount ) =>
		vec4( mix( c.rgb, c.rgb.oneMinus(), amount ), c.a ) },

	posterize: { type: 'color', defaults: [ 3, 0.6 ], fn: ( c, bins, gamma ) => {
		const c2 = c.rgb.pow( gamma ).mul( bins ).floor().div( bins ).pow( gamma.reciprocal() );
		return vec4( c2, c.a );
	} },

	thresh: { type: 'color', defaults: [ 0.5, 0.04 ], fn: ( c, threshold, tol ) => {
		const l = luminance( c.rgb );
		return vec4( vec3( smoothstep( threshold.sub( tol ), threshold.add( tol ), l ) ), c.a );
	} },

	color: { type: 'color', defaults: [ 1, 1, 1, 1 ], fn: ( c, r, g, b, a ) => c.mul( vec4( r, g, b, a ) ) },

	hue: { type: 'color', defaults: [ 0.4 ], fn: ( c, amount ) => vec4( hue( c.rgb, amount ), c.a ) },

	saturate: { type: 'color', defaults: [ 2 ], fn: ( c, amount ) => vec4( saturation( c.rgb, amount ), c.a ) },

	// rotate through HSV then fract back to RGB — the classic psychedelic banding
	colorama: { type: 'color', defaults: [ 0.005 ], fn: ( c, amount ) =>
		vec4( fract( hsvToRgb( rgbToHsv( c.rgb ).add( amount ) ) ), c.a ) },

	// per-channel additive cycle (the shift amount itself is fract'd, as in hydra)
	shift: { type: 'color', defaults: [ 0.5, 0, 0, 0 ], fn: ( c, r, g, b, a ) =>
		c.add( fract( vec4( r, g, b, a ) ) ) },

	// ---- combine : (c0, c1) -> vec4 ---------------------------------------
	add: { type: 'combine', defaults: [ 1 ], fn: ( a, b, amount ) =>
		a.add( b ).mul( amount ).add( a.mul( amount.oneMinus() ) ) },

	mult: { type: 'combine', defaults: [ 1 ], fn: ( a, b, amount ) =>
		a.mul( amount.oneMinus() ).add( a.mul( b ).mul( amount ) ) },

	blend: { type: 'combine', defaults: [ 0.5 ], fn: ( a, b, amount ) => mix( a, b, amount ) },

	diff: { type: 'combine', defaults: [], fn: ( a, b ) =>
		vec4( a.rgb.sub( b.rgb ).abs(), max( a.a, b.a ) ) },

	layer: { type: 'combine', defaults: [], fn: ( a, b ) =>
		vec4( mix( a.rgb, b.rgb, b.a ), clamp( a.a.add( b.a ), 0, 1 ) ) },

	mask: { type: 'combine', defaults: [], fn: ( a, b ) => {
		const m = luminance( b.rgb );
		return vec4( a.rgb.mul( m ), a.a.mul( m ) );
	} },

	// ---- combineCoord : (st, c1) -> st ------------------------------------
	modulate: { type: 'combineCoord', defaults: [ 0.1 ], fn: ( st, c, amount ) =>
		st.add( c.xy.mul( amount ) ) },

	modulateScale: { type: 'combineCoord', defaults: [ 1, 1 ], fn: ( st, c, multiple, offset ) => {
		const p = st.sub( 0.5 );
		return vec2(
			p.x.div( float( offset ).add( c.r.mul( multiple ) ) ),
			p.y.div( float( offset ).add( c.g.mul( multiple ) ) ),
		).add( 0.5 );
	} },

	modulateRotate: { type: 'combineCoord', defaults: [ 1, 0 ], fn: ( st, c, multiple, offset ) =>
		rot2( st.sub( 0.5 ), float( offset ).add( c.x.mul( multiple ) ) ).add( 0.5 ) },

	// kaleid whose fold count is driven by the modulating texture's red channel
	modulateKaleid: { type: 'combineCoord', defaults: [ 4 ], fn: ( st, c, nSides ) => {
		const p = st.sub( 0.5 );
		const r = length( p );
		const seg = float( Math.PI * 2 ).div( nSides );
		let a = mod( atan( p.y, p.x ), seg );
		a = a.sub( seg.div( 2 ) ).abs();
		return vec2( cos( a ), sin( a ) ).mul( c.r.add( r ) );
	} },
};

// ---------------------------------------------------------------------------
// arg resolution: numbers/functions become uniforms (live-tweakable, no
// recompile); functions are also recorded so we can update them per-frame.
// ---------------------------------------------------------------------------
function resolveArg( a, store ) {
	if ( typeof a === 'number' ) return uniform( a );
	if ( typeof a === 'function' ) { const u = uniform( a( state.t ) ); store.push( [ u, a ] ); return u; }
	return a; // already a node or an Output (for src)
}

// ---------------------------------------------------------------------------
// the compiler — a direct port of hydra-synth's generateGlsl(), but it returns
// a closure (st:vec2 node) -> vec4 node instead of concatenating GLSL strings.
// ---------------------------------------------------------------------------
function compile( source, store ) {
	let color = () => vec4( 0, 0, 0, 1 );
	for ( const tr of source.transforms ) {
		const prev = color;
		const def = tr.def;
		const scalars = ( offset ) => def.defaults.map( ( d, i ) => resolveArg( tr.args[ i + offset ] ?? d, store ) );

		if ( def.type === 'src' ) {
			if ( def.srcArg ) { const out = tr.args[ 0 ]; color = ( st ) => def.fn( st, out ); }
			else { const a = scalars( 0 ); color = ( st ) => def.fn( st, ...a ); }
		} else if ( def.type === 'coord' ) {
			const a = scalars( 0 ); color = ( st ) => prev( def.fn( st, ...a ) );
		} else if ( def.type === 'color' ) {
			const a = scalars( 0 ); color = ( st ) => def.fn( prev( st ), ...a );
		} else if ( def.type === 'combine' ) {
			const other = compile( tr.args[ 0 ], store ); const a = scalars( 1 );
			color = ( st ) => def.fn( prev( st ), other( st ), ...a );
		} else if ( def.type === 'combineCoord' ) {
			const other = compile( tr.args[ 0 ], store ); const a = scalars( 1 );
			color = ( st ) => prev( def.fn( st, other( st ), ...a ) );
		}
	}
	return color;
}

// ---------------------------------------------------------------------------
// the chain object (Hydra's GlslSource). Every chained method just pushes a
// transform; nothing is evaluated until .out().
// ---------------------------------------------------------------------------
class TslSource {
	constructor( def, args = [] ) { this.transforms = []; if ( def ) this.transforms.push( { def, args } ); }
	out( output ) { ( output || state.defaultOut ).setChain( this ); return this; }
}
for ( const [ name, def ] of Object.entries( defs ) ) {
	if ( def.type !== 'src' ) {
		TslSource.prototype[ name ] = function ( ...args ) { this.transforms.push( { def, args } ); return this; };
	}
}

// ---------------------------------------------------------------------------
// an output buffer with ping-pong render targets (the framebuffer feedback that
// makes Hydra Hydra).
// ---------------------------------------------------------------------------
class Output {
	constructor( renderer, w, h ) {
		this.renderer = renderer;
		const mk = () => {
			const rt = new RenderTarget( w, h, {
				type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter,
				wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping, depthBuffer: false,
			} );
			return rt;
		};
		this.read = mk();
		this.write = mk();
		this.texNode = texture( this.read.texture );  // what src(oN) samples; value swaps each frame
		this.material = new MeshBasicNodeMaterial();
		this.quad = new QuadMesh( this.material );
		this.updaters = [];
		this.hasChain = false;
	}
	setChain( source ) {
		const store = [];
		const colorFn = compile( source, store );
		this.updaters = store;
		this.material.colorNode = colorFn( uv() );
		this.material.needsUpdate = true;
		this.hasChain = true;
	}
}

// ---------------------------------------------------------------------------
// top-level synth
// ---------------------------------------------------------------------------
export class HydraTSL {
	constructor( { canvas, width = 1280, height = 720, forceWebGL = false, antialias = false } = {} ) {
		this.width = width; this.height = height;
		this.renderer = new WebGPURenderer( { canvas, antialias, forceWebGL } );
		this.renderer.setSize( width, height );

		this.outputs = [];
		for ( let i = 0; i < 4; i ++ ) this.outputs.push( new Output( this.renderer, width, height ) );
		state.outputs = this.outputs;
		state.defaultOut = this.outputs[ 0 ];
		this.display = this.outputs[ 0 ];

		// screen blit
		this.screenTex = texture( this.display.read.texture );
		this.screenMat = new MeshBasicNodeMaterial();
		this.screenMat.colorNode = this.screenTex;
		this.screenQuad = new QuadMesh( this.screenMat );

		// build Hydra-style API (osc, noise, ..., src, o0..o3, render)
		const api = {};
		for ( const [ name, def ] of Object.entries( defs ) )
			if ( def.type === 'src' ) api[ name ] = ( ...args ) => new TslSource( def, args );
		this.outputs.forEach( ( o, i ) => api[ 'o' + i ] = o );
		api.render = ( o ) => { this.display = o || this.outputs[ 0 ]; };
		this.api = api;
	}

	async init() { await this.renderer.init(); return this; }

	get backend() { return this.renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL'; }

	// returns the generated shader source (WGSL on WebGPU, GLSL on WebGL)
	async getShader( output = this.display ) {
		const scene = new Scene();
		const mesh = new Mesh( new PlaneGeometry( 2, 2 ), output.material );
		scene.add( mesh );
		const { vertexShader, fragmentShader } =
			await this.renderer.debug.getShaderAsync( scene, output.quad.camera, mesh );
		return { vertexShader, fragmentShader };
	}

	// run all patch passes offscreen (uniform updates, ping-pong, swap) without
	// presenting — for callers that composite the outputs into their own scene
	update( tSeconds ) {
		state.t = tSeconds;
		for ( const out of this.outputs ) {
			if ( ! out.hasChain ) continue;
			for ( const [ u, fn ] of out.updaters ) u.value = fn( tSeconds );
		}
		for ( const out of this.outputs ) {
			if ( ! out.hasChain ) continue;
			this.renderer.setRenderTarget( out.write );
			out.quad.render( this.renderer );
			const tmp = out.read; out.read = out.write; out.write = tmp; // swap
			out.texNode.value = out.read.texture;                        // re-point feedback
		}
	}

	// blit the display output to the canvas (Hydra's classic fullscreen view)
	present() {
		this.screenTex.value = this.display.read.texture;
		this.renderer.setRenderTarget( null );
		this.screenQuad.render( this.renderer );
	}

	tick( tSeconds ) {
		this.update( tSeconds );
		this.present();
	}
}
