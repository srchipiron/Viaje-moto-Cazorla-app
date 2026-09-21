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
const fs = require('fs');
/* Punto de GPS a mitad de la etapa de HOY, sacado del plan: si se fija a mano,
   la prueba caduca en cuanto el viaje avanza un dia. */
function puntoDeHoy() {
  const plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'viaje.json'), 'utf8'));
  const hoy = new Date().toISOString().slice(0, 10);
  const e = plan.itinerario.find((d) => d.fecha === hoy) || plan.itinerario[0];
  const t = JSON.parse(fs.readFileSync(path.join(__dirname, '..', e.gpx.track), 'utf8'));
  const medio = t.track[Math.floor(t.track.length / 2)];
  return { dia: e.dia, destino: e.destino, sobre: { latitude: medio[0], longitude: medio[1], accuracy: 15 },
    fuera: { latitude: medio[0], longitude: medio[1] - 0.4, accuracy: 15 } };
}
const HOY = puntoDeHoy();
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
    const d0 = new Date('2026-09-14T12:00:00Z');
    for (let d = 0; d < 20; d++) { const dt = new Date(d0.getTime() + d * 86400000); time.push(dt.toISOString().slice(0, 10)); wc.push([0, 2, 61, 95][d % 4]); tmax.push(24 + (d % 5)); tmin.push(8 + (d % 4)); pp.push([10, 30, 60, 85][d % 4]); ps.push([0, 0.5, 4, 12][d % 4]); gu.push(30 + (d % 3) * 15); }
    return { latitude: +lat, longitude: +lons[i], elevation: 900, daily: { time, weather_code: wc, temperature_2m_max: tmax, temperature_2m_min: tmin, precipitation_probability_max: pp, precipitation_sum: ps, wind_gusts_10m_max: gu } };
  });
}

/* Geocodificador simulado: Mora de Rubielos esta en la ruta del dia 8; Morella queda fuera del viaje. */
function mockGeo(url) {
  const q = new URL(url).searchParams.get('name').toLowerCase();
  const all = [
    { name: 'Mora de Rubielos', admin1: 'Aragón', admin2: 'Teruel', country_code: 'ES', latitude: 40.2508, longitude: -0.7517, population: 1500 },
    { name: 'Morella', admin1: 'Comunidad Valenciana', admin2: 'Castellón', country_code: 'ES', latitude: 40.6197, longitude: -0.1003, population: 2400 },
    { name: 'Mora', admin1: 'Castilla-La Mancha', admin2: 'Toledo', country_code: 'ES', latitude: 39.685, longitude: -3.774, population: 9800 },
  ];
  return { results: all.filter((x) => x.name.toLowerCase().includes(q)) };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, locale: 'es-ES' });
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockMeteo(r.request().url())) }));
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG1x1 }));
  await ctx.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockGeo(r.request().url())) }));
  async function nuevoCtx(geo) {
    const c = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, locale: 'es-ES', permissions: ['geolocation'], geolocation: geo });
    await c.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockMeteo(r.request().url())) }));
    await c.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG1x1 }));
    return c;
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const views = ['#/resumen', '#/etapas', '#/etapas/1', '#/etapas/4', '#/etapas/7', '#/etapas/11', '#/noches', '#/tiempo', '#/listas', '#/equipaje', '#/guia', '#/hoja', '#/sos', '#/ahora', '#/buscar', '#/buscar/albarrac'];
  for (const v of views) {
    await page.goto(BASE + v, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !document.querySelector('.loading'));
    const n = (await page.locator('#view').innerText()).length;
    if (n < 200 && v !== '#/buscar') errors.push(`vista ${v} casi vacia (${n} chars)`);
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
  // radares de la DGT: tabla en la ficha de etapa (dia 3 tiene dos sobre la ruta) y vista propia
  await page.goto(BASE + '#/etapas/3', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => /Radares/i.test(document.getElementById('view').innerText), null, { timeout: 15000 })
    .catch(() => errors.push('dia 3 sin el bloque de radares'));
  const nrad = await page.locator('h2:text-matches("^Radares", "i") + .card > .tbl-wrap tbody tr').count();
  if (nrad !== 2) errors.push(`dia 3: ${nrad} radares sobre la ruta, esperados 2`);
  if (!(await page.locator('h2:text-matches("^Radares", "i") + .card details').count())) errors.push('dia 3 sin el desplegable de radares cerca de la ruta');
  console.log('radares dia 3:', nrad, '|', (await page.locator('#view').innerText()).match(/Fijo · [^\n]*/g));
  await page.goto(BASE + '#/etapas/5', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  if (/^Radares/im.test(await page.locator('#view').innerText())) errors.push('dia 5 no deberia tener radares');
  // vista #/radares: lista completa de Espana cargada y desglose por etapa
  await page.goto(BASE + '#/radares', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => /puntos de radar/i.test(document.getElementById('view').innerText), null, { timeout: 15000 })
    .catch(() => errors.push('vista de radares sin cargar'));
  const totRad = await page.evaluate(() => (D.radares && D.radares.radares || []).length);
  if (totRad < 700) errors.push(`la app solo tiene ${totRad} radares de toda España`);
  const enRuta = await page.evaluate(() => D.data.itinerario.reduce((s, e) => s + radaresDia(e.dia).en_ruta.length, 0));
  if (enRuta !== 5) errors.push(`radares en ruta: ${enRuta}, esperados 5`);
  console.log('radares:', totRad, 'puntos en España |', enRuta, 'sobre la ruta');
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
  // buscador
  await page.goto(BASE + '#/buscar/laminador', { waitUntil: 'networkidle' });
  const nres = await page.locator('.guia-link').count(); if (!nres) errors.push('buscador sin resultados para "laminador"'); console.log('buscar laminador:', nres, 'resultados');
  // diario y gastos persistentes
  await page.goto(BASE + '#/etapas/5', { waitUntil: 'networkidle' });
  await page.fill('[data-diario="5"]', 'Prueba de diario'); await page.waitForTimeout(600);
  await page.selectOption('.gasto-form select', 'gasolina'); await page.fill('.gasto-form input[name=importe]', '21.5'); await page.fill('.gasto-form input[name=concepto]', 'Repsol'); await page.click('.gasto-form button[type=submit]');
  await page.reload({ waitUntil: 'networkidle' });
  const diario = await page.inputValue('[data-diario="5"]'); const gasto = await page.locator('.gastos li').count();
  if (diario !== 'Prueba de diario' || gasto !== 1) errors.push(`diario/gastos no persisten (${diario} / ${gasto})`); console.log('diario y gasto persistentes:', diario === 'Prueba de diario', gasto);
  await page.goto(BASE + '#/resumen', { waitUntil: 'networkidle' });
  if (!/Gastos del viaje/.test(await page.locator('#view').innerText())) errors.push('resumen sin gastos del viaje');
  // tema manual
  await page.click('#tema'); const tema1 = await page.evaluate(() => document.documentElement.dataset.theme); await page.click('#tema'); const tema2 = await page.evaluate(() => document.documentElement.dataset.theme);
  if (tema1 !== 'light' || tema2 !== 'dark') errors.push(`tema: ${tema1}/${tema2}`); console.log('tema:', tema1, tema2); await page.click('#tema');
  // buscador de pueblos: uno en la ruta, uno fuera, y uno ambiguo
  await page.goto(BASE + '#/pueblos', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('.loading') && document.getElementById('pueblo-q'));
  await page.fill('#pueblo-q', 'Mora de Rubielos'); await page.click('#pueblo-form button');
  await page.waitForFunction(() => /Está en la ruta|Desvío corto|Desvío largo|Fuera del viaje/.test(document.getElementById('view').innerText), null, { timeout: 10000 }).catch(() => errors.push('pueblos: sin resultado para Mora de Rubielos'));
  const pu1 = await page.locator('#view').innerText();
  if (!/está en la ruta/i.test(pu1) || !/día 8/i.test(pu1)) errors.push('pueblos: Mora de Rubielos deberia estar en la ruta del dia 8');
  console.log('pueblos (Mora de Rubielos):', (pu1.match(/Está en la ruta|Desvío corto|Desvío largo|Fuera del viaje/) || ['?'])[0], '|', (pu1.match(/Ya pasas por ahí el día \d+/) || [''])[0]);
  await page.fill('#pueblo-q', 'Morella'); await page.click('#pueblo-form button');
  await page.waitForFunction(() => /Morella/.test(document.getElementById('view').innerText) && /Fuera del viaje|Desvío/.test(document.getElementById('view').innerText), null, { timeout: 10000 }).catch(() => errors.push('pueblos: sin resultado para Morella'));
  const pu2 = await page.locator('#view').innerText();
  console.log('pueblos (Morella):', (pu2.match(/Está en la ruta|Desvío corto|Desvío largo|Fuera del viaje/) || ['?'])[0]);
  await page.fill('#pueblo-q', 'Mora'); await page.click('#pueblo-form button');
  await page.waitForSelector('[data-pueblo-sel]', { timeout: 10000 }).catch(() => errors.push('pueblos: no ofrece elegir entre varios'));
  console.log('pueblos (ambiguo): opciones', await page.locator('[data-pueblo-sel]').count(), '| consultados', await page.locator('[data-pueblo-prev]').count());
  await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/pueblos.png' : '/dev/null', fullPage: true }).catch(() => null);
  // SOS + GPS simulado sobre la ruta del dia 3 (cerca de Alcaraz)
  await ctx.grantPermissions(['geolocation']); await ctx.setGeolocation({ latitude: 38.6648, longitude: -2.4911, accuracy: 12 });
  await page.goto(BASE + '#/etapas/3', { waitUntil: 'networkidle' });
  await page.click('[data-localizar]'); await page.waitForSelector('.card.pos', { timeout: 10000 }).catch(() => errors.push('sin tarjeta de posicion'));
  const posTxt = await page.locator('.card.pos').innerText().catch(() => '');
  console.log('posicion:', posTxt.replace(/\n/g, ' | ').slice(0, 160));
  if (!/sobre la ruta/i.test(posTxt) || !/alcaraz/i.test(posTxt)) errors.push('posicion en etapa incorrecta (esperaba sobre la ruta y siguiente punto Alcaraz)');
  // vista "Ahora": cruza posicion + hora + plan (GPS a mitad de la etapa de hoy).
  // Contexto nuevo: el navegador cachea la ultima posicion y devolveria la del bloque anterior.
  console.log(`etapa de hoy: dia ${HOY.dia} -> ${HOY.destino}`);
  const ctxA = await nuevoCtx(HOY.sobre);
  const pageA = await ctxA.newPage();
  pageA.on('pageerror', (e) => errors.push('ahora pageerror: ' + e.message));
  await pageA.goto(BASE + '#/ahora', { waitUntil: 'networkidle' });
  await pageA.waitForFunction(() => !document.querySelector('.loading'));
  await pageA.click('[data-localizar]');
  await pageA.waitForFunction(() => /de moto/i.test(document.getElementById('view').innerText), null, { timeout: 10000 }).catch(() => errors.push('ahora: sin tarjeta de progreso'));
  const ahora = await pageA.locator('#view').innerText();
  console.log('ahora:', ahora.replace(/\n+/g, ' | ').slice(0, 260));
  if (!/quedan/i.test(ahora)) errors.push('ahora: sin kilometros restantes');
  if (!/llegada estimada/i.test(ahora)) errors.push('ahora: sin llegada estimada');
  if (!/gasolina/i.test(ahora)) errors.push('ahora: sin tarjeta de gasolina');
  if (/fuera de la ruta/i.test(ahora)) errors.push('ahora: se cree fuera de la ruta estando encima');
  // anotar un repostaje y comprobar que el contador se reinicia
  await pageA.click('[data-repostaje]');
  await pageA.waitForTimeout(300);
  const trasRepostar = await pageA.locator('#view').innerText();
  const km0 = (trasRepostar.match(/gasolina\s*([\d.,]+) km/i) || [])[1];
  console.log('km desde repostaje:', km0);
  if (km0 && parseFloat(km0.replace('.', '')) > 5) errors.push(`ahora: el repostaje no reinicia el contador (${km0})`);
  await pageA.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/ahora.png' : '/dev/null', fullPage: true }).catch(() => null);
  await ctxA.close();
  // fuera de ruta: unos 30 km al oeste del track de hoy
  const ctxF = await nuevoCtx(HOY.fuera);
  const pageF = await ctxF.newPage();
  await pageF.goto(BASE + '#/ahora', { waitUntil: 'networkidle' });
  await pageF.click('[data-localizar]');
  await pageF.waitForSelector('.card.warn', { timeout: 10000 }).catch(() => errors.push('ahora: no avisa estando fuera de la ruta'));
  const fuera = await pageF.locator('#view').innerText();
  if (!/fuera de la ruta/i.test(fuera)) errors.push('ahora: no detecta que esta fuera de la ruta');
  console.log('fuera de ruta:', /fuera de la ruta/i.test(fuera));
  await ctxF.close();
  await page.goto(BASE + '#/sos', { waitUntil: 'networkidle' });
  const sos = await page.locator('#view').innerText(); if (!/112/.test(sos) || !/Emergencia/.test(sos)) errors.push('vista SOS incompleta');
  await page.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/sos.png' : '/dev/null' }).catch(() => null);
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
