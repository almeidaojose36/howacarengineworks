import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
const [,, mode, a, b, out, w='1920', h='1080', fps='30'] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', m => { if (m.type()==='error') console.error('PAGE', m.text()); });
page.on('pageerror', e => console.error('PAGEERR', e.message));
await page.goto(`http://localhost:8765/index.html?w=${w}&h=${h}`);
await page.waitForFunction('window.READY===true', null, { timeout: 120000 });
if (mode === 'still') {
  const times = a.split(',').map(Number);
  for (const t of times) {
    // warm: step from t-2 to integrate rotation
    for (let k = 4; k > 0; k--) await page.evaluate(x => window.renderFrame(x), t - k * 0.05);
    await page.evaluate(x => window.renderFrame(x), t);
    const d = await page.evaluate(() => window.grab(0.9)); fs.writeFileSync(`${out}/s_${t.toFixed(1)}.jpg`, Buffer.from(d, 'base64'));
  }
} else {
  const f0 = +a, f1 = +b, F = +fps;
  const ff = spawn('ffmpeg', ['-y','-v','error','-f','image2pipe','-framerate',fps,'-c:v','mjpeg','-i','-','-c:v','libx264','-preset','medium','-crf','16','-pix_fmt','yuv420p',out]);
  // pre-roll to integrate rotation state
  for (let f = Math.max(0, f0 - 2); f < f0; f++) await page.evaluate(x => window.renderFrame(x), f / F);
  const T0 = Date.now();
  for (let f = f0; f < f1; f++) {
    await page.evaluate(x => window.renderFrame(x), f / F);
    const d = await page.evaluate(() => window.grab(0.94));
    if (!ff.stdin.write(Buffer.from(d, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - f0) % 20 === 0) console.log(out, f, ((Date.now() - T0) / (f - f0 + 1) / 1000).toFixed(2) + 's/f');
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
}
await browser.close();
