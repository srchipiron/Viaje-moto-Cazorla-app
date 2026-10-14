/* Prueba de humo con Playwright (Chromium). Recorre todas las vistas, comprueba que no hay
   errores de JavaScript, que las marcas persisten, que el service worker cachea y que la app
   sigue funcionando sin conexion. Las llamadas a Open-Meteo, a los precios y a los mapas se simulan.
   La prueba principal va contra el primer viaje (2026-09-cazorla, con ?viaje=), que es el que tiene los
   datos que se comprueban; despues, el viaje minimo de viajes/ejemplo y el viaje por Portugal
   (2027-01-fisterra): horas de Portugal, gasolineras de la DGEG y pueblos de los dos paises.

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
/* Las comprobaciones de detalle (radares del dia 3, gasolineras del 10, mapa...) son del viaje de 2026,
   que esta completo: la prueba lo abre siempre con ?viaje=, sea o no el activo. */
const INDICE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'viajes', 'index.json'), 'utf8'));
const VIAJE_PRUEBA = '2026-09-cazorla';
const VIAJE_DIR = path.join(__dirname, '..', 'viajes', VIAJE_PRUEBA);
/* Punto de GPS a mitad de la etapa de HOY, sacado del plan: si se fija a mano,
   la prueba caduca en cuanto el viaje avanza un dia. Fuera de las fechas del viaje se usa el dia 1
   con el reloj simulado en esa fecha (relojEtapa). */
function puntoDeHoy() {
  const plan = JSON.parse(fs.readFileSync(path.join(VIAJE_DIR, 'viaje.json'), 'utf8'));
  const hoy = new Date().toISOString().slice(0, 10);
  const e = plan.itinerario.find((d) => d.fecha === hoy) || plan.itinerario[0];
  const t = JSON.parse(fs.readFileSync(path.join(VIAJE_DIR, e.gpx.track), 'utf8'));
  const medio = t.track[Math.floor(t.track.length / 2)];
  return { dia: e.dia, fecha: e.fecha, destino: e.destino, sobre: { latitude: medio[0], longitude: medio[1], accuracy: 15 },
    fuera: { latitude: medio[0], longitude: medio[1] - 0.4, accuracy: 15 } };
}
const HOY = puntoDeHoy();
const relojEtapa = (pagina) => pagina.clock.install({ time: new Date(`${HOY.fecha}T11:00:00+02:00`) });
const RAIZ = process.argv[2] || 'http://localhost:8080/';
const BASE = `${RAIZ}?viaje=${VIAJE_PRUEBA}`;   // BASE + '#/vista'
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
  /* Precios del Ministerio simulados: cada gasolinera de la ruta con un precio distinto y estable. */
  const GAS = JSON.parse(fs.readFileSync(path.join(VIAJE_DIR, 'gasolineras.json'), 'utf8'));
  const mockGas = (c) => c.route('https://sedeaplicaciones.minetur.gob.es/**', (r) => {
    const prov = r.request().url().match(/FiltroProvinciaProducto\/(\d+)\//);
    const lista = [].concat(...Object.values(GAS.por_dia)).filter((s) => !prov || s.prov === prov[1]).map((s, i) => ({ IDEESS: s.id, PrecioProducto: (1.8 + (i % 7) / 100).toFixed(3).replace('.', ',') }));
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Fecha: '22/09/2026 8:00:00', ListaEESSPrecio: lista }) });
  });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, locale: 'es-ES' });
  await ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockMeteo(r.request().url())) }));
  await mockGas(ctx);
  await ctx.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG1x1 }));
  await ctx.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockGeo(r.request().url())) }));
  async function nuevoCtx(geo) {
    const c = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, locale: 'es-ES', permissions: ['geolocation'], geolocation: geo });
    await c.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockMeteo(r.request().url())) }));
    await mockGas(c);
    await c.route('https://precoscombustiveis.dgeg.gov.pt/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: true, resultado: [] }) }));
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
    const txtV = await page.locator('#view').innerText(); const n = txtV.length;
    // Ahora, fuera de las fechas del viaje, solo dice que falta o que ya termino: es corta a proposito
    const cortaAdrede = v === '#/buscar' || (v === '#/ahora' && /Viaje terminado|Faltan \d+ d/.test(txtV));
    if (n < 200 && !cortaAdrede) errors.push(`vista ${v} casi vacia (${n} chars)`);
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
  // gasolineras: bloque en la etapa 10 con precios simulados del Ministerio y vista #/gasolina
  await page.goto(BASE + '#/etapas/10', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('table.gas tr.barata').length === 1, null, { timeout: 15000 })
    .catch(() => errors.push('etapa 10 sin la gasolinera mas barata resaltada'));
  const gasFilas = await page.locator('table.gas tbody tr').count();
  if (gasFilas !== 8) errors.push(`etapa 10: ${gasFilas} gasolineras, esperadas 8`);
  const gasTxt = await page.locator('#view').innerText();
  console.log('gasolineras dia 10:', gasFilas, '|', (gasTxt.match(/barata hoy:[^\n]*/i) || [''])[0].slice(0, 90), '|', await page.locator('table.gas tr.barata').innerText().catch(() => 'sin fila'));
  await page.goto(BASE + '#/gasolina', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const gasVista = await page.locator('#view').innerText();
  if (!/Más barata:/.test(gasVista)) errors.push('vista de gasolina sin la mas barata');
  console.log('vista gasolina:', (gasVista.match(/Más barata:/g) || []).length, 'etapas con precio');
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
  if (enRuta !== 4) errors.push(`radares en ruta: ${enRuta}, esperados 4`);
  const nTramos = await page.evaluate(() => radaresTramos().length);
  if (nTramos !== 47) errors.push(`radares de tramo: ${nTramos}, esperados 47`);
  if (!/Radares de tramo/i.test(await page.locator('#view').innerText())) errors.push('vista de radares sin la seccion de tramos');
  console.log('radares:', totRad, 'puntos en España |', enRuta, 'sobre la ruta |', nTramos, 'tramos');
  // tabla de rutas Kurviger en la guia
  await page.goto(BASE + '#/guia', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('table.rutas tbody tr').length >= 11 && !document.querySelector('table.rutas .muted'), null, { timeout: 15000 }).catch(() => errors.push('tabla de rutas Kurviger incompleta'));
  console.log('rutas Kurviger:', await page.locator('table.rutas tbody tr').count());
  // mapa del viaje completo
  if (await page.locator('[data-mapa="todos"]').count()) {
    await page.locator('[data-mapa="todos"]').first().click();
    await page.waitForFunction(() => window.L && document.querySelectorAll('.leaflet-overlay-pane path').length >= 11, null, { timeout: 20000 }).catch(() => errors.push('mapa completo sin las 11 lineas'));
    const tramosMapa = await page.locator('.leaflet-overlay-pane path[stroke-dasharray]').count();
    if (!tramosMapa) errors.push('mapa completo sin radares de tramo (lineas discontinuas)');
    const leyenda = await page.locator('#mapa-leyenda').innerText();
    if (!/tramo/i.test(leyenda)) errors.push('mapa sin leyenda de radares');
    console.log('mapa completo: lineas', await page.locator('.leaflet-overlay-pane path').count(), 'noches', await page.locator('.via-noche').count(), '| tramos', tramosMapa, '| leyenda:', leyenda);
    await page.locator('#mapa-cerrar').click();
  }
  // durante el viaje (reloj simulado): progreso, proxima parada y meteo por horas
  const ctx2 = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  await ctx2.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockMeteo(r.request().url())) }));
  await mockGas(ctx2);
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
  await relojEtapa(pageA);
  await pageA.goto(BASE + '#/ahora', { waitUntil: 'networkidle' });
  await pageA.waitForFunction(() => !document.querySelector('.loading'));
  await pageA.click('[data-localizar]');
  // "Quedan" solo sale con posicion: "de moto" y "llegada estimada" tambien estan en la tarjeta sin GPS.
  await pageA.waitForFunction(() => /quedan/i.test(document.getElementById('view').innerText), null, { timeout: 10000 }).catch(() => errors.push('ahora: sin tarjeta de progreso'));
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
  await relojEtapa(pageF);
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
  // plantilla: el viaje minimo de viajes/ejemplo (tools/nuevo_viaje.py) abre todas las vistas sin errores
  // y lo que se apunta en el guarda aparte, sin mezclarse con el viaje activo
  if (fs.existsSync(path.join(__dirname, '..', 'viajes', 'ejemplo', 'viaje.json'))) {
    const ctxE = await nuevoCtx({ latitude: 40.407, longitude: -1.44, accuracy: 15 });
    const pe = await ctxE.newPage();
    pe.on('pageerror', (e) => errors.push('pageerror(ejemplo): ' + e.message));
    const vistas = ['resumen', 'etapas', 'etapas/1', 'etapas/2', 'noches', 'tiempo', 'listas', 'equipaje', 'guia', 'hoja', 'sos', 'buscar/alba', 'ahora', 'pueblos', 'radares', 'gasolina'];
    for (const v of vistas) {
      await pe.goto(RAIZ + `?viaje=ejemplo#/${v}`, { waitUntil: 'networkidle' });
      const t = await pe.locator('#view').innerText();
      if (/undefined|NaN|\[object |No se pudo cargar/.test(t)) errors.push(`ejemplo #/${v}: ${(t.match(/.{0,40}(undefined|NaN|\[object |No se pudo cargar).{0,30}/) || [''])[0]}`);
    }
    const marca = await pe.locator('.brand-text strong').innerText();
    if (!/ejemplo/i.test(marca)) errors.push('ejemplo: la cabecera no lleva el nombre del viaje: ' + marca);
    await pe.goto(RAIZ + '?viaje=ejemplo#/etapas/1', { waitUntil: 'networkidle' });
    await pe.fill('[data-diario="1"]', 'Nota del viaje de ejemplo'); await pe.waitForTimeout(600);
    const claveE = await pe.evaluate(() => Object.keys(localStorage).filter((k) => /diario/.test(k)));
    if (!claveE.includes('viaje-nx500-diario@ejemplo')) errors.push('ejemplo: el diario no se guarda con su sufijo: ' + claveE.join(','));
    await pe.goto(BASE + '#/etapas/1', { waitUntil: 'networkidle' });
    const diarioActivo = await pe.locator('[data-diario="1"]').inputValue().catch(() => '');
    if (/ejemplo/.test(diarioActivo)) errors.push('el diario del viaje de ejemplo aparece en el viaje activo');
    // el resto de viajes del indice (el activo incluido) abren todas las vistas sin errores
    for (const vj of INDICE.viajes.filter((x) => x.id !== VIAJE_PRUEBA && x.id !== 'ejemplo')) {
      for (const v of vistas) {
        await pe.goto(RAIZ + `?viaje=${vj.id}#/${v}`, { waitUntil: 'networkidle' });
        const t = await pe.locator('#view').innerText();
        if (/undefined|NaN|\[object |No se pudo cargar/.test(t)) errors.push(`${vj.id} #/${v}: ${(t.match(/.{0,40}(undefined|NaN|\[object |No se pudo cargar).{0,30}/) || [''])[0]}`);
      }
      console.log(`viaje ${vj.id}:`, vistas.length, 'vistas sin errores');
    }
    console.log('plantilla (viajes/ejemplo):', vistas.length, 'vistas · cabecera', marca, '· claves', claveE.join(','));
    await ctxE.close();
  }
  // viaje por España y Portugal: horas de Portugal, gasolineras de la DGEG, pueblos de los dos paises,
  // informacion general en la Guia y radares solo en España. Y la raiz abre el viaje activo.
  const VF = '2027-01-fisterra', dirF = path.join(__dirname, '..', 'viajes', VF);
  if (fs.existsSync(path.join(dirF, 'viaje.json'))) {
    const planF = JSON.parse(fs.readFileSync(path.join(dirF, 'viaje.json'), 'utf8'));
    const gasF = JSON.parse(fs.readFileSync(path.join(dirF, 'gasolineras.json'), 'utf8'));
    const todasF = [].concat(...Object.values(gasF.por_dia));
    const d9 = planF.itinerario.find((d) => d.dia === 9);
    const t9 = JSON.parse(fs.readFileSync(path.join(dirF, d9.gpx.track), 'utf8'));
    const medio9 = t9.track[Math.floor(t9.track.length / 2)];
    const meteoUrls = [];
    const ctxP = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, locale: 'es-ES', timezoneId: 'Europe/Lisbon',
      permissions: ['geolocation'], geolocation: { latitude: medio9[0], longitude: medio9[1], accuracy: 15 } });
    await ctxP.route('https://api.open-meteo.com/**', (r) => { meteoUrls.push(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockMeteo(r.request().url())) }); });
    await ctxP.route('https://tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG1x1 }));
    await ctxP.route('https://sedeaplicaciones.minetur.gob.es/**', (r) => {
      const prov = r.request().url().match(/FiltroProvinciaProducto\/(\d+)\//);
      const lista = todasF.filter((s) => !/^PT-/.test(s.id) && (!prov || s.prov === prov[1])).map((s, i) => ({ IDEESS: s.id, PrecioProducto: (1.6 + (i % 7) / 100).toFixed(3).replace('.', ',') }));
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Fecha: '24/01/2027 8:00:00', ListaEESSPrecio: lista }) });
    });
    await ctxP.route('https://precoscombustiveis.dgeg.gov.pt/**', (r) => {
      const dist = new URL(r.request().url()).searchParams.get('idDistrito');
      const lista = todasF.filter((s) => s.prov === `PT-${dist}`).map((s, i) => ({ Id: +s.id.slice(3), Preco: `${(1.9 + (i % 5) / 100).toFixed(3).replace('.', ',')} €` }));
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: true, mensagem: 'sucesso', resultado: lista }) });
    });
    await ctxP.route('https://geocoding-api.open-meteo.com/**', (r) => {
      const q = new URL(r.request().url()).searchParams.get('name').toLowerCase();
      const all = [
        { name: 'Nazaré', admin1: 'Leiria', admin2: 'Nazaré', country_code: 'PT', latitude: 39.60289, longitude: -9.06836, population: 8993 },
        { name: 'Nazaré', admin1: 'Bahia', admin2: 'Nazaré', country_code: 'BR', latitude: -13.035, longitude: -39.015, population: 27000 },
        { name: 'Monsaraz', admin1: 'Évora', admin2: 'Reguengos de Monsaraz', country_code: 'PT', latitude: 38.4430, longitude: -7.3810, population: 800 },
      ];
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: all.filter((x) => x.name.toLowerCase().includes(q)) }) });
    });
    const pf = await ctxP.newPage();
    pf.on('pageerror', (e) => errors.push('pageerror(portugal): ' + e.message));
    const URLF = `${RAIZ}?viaje=${VF}`;
    const vistasF = ['resumen', 'etapas', ...planF.itinerario.map((d) => `etapas/${d.dia}`), 'noches', 'tiempo', 'listas', 'equipaje', 'guia', 'hoja', 'sos', 'buscar/peaje', 'ahora', 'pueblos', 'radares', 'gasolina'];
    for (const v of vistasF) {
      await pf.goto(`${URLF}#/${v}`, { waitUntil: 'networkidle' });
      const t = await pf.locator('#view').innerText();
      if (/undefined|NaN|\[object |No se pudo cargar/.test(t)) errors.push(`portugal #/${v}: ${(t.match(/.{0,40}(undefined|NaN|\[object |No se pudo cargar).{0,30}/) || [''])[0]}`);
    }
    const marcaF = await pf.locator('.brand-text strong').innerText();
    if (marcaF !== planF.proyecto.nombre_corto) errors.push('portugal: la cabecera no lleva el nombre del viaje: ' + marcaF);
    if (!meteoUrls.some((u) => /timezone=Europe%2FLisbon/.test(u)) || !meteoUrls.some((u) => /timezone=Europe%2FMadrid/.test(u))) errors.push('portugal: la meteo no se pide en hora de Portugal y de España');
    await pf.goto(`${URLF}#/etapas/2`, { waitUntil: 'networkidle' });
    const e2 = await pf.locator('#view').innerText();
    if (!/Cambias de hora/.test(e2) || !/\bPT\b/.test(e2)) errors.push('portugal: el día 2 no avisa del cambio de hora');
    if (!/Anochece a las \d\d:\d\d \(hora de Portugal\)/.test(e2)) errors.push('portugal: el ocaso del día 2 no va en hora de Portugal');
    const avisoD2 = await pf.evaluate(() => resumenDiaTexto(D.data.itinerario[1]));
    if (!/Salida \d\d:\d\d \(hora de España\) · llegada prevista \d\d:\d\d \(hora de Portugal\)/.test(avisoD2)) errors.push('portugal: el aviso a casa del día 2 no dice la hora de cada país: ' + avisoD2.split('\n')[2]);
    await pf.goto(`${URLF}#/etapas/3`, { waitUntil: 'networkidle' });
    await pf.waitForFunction(() => document.querySelectorAll('table.gas tr.barata').length === 1, null, { timeout: 15000 })
      .catch(() => errors.push('portugal: día 3 sin la gasolinera más barata (precios de la DGEG)'));
    const precioPT = await pf.evaluate(() => Object.keys(D.precios.precios).filter((k) => /^PT-/.test(k)).length);
    if (!precioPT) errors.push('portugal: sin precios de la DGEG');
    await pf.goto(`${URLF}#/etapas/5`, { waitUntil: 'networkidle' });
    await pf.waitForFunction(() => /En Portugal la app no tiene radares/.test(document.getElementById('view').innerText), null, { timeout: 10000 })
      .catch(() => errors.push('portugal: el día 5 no explica que no hay radares de Portugal'));
    await pf.goto(`${URLF}#/guia`, { waitUntil: 'networkidle' });
    const guiaF = await pf.locator('#view').innerText();
    if (!/Información del viaje/.test(guiaF) || !/Peajes/.test(guiaF)) errors.push('portugal: la Guía no trae la información del viaje');
    await pf.goto(`${URLF}#/noches`, { waitUntil: 'networkidle' });
    if (!/Ninguna reservada/.test(await pf.locator('#view').innerText())) errors.push('portugal: las noches se dan por reservadas');
    await pf.goto(`${URLF}#/pueblos`, { waitUntil: 'networkidle' });
    await pf.waitForFunction(() => !document.querySelector('.loading') && document.getElementById('pueblo-q'));
    await pf.fill('#pueblo-q', 'Nazaré'); await pf.click('#pueblo-form button');
    await pf.waitForFunction(() => /Está en la ruta|Desvío corto|Desvío largo|Fuera del viaje/.test(document.getElementById('view').innerText), null, { timeout: 10000 }).catch(() => errors.push('portugal: sin resultado para Nazaré'));
    const puF = await pf.locator('#view').innerText();
    if (!/está en la ruta/i.test(puF) || !/día 5/i.test(puF)) errors.push('portugal: Nazaré debería estar en la ruta del día 5');
    console.log('portugal:', vistasF.length, 'vistas · cabecera', marcaF, '· meteo', meteoUrls.length, 'peticiones · precios PT', precioPT, '· Nazaré', (puF.match(/Está en la ruta|Desvío corto/) || ['?'])[0]);
    // Ahora en un dia de Portugal, a mitad de etapa: llegada en hora portuguesa
    const pa = await ctxP.newPage();
    pa.on('pageerror', (e) => errors.push('pageerror(portugal ahora): ' + e.message));
    await pa.clock.install({ time: new Date(`${d9.fecha}T11:00:00Z`) });
    await pa.goto(`${URLF}#/ahora`, { waitUntil: 'networkidle' });
    await pa.click('[data-localizar]');
    await pa.waitForFunction(() => /quedan/i.test(document.getElementById('view').innerText), null, { timeout: 10000 }).catch(() => errors.push('portugal: Ahora sin llegada estimada'));
    const ahF = await pa.locator('#view').innerText();
    if (/fuera de la ruta/i.test(ahF)) errors.push('portugal: Ahora se cree fuera de la ruta');
    console.log('portugal ahora:', (ahF.match(/Llegada estimada[^\n]*\n[^\n]*\n[^\n]*/i) || [''])[0].replace(/\n/g, ' | '));
    // La raiz, sin ?viaje=, abre el viaje activo del indice
    await pf.goto(RAIZ + '#/resumen', { waitUntil: 'networkidle' });
    const activo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'viajes', INDICE.activo, 'viaje.json'), 'utf8'));
    const marcaA = await pf.locator('.brand-text strong').innerText();
    if (marcaA !== (activo.proyecto.nombre_corto || activo.proyecto.nombre)) errors.push('la raíz no abre el viaje activo: ' + marcaA);
    await ctxP.close();
  }
  await browser.close();
  const real = errors.filter((e) => !/open-meteo|tile\.openstreetmap/.test(e));
  console.log(real.length ? `\nERRORES (${real.length}):\n  ` + real.join('\n  ') : '\nSin errores');
  process.exit(real.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
