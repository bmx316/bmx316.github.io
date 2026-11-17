const { chromium } = require('playwright');
const shots = [
 ['bear-lodge-arrival', 1, '.768,.566,10', '.70,.52,20', 55, 'Level 1 · Arriving at Bear Lodge Resort, Burgess Junction'],
 ['level1-aerial', 1, '.98,.92,1100', '.45,.42,0', 50, 'Level 1 · Aerial over Burgess Junction, looking west'],
 ['level3-rider', 3, '.62,.62,12', '.35,.38,0', 60, 'Level 3 · Mid-route, rider’s eye'],
 ['level5-aerial', 5, '.70,.95,1000', '.25,.40,0', 50, 'Level 5 · Aerial toward High Country Lodge'],
 ['high-country-lodge', 5, '.268,.462,10', '.225,.435,6', 55, 'Level 5 · Pulling into Wyoming High Country Lodge'],
];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  p.on('console', m => m.type() === 'error' && console.log('ERR', m.text()));
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  for (const [name, lv, cam, look, fov, label] of shots) {
    const q = new URLSearchParams({ level: lv, cam, look, fov, label, far: cam.split(',')[2] > 200 ? 14000 : 6500, near: cam.split(',')[2] > 200 ? 3000 : 900 });
    await p.goto('http://localhost:8765/render.html?' + q, { waitUntil: 'load' });
    await p.waitForFunction('window.DONE === true', null, { timeout: 180000 });
    await p.screenshot({ path: `out_${name}.png` });
    console.log('ok', name);
  }
  await b.close();
})();
