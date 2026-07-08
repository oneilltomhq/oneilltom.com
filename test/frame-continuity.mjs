import { chromium } from 'playwright';
// The metaball motion lives in a GPU compute sim now (@oneilltom/lib3/flubber
// FlubberField): particle
// positions in a storage buffer, integrated as pos += vel·dt with a governed
// velocity — there is no position wrap, so the mod()-box-teleport 'glitch' this
// test was born to catch cannot structurally recur. We still guard the sim
// end-to-end: read the particle buffer back each frame and assert the field is
// (1) finite, (2) not escaping to infinity, (3) continuous — displacement per
// unit *simulated* time stays within the speed budget.
//
// Continuity is checked on the 95th percentile, not the max: GPU readback is
// async, so the position sample and window.__sim.t are read across a small gap
// (unlike the old synchronous CPU read), which sprinkles a few misaligned
// outliers. A REAL teleport blows the whole distribution (p50 included) into
// the hundreds, so p95 ≤ 1 still fails loudly on it while tolerating the async
// jitter. Launch flags are the machine-validated WebGPU set (headless:false +
// --headless=new; playwright's own headless mode hides the GPU adapter).
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: false,
  args: [
    '--headless=new', '--enable-unsafe-webgpu', '--enable-features=Vulkan',
    '--ignore-gpu-blocklist', '--enable-gpu', '--force-device-scale-factor=1',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(process.argv[2] || 'http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__ready === true', { timeout: 15000 });
await page.waitForFunction('!!window.__flubber', { timeout: 5000 });
await page.waitForTimeout(1000);

const FRAMES = 200;
const BUDGET = 3.4;      // SPEED_CAP + slack — keep in sync with flubber uSpeedCap
const ratios = [];
let nanCount = 0, escapes = 0, samples = 0, zFlips = 0, prevDz = 0;
let prev = null, prevT = null;
const C = [0.75, 0.0, 0.3];   // density box centre  (FlubberField default)
const H = [2.3, 1.6, 1.2];    // density box half-extents

for (let k = 0; k < FRAMES; k++) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  const s = await page.evaluate(async () => {
    const f = window.__flubber;
    const buf = await f.renderer.getArrayBufferAsync(f.pPos.value);
    return { a: Array.from(new Float32Array(buf)), t: window.__sim.t };
  });
  const a = s.a;
  // whole-buffer health: finite + not escaping the box by a wide margin. Stride
  // is 4 floats (vec3 padded to std430); satellites tearing off legitimately
  // reach ~1.5× the half-extent, so 'escape' is a much wider 3× threshold.
  for (let i = 0; i < a.length; i += 4) {
    samples++;
    for (let d = 0; d < 3; d++) {
      const v = a[i + d];
      if (!Number.isFinite(v)) { nanCount++; continue; }
      if (Math.abs(v - C[d]) > H[d] * 3) escapes++;
    }
  }
  // per-frame continuity of particle 0
  if (prev) {
    const dt = s.t - prevT;
    const d = Math.hypot(a[0] - prev[0], a[1] - prev[1], a[2] - prev[2]);
    if (dt > 1e-6) ratios.push(d / (BUDGET * dt));
    const dz = a[2] - prev[2];
    if (Math.abs(dz) > 1e-4 && Math.abs(prevDz) > 1e-4 && Math.sign(dz) !== Math.sign(prevDz)) zFlips++;
    prevDz = dz;
  }
  prev = a; prevT = s.t;
}
ratios.sort((x, y) => x - y);
const p95 = ratios[Math.floor(0.95 * ratios.length)] ?? 0;
const escapeFrac = escapes / samples;
const r = {
  frames: FRAMES,
  p95SpeedRatio: +p95.toFixed(2),
  maxSpeedRatio: +(ratios[ratios.length - 1] ?? 0).toFixed(2),
  zSignFlips: zFlips,
  nanCount,
  escapeFrac: +escapeFrac.toFixed(4),
};
const pass = r.p95SpeedRatio <= 1.0 && r.nanCount === 0 && r.escapeFrac < 0.01 && r.zSignFlips < 40;
console.log(JSON.stringify({ ...r, pass }));
await browser.close();
if (!pass) process.exit(1);
