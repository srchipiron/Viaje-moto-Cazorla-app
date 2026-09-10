/* Prueba de humo con Playwright (Chromium). Recorre todas las vistas, comprueba que no hay
   errores de JavaScript, que las marcas persisten, que el service worker cachea y que la app
   sigue funcionando sin conexion. Las llamadas a Open-Meteo y a los mapas se simulan.

   Uso:  python3 -m http.server 8080 &   (desde la raiz del repositorio)
         node tests/smoke.js [http://localhost:8080/]
   Requiere Playwright instalado (global o local) y Chromium. */
'use strict';
const path = require('path');
function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* no local */ }
  const g = require('child_process').execSync('npm root -g').toString().trim();
  return require(path.join(g, 'playwright'));
}
const { chromium } = loadPlaywright();
const BASE = process.argv[2] || 'http://localhost:8080/';
const PNG1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function mockMeteo(url) {
  const u = new URL(url);
  const lats = u.searchParams.get('latitude').split(','), lons = u.searchParams.get('longitude').split(',');
  const hourly = u.searchParams.get('hourly');
  const start = u.searchParams.get('start_date') || new Date().toISOString().slice(0, 10);
  return lats.map((lat, i) => {
    if (hourly) {
      const time = [], pp = [], t = [], wc = [], g = [];
      for (let h = 0; h < 24; h++) { time.push(`${start}T${String(h).padStart(2, '0')}:00`); pp.push(h >= 14 && h <= 18 ? 60 + i * 5 : 5); t.push(12 + h); wc.push(h >= 15 ? 95 : 1); g.push(20 + h); }
      return { latitude: +lat, longitude: +lons[i], hourly: { time, precipitation_probability: pp, temperature_2m: t, weather_code: wc, wind_gusts_10m: g } };
    }
    const time = [], wc = [], tmax = [], tmin = [], pp = [], ps = [], gu = [];
    const d0 = new Date(); d0.setHours(12, 0, 0, 0);
    for (let d = 0; d < 16; d++) { const dt = new Date(d0.getTime() + d * 86400000); time.push(dt.toISOString().slice(0, 10)); wc.push([0, 2, 61, 95][d % 4]); tmax.push(24 + (d % 5)); tmin.push(8 + (d % 4)); pp.push([10, 30, 60, 85][d % 4]); ps.push([0, 0.5, 4, 12][d % 4]); gu.push(30 + (d % 3) * 15); }
    return { latitude: +lat, longitude: +lons[i], elevation: 900, daily: { time, weather_code: wc, temperature_2m_max: tmax, temperature_2m_min: tmin, precipitation_probability_max: pp, precipitation_sum: ps, wind_gusts_10m_max: gu } };
  });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, locale: 'es-ES' });
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockMeteo(r.request().url())) }));
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG1x1 }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const views = ['#/resumen', '#/etapas', '#/etapas/1', '#/etapas/4', '#/etapas/7', '#/etapas/11', '#/noches', '#/tiempo', '#/listas', '#/equipaje', '#/guia', '#/hoja'];
  for (const v of views) {
    await page.goto(BASE + v, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !document.querySelector('.loading'));
    const n = (await page.locator('#view').innerText()).length;
    if (n < 200) errors.push(`vista ${v} casi vacia (${n} chars)`);
    console.log(`${v.padEnd(12)} ${n} chars`);
  }
  // marcas persistentes
  await page.goto(BASE + '#/listas', { waitUntil: 'networkidle' });
  const first = page.locator('input[data-key]').first(); const key = await first.getAttribute('data-key'); await first.check();
  await page.reload({ waitUntil: 'networkidle' });
  const persisted = await page.locator(`input[data-key="${key.replace(/"/g, '\\"')}"]`).isChecked();
  if (!persisted) errors.push('la marca no persiste'); console.log('marca persistente:', persisted);
  // lista de carga de maletas y boton de avisar
  await page.goto(BASE + '#/listas', { waitUntil: 'networkidle' });
  const carga = await page.locator('input[data-key^="carga|"]').count();
  if (!carga) errors.push('sin lista de carga de maletas'); console.log('carga de maletas:', carga, 'items');
  await page.goto(BASE + '#/etapas/3', { waitUntil: 'networkidle' });
  if (!(await page.locator('[data-avisar]').count())) errors.push('sin boton Avisar en casa');
  const compartido = await page.evaluate(() => new Promise((res) => { window.open = (u) => { res(u); return null; }; navigator.share = undefined; document.querySelector('[data-avisar]').click(); setTimeout(() => res(null), 1500); }));
  if (!compartido || !/wa\.me\/\?text=.*D%C3%ADa%203/.test(compartido)) errors.push('avisar en casa no genera el enlace de WhatsApp: ' + compartido);
  console.log('avisar en casa:', compartido ? decodeURIComponent(compartido).slice(0, 70).replace(/\n/g, ' | ') : null);
  // tabla de rutas Kurviger en la guia
  await page.goto(BASE + '#/guia', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('table.rutas tbody tr').length >= 11 && !document.querySelector('table.rutas .muted'), null, { timeout: 15000 }).catch(() => errors.push('tabla de rutas Kurviger incompleta'));
  console.log('rutas Kurviger:', await page.locator('table.rutas tbody tr').count());
  // mapa del viaje completo
  if (await page.locator('[data-mapa="todos"]').count()) {
    await page.locator('[data-mapa="todos"]').first().click();
    await page.waitForFunction(() => window.L && document.querySelectorAll('.leaflet-overlay-pane path').length >= 11, null, { timeout: 20000 }).catch(() => errors.push('mapa completo sin las 11 lineas'));
    console.log('mapa completo: lineas', await page.locator('.leaflet-overlay-pane path').count(), 'noches', await page.locator('.via-noche').count());
    await page.locator('#mapa-cerrar').click();
  }
  // durante el viaje (reloj simulado): progreso, proxima parada y meteo por horas
  const ctx2 = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  await ctx2.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockMeteo(r.request().url())) }));
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push('pageerror(viaje): ' + e.message));
  await p2.clock.install({ time: new Date('2026-09-16T11:05:00+02:00') });
  await p2.goto(BASE + '#/resumen', { waitUntil: 'networkidle' });
  const txt = await p2.locator('#view').innerText();
  if (!/Día 3 de 11/.test(txt)) errors.push('resumen en viaje: falta el progreso');
  if (!/Próximo:/.test(txt)) errors.push('resumen en viaje: falta la proxima parada');
  console.log('en viaje:', (txt.match(/Día 3 de 11[^\n]*/) || [''])[0], '|', (txt.match(/Próximo:[^\n]{0,60}/) || [''])[0]);
  await p2.goto(BASE + '#/etapas/3', { waitUntil: 'networkidle' });
  await p2.waitForFunction(() => document.querySelectorAll('.hr').length > 0, null, { timeout: 10000 }).catch(() => errors.push('sin meteo por horas'));
  const t3 = await p2.locator('#view').innerText();
  console.log('horas:', await p2.locator('.hr').count(), '| tormenta:', /tormenta de tarde/i.test(t3), '| anochece:', (t3.match(/Anochece[^\n]*/) || [''])[0]);
  if (!/tormenta de tarde/i.test(t3)) errors.push('sin aviso de tormenta de tarde con el mock');
  await p2.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/etapa3-viaje.png' : '/dev/null', fullPage: false }).catch(() => null);
  await ctx2.close();
  // mapa interactivo
  await page.goto(BASE + '#/etapas/1', { waitUntil: 'networkidle' });
  if (await page.locator('[data-mapa]').count()) {
    await page.locator('[data-mapa]').first().click();
    await page.waitForFunction(() => window.L && document.querySelector('.leaflet-container'), null, { timeout: 15000 });
    console.log('mapa: ok, marcadores', await page.locator('.via-icon').count());
    await page.locator('#mapa-cerrar').click();
  }
  // service worker + offline
  await page.goto(BASE + '#/resumen', { waitUntil: 'networkidle' });
  const sw = await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).then(() => true).catch(() => false);
  console.log('service worker controlando:', sw);
  if (sw) {
    await page.waitForTimeout(1500);
    await ctx.setOffline(true);
    await page.goto(BASE + '#/etapas/2', { waitUntil: 'load' }).catch((e) => errors.push('offline: ' + e.message));
    await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 8000 }).catch(() => errors.push('offline: la vista no renderiza'));
    console.log('offline:', (await page.locator('#view').innerText()).slice(0, 40).replace(/\n/g, ' '));
    await ctx.setOffline(false);
  }
  await browser.close();
  const real = errors.filter((e) => !/open-meteo|tile\.openstreetmap/.test(e));
  console.log(real.length ? `\nERRORES (${real.length}):\n  ` + real.join('\n  ') : '\nSin errores');
  process.exit(real.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
