import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(process.argv[2] || 'http://localhost:8941/', { waitUntil: 'networkidle' });
await page.waitForFunction('window.__ready === true', { timeout: 15000 });
await page.waitForTimeout(1000);
// sample position at EVERY consecutive frame; positions must be continuous:
// |Δp| ≤ max-speed · Δ(simulated time). Displacement is budgeted against the
// page's own accumulated physics time (window.__sim.t), not the sampler's
// wall clock — rAF scheduling jitter between the page's callback and this
// one otherwise misattributes time and false-positives at high body speeds.
// A true teleport still fails loudly: position change with ~zero stepped
// time makes the ratio explode. Also count z-direction sign alternations —
// the signature of the per-frame teleport bug that shipped as 'the glitch'.
const r = await page.evaluate(`new Promise(res => {
  const ps = [], ss = [];
  const c = () => {
    const p = window.__body.p; ps.push([p.x, p.y, p.z]); ss.push(window.__sim.t);
    if (ps.length < 360) requestAnimationFrame(c);
    else {
      let maxRatio = 0, zFlips = 0, prevDz = 0;
      for (let i = 1; i < ps.length; i++) {
        const dt = ss[i] - ss[i-1];
        const d = Math.hypot(ps[i][0]-ps[i-1][0], ps[i][1]-ps[i-1][1], ps[i][2]-ps[i-1][2]);
        maxRatio = Math.max(maxRatio, d / (3.4 * dt + 1e-6)); // budget = SPEED_CAP + slack, keep in sync
        const dz = ps[i][2] - ps[i-1][2];
        if (Math.abs(dz) > 1e-4 && Math.abs(prevDz) > 1e-4 && Math.sign(dz) !== Math.sign(prevDz)) zFlips++;
        prevDz = dz;
      }
      res({ frames: ps.length, maxSpeedRatio: +maxRatio.toFixed(2), zSignFlips: zFlips });
    }
  };
  requestAnimationFrame(c);
})`);
const pass = r.maxSpeedRatio <= 1.0 && r.zSignFlips < 30;
console.log(JSON.stringify({ ...r, pass }));
await browser.close();
