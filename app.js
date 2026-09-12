/* Viaje NX500 · app estática. Lee data/viaje.json (fuente de verdad) y guarda
   las marcas de checklist en localStorage. Sin dependencias ni build. */
'use strict';

const STORAGE_KEY = 'viaje-nx500-v3-checks';
const CONTACTOS_KEY = 'viaje-nx500-contactos'; // telefonos personales: solo en este dispositivo
const DIARIO_KEY = 'viaje-nx500-diario';     // notas por dia, solo en este dispositivo
const GASTOS_KEY = 'viaje-nx500-gastos';     // gastos por dia, solo en este dispositivo
const TEMA_KEY = 'viaje-nx500-tema';         // auto | light | dark
const D = { data: null, checks: loadChecks(), pos: null };
function lsGet(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch (e) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

/* ---------- utilidades ---------- */
function loadChecks() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { return {}; } }
function saveChecks() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(D.checks)); } catch (e) { /* sin almacenamiento */ } }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function daysBetween(a, b) { return Math.round((Date.UTC(...b.split('-').map((n, i) => i === 1 ? n - 1 : +n)) - Date.UTC(...a.split('-').map((n, i) => i === 1 ? n - 1 : +n))) / 86400000); }
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fmtFecha(iso) { const [, m, d] = iso.split('-'); return `${+d} ${MESES[+m - 1]}`; }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function human(key) { return cap(String(key).replace(/_/g, ' ')); }
function telLink(tel) { return `<a class="tel" href="tel:${esc(String(tel).replace(/\s+/g, ''))}">${esc(tel)}</a>`; }
function mapsSearch(q) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`; }
function mapsDir(q) { return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}&travelmode=driving`; }
/* Horas "HH:MM" o "HH:MM-HH:MM" (se usa el inicio) -> minutos desde medianoche. */
function horaMin(s) { const m = /(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function ahoraMin() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function fmtHM(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
/* Orto y ocaso (algoritmo NOAA simplificado, precision de ~2 min). Devuelve horas locales "HH:MM". */
function solDia(lat, lon, iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const n = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  const rad = Math.PI / 180;
  const calc = (rise) => {
    const lngH = lon / 15, t = n + ((rise ? 6 : 18) - lngH) / 24;
    const M = (0.9856 * t) - 3.289;
    let L = M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 282.634; L = (L + 360) % 360;
    let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad; RA = (RA + 360) % 360;
    RA += (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90); RA /= 15;
    const sinDec = 0.39782 * Math.sin(L * rad), cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(90.833 * rad) - (sinDec * Math.sin(lat * rad))) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null;
    let H = rise ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad; H /= 15;
    const T = H + RA - (0.06571 * t) - 6.622;
    const UT = (((T - lngH) % 24) + 24) % 24;
    const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + UT * 3600000);
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: (D.data && D.data.meteo && D.data.meteo.zona_horaria) || 'Europe/Madrid' });
  };
  return { orto: calc(true), ocaso: calc(false) };
}
function dots(n, max = 5) { return `<span class="dots d${n}" title="${n}/${max}">${'●'.repeat(n)}${'○'.repeat(max - n)}</span>`; }
function tipoInfo(t) { const m = t.startsWith('montaña'); return { icon: m ? '⛰️' : '☀️', cls: m ? 'mount' : 'hot', label: human(t) }; }
function list(items) { return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`; }
const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
function fmtEur(v, aprox) { return (aprox ? '≈ ' : '') + EUR.format(v); }
function fmtVal(k, v) {
  if (Array.isArray(v)) return esc(v.join(', '));
  if (typeof v === 'number') {
    if (/precio.*eur|_eur_/.test(k) || /_eur$/.test(k)) return fmtEur(v);
    if (k === 'altitud_m') return `${v} m`;
  }
  return esc(v);
}

/* ---------- checklists persistentes ---------- */
function checkItem(key, label, sub) {
  const on = !!D.checks[key];
  return `<label class="check${on ? ' done' : ''}"><input type="checkbox" data-key="${esc(key)}"${on ? ' checked' : ''}><span class="check-text">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></label>`;
}
function progress(keys) {
  const done = keys.filter((k) => D.checks[k]).length;
  const full = keys.length > 0 && done === keys.length;
  return `<span class="progress${full ? ' full' : ''}">${done}/${keys.length}</span>`;
}
function bar(keys) {
  const done = keys.filter((k) => D.checks[k]).length;
  const pct = keys.length ? Math.round((done / keys.length) * 100) : 0;
  return `<div class="bar"><i style="width:${pct}%"></i></div>`;
}
function confirmarKeys(dia) { const a = dia.alojamiento; return (a && a.pendiente_confirmar || []).map((t) => `confirmar|${dia.dia}|${t}`); }
/* Un elemento de lista puede ser un texto o { que, hecho }; los hechos cuentan como marcados. */
function itemObj(x) { return typeof x === 'string' ? { que: x } : x; }
function previaItems(g) { return D.data.checklist_previa[g].map(itemObj); }
function previaKeys() { const c = D.data.checklist_previa; return Object.keys(c).flatMap((g) => previaItems(g).map((t) => `previa|${g}|${t.que}`)); }
function marcarHechos() {
  const c = D.data.checklist_previa; let n = 0;
  Object.keys(c).forEach((g) => previaItems(g).forEach((t) => { if (t.hecho && !D.checks[`previa|${g}|${t.que}`]) { D.checks[`previa|${g}|${t.que}`] = true; n++; } }));
  (D.data.compras_pendientes || []).forEach((x) => { if (x.hecho && !D.checks[`compra|${x.que}`]) { D.checks[`compra|${x.que}`] = true; n++; } });
  if (n) saveChecks();
}

/* Telefonos personales guardados solo en el navegador, nunca en el repositorio. */
function contactosLocales() { try { return JSON.parse(localStorage.getItem(CONTACTOS_KEY)) || {}; } catch (e) { return {}; } }
function setContactoLocal(k, tel) {
  const c = contactosLocales();
  if (tel) c[k] = tel; else delete c[k];
  try { localStorage.setItem(CONTACTOS_KEY, JSON.stringify(c)); } catch (e) { /* sin almacenamiento */ }
}
/* Devuelve el contacto con el telefono local incorporado si lo hay. */
function contacto(k) {
  const c = D.data.contactos[k];
  if (c && typeof c === 'object' && c.local) { const tel = contactosLocales()[k]; return tel ? { ...c, telefono: tel } : c; }
  return c;
}

/* Un contacto puede ser un texto (telefono o "PENDIENTE: ...") o un objeto
   { nombre|compania, telefono, nota }. Sin telefono se muestra como pendiente. */
function contactoPendiente(c) { return typeof c === 'string' ? /^PENDIENTE/i.test(c) : !c.telefono; }
function contactoHTML(c) {
  if (typeof c === 'string') return contactoPendiente(c) ? `<span class="badge warn">Pendiente</span> <small>${esc(c.replace(/^PENDIENTE:\s*/i, ''))}</small>` : telLink(c);
  const quien = c.nombre || c.compania;
  const alt = c.telefonos_alternativos && c.telefonos_alternativos.length ? `<br><small>También: ${c.telefonos_alternativos.map(telLink).join(' · ')}</small>` : '';
  const pol = c.poliza_local ? contactosLocales()[`${c._k || 'seguro_asistencia'}:poliza`] : '';
  const nota = alt + (pol ? `<br><small>Póliza nº <b>${esc(pol)}</b> (guardada en este móvil)</small>` : '') + (c.nota ? `<br><small>${esc(c.nota.replace(/^PENDIENTE:\s*/i, ''))}</small>` : '');
  if (!c.telefono) return `${quien ? `<b>${esc(quien)}</b> ` : ''}<span class="badge warn">${c.local ? 'Sin guardar en este móvil' : 'Pendiente'}</span>${nota}`;
  return `${quien ? `${esc(quien)}: ` : ''}${telLink(c.telefono)}${nota}`;
}

/* Botones grandes de llamada: 112, casa, seguro y alojamiento de hoy o el proximo. */
function quickCalls() {
  const c = D.data.contactos, it = D.data.itinerario, today = todayISO();
  const btn = (icon, label, tel, sub, cls = '') => tel
    ? `<a class="call ${cls}" href="tel:${esc(String(tel).replace(/\s+/g, ''))}"><span class="call-icon">${icon}</span><b>${esc(label)}</b><small>${esc(sub || tel)}</small></a>`
    : `<span class="call pend"><span class="call-icon">${icon}</span><b>${esc(label)}</b><small>${esc(sub || 'Sin teléfono')}</small></span>`;
  const casa = contacto('en_casa'), seg = contacto('seguro_asistencia');
  const casaTel = typeof casa === 'string' ? (contactoPendiente(casa) ? null : casa) : casa.telefono;
  const segTel = typeof seg === 'string' ? (contactoPendiente(seg) ? null : seg) : seg.telefono;
  const hoy = it.find((d) => d.fecha === today && d.alojamiento);
  const prox = hoy || it.find((d) => d.fecha >= today && d.alojamiento) || null;
  const a = prox && prox.alojamiento;
  return `<div class="calls">
    <a class="call sos" href="#/sos"><span class="call-icon">🆘</span><b>Emergencia</b><small>112 · posición GPS · seguro</small></a>
    ${btn('🏠', typeof casa === 'string' ? 'En casa' : (casa.nombre || 'En casa'), casaTel, casaTel || (casa.local ? 'Añádelo en Contactos' : 'Pendiente'))}
    ${btn('🛡️', typeof seg === 'string' ? 'Seguro' : (seg.compania || 'Seguro'), segTel, segTel ? segTel : 'Teléfono pendiente')}
    ${a ? btn('🛏️', hoy ? 'Alojamiento de hoy' : `Noche ${prox.dia} · ${fmtFecha(prox.fecha)}`, a.telefono, a.nombre) : ''}
  </div>`;
}

/* ---------- meteo (Open-Meteo, sin clave) ---------- */
const METEO_KEY = 'viaje-nx500-meteo';
const METEO_TTL_MS = 3 * 60 * 60 * 1000; // refresco automatico cada 3 h
const METEO_API = 'https://api.open-meteo.com/v1/forecast';
const METEO_DAILY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max', 'precipitation_sum', 'wind_gusts_10m_max'];
D.meteo = { status: 'idle', fetched: null, byPoint: {}, error: null, lastTry: 0 };
const METEO_RETRY_MS = 60 * 1000; // no reintentar solo antes de 1 min tras un fallo

function meteoPoints() {
  const seen = {}; const out = [];
  D.data.itinerario.forEach((e) => (e.meteo_puntos || []).forEach((pt) => { const k = meteoKey(pt); if (!seen[k]) { seen[k] = true; out.push(pt); } }));
  return out;
}
function meteoKey(pt) { return `${pt.lat},${pt.lon}`; }
function meteoLoadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(METEO_KEY));
    if (c && c.byPoint) { D.meteo.byPoint = c.byPoint; D.meteo.fetched = c.fetched; D.meteo.status = 'ok'; }
  } catch (e) { /* sin cache */ }
}
function meteoStale() { return !D.meteo.fetched || (Date.now() - new Date(D.meteo.fetched).getTime()) > METEO_TTL_MS; }
async function meteoFetch(force) {
  if (D.meteo.status === 'loading') return;
  if (!force && (!meteoStale() || Date.now() - D.meteo.lastTry < METEO_RETRY_MS)) return;
  D.meteo.lastTry = Date.now();
  if (!navigator.onLine) { D.meteo.error = 'Sin conexión'; return; }
  const pts = meteoPoints(); if (!pts.length) return;
  D.meteo.status = 'loading'; D.meteo.error = null;
  const q = `latitude=${pts.map((p) => p.lat).join(',')}&longitude=${pts.map((p) => p.lon).join(',')}&daily=${METEO_DAILY.join(',')}&timezone=${encodeURIComponent(D.data.meteo.zona_horaria || 'Europe/Madrid')}&forecast_days=16`;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(`${METEO_API}?${q}`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const arr = Array.isArray(json) ? json : [json];
    const byPoint = {};
    arr.forEach((loc, i) => {
      const pt = pts[i]; if (!pt || !loc.daily) return;
      const days = {};
      loc.daily.time.forEach((date, j) => {
        days[date] = { code: loc.daily.weather_code[j], tmax: loc.daily.temperature_2m_max[j], tmin: loc.daily.temperature_2m_min[j], pprob: loc.daily.precipitation_probability_max[j], psum: loc.daily.precipitation_sum[j], gust: loc.daily.wind_gusts_10m_max[j] };
      });
      byPoint[meteoKey(pt)] = { nombre: pt.nombre, elev: loc.elevation, days };
    });
    D.meteo.byPoint = byPoint; D.meteo.fetched = new Date().toISOString(); D.meteo.status = 'ok';
    try { localStorage.setItem(METEO_KEY, JSON.stringify({ fetched: D.meteo.fetched, byPoint })); } catch (e) { /* sin almacenamiento */ }
  } catch (err) {
    D.meteo.status = Object.keys(D.meteo.byPoint).length ? 'ok' : 'error';
    D.meteo.error = err.name === 'AbortError' ? 'Tiempo de espera agotado' : (err instanceof TypeError ? 'Sin acceso a la red' : (err.message || 'Error de red'));
  }
  rerender('tiempo'); rerender('etapas'); rerender('resumen');
}
/* Re-pinta la vista actual conservando el scroll, solo si coincide con la vista (y dia) indicados.
   Las llamadas seguidas se agrupan en un unico repintado. */
let RERENDER_T = 0;
function rerender(view, dia) {
  const r = route();
  if (view && r.view !== view) return;
  if (dia != null && r.view === 'etapas' && String(r.arg) !== String(dia)) return;
  if (RERENDER_T) return;
  RERENDER_T = setTimeout(() => { RERENDER_T = 0; const y = window.scrollY; render(); window.scrollTo(0, y); }, 30);
}
/* Codigos WMO de Open-Meteo */
function wmo(code) {
  if (code === 0) return { icon: '☀️', label: 'Despejado' };
  if (code === 1) return { icon: '🌤️', label: 'Casi despejado' };
  if (code === 2) return { icon: '⛅', label: 'Nubes y claros' };
  if (code === 3) return { icon: '☁️', label: 'Cubierto' };
  if (code === 45 || code === 48) return { icon: '🌫️', label: 'Niebla' };
  if (code >= 51 && code <= 57) return { icon: '🌦️', label: 'Llovizna' };
  if (code >= 61 && code <= 67) return { icon: '🌧️', label: 'Lluvia' };
  if (code >= 71 && code <= 77) return { icon: '🌨️', label: 'Nieve' };
  if (code >= 80 && code <= 82) return { icon: '🌦️', label: 'Chubascos' };
  if (code >= 85 && code <= 86) return { icon: '🌨️', label: 'Chubascos de nieve' };
  if (code >= 95) return { icon: '⛈️', label: 'Tormenta' };
  return { icon: '❔', label: 'Sin dato' };
}
function meteoVerdictOne(w) {
  if (!w) return null;
  if (w.code >= 95 || w.pprob >= 70 || w.psum >= 8 || w.gust >= 70) return 'malo';
  if (w.pprob >= 40 || w.psum >= 2 || (w.code >= 51 && w.code <= 82) || w.gust >= 50) return 'regular';
  return 'bueno';
}
const VERDICT = { bueno: { cls: 'ok', txt: 'Buen tiempo', icon: '🟢' }, regular: { cls: 'warn', txt: 'Regular', icon: '🟠' }, malo: { cls: 'hot', txt: 'Mal tiempo', icon: '🔴' } };
function meteoDia(e) {
  const pts = (e.meteo_puntos || []).map((pt) => { const bp = D.meteo.byPoint[meteoKey(pt)]; return { pt, w: bp && bp.days[e.fecha] }; });
  const rank = { bueno: 0, regular: 1, malo: 2 };
  let worst = null;
  pts.forEach(({ w }) => { const v = meteoVerdictOne(w); if (v && (!worst || rank[v] > rank[worst])) worst = v; });
  const tmin = Math.min(...pts.filter((x) => x.w).map((x) => x.w.tmin));
  const tmax = Math.max(...pts.filter((x) => x.w).map((x) => x.w.tmax));
  return { pts, verdict: worst, tmin: isFinite(tmin) ? tmin : null, tmax: isFinite(tmax) ? tmax : null };
}
function fmtHace(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo'; if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60); if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
function meteoLinks(pt) {
  return `<a href="https://www.google.com/search?q=${encodeURIComponent('el tiempo en ' + pt.nombre)}" target="_blank" rel="noopener">Google</a> · <a href="https://www.windy.com/?${pt.lat},${pt.lon},9" target="_blank" rel="noopener">Windy</a>`;
}
function meteoPointRow(pt, w) {
  if (!w) return `<div class="wx-row"><span class="wx-icon">❔</span><div class="wx-main"><b>${esc(pt.nombre)}</b><small>Sin previsión todavía</small></div><small class="wx-links">${meteoLinks(pt)}</small></div>`;
  const k = wmo(w.code), v = meteoVerdictOne(w);
  return `<div class="wx-row wx-${v}">
    <span class="wx-icon" title="${k.label}">${k.icon}</span>
    <div class="wx-main"><b>${esc(pt.nombre)}</b><small>${k.label} · ${Math.round(w.tmin)}° / <b>${Math.round(w.tmax)}°</b></small></div>
    <div class="wx-nums"><span title="Probabilidad de lluvia">💧 ${w.pprob == null ? '–' : w.pprob + '%'}</span><span title="Lluvia acumulada">${w.psum == null ? '' : w.psum.toFixed(1) + ' mm'}</span><span title="Rachas máximas">💨 ${w.gust == null ? '–' : Math.round(w.gust) + ' km/h'}</span></div>
    <small class="wx-links">${meteoLinks(pt)}</small>
  </div>`;
}
function meteoStrip(e) {
  const m = meteoDia(e);
  if (!m.verdict) return '';
  const v = VERDICT[m.verdict];
  const avisos = [];
  if (m.tmin != null && m.tmin <= 8) avisos.push('Frío al salir: forro térmico');
  if (m.tmax != null && m.tmax >= 32) avisos.push('Calor: beber en cada parada');
  return `<div class="card wx-strip"><div class="card-title"><h3>Previsión</h3><span class="badge ${v.cls}">${v.icon} ${v.txt}</span></div>
    ${m.pts.map(({ pt, w }) => meteoPointRow(pt, w)).join('')}
    ${avisos.length ? `<div class="note">${avisos.map(esc).join(' · ')}</div>` : ''}
    ${meteoHorasHTML(e)}
    <p><small>${D.meteo.fetched ? `Actualizado ${fmtHace(D.meteo.fetched)}` : ''} · <a href="#/tiempo">Ver todos los días</a></small></p></div>`;
}

/* Prevision por horas de una etapa (solo cuando la fecha esta a menos de 16 dias). */
const METEO_H_KEY = 'viaje-nx500-meteo-horas';
const METEO_HOURLY = ['precipitation_probability', 'temperature_2m', 'weather_code', 'wind_gusts_10m'];
const HORA_INI = 7, HORA_FIN = 20; // franja que se pinta
D.meteoH = { byDay: {}, loading: {} };
function meteoHLoadCache() { try { const c = JSON.parse(localStorage.getItem(METEO_H_KEY)); if (c && typeof c === 'object') D.meteoH.byDay = c; } catch (e) { /* sin cache */ } }
function meteoHDisponible(e) { const n = daysBetween(todayISO(), e.fecha); return n >= 0 && n <= 15; }
async function meteoHorasFetch(e, force) {
  if (!meteoHDisponible(e) || !(e.meteo_puntos || []).length || D.meteoH.loading[e.dia]) return;
  const c = D.meteoH.byDay[e.dia];
  if (!force && c && c.fecha === e.fecha && (Date.now() - new Date(c.fetched).getTime()) < METEO_TTL_MS) return;
  if (!navigator.onLine) return;
  if (!force && c && c.lastTry && Date.now() - c.lastTry < METEO_RETRY_MS) return;
  D.meteoH.loading[e.dia] = true;
  const pts = e.meteo_puntos;
  const q = `latitude=${pts.map((p) => p.lat).join(',')}&longitude=${pts.map((p) => p.lon).join(',')}&hourly=${METEO_HOURLY.join(',')}&timezone=${encodeURIComponent(D.data.meteo.zona_horaria || 'Europe/Madrid')}&start_date=${e.fecha}&end_date=${e.fecha}`;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(`${METEO_API}?${q}`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json(); const arr = Array.isArray(json) ? json : [json];
    const out = { fecha: e.fecha, fetched: new Date().toISOString(), pts: [] };
    arr.forEach((loc, i) => {
      const pt = pts[i]; const h = loc.hourly; if (!pt || !h) return;
      const horas = h.time.map((tm, j) => ({ h: +tm.slice(11, 13), pp: h.precipitation_probability[j], t: h.temperature_2m[j], code: h.weather_code[j], gust: h.wind_gusts_10m[j] })).filter((x) => x.h >= HORA_INI && x.h <= HORA_FIN);
      out.pts.push({ nombre: pt.nombre, horas });
    });
    D.meteoH.byDay[e.dia] = out;
    try { localStorage.setItem(METEO_H_KEY, JSON.stringify(D.meteoH.byDay)); } catch (err) { /* sin almacenamiento */ }
  } catch (err) {
    D.meteoH.byDay[e.dia] = { ...(c || { fecha: e.fecha, pts: [] }), lastTry: Date.now(), error: err.message };
  }
  delete D.meteoH.loading[e.dia];
  rerender('etapas', e.dia);
}
/* Aviso de tormenta de tarde: probabilidad >= 40 % o tormenta entre las 13 y las 19 h en algun punto. */
function tormentaTarde(hd) {
  let peor = null;
  (hd.pts || []).forEach((p) => p.horas.forEach((x) => {
    if (x.h < 13 || x.h > 19) return;
    if (x.pp >= 40 || x.code >= 95) { if (!peor || x.h < peor.h) peor = { h: x.h, pp: x.pp, code: x.code, punto: p.nombre }; }
  }));
  return peor;
}
function meteoHorasHTML(e) {
  if (!meteoHDisponible(e)) return '';
  const hd = D.meteoH.byDay[e.dia];
  if (!hd || hd.fecha !== e.fecha || !hd.pts.length) { meteoHorasFetch(e, false); return hd && hd.error ? '' : `<p class="muted"><small>Cargando la previsión por horas…</small></p>`; }
  meteoHorasFetch(e, false); // refresca si esta caducada
  const filas = hd.pts.map((p) => `<div class="hrs-row"><b>${esc(p.nombre)}</b><div class="hrs">${p.horas.map((x) => {
    const v = x.pp >= 70 || x.code >= 95 ? 'malo' : x.pp >= 40 || (x.code >= 51 && x.code <= 82) ? 'regular' : 'bueno';
    return `<div class="hr hr-${v}" title="${x.h}:00 · ${wmo(x.code).label} · ${x.pp}% lluvia · ${Math.round(x.t)}° · rachas ${Math.round(x.gust)} km/h"><span class="hr-ico">${wmo(x.code).icon}</span><span class="hr-t">${Math.round(x.t)}°</span><span class="hr-bar"><i style="height:${Math.max(4, x.pp)}%"></i></span><span class="hr-pp">${x.pp}</span><span class="hr-h">${x.h}</span></div>`;
  }).join('')}</div></div>`).join('');
  const tt = tormentaTarde(hd);
  const llegada = horaMin(e.llegada_prevista);
  const aviso = tt ? `<div class="note"><b>⛈️ Lluvia o tormenta de tarde</b> desde las ${tt.h}:00 en ${esc(tt.punto)} (${tt.pp}%).${llegada != null && llegada >= tt.h * 60 ? ` La llegada prevista (${esc(e.llegada_prevista.split(' ')[0])}) cae dentro: salir antes o acortar.` : ' Llegas antes, según el plan.'}</div>` : '';
  return `<h4>Por horas · ${fmtFecha(e.fecha)}</h4>${filas}<p><small>Barra: probabilidad de lluvia (%). Temperatura en °C.</small></p>${aviso}`;
}

function viewTiempo() {
  const it = D.data.itinerario, mt = D.data.meteo, today = todayISO();
  if (D.meteo.status === 'idle' || (D.meteo.status === 'ok' && meteoStale())) meteoFetch(false);
  const hasData = Object.keys(D.meteo.byPoint).length > 0;
  let estado;
  if (D.meteo.status === 'loading' && !hasData) estado = '<span class="badge">Consultando…</span>';
  else if (hasData) estado = `<span class="badge ok">Actualizado ${fmtHace(D.meteo.fetched)}</span>${D.meteo.error ? ` <span class="badge warn">Sin refrescar: ${esc(D.meteo.error)}</span>` : ''}`;
  else estado = `<span class="badge warn">No disponible${D.meteo.error ? `: ${esc(D.meteo.error)}` : ''}</span>`;
  const dias = it.map((e) => {
    const m = meteoDia(e); const t = tipoInfo(e.tipo);
    const lejos = daysBetween(today, e.fecha) > 15;
    const v = m.verdict ? VERDICT[m.verdict] : null;
    return `<div class="card wx-day">
      <div class="card-title"><h3><a href="#/etapas/${e.dia}">Día ${e.dia} · ${cap(e.dia_semana)} ${fmtFecha(e.fecha)}</a></h3>${v ? `<span class="badge ${v.cls}">${v.icon} ${v.txt}</span>` : `<span class="badge">${lejos ? 'A más de 16 días' : 'Sin previsión'}</span>`}</div>
      <p class="muted">${t.icon} ${esc(e.origen)} → ${esc(e.destino)}</p>
      ${m.pts.map(({ pt, w }) => meteoPointRow(pt, w)).join('')}
    </div>`;
  }).join('');
  return `<div class="card accent"><div class="card-title"><h1>Tiempo en ruta</h1>${estado}</div>
      <p class="muted">Previsión diaria de ${esc(mt.proveedor.split(' (')[0])} para dos puntos de cada etapa. Se guarda en el móvil y se refresca sola cada 3 horas.</p>
      <p><button class="btn small" type="button" id="meteo-refresh"${D.meteo.status === 'loading' ? ' disabled' : ''}>Actualizar ahora</button> <a class="btn small" href="${esc(mt.enlaces.aemet)}" target="_blank" rel="noopener">AEMET</a> <a class="btn small" href="${esc(mt.enlaces.windy)}" target="_blank" rel="noopener">Windy</a></p>
      ${!hasData && D.meteo.status === 'error' ? `<div class="note">No se ha podido consultar la previsión desde aquí. Usa los enlaces de cada punto o abre la app publicada en GitHub Pages.</div>` : ''}
    </div>
    <div class="note info"><b>Regla:</b> ${esc(mt.regla)}</div>
    ${dias}
    <details class="card"><summary>Cómo se califica cada día</summary><dl><dt>🔴 Mal tiempo</dt><dd>${esc(mt.criterio.malo)}</dd><dt>🟠 Regular</dt><dd>${esc(mt.criterio.regular)}</dd><dt>🟢 Buen tiempo</dt><dd>${esc(mt.criterio.bueno)}</dd></dl><p><small>${esc(mt.nota_coordenadas)}</small></p></details>`;
}

/* Pago de un alojamiento: { total_eur, pagado_eur, pendiente_eur, donde } */
function pagoInfo(a) {
  const pg = a && a.pago; if (!pg) return null;
  return { ...pg, pendiente: (pg.pendiente_eur || 0) > 0 };
}
function estadoBadge(a) {
  const pg = pagoInfo(a);
  if (pg && pg.pendiente) return `<span class="badge warn">Pendiente ${fmtEur(pg.pendiente_eur, pg.aproximado)}</span>`;
  return `<span class="badge ok">${pg ? 'Pagado' : esc(a.estado)}</span>`;
}
function pagoHTML(a) {
  const pg = pagoInfo(a); if (!pg) return '';
  return `<dt>Pago</dt><dd>${pg.pendiente ? `<b>${fmtEur(pg.pendiente_eur, pg.aproximado)} pendientes</b> · ${esc(pg.donde)}${pg.pagado_eur ? `<br><small>Pagados ${fmtEur(pg.pagado_eur, pg.aproximado)} de ${fmtEur(pg.total_eur, pg.aproximado)}</small>` : ''}${pg.nota ? `<br><small>${esc(pg.nota)}</small>` : ''}` : `Pagado por completo (${fmtEur(pg.total_eur)})`}</dd>`;
}
function pagoKey(dia) { return `pago|${dia.dia}|${dia.alojamiento.nombre}`; }
function nochesPendientes() { return D.data.itinerario.filter((e) => { const pg = pagoInfo(e.alojamiento); return pg && pg.pendiente; }); }

/* ---------- rutas GPX (track ligero generado con tools/gpx2json.py) ---------- */
D.tracks = {};  // dia -> { status, data }
function trackLoad(e) {
  if (!e.gpx || !e.gpx.track) return;
  const t = D.tracks[e.dia];
  if (t && (t.status === 'ok' || t.status === 'loading')) return;
  if (window.VIAJE_TRACKS && window.VIAJE_TRACKS[e.dia]) { D.tracks[e.dia] = { status: 'ok', data: window.VIAJE_TRACKS[e.dia] }; return; }
  D.tracks[e.dia] = { status: 'loading' };
  fetch(e.gpx.track).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((data) => { D.tracks[e.dia] = { status: 'ok', data }; })
    .catch((err) => { D.tracks[e.dia] = { status: 'error', error: err.message }; })
    .then(() => { rerender('etapas', e.dia); rerender('guia'); rerender('hoja'); });
}
function trackLoadP(e) {
  if (!e.gpx || !e.gpx.track) return Promise.resolve(null);
  const t = D.tracks[e.dia];
  if (t && t.status === 'ok') return Promise.resolve(t.data);
  if (window.VIAJE_TRACKS && window.VIAJE_TRACKS[e.dia]) { D.tracks[e.dia] = { status: 'ok', data: window.VIAJE_TRACKS[e.dia] }; return Promise.resolve(D.tracks[e.dia].data); }
  if (!t || t.status !== 'loading') D.tracks[e.dia] = { status: 'loading' };
  return new Promise((resolve) => {
    const wait = () => { const s = D.tracks[e.dia]; if (s && s.status !== 'loading') resolve(s.status === 'ok' ? s.data : null); else setTimeout(wait, 80); };
    if (!t || t.status !== 'loading') {
      fetch(e.gpx.track).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((data) => { D.tracks[e.dia] = { status: 'ok', data }; })
        .catch((err) => { D.tracks[e.dia] = { status: 'error', error: err.message }; })
        .then(wait);
    } else wait();
  });
}
function tracksLoadAll() { return Promise.all(D.data.itinerario.map(trackLoadP)); }
const DIA_COLORS = ['#1d5fa5', '#c2410c', '#1f8a4c', '#7c3aed', '#b2600a', '#0e7490', '#be123c', '#4d7c0f', '#6d28d9', '#b45309', '#0369a1'];
function fmtMin(min) { if (min == null) return '–'; const h = Math.floor(min / 60), m = min % 60; return `${h}h${String(m).padStart(2, '0')}`; }
function fmtKm(km) { return `${km.toLocaleString('es-ES', { maximumFractionDigits: 1 })} km`; }
function fmtM(m) { return m == null ? '–' : `${Math.round(m).toLocaleString('es-ES')} m`; }

/* Croquis del recorrido: proyeccion equirectangular sobre el bbox. */
function trackSketch(t) {
  const [la0, lo0, la1, lo1] = t.bbox;
  const kx = Math.cos(((la0 + la1) / 2) * Math.PI / 180);
  const w = (lo1 - lo0) * kx, h = (la1 - la0);
  const W = 600, H = Math.max(160, Math.min(320, Math.round(W * h / (w || 1))));
  const pad = 18;
  const sx = (W - 2 * pad) / (w || 1), sy = (H - 2 * pad) / (h || 1), sc = Math.min(sx, sy);
  const ox = pad + ((W - 2 * pad) - w * sc) / 2, oy = pad + ((H - 2 * pad) - h * sc) / 2;
  const X = (lon) => (ox + (lon - lo0) * kx * sc).toFixed(1), Y = (lat) => (oy + (la1 - lat) * sc).toFixed(1);
  const pts = t.track.map(([la, lo]) => `${X(lo)},${Y(la)}`).join(' ');
  t._proj = { ox, oy, sc, kx, lo0, la1 }; // para situar el punto del perfil sobre el croquis
  const vias = t.vias.filter((v) => v.tipo !== 'shaping');
  const marks = vias.map((v, i) => {
    const cls = v.tipo === 'start' ? 'ini' : v.tipo === 'destination' ? 'fin' : 'via';
    const label = v.tipo === 'start' ? 'S' : v.tipo === 'destination' ? 'F' : String(i);
    return `<g class="sk-${cls}"><circle cx="${X(v.lon)}" cy="${Y(v.lat)}" r="${cls === 'via' ? 7 : 8}"></circle><text x="${X(v.lon)}" y="${(+Y(v.lat) + 3.2).toFixed(1)}" text-anchor="middle">${label}</text></g>`;
  }).join('');
  return `<svg class="sketch" viewBox="0 0 ${W} ${H}" role="img" aria-label="Croquis del recorrido"><polyline points="${pts}"></polyline>${marks}<g class="sk-hover" hidden><circle r="9"></circle><circle r="4"></circle></g></svg>`;
}

/* Perfil de altitud: una serie, area + linea, rejilla ligera, etiqueta del maximo y tooltip. */
function trackProfile(t) {
  if (!t.perfil || !t.perfil.length) return '';
  const W = 600, H = 190, L = 44, R = 10, T = 18, B = 26;
  const kmMax = t.perfil[t.perfil.length - 1][0];
  const eMin = Math.floor((t.alt_min_m || 0) / 100) * 100, eMax = Math.ceil((t.alt_max_m || 100) / 100) * 100;
  const X = (km) => L + (km / kmMax) * (W - L - R), Y = (m) => T + (1 - (m - eMin) / (eMax - eMin || 1)) * (H - T - B);
  const line = t.perfil.map(([k, m]) => `${X(k).toFixed(1)},${Y(m).toFixed(1)}`).join(' ');
  const area = `M${X(0).toFixed(1)},${Y(eMin).toFixed(1)} L${line.replace(/ /g, ' L')} L${X(kmMax).toFixed(1)},${Y(eMin).toFixed(1)} Z`;
  const yStep = (eMax - eMin) > 1500 ? 500 : (eMax - eMin) > 600 ? 250 : 100;
  let ys = ''; for (let m = eMin; m <= eMax; m += yStep) ys += `<line x1="${L}" x2="${W - R}" y1="${Y(m).toFixed(1)}" y2="${Y(m).toFixed(1)}"></line><text x="${L - 6}" y="${(Y(m) + 3.5).toFixed(1)}" text-anchor="end">${m.toLocaleString('es-ES')}</text>`;
  const xStep = kmMax > 200 ? 50 : kmMax > 80 ? 25 : 10;
  let xs = ''; for (let k = 0; k <= kmMax; k += xStep) xs += `<text x="${X(k).toFixed(1)}" y="${H - 8}" text-anchor="middle">${k}</text>`;
  let iMax = 0; t.perfil.forEach((p, i) => { if (p[1] > t.perfil[iMax][1]) iMax = i; });
  const pm = t.perfil[iMax];
  const lx = X(pm[0]), anchor = lx > W - 90 ? 'end' : lx < L + 60 ? 'start' : 'middle';
  return `<svg class="perfil" viewBox="0 0 ${W} ${H}" role="img" aria-label="Perfil de altitud" data-kmmax="${kmMax}" data-l="${L}" data-r="${R}">
    <g class="grid">${ys}</g><g class="axis">${xs}<text x="${W - R}" y="${H - 8}" text-anchor="end" class="unit">km</text><text x="${L - 6}" y="${T - 6}" text-anchor="end" class="unit">m</text></g>
    <path class="area" d="${area}"></path><polyline class="line" points="${line}"></polyline>
    <g class="max"><circle cx="${lx.toFixed(1)}" cy="${Y(pm[1]).toFixed(1)}" r="4"></circle><text x="${lx.toFixed(1)}" y="${(Y(pm[1]) - 9).toFixed(1)}" text-anchor="${anchor}">${pm[1].toLocaleString('es-ES')} m · km ${pm[0].toLocaleString('es-ES', { maximumFractionDigits: 1 })}</text></g>
    <g class="hover" hidden><line y1="${T}" y2="${H - B}"></line><circle r="4.5"></circle><text></text></g>
    <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"></rect>
  </svg>`;
}
function trackCum(t) {
  if (t._cum) return t._cum;
  const R = 6371, rad = Math.PI / 180; const cum = [0];
  for (let i = 1; i < t.track.length; i++) {
    const [a1, o1] = t.track[i - 1], [a2, o2] = t.track[i];
    const x = Math.sin((a2 - a1) * rad / 2) ** 2 + Math.cos(a1 * rad) * Math.cos(a2 * rad) * Math.sin((o2 - o1) * rad / 2) ** 2;
    cum.push(cum[i - 1] + 2 * R * Math.asin(Math.sqrt(x)));
  }
  t._cum = cum; return cum;
}
/* Situa sobre el croquis el punto del track que esta a la fraccion f (0-1) del recorrido. */
function sketchMark(t, f) {
  const svg = document.querySelector('svg.sketch'); const g = svg && svg.querySelector('.sk-hover'); if (!g || !t._proj) return;
  if (f == null) { g.hidden = true; return; }
  const cum = trackCum(t); const target = f * cum[cum.length - 1];
  let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < target) lo = m + 1; else hi = m; }
  const [la, ln] = t.track[lo]; const P = t._proj;
  const x = (P.ox + (ln - P.lo0) * P.kx * P.sc).toFixed(1), y = (P.oy + (P.la1 - la) * P.sc).toFixed(1);
  g.hidden = false; g.querySelectorAll('circle').forEach((c) => { c.setAttribute('cx', x); c.setAttribute('cy', y); });
}
/* Pinta en el perfil el punto a km dados (y lo refleja en el croquis). */
function profileShowKm(t, km) {
  const svg = document.querySelector('svg.perfil'); if (!svg) return;
  const g = svg.querySelector('.hover');
  if (km == null) { g.hidden = true; sketchMark(t, null); return; }
  const W = 600, L = +svg.dataset.l, R = +svg.dataset.r, kmMax = +svg.dataset.kmmax;
  let best = 0; t.perfil.forEach((p, i) => { if (Math.abs(p[0] - km) < Math.abs(t.perfil[best][0] - km)) best = i; });
  const p = t.perfil[best]; const H = 190, T = 18, B = 26;
  const eMin = Math.floor((t.alt_min_m || 0) / 100) * 100, eMax = Math.ceil((t.alt_max_m || 100) / 100) * 100;
  const x = L + (p[0] / kmMax) * (W - L - R), y = T + (1 - (p[1] - eMin) / (eMax - eMin || 1)) * (H - T - B);
  g.hidden = false; g.querySelector('line').setAttribute('x1', x); g.querySelector('line').setAttribute('x2', x);
  const c = g.querySelector('circle'); c.setAttribute('cx', x); c.setAttribute('cy', y);
  sketchMark(t, kmMax ? p[0] / kmMax : 0);
  const tx = g.querySelector('text'); tx.textContent = `km ${p[0].toLocaleString('es-ES', { maximumFractionDigits: 1 })} · ${p[1].toLocaleString('es-ES')} m`; tx.setAttribute('x', x > W - 110 ? x - 8 : x + 8); tx.setAttribute('y', T + 12); tx.setAttribute('text-anchor', x > W - 110 ? 'end' : 'start');
}
function trackActual() {
  const e = D.data && D.data.itinerario.find((d) => String(d.dia) === String(route().arg)); const st = e && D.tracks[e.dia];
  return st && st.status === 'ok' ? st.data : null;
}
/* Raton o dedo sobre el perfil: punto en el perfil y en el croquis. */
function profileHover(ev) {
  const svg = ev.target.closest('svg.perfil'); if (!svg) return;
  const t = trackActual(); if (!t) return;
  if (ev.type === 'pointerleave') { profileShowKm(t, null); return; }
  const rect = svg.getBoundingClientRect(); const W = 600, L = +svg.dataset.l, R = +svg.dataset.r, kmMax = +svg.dataset.kmmax;
  const xv = (ev.clientX - rect.left) / rect.width * W;
  profileShowKm(t, Math.max(0, Math.min(kmMax, (xv - L) / (W - L - R) * kmMax)));
}
/* Raton o dedo sobre el croquis: busca el punto del track mas cercano y lo lleva al perfil. */
function sketchHover(ev) {
  const svg = ev.target.closest('svg.sketch'); if (!svg) return;
  const t = trackActual(); if (!t || !t._proj) return;
  if (ev.type === 'pointerleave') { profileShowKm(t, null); return; }
  const rect = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal;
  const x = (ev.clientX - rect.left) / rect.width * vb.width, y = (ev.clientY - rect.top) / rect.height * vb.height;
  const P = t._proj; let best = -1, bd = Infinity;
  t.track.forEach(([la, ln], i) => { const px = P.ox + (ln - P.lo0) * P.kx * P.sc, py = P.oy + (P.la1 - la) * P.sc; const d = (px - x) ** 2 + (py - y) ** 2; if (d < bd) { bd = d; best = i; } });
  if (best < 0 || bd > 30 * 30) { profileShowKm(t, null); return; }
  const cum = trackCum(t); const kmMax = t.perfil[t.perfil.length - 1][0];
  profileShowKm(t, cum[best] / cum[cum.length - 1] * kmMax);
}
document.addEventListener('pointermove', (ev) => { profileHover(ev); sketchHover(ev); });
document.addEventListener('pointerleave', (ev) => { profileHover(ev); sketchHover(ev); }, true);

/* Nombre de un punto de ruta: salida, destino, o el nombre de e.gpx.vias por orden de via. */
function viaNombre(e, v, idxVia) {
  if (v.tipo === 'start') return 'Salida';
  if (v.tipo === 'destination') return 'Destino';
  const nombres = (e.gpx && e.gpx.vias) || [];
  return nombres[idxVia - 1] || v.nombre.replace('Via Point', 'Vía');
}
function rutaHTML(e) {
  if (!e.gpx) return '';
  const st = D.tracks[e.dia];
  if (!st || st.status === 'loading') { trackLoad(e); return `<h2>Ruta GPX</h2><div class="card"><p class="muted">Cargando la ruta…</p></div>`; }
  if (st.status === 'error') return `<h2>Ruta GPX</h2><div class="card warn"><p>No se pudo cargar el track (${esc(st.error)}).</p><p class="row">${kurvigerBtns(e)} <a class="btn small" href="${esc(e.gpx.archivo)}" download>Descargar GPX</a></p></div>`;
  const t = st.data;
  const vias = t.vias.filter((v) => v.tipo !== 'shaping');
  const diffKm = t.km - e.km_aprox;
  return `<h2>Ruta GPX</h2>
    <div class="card ruta">
      <div class="card-title"><h3>${esc((e.gpx.kurviger && e.gpx.kurviger.nombre) || t.nombre)}</h3><span class="badge">${esc(t.fuente)}</span></div>
      ${e.gpx.kurviger ? `<p class="row">${kurvigerBtns(e)}</p>` : ''}
      ${trackSketch(t)}
      <h4>Perfil de altitud</h4>
      ${trackProfile(t)}
      <div class="statgrid">
        <div class="stat"><small>Distancia (GPX)</small><b>${fmtKm(t.km)}</b><small>Plan: ${e.km_aprox} km${Math.abs(diffKm) >= 5 ? ` (${diffKm > 0 ? '+' : ''}${Math.round(diffKm)})` : ''}</small></div>
        <div class="stat"><small>Tiempo Kurviger</small><b>${fmtMin(t.duracion_min)}</b><small>Plan: ${esc(e.tiempo_real_aprox)} reales</small></div>
        ${e.gpx.kurviger ? `<div class="stat"><small>Kurviger Cloud ${fmtFecha(e.gpx.kurviger.exportado)}</small><b>${fmtKm(e.gpx.kurviger.km)} · ${fmtMin(e.gpx.kurviger.duracion_min)}</b><small>${e.gpx.kurviger.waypoints} puntos · perfil ${esc(e.gpx.kurviger.perfil)}${Math.abs(e.gpx.kurviger.duracion_min - (t.duracion_min || 0)) >= 15 ? ` · ${e.gpx.kurviger.duracion_min > t.duracion_min ? '+' : '−'}${fmtMin(Math.abs(e.gpx.kurviger.duracion_min - t.duracion_min))} respecto al GPX` : ''}</small></div>` : ''}
        <div class="stat"><small>Desnivel</small><b>+${fmtM(t.subida_m)}</b><small>−${fmtM(t.bajada_m)}</small></div>
        <div class="stat"><small>Altitud</small><b>${fmtM(t.alt_max_m)}</b><small>mín. ${fmtM(t.alt_min_m)}</small></div>
      </div>
      <h4>Puntos de la ruta (${vias.length})</h4>
      <div class="tbl-wrap"><table class="vias"><thead><tr><th>#</th><th>Punto</th><th>km</th><th></th></tr></thead><tbody>${vias.map((v, i) => `<tr><td>${v.tipo === 'start' ? 'S' : v.tipo === 'destination' ? 'F' : i}</td><td>${esc(viaNombre(e, v, i))}</td><td>${v.km.toLocaleString('es-ES', { minimumFractionDigits: 1 })}</td><td><a href="${mapsSearch(`${v.lat},${v.lon}`)}" target="_blank" rel="noopener">mapa ↗</a></td></tr>`).join('')}</tbody></table></div>
      <p class="row">
        ${window.VIAJE_DATA ? '' : `<button class="btn${e.gpx.kurviger ? '' : ' primary'}" type="button" data-mapa="${e.dia}">🗺️ Mapa interactivo</button>`}
        <a class="btn" href="${esc(e.gpx.archivo)}" download>⬇️ Descargar GPX</a>
        <a class="btn" href="${mapsSearch(`${t.track[0][0]},${t.track[0][1]}`)}" target="_blank" rel="noopener">Inicio en Maps ↗</a>
      </p>
      ${e.gpx.nota ? `<p><small>${esc(e.gpx.nota)}</small></p>` : ''}
      <p><small>Los ${t.puntos_track_original.toLocaleString('es-ES')} puntos del GPX se muestran simplificados a ${t.track.length}. Para navegar, importa el GPX original en Kurviger.</small></p>
    </div>`;
}

/* Mapa interactivo (Leaflet + OpenStreetMap, se carga solo al abrirlo). */
let LMAP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet/leaflet.css'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = 'vendor/leaflet/leaflet.js'; js.onload = resolve; js.onerror = () => reject(new Error('No se pudo cargar el mapa')); document.head.appendChild(js);
  });
}
function mapaBase() {
  if (LMAP) { LMAP.remove(); LMAP = null; }
  LMAP = L.map('mapa-lienzo', { zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(LMAP);
  return LMAP;
}
function mapaAbrirCaja(titulo) {
  const box = document.getElementById('mapa'); box.hidden = false; document.body.classList.add('mapa-abierto');
  document.getElementById('mapa-titulo').textContent = titulo;
}
/* Mapa del viaje completo: los 11 tracks, cada dia de un color, con las noches marcadas. */
async function openMapTodos() {
  mapaAbrirCaja('Viaje completo · cargando…');
  try { await loadLeaflet(); } catch (err) { closeMap(); alert(err.message); return; }
  const tracks = await tracksLoadAll();
  if (document.getElementById('mapa').hidden) return;
  mapaBase();
  const it = D.data.itinerario; const bounds = [];
  it.forEach((e, i) => {
    const t = tracks[i]; if (!t) return;
    const color = DIA_COLORS[i % DIA_COLORS.length];
    const line = L.polyline(t.track, { color, weight: 4, opacity: .85 }).addTo(LMAP).bindTooltip(`Día ${e.dia} · ${fmtFecha(e.fecha)} · ${esc(e.origen)} → ${esc(e.destino)} · ${fmtKm(t.km)}`, { sticky: true });
    line.on('click', () => { closeMap(); location.hash = `#/etapas/${e.dia}`; });
    bounds.push(line.getBounds());
    // Salidas que coinciden con otra anterior (bucles desde la misma base) se desplazan un poco para que se vean.
    const ini = t.track[0];
    const repes = it.slice(0, i).filter((d) => { const s = tracks[it.indexOf(d)]; return s && Math.abs(s.track[0][0] - ini[0]) < 0.01 && Math.abs(s.track[0][1] - ini[1]) < 0.01; }).length;
    L.marker(ini, { zIndexOffset: 1000, icon: L.divIcon({ className: 'via-icon via-dia', html: `<span style="background:${color}">${e.dia}</span>`, iconSize: [24, 24], iconAnchor: [12 - repes * 26, 12] }) }).addTo(LMAP).bindTooltip(`Salida día ${e.dia}: ${esc(e.origen)}`);
    const noche = D.data.alojamientos_resumen.find((n) => n.fecha === e.fecha);
    if (noche) {
      const fin = t.track[t.track.length - 1];
      L.marker(fin, { zIndexOffset: 500, icon: L.divIcon({ className: 'via-icon via-noche', html: '<span>🛏️</span>', iconSize: [24, 24], iconAnchor: [-4, 28] }) }).addTo(LMAP).bindTooltip(`Noche ${noche.noche} · ${esc(noche.lugar)}: ${esc(noche.alojamiento)}`);
    }
  });
  posMarker();
  document.getElementById('mapa-titulo').textContent = `Viaje completo · ${it.length} etapas · ${D.data.proyecto.distancia_total_aprox_km} km`;
  if (bounds.length) LMAP.fitBounds(bounds.reduce((a, b) => a.extend(b)), { padding: [24, 24] });
  setTimeout(() => LMAP && LMAP.invalidateSize(), 50);
}
async function openMap(dia) {
  if (dia === 'todos') return openMapTodos();
  const e = D.data.itinerario.find((d) => String(d.dia) === String(dia)); const st = e && D.tracks[e.dia]; if (!st || st.status !== 'ok') return;
  const t = st.data;
  mapaAbrirCaja(`Día ${e.dia} · ${t.nombre}`);
  try { await loadLeaflet(); } catch (err) { closeMap(); alert(err.message); return; }
  mapaBase();
  const line = L.polyline(t.track, { color: '#1d5fa5', weight: 4, opacity: .9 }).addTo(LMAP);
  t.vias.filter((v) => v.tipo !== 'shaping').forEach((v, i) => {
    const label = v.tipo === 'start' ? 'S' : v.tipo === 'destination' ? 'F' : String(i);
    const icon = L.divIcon({ className: `via-icon via-${v.tipo}`, html: `<span>${label}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] });
    L.marker([v.lat, v.lon], { icon }).addTo(LMAP).bindTooltip(`${viaNombre(e, v, i)} · km ${v.km}`);
  });
  (e.meteo_puntos || []).forEach((p) => L.circleMarker([p.lat, p.lon], { radius: 6, color: '#b2600a', fillColor: '#f0a94a', fillOpacity: .9, weight: 2 }).addTo(LMAP).bindTooltip(`Previsión: ${p.nombre}`));
  (e.gpx.avisos || []).filter((a) => a.lat != null).forEach((a) => L.marker([a.lat, a.lon], { icon: L.divIcon({ className: 'via-icon via-aviso', html: '<span>🔁</span>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(LMAP).bindTooltip(`${a.lugar} (km ${a.km}): ${a.que}`));
  posMarker();
  LMAP.fitBounds(line.getBounds(), { padding: [24, 24] });
  setTimeout(() => LMAP && LMAP.invalidateSize(), 50);
}
function posMarker() {
  if (!LMAP || !D.pos) return;
  L.circle([D.pos.lat, D.pos.lon], { radius: D.pos.acc, color: '#1d5fa5', weight: 1, fillOpacity: .1 }).addTo(LMAP);
  L.marker([D.pos.lat, D.pos.lon], { zIndexOffset: 2000, icon: L.divIcon({ className: 'via-icon via-yo', html: '<span>📍</span>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(LMAP).bindTooltip('Estoy aquí');
}
function closeMap() { document.getElementById('mapa').hidden = true; document.body.classList.remove('mapa-abierto'); if (LMAP) { LMAP.remove(); LMAP = null; } }

/* Decisiones abiertas de una etapa: cada opcion con sus alternativas. */
function opcionesHTML(e) {
  const ops = e.opciones; if (!ops || !ops.length) return '';
  return `<h2>Decisiones del día</h2>
    ${ops.map((o) => `<div class="card opcion">
      <div class="card-title"><h3>${esc(o.titulo)}</h3><span class="badge ${/pendiente|decidir/i.test(o.estado) ? 'warn' : 'ok'}">${esc(o.estado)}</span></div>
      ${o.cuando ? `<p class="muted"><small>${esc(o.cuando)}</small></p>` : ''}
      <div class="alts">${(o.alternativas || []).map((a) => `<div class="alt">
          <b>${esc(a.nombre)}</b>
          <span class="alt-coste">${esc(a.coste)}</span>
          <p>${esc(a.por_que)}</p>
          ${a.como ? `<small><b>En Kurviger:</b> ${esc(a.como)}</small>` : ''}
        </div>`).join('')}</div>
    </div>`).join('')}`;
}

/* ---------- guia turistica por etapa ---------- */
const POI_ICON = { mirador: '🔭', monumento: '🏰', naturaleza: '🌲', pueblo: '🏘️', cafe: '☕', comida: '🍽️', paseo: '🚶' };
function guiaHTML(e) {
  const g = e.guia; if (!g) return '';
  const ver = (g.ver || []).map((v) => `<div class="poi${v.opcional ? ' opcional' : ''}">
      <span class="poi-icon" aria-hidden="true">${POI_ICON[v.tipo] || '📍'}</span>
      <div class="poi-body">
        <div class="poi-head"><b>${esc(v.lugar)}</b>${v.opcional ? '<span class="badge">Opcional</span>' : ''}${v.tiempo ? `<span class="poi-time">⏱ ${esc(v.tiempo)}</span>` : ''}</div>
        <p>${esc(v.que)}</p>
        <small><a href="${mapsSearch(v.lugar)}" target="_blank" rel="noopener">Ver en el mapa ↗</a></small>
      </div></div>`).join('');
  const c = g.comer;
  return `<h2 id="guia">Guía del día</h2>
    <div class="card guia">
      <p class="lead">${esc(g.resumen)}</p>
      <h4>Qué ver y dónde parar</h4>
      <div class="poi-list">${ver}</div>
      ${c ? `<h4>Qué comer</h4><p>${esc(c.donde)}</p><ul class="platos">${(c.platos || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${c.nota ? `<p><small>${esc(c.nota)}</small></p>` : ''}` : ''}
      ${g.tarde ? `<h4>La tarde</h4><p>${esc(g.tarde)}</p>` : ''}
      ${g.consejo ? `<div class="note info"><b>Consejo:</b> ${esc(g.consejo)}</div>` : ''}
    </div>`;
}

/* ---------- posicion GPS: donde estoy respecto a la etapa ---------- */
function geoGet() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Este navegador no tiene GPS')); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      D.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() }; resolve(D.pos);
    }, (err) => reject(new Error(err.code === 1 ? 'Permiso de ubicación denegado' : err.code === 2 ? 'Sin señal GPS' : 'Tiempo de espera del GPS agotado')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}
function havKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const x = Math.sin((b[0] - a[0]) * rad / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin((b[1] - a[1]) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
/* Situa una posicion sobre el track de una etapa: km recorrido, distancia a la ruta, siguiente via y km restantes. */
function posEnEtapa(t, pos) {
  let best = 0, bd = Infinity;
  t.track.forEach((p, i) => { const d = havKm([pos.lat, pos.lon], p); if (d < bd) { bd = d; best = i; } });
  const cum = trackCum(t); const total = cum[cum.length - 1];
  const km = cum[best] / total * t.km;
  const vias = t.vias.filter((v) => v.tipo !== 'shaping');
  const next = vias.find((v) => v.km > km + 0.3);
  return { km, dist: bd, restante: Math.max(0, t.km - km), next, idxNext: next ? vias.indexOf(next) : -1, pct: Math.round(km / t.km * 100) };
}
function cercaLinks(pos) {
  const q = (what) => `https://www.google.com/maps/search/${encodeURIComponent(what)}/@${pos.lat},${pos.lon},13z`;
  return `<a class="btn small" href="${q('gasolinera')}" target="_blank" rel="noopener">⛽ Gasolinera</a> <a class="btn small" href="${q('taller motos')}" target="_blank" rel="noopener">🔧 Taller de motos</a> <a class="btn small" href="${q('centro de salud')}" target="_blank" rel="noopener">🏥 Centro de salud</a> <a class="btn small" href="${q('farmacia')}" target="_blank" rel="noopener">💊 Farmacia</a>`;
}
function posHTML(e) {
  const pos = D.pos; const t = e && D.tracks[e.dia] && D.tracks[e.dia].data;
  if (D.posError) return `<div class="note"><b>Sin posición:</b> ${esc(D.posError)}</div>`;
  if (!pos) return '';
  const hace = fmtHace(new Date(pos.t).toISOString());
  const link = `https://www.google.com/maps/search/?api=1&query=${pos.lat.toFixed(5)},${pos.lon.toFixed(5)}`;
  let sobre = '';
  if (t) {
    const r = posEnEtapa(t, pos);
    const lejos = r.dist > 1;
    sobre = `<div class="statgrid">
      <div class="stat"><small>Km de la etapa</small><b>${r.km.toLocaleString('es-ES', { maximumFractionDigits: 1 })}</b><small>de ${fmtKm(t.km)} · ${r.pct} %</small></div>
      <div class="stat"><small>Distancia a la ruta</small><b class="${lejos ? 'txt-hot' : 'txt-ok'}">${r.dist < 1 ? `${Math.round(r.dist * 1000)} m` : `${r.dist.toFixed(1)} km`}</b><small>${lejos ? 'Fuera de la ruta' : 'Sobre la ruta'}</small></div>
      <div class="stat"><small>Quedan</small><b>${fmtKm(Math.round(r.restante))}</b><small>${t.duracion_min ? `≈ ${fmtMin(Math.round(r.restante / t.km * t.duracion_min))} de moto` : ''}</small></div>
      <div class="stat"><small>Siguiente punto</small><b>${r.next ? esc(viaNombre(e, r.next, r.idxNext)) : 'Destino'}</b><small>${r.next ? `en ${fmtKm(Math.round((r.next.km - r.km) * 10) / 10)}` : ''}</small></div>
    </div>${lejos ? `<div class="note"><b>Estás a ${r.dist.toFixed(1)} km de la ruta.</b> Si no es a propósito, deja que Kurviger recalcule hacia la ruta o vuelve al último punto: ${r.next ? esc(viaNombre(e, r.next, r.idxNext)) : 'destino'}.</div>` : ''}`;
  }
  return `<div class="card pos"><div class="card-title"><h3>📍 Dónde estoy</h3><span class="muted"><small>${hace} · ±${Math.round(pos.acc)} m</small></span></div>
    ${sobre}
    <p class="row"><a class="btn small" href="${link}" target="_blank" rel="noopener">Ver en Google Maps ↗</a><button class="btn small" type="button" data-compartir-pos>📤 Enviar mi posición</button>${e && !window.VIAJE_DATA && t ? `<button class="btn small" type="button" data-mapa="${e.dia}">🗺️ En el mapa</button>` : ''}</p>
    <p class="row">${cercaLinks(pos)}</p></div>`;
}
async function localizar(dia) {
  D.posError = null; D.posLoading = true; rerender();
  try { await geoGet(); } catch (err) { D.posError = err.message; }
  D.posLoading = false; rerender();
}
async function compartirPos() {
  const pos = D.pos; if (!pos) return;
  const link = `https://www.google.com/maps/search/?api=1&query=${pos.lat.toFixed(5)},${pos.lon.toFixed(5)}`;
  const text = `Estoy aquí: ${link}`;
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (err) { if (err && err.name === 'AbortError') return; } }
  const casa = contacto('en_casa'); const tel = casa && typeof casa === 'object' && casa.telefono ? String(casa.telefono).replace(/\D/g, '') : '';
  window.open(`https://wa.me/${tel ? (tel.length === 9 ? '34' + tel : tel) : ''}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}
function localizarBtn(e) { return `<button class="btn" type="button" data-localizar="${e ? e.dia : ''}"${D.posLoading ? ' disabled' : ''}>📍 ${D.posLoading ? 'Buscando GPS…' : 'Dónde estoy'}</button>`; }

/* Panel de emergencia: llamadas grandes, posicion y datos del seguro. */
function viewSos() {
  const c = D.data.contactos, it = D.data.itinerario, today = todayISO(), s = D.data.seguro;
  const hoy = it.find((d) => d.fecha === today);
  const casa = contacto('en_casa'), seg = contacto('seguro_asistencia');
  const loc = contactosLocales();
  const big = (icon, label, tel, sub, cls = '') => tel ? `<a class="call ${cls}" href="tel:${esc(String(tel).replace(/\s+/g, ''))}"><span class="call-icon">${icon}</span><b>${esc(label)}</b><small>${esc(sub || tel)}</small></a>` : '';
  const n = hoy ? D.data.alojamientos_resumen.find((x) => x.fecha === today) : null;
  const localForm = (k, label, ph) => `<form class="tel-local" data-contacto="${k}" data-campo="texto"><label for="sos-${k}">${label} · en este móvil</label><div class="row"><input id="sos-${k}" type="text" placeholder="${ph}" value="${esc(loc[k + ':texto'] || '')}" autocomplete="off"><button class="btn small primary" type="submit">Guardar</button>${loc[k + ':texto'] ? '<button class="btn small danger" type="button" data-borrar>Borrar</button>' : ''}</div></form>`;
  return `<div class="card sos-head"><h1>🆘 Emergencia</h1><p>Primero a salvo, chaleco puesto, moto fuera de la calzada si se puede. Luego llama.</p></div>
    <div class="calls sos-calls">
      ${big('🚨', 'Emergencias', c.emergencias, '112', 'sos')}
      ${big('🛡️', typeof seg === 'object' ? seg.compania : 'Seguro', typeof seg === 'object' ? seg.telefono : seg, 'Asistencia 24 h')}
      ${typeof seg === 'object' && seg.telefonos_alternativos ? big('🛡️', 'Seguro (alternativo)', seg.telefonos_alternativos[0]) : ''}
      ${big('🏠', typeof casa === 'object' ? casa.nombre : 'En casa', typeof casa === 'object' ? casa.telefono : casa, typeof casa === 'object' && !casa.telefono ? '' : undefined) || `<span class="call pend"><span class="call-icon">🏠</span><b>En casa</b><small>Añade el número en Resumen</small></span>`}
      ${n ? big('🛏️', 'Alojamiento de hoy', n.telefono, n.alojamiento) : ''}
    </div>
    <h2>Mi posición</h2>
    <p class="row">${localizarBtn(hoy)}</p>
    ${posHTML(hoy)}
    ${!D.pos && !D.posError ? '<p class="muted"><small>Pulsa «Dónde estoy» para obtener las coordenadas por GPS (funciona sin cobertura) y enviarlas por WhatsApp o compartir.</small></p>' : ''}
    <h2>Qué decir al 112</h2>
    <div class="card"><ol><li>Dónde estás: carretera, punto kilométrico o pueblo más cercano, o las coordenadas de arriba.</li><li>Qué ha pasado y cuántas personas hay heridas; si respiran y están conscientes.</li><li>Que vas en moto, solo, y el estado de la vía (curva, sin visibilidad).</li><li>No cuelgues hasta que te lo digan.</li></ol></div>
    <h2>Datos para el seguro</h2>
    <div class="card"><dl>${s ? `<dt>Póliza</dt><dd>${esc(s.compania)} · ${esc(s.producto.split(' (')[0])}${loc['seguro_asistencia:poliza'] ? `<br><b>Nº ${esc(loc['seguro_asistencia:poliza'])}</b>` : '<br><small>Nº de póliza: guárdalo en Resumen → Contactos</small>'}</dd>` : ''}<dt>Moto</dt><dd>${esc(D.data.proyecto.moto.modelo)}${loc['matricula:texto'] ? ` · matrícula <b>${esc(loc['matricula:texto'])}</b>` : ''}</dd></dl>
      ${localForm('matricula', 'Matrícula', '0000 XXX')}
      ${localForm('medico', 'Datos médicos', 'Alergias, medicación, grupo sanguíneo…')}
      ${loc['medico:texto'] ? `<div class="note info"><b>Médico:</b> ${esc(loc['medico:texto'])}</div>` : ''}
      <p><small>Estos datos se guardan solo en este dispositivo.</small></p></div>
    ${s ? `<h2>Pasos con el seguro</h2><div class="card"><ol>${s.en_caso_de.averia_o_accidente.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''}`;
}

/* ---------- avisar en casa: resumen del dia para compartir ---------- */
function resumenDiaTexto(e) {
  const a = e.alojamiento; const m = meteoDia(e); const v = m.verdict ? VERDICT[m.verdict] : null;
  const l = [`🏍️ Día ${e.dia} de ${D.data.itinerario.length} · ${cap(e.dia_semana)} ${fmtFecha(e.fecha)}`,
    `${e.origen} → ${e.destino}`,
    `Salida ${e.salida.split(' ')[0]} · llegada prevista ${e.llegada_prevista.split(' ')[0]} · ${e.km_aprox} km (${e.tiempo_real_aprox} de conducción)`];
  if (a) l.push(`Duermo en ${a.nombre}, ${a.direccion}. Tel. ${a.telefono}`);
  else { const n = D.data.alojamientos_resumen.find((x) => x.fecha === e.fecha); if (n) l.push(`Duermo en ${n.alojamiento} (${n.lugar}). Tel. ${n.telefono}`); }
  if (v) l.push(`Previsión: ${v.txt}${m.tmin != null ? ` · ${Math.round(m.tmin)}°/${Math.round(m.tmax)}°` : ''}`);
  const nav = D.data.proyecto.navegacion; if (nav && nav.ubicacion_compartida) l.push(`Ubicación en tiempo real: ${nav.ubicacion_compartida}`);
  return l.join('\n');
}
function avisarBtn(e) {
  return `<button class="btn" type="button" data-avisar="${e.dia}" title="Enviar el resumen del día a casa">📤 Avisar en casa</button>`;
}
async function avisarCasa(dia) {
  const e = D.data.itinerario.find((d) => String(d.dia) === String(dia)); if (!e) return;
  const text = resumenDiaTexto(e);
  if (navigator.share) { try { await navigator.share({ title: `Día ${e.dia} · Viaje NX500`, text }); return; } catch (err) { if (err && err.name === 'AbortError') return; } }
  const casa = contacto('en_casa'); const tel = casa && typeof casa === 'object' && casa.telefono ? String(casa.telefono).replace(/\D/g, '') : '';
  const num = tel ? (tel.length === 9 ? '34' + tel : tel) : '';
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}
function toast(msg, ms = 2500) {
  const t = document.getElementById('toast'); const b = document.getElementById('toast-btn');
  document.getElementById('toast-text').textContent = msg; b.hidden = true; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; b.hidden = false; }, ms);
}

/* Progreso del viaje y proxima parada del dia (segun el horario orientativo y la hora actual). */
function progresoViaje(hoy) {
  const it = D.data.itinerario;
  const hechos = it.filter((d) => d.dia < hoy.dia).reduce((s, d) => s + d.km_aprox, 0);
  const total = it.reduce((s, d) => s + d.km_aprox, 0);
  const pct = Math.round((hechos / total) * 100);
  return `<div class="card"><div class="card-title"><h3>Día ${hoy.dia} de ${it.length}</h3><span class="muted">${hechos} km hechos · ${total - hechos} km por delante</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
}
function proximaParada(e) {
  const h = e.horario_orientativo; if (!h || !h.length || e.fecha !== todayISO()) return '';
  const now = ahoraMin();
  const idx = h.findIndex((x) => { const m = horaMin(x.hora); return m != null && m >= now; });
  if (idx < 0) return `<div class="note info"><b>Horario del día cumplido.</b> Última parada prevista: ${esc(h[h.length - 1].lugar)} (${esc(h[h.length - 1].hora)}).</div>`;
  const p = h[idx], m = horaMin(p.hora), en = m - now;
  return `<div class="note info"><b>Próximo:</b> ${esc(p.lugar)} a las ${esc(p.hora)}${en > 0 ? ` (en ${en >= 60 ? `${Math.floor(en / 60)} h ${en % 60} min` : `${en} min`})` : ''} · ${esc(p.que)}${h[idx + 1] ? `<br><small>Después: ${esc(h[idx + 1].lugar)} (${esc(h[idx + 1].hora)})</small>` : ''}</div>`;
}
function presionesHTML(m, corto) {
  const p = m.presiones; if (!p) return '';
  const bar = (v) => v.toLocaleString('es-ES', { minimumFractionDigits: 1 });
  const head = `<b>${bar(p.delantera_bar)} bar</b> delante · <b>${bar(p.trasera_bar)} bar</b> detrás${p.en_frio ? ' (en frío)' : ''}`;
  if (corto) return head;
  return `${head}<br><small>${p.delantera_psi ? `${p.delantera_psi} / ${p.trasera_psi} psi. ` : ''}${esc(p.con_carga || '')} ${esc(p.comprobar || '')}${p.fuente ? `<br>${esc(p.fuente)}` : ''}</small>`;
}
/* Puntos de despiste de la etapa: idas y vueltas, bucles, vias dobles. */
function avisosNavHTML(e) {
  const av = e.gpx && e.gpx.avisos; if (!e.gpx) return '';
  if (!av || !av.length) return `<h2>Puntos de despiste</h2><div class="card ok"><p>Ninguno: la ruta es lineal, sin idas y vueltas ni vías dobles. Seguir a Kurviger.</p></div>`;
  return `<h2>Puntos de despiste (${av.length})</h2>
    <div class="card"><ol class="despistes">${av.map((a) => `<li><div class="desp-head"><b>${esc(a.lugar)}</b><span class="badge">km ${a.km}</span>${a.lat != null ? `<a href="${mapsSearch(`${a.lat},${a.lon}`)}" target="_blank" rel="noopener">mapa ↗</a>` : ''}</div><p>${esc(a.que)}</p></li>`).join('')}</ol>
    <p><small>Sitios donde Kurviger te hará dar la vuelta o repetir carretera. Ninguno es un error: están comprobados sobre el GPX.</small></p></div>`;
}
function kurvigerBtns(e) {
  const k = e.gpx && e.gpx.kurviger; if (!k) return '';
  return `<a class="btn primary" href="${esc(k.cloud_url)}" target="_blank" rel="noopener">🧭 Abrir en Kurviger</a>${k.plan_url ? ` <a class="btn" href="${esc(k.plan_url)}" target="_blank" rel="noopener">Kurviger web ↗</a>` : ''}`;
}
function cortesAviso(e) {
  const k = e.gpx && e.gpx.kurviger; if (!k || !k.cortes_reportados) return '';
  return `<div class="note"><b>🚧 Kurviger informa de ${k.cortes_reportados} corte${k.cortes_reportados > 1 ? 's' : ''} de carretera en esta ruta</b> (datos del ${fmtFecha(k.exportado)}). Abrir la ruta en Kurviger antes de salir, ver el tramo afectado y decidir el desvío.</div>`;
}
function gasolinaAviso(e) {
  const aut = D.data.proyecto.moto.autonomia_orientativa_km; if (!aut) return '';
  if (e.km_aprox >= aut * 0.6) return `<div class="note"><b>⛽ Repostar en ruta:</b> ${e.km_aprox} km con ${aut} km de autonomía orientativa. Llenar en el primer pueblo grande, no apurar.</div>`;
  return '';
}
function solHTML(e) {
  const pt = (e.meteo_puntos || [])[e.meteo_puntos.length - 1]; if (!pt) return '';
  const s = solDia(pt.lat, pt.lon, e.fecha); if (!s || !s.ocaso) return '';
  return `<span title="Ocaso en ${esc(pt.nombre)}">🌇 Anochece a las ${s.ocaso}</span>`;
}

/* ---------- diario y gastos del dia (solo en este dispositivo) ---------- */
const GASTO_TIPOS = { gasolina: '⛽ Gasolina', comida: '🍽️ Comida', alojamiento: '🛏️ Alojamiento', otros: '🧾 Otros' };
function gastosDia(dia) { return (lsGet(GASTOS_KEY, {})[dia] || []); }
function gastosTotal(lista) { return lista.reduce((s, g) => s + (+g.importe || 0), 0); }
function diarioHTML(e) {
  const txt = lsGet(DIARIO_KEY, {})[e.dia] || '';
  const g = gastosDia(e.dia); const tot = gastosTotal(g);
  return `<h2>Diario y gastos del día</h2>
    <div class="card diario">
      <label for="diario-${e.dia}"><b>Diario</b> <small>· se guarda solo mientras escribes, en este móvil</small></label>
      <textarea id="diario-${e.dia}" data-diario="${e.dia}" rows="3" placeholder="Cómo ha ido, km reales, qué repetirías…">${esc(txt)}</textarea>
      <h4>Gastos ${g.length ? `<span class="badge">${fmtEur(tot)}</span>` : ''}</h4>
      ${g.length ? `<ul class="gastos">${g.map((x, i) => `<li><span>${GASTO_TIPOS[x.tipo] || x.tipo}${x.concepto ? ` · ${esc(x.concepto)}` : ''}</span><b>${fmtEur(+x.importe)}</b><button class="btn small danger" type="button" data-gasto-borrar="${e.dia}|${i}" title="Borrar">✕</button></li>`).join('')}</ul>` : ''}
      <form class="gasto-form row" data-gasto="${e.dia}">
        <select name="tipo">${Object.keys(GASTO_TIPOS).map((k) => `<option value="${k}">${GASTO_TIPOS[k]}</option>`).join('')}</select>
        <input name="importe" type="number" inputmode="decimal" step="0.01" min="0" placeholder="€" required>
        <input name="concepto" type="text" placeholder="Concepto (opcional)">
        <button class="btn small primary" type="submit">Añadir</button>
      </form>
    </div>`;
}
function gastosResumenHTML() {
  const all = lsGet(GASTOS_KEY, {}); const dias = Object.keys(all).filter((k) => all[k].length);
  if (!dias.length) return '';
  const porTipo = {}; let tot = 0;
  dias.forEach((k) => all[k].forEach((x) => { porTipo[x.tipo] = (porTipo[x.tipo] || 0) + (+x.importe || 0); tot += +x.importe || 0; }));
  return `<h2>Gastos del viaje</h2><div class="card"><div class="card-title"><h3>${fmtEur(tot)}</h3><span class="muted">${dias.length} día${dias.length === 1 ? '' : 's'} con gastos</span></div>
    <p>${Object.keys(porTipo).map((k) => `${GASTO_TIPOS[k] || k} <b>${fmtEur(porTipo[k])}</b>`).join(' · ')}</p>
    <p><small>${dias.sort((a, b) => a - b).map((k) => `<a href="#/etapas/${k}">Día ${k}: ${fmtEur(gastosTotal(all[k]))}</a>`).join(' · ')}</small></p></div>`;
}

/* ---------- buscador ---------- */
function viewBuscar(arg) {
  const q = decodeURIComponent(arg || '').trim(); const nq = norm(q);
  let res = '';
  if (nq.length >= 2) {
    const hits = [];
    const add = (href, titulo, texto) => { if (norm(titulo + ' ' + texto).includes(nq)) hits.push({ href, titulo, texto }); };
    D.data.itinerario.forEach((e) => {
      const base = `#/etapas/${e.dia}`, pre = `Día ${e.dia} · `;
      add(base, pre + `${e.origen} → ${e.destino}`, [e.tipo, e.objetivo, e.equipaje, e.opcional].filter(Boolean).join(' '));
      (e.waypoints || []).forEach((w) => add(base, pre + w, 'waypoint'));
      (e.paradas || []).forEach((p) => add(base, pre + 'Parada', p));
      (e.notas || []).forEach((n) => add(base, pre + 'Nota', n));
      (e.horario_orientativo || []).forEach((h) => add(base, pre + `${h.hora} ${h.lugar}`, h.que));
      if (e.guia) { (e.guia.ver || []).forEach((v) => add(base + '#guia', pre + v.lugar, v.que)); if (e.guia.comer) add(base, pre + 'Comer', `${e.guia.comer.donde} ${(e.guia.comer.platos || []).join(' ')}`); if (e.guia.tarde) add(base, pre + 'La tarde', e.guia.tarde); if (e.guia.consejo) add(base, pre + 'Consejo', e.guia.consejo); }
      if (e.alojamiento) add(base, pre + e.alojamiento.nombre, `${e.alojamiento.direccion} ${e.alojamiento.telefono} ${e.alojamiento.estado || ''} ${e.alojamiento.plan_b_cena || ''}`);
      (e.opciones || []).forEach((o) => add(base, pre + o.titulo, (o.alternativas || []).map((a) => `${a.nombre} ${a.por_que}`).join(' ')));
      ((e.gpx && e.gpx.avisos) || []).forEach((a) => add(base, pre + `Despiste: ${a.lugar}`, a.que));
      if (e.lavanderia) add(base, pre + e.lavanderia.nombre, `lavandería ${e.lavanderia.direccion} ${e.lavanderia.plan}`);
    });
    const rep = D.data.reparto_equipaje; Object.keys(rep).forEach((k) => { if (Array.isArray(rep[k])) rep[k].forEach((t) => add('#/equipaje', `Equipaje · ${human(k)}`, t)); });
    Object.keys(D.data.checklist_previa).forEach((k) => D.data.checklist_previa[k].forEach((t) => add('#/listas', `Checklist · ${human(k)}`, t)));
    D.data.compras_pendientes.forEach((c) => add('#/listas', 'Compra pendiente', `${c.que} ${c.donde}`));
    const mat = D.data.material_en_propiedad; ['compresor', 'antirrobo', 'powerbank'].forEach((k) => add('#/equipaje', `Material · ${human(k)}`, `${mat[k].modelo} ${mat[k].nota}`));
    if (D.data.seguro) { D.data.seguro.coberturas.forEach((c) => add('#/guia', `Seguro · ${c.nombre}`, c.limite)); D.data.seguro.exclusiones_relevantes.forEach((x) => add('#/guia', 'Seguro · no cubre', x)); }
    const mark = (s) => { const i = norm(s).indexOf(nq); if (i < 0) return esc(s); return `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}`; };
    res = hits.length ? `<p class="muted">${hits.length} resultado${hits.length === 1 ? '' : 's'}</p><div class="card"><div class="guia-index">${hits.slice(0, 80).map((h) => `<a class="guia-link" href="${h.href}"><span class="badge">→</span><span>${mark(h.titulo)}</span><small>${mark(h.texto.length > 160 ? h.texto.slice(0, 160) + '…' : h.texto)}</small></a>`).join('')}</div></div>` : '<div class="card"><p class="muted">Nada con ese texto.</p></div>';
  }
  return `<div class="card accent"><h1>Buscar en el plan</h1><form class="buscar row" id="buscar-form"><input type="search" id="buscar-q" placeholder="Pueblo, hotel, plato, cosa que llevar…" value="${esc(q)}" autofocus><button class="btn primary" type="submit">Buscar</button></form><p class="muted"><small>Busca en etapas, guía, horarios, alojamientos, listas y equipaje. Sin acentos también vale.</small></p></div>${res}`;
}

/* ---------- vistas ---------- */
function etapaCard(e, opts = {}) {
  const t = tipoInfo(e.tipo);
  return `<a class="card ${opts.hoy ? 'warn' : ''}" href="#/etapas/${e.dia}">
    <div class="etapa-head">
      ${opts.hoy ? '<span class="badge warn">HOY</span>' : ''}
      <span class="badge">Día ${e.dia}</span>
      <span class="muted">${cap(e.dia_semana)} ${fmtFecha(e.fecha)}</span>
      <span class="badge ${t.cls}">${t.icon} ${t.label}</span>
    </div>
    <div class="etapa-ruta">${esc(e.origen)} → ${esc(e.destino)}</div>
    <div class="stats"><b>${e.km_aprox} km</b><span><b>${esc(e.tiempo_real_aprox)}</b> reales</span><span>Dif. ${dots(e.dificultad)}</span><span>Fatiga ${dots(e.fatiga)}</span><span>${esc(e.perfil_kurviger)}</span>${e.gpx ? '<span title="Ruta GPX disponible">🗺️ GPX</span>' : ''}${e.gpx && e.gpx.avisos && e.gpx.avisos.length ? `<span title="Puntos de despiste">🔁 ${e.gpx.avisos.length}</span>` : ''}${(e.opciones || []).some((o) => /pendiente|decidir/i.test(o.estado)) ? '<span class="wx-inline" title="Hay una decisión pendiente">⚖️ Por decidir</span>' : ''}${etapaWx(e)}</div>
  </a>`;
}

function etapaWx(e) {
  const m = meteoDia(e); if (!m.verdict) return '';
  const v = VERDICT[m.verdict];
  return `<span class="wx-inline">${v.icon} ${v.txt}${m.tmin != null ? ` · ${Math.round(m.tmin)}°/${Math.round(m.tmax)}°` : ''}</span>`;
}

function viewResumen() {
  const p = D.data.proyecto, it = D.data.itinerario, today = todayISO();
  const hoy = it.find((d) => d.fecha === today);
  let estado;
  if (today < p.fechas.inicio) {
    const n = daysBetween(today, p.fechas.inicio);
    marcarHechos(); const keys = previaKeys();
    estado = `<div class="card warn"><div class="card-title"><h3>Faltan ${n} día${n === 1 ? '' : 's'} para la salida</h3>${progress(keys)}</div>
      <p>Salida el lunes ${fmtFecha(p.fechas.inicio)} a las ${esc(it[0].salida)} hacia ${esc(it[0].destino)}.</p>${bar(keys)}
      <p><a class="btn small" href="#/listas">Checklist previa</a> <a class="btn small" href="#/etapas/1">Ver día 1</a></p></div>`;
  } else if (hoy) {
    const manana = it.find((d) => d.dia === hoy.dia + 1);
    estado = `<h2>Hoy</h2>${progresoViaje(hoy)}${etapaCard(hoy, { hoy: true })}${proximaParada(hoy)}<p class="row">${avisarBtn(hoy)}<a class="btn" href="#/etapas/${hoy.dia}">Ficha del día</a></p>${manana ? `<h4>Mañana</h4>${etapaCard(manana)}` : ''}`;
  } else if (today > p.fechas.fin) {
    estado = `<div class="card ok"><h3>Viaje terminado</h3><p>Hasta el ${fmtFecha(p.vacaciones.fin)} quedan ${p.vacaciones.margen_tras_el_viaje_dias} días de margen de vacaciones.</p></div>`;
  }
  const r = p.reglas_globales, m = p.moto, c = D.data.contactos, rd = D.data.rutina_diaria;
  const contactoRow = (label, val) => `<dt>${label}</dt><dd>${contactoHTML(val)}</dd>`;
  const localForm = (k, label, campo = 'telefono') => {
    const c = D.data.contactos[k]; if (!c) return '';
    if (campo === 'telefono' && !c.local) return '';
    if (campo === 'poliza' && !c.poliza_local) return '';
    const sk = campo === 'poliza' ? `${k}:poliza` : k;
    const val = contactosLocales()[sk] || '';
    const id = `loc-${esc(k)}-${campo}`;
    return `<form class="tel-local" data-contacto="${esc(k)}" data-campo="${campo}">
      <label for="${id}">${esc(label)} · ${campo === 'poliza' ? 'nº de póliza' : 'teléfono'} en este móvil</label>
      <div class="row"><input id="${id}" type="${campo === 'poliza' ? 'text' : 'tel'}" inputmode="${campo === 'poliza' ? 'numeric' : 'tel'}" placeholder="${campo === 'poliza' ? 'Número de póliza' : '+34 600 00 00 00'}" value="${esc(val)}" autocomplete="off">
      <button class="btn small primary" type="submit">Guardar</button>${val ? '<button class="btn small danger" type="button" data-borrar>Borrar</button>' : ''}</div>
      <small>Se guarda solo en este dispositivo. No viaja al repositorio ni a ningún servidor.</small>
    </form>`;
  };
  return `
    <div class="card accent">
      <h1>${esc(p.nombre)}</h1>
      <p class="muted">${esc(p.objetivo)}</p>
      <div class="statgrid">
        <div class="stat"><small>Fechas</small><b>${fmtFecha(p.fechas.inicio)} – ${fmtFecha(p.fechas.fin)}</b></div>
        <div class="stat"><small>Duración</small><b>${p.fechas.dias} días · ${p.fechas.noches} noches</b></div>
        <div class="stat"><small>Distancia aprox.</small><b>${p.distancia_total_aprox_km} km</b></div>
        <div class="stat"><small>Moto</small><b>${esc(m.modelo)}</b></div>
      </div>
      <p class="row">${window.VIAJE_DATA ? '' : '<button class="btn primary" type="button" data-mapa="todos">🗺️ Mapa del viaje completo</button>'}<a class="btn" href="#/hoja">📄 Hoja de ruta</a></p>
    </div>
    ${instalarHTML()}
    ${estado || ''}
    <h2>Llamar</h2>
    ${quickCalls()}
    <h2>Contactos</h2>
    <div class="card"><dl>${contactoRow('Emergencias', c.emergencias)}${contactoRow('Seguro / asistencia', contacto('seguro_asistencia'))}${contactoRow('En casa', contacto('en_casa'))}</dl>
      ${localForm('en_casa', 'En casa')}
      ${localForm('seguro_asistencia', 'Seguro', 'poliza')}
      ${D.data.seguro ? `<details><summary>Qué cubre el seguro y qué hacer</summary>${seguroHTML(false)}</details>` : ''}
      <p><a class="btn small" href="#/noches">Teléfonos de alojamientos</a> <a class="btn small" href="#/guia">Seguro al detalle</a></p></div>
    <h2>Reglas del viaje</h2>
    <div class="card">
      <dl>
        <dt>Conducción real</dt><dd>Objetivo <b>${esc(r.conduccion_real_objetivo)}</b>, máximo <b>${esc(r.conduccion_real_maximo)}</b></dd>
        <dt>Superficie</dt><dd>${esc(r.superficie)}</dd>
        <dt>Horario</dt><dd>${esc(r.horario)}</dd>
        <dt>Paradas</dt><dd>${esc(r.paradas)}</dd>
        <dt>Gasolina</dt><dd>${esc(m.regla_gasolina)} Autonomía orientativa: ${m.autonomia_orientativa_km} km.</dd>
        ${m.presiones ? `<dt>Presiones</dt><dd>${presionesHTML(m, true)} · <a href="#/guia">detalle</a></dd>` : ''}
        ${m.precarga_trasera ? `<dt>Precarga</dt><dd>Trasera en posición <b>${esc(m.precarga_trasera.recomendada.split(' ')[0])}</b> de ${m.precarga_trasera.posiciones} con maletas</dd>` : ''}
        <dt>Recortable</dt><dd>${esc(r.recortables_sin_cambiar_alojamiento.join(' · '))}</dd>
      </dl>
    </div>
    <h2>Rutina diaria</h2>
    <div class="card">
      ${Object.keys(rd).map((k) => `<details${k === 'mañana' || k === 'en_ruta' ? ' open' : ''}><summary>${human(k)}</summary>${list(rd[k])}</details>`).join('')}
    </div>
    ${gastosResumenHTML()}
    <h2>Filosofía</h2>
    <div class="card"><p class="muted">${esc(p.piloto.nombre)} · ${esc(p.piloto.nivel)}${p.piloto.peso_kg ? ` · ${p.piloto.edad} años, ${p.piloto.altura_m.toLocaleString('es-ES', { minimumFractionDigits: 2 })} m, ${p.piloto.peso_kg} kg` : ''}</p>${list(p.piloto.filosofia)}${p.piloto.nota_fisica ? `<div class="note info">${esc(p.piloto.nota_fisica)} <a href="#/guia">Ajustes de la moto</a></div>` : ''}</div>
    <p class="version">${planVersion()} · <a href="#" id="reload-plan">Actualizar plan</a> · <a href="#" id="imprimir">Imprimir</a></p>`;
}
/* Instalacion como app: Android/Chrome muestra el boton; iOS recibe la indicacion. */
function esStandalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function instalarHTML() {
  if (esStandalone() || window.VIAJE_DATA) return '';
  if (D.installEvt) return `<div class="card ok"><div class="card-title"><h3>📲 Instalar en el móvil</h3><button class="btn small primary" type="button" id="instalar">Instalar</button></div><p class="muted"><small>Se abre a pantalla completa y funciona sin cobertura.</small></p></div>`;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !localStorage.getItem('viaje-nx500-ios-hint')) return `<div class="card"><div class="card-title"><h3>📲 Añadir a la pantalla de inicio</h3><button class="btn small" type="button" id="ios-hint-ok">Entendido</button></div><p class="muted"><small>En Safari: botón Compartir → «Añadir a pantalla de inicio». Así funciona sin cobertura.</small></p></div>`;
  return '';
}
function planVersion() { const m = D.data.meta; return `Plan v${m.version}${m.revision ? `.${m.revision}` : ''} · ${fmtFecha(m.actualizado)}${D.fromCache ? ' · copia sin conexión' : ''}`; }

function alojamientoCard(dia) {
  const a = dia.alojamiento; if (!a) return '';
  const LABELS = { tipo: 'Tipo', precio_eur: 'Precio', precio_total_eur: 'Precio total', precio_referencia_eur_noche: 'Precio ref. / noche', moto_eur_dia: 'Moto / día', checkin: 'Check-in', recepcion: 'Recepción', servicios: 'Servicios', horario_google: 'Horario (Google)', parking: 'Parking', moto: 'Moto', desayuno: 'Desayuno', restaurante: 'Restaurante', noches: 'Noches', fechas: 'Fechas', altitud_m: 'Altitud' };
  const rows = Object.keys(LABELS).filter((k) => a[k] != null).map((k) => `<dt>${LABELS[k]}</dt><dd>${fmtVal(k, a[k])}</dd>`).join('') + pagoHTML(a);
  const keys = confirmarKeys(dia);
  const pend = a.pendiente_confirmar ? `<h4>Pendiente de confirmar ${progress(keys)}</h4>${a.pendiente_confirmar.map((t) => checkItem(`confirmar|${dia.dia}|${t}`, t)).join('')}` : '';
  const planB = a.plan_b_cena || a.plan_b;
  return `<h2>Alojamiento</h2>
    <div class="card ok">
      <div class="card-title"><h3>${esc(a.nombre)}</h3>${estadoBadge(a)}</div>
      <p class="muted"><small>${esc(a.estado)}</small></p>
      <p>${esc(a.direccion)}<br><a href="${mapsDir(a.direccion)}" target="_blank" rel="noopener">Cómo llegar</a> · <a href="${mapsSearch(a.nombre + ', ' + a.direccion)}" target="_blank" rel="noopener">Ver en el mapa</a></p>
      <p>📞 ${telLink(a.telefono)}</p>
      <dl>${rows}</dl>
      ${pend}
      ${planB ? `<div class="note">${a.plan_b_cena ? '<b>Plan B cena:</b> ' : '<b>Plan B:</b> '}${esc(planB)}</div>` : ''}
    </div>`;
}

function viewEtapas(arg) {
  const it = D.data.itinerario, today = todayISO();
  const hoy = it.find((d) => d.fecha === today);
  let n = parseInt(arg, 10);
  if (!it.some((d) => d.dia === n)) n = hoy ? hoy.dia : 0;
  const chips = `<div class="chips">
    <a class="chip${!n ? ' active' : ''}" href="#/etapas"><strong>Todas</strong><small>&nbsp;</small></a>
    ${it.map((d) => `<a class="chip${d.dia === n ? ' active' : ''}${d.fecha === today ? ' today' : ''}" href="#/etapas/${d.dia}"><strong>${d.dia}</strong><small>${fmtFecha(d.fecha)}</small></a>`).join('')}
  </div>`;
  if (!n) {
    const km = it.reduce((s, d) => s + d.km_aprox, 0);
    return `${chips}<h2>Las ${it.length} etapas</h2><p class="muted">${km} km sumando etapas · ${D.data.proyecto.distancia_total_aprox_km} km aprox. según plan</p>${it.map((d) => etapaCard(d, { hoy: d.fecha === today })).join('')}`;
  }
  const e = it.find((d) => d.dia === n), t = tipoInfo(e.tipo);
  const prev = it.find((d) => d.dia === n - 1), next = it.find((d) => d.dia === n + 1);
  const equipCfg = D.data.equipacion_moto.configuracion_por_tipo_de_dia;
  const cfgKey = Object.keys(equipCfg).find((k) => equipCfg[k].dias.includes(n));
  const cfg = cfgKey ? equipCfg[cfgKey] : null;
  const sinLat = D.data.reparto_equipaje.dias_sin_laterales;
  return `${chips}
    <div class="card accent">
      <div class="etapa-head">
        ${e.fecha === today ? '<span class="badge warn">HOY</span>' : ''}
        <span class="badge">Día ${e.dia} de ${it.length}</span>
        <span class="muted">${cap(e.dia_semana)} ${fmtFecha(e.fecha)}</span>
        <span class="badge ${t.cls}">${t.icon} ${t.label}</span>
      </div>
      <h1>${esc(e.origen)} → ${esc(e.destino)}</h1>
      <div class="statgrid">
        <div class="stat"><small>Distancia</small><b>${e.km_aprox} km</b></div>
        <div class="stat"><small>Conducción real</small><b>${esc(e.tiempo_real_aprox)}</b></div>
        <div class="stat"><small>Dificultad</small><b>${dots(e.dificultad)}</b></div>
        <div class="stat"><small>Fatiga</small><b>${dots(e.fatiga)}</b></div>
        <div class="stat"><small>Salida</small><b>${esc(e.salida)}</b></div>
        <div class="stat"><small>Llegada prevista</small><b>${esc(e.llegada_prevista)}</b></div>
        <div class="stat"><small>Perfil Kurviger</small><b>${esc(e.perfil_kurviger)}</b></div>
      </div>
      <p class="row muted"><small>${solHTML(e)}</small>${avisarBtn(e)}${e.gpx ? localizarBtn(e) : ''}</p>
      ${D.pos || D.posError ? posHTML(e) : ''}
      ${proximaParada(e)}
      ${e.objetivo ? `<div class="note info"><b>Objetivo:</b> ${esc(e.objetivo)}</div>` : ''}
      ${cortesAviso(e)}
      ${gasolinaAviso(e)}
      ${e.equipaje ? `<div class="note"><b>Equipaje:</b> ${esc(e.equipaje)}</div>` : ''}
      ${e.opcional ? `<div class="note mount"><b>Opcional:</b> ${esc(e.opcional)}</div>` : ''}
    </div>

    ${meteoStrip(e)}
    ${avisosNavHTML(e)}
    ${rutaHTML(e)}
    <h2>Waypoints (${e.waypoints.length})</h2>
    <div class="card"><ol class="wp">${e.waypoints.map((w) => `<li><a href="${mapsSearch(w)}" target="_blank" rel="noopener">${esc(w)}</a><span class="go">mapa ↗</span></li>`).join('')}</ol>
      <p><small>Enlaces de consulta en Google Maps. La ruta real se crea en Kurviger con estos puntos como shaping points sobre la carretera.</small></p></div>

    ${e.horario_orientativo ? (() => { const esHoy = e.fecha === today, now = ahoraMin(); let nextIdx = -1; if (esHoy) nextIdx = e.horario_orientativo.findIndex((h) => { const m = horaMin(h.hora); return m != null && m >= now; }); return `<h2>Horario orientativo</h2><div class="card"><div class="tbl-wrap"><table class="horario"><thead><tr><th>Hora</th><th>Lugar</th><th>Qué</th></tr></thead><tbody>${e.horario_orientativo.map((h, i) => `<tr class="${esHoy ? (i === nextIdx ? 'now' : (nextIdx < 0 || i < nextIdx) ? 'past' : '') : ''}"><td><b>${esc(h.hora)}</b></td><td>${esc(h.lugar)}</td><td>${esc(h.que)}</td></tr>`).join('')}</tbody></table></div>${esHoy ? '<p><small>Las filas en gris ya han pasado; la resaltada es la siguiente según la hora.</small></p>' : ''}</div>`; })() : ''}
    ${e.paradas ? `<h2>Paradas</h2><div class="card">${list(e.paradas)}</div>` : ''}
    ${guiaHTML(e)}
    ${opcionesHTML(e)}
    ${e.notas ? `<h2>Notas</h2><div class="card">${list(e.notas)}</div>` : ''}

    ${cfg ? `<h2>Equipación del día</h2><div class="card"><p class="muted">Configuración «${human(cfgKey)}»</p><dl><dt>Pantalón</dt><dd>${esc(cfg.pantalon)}</dd><dt>Chaqueta</dt><dd>${esc(cfg.chaqueta)}</dd>${cfg.nota ? `<dt>Nota</dt><dd>${esc(cfg.nota)}</dd>` : ''}</dl>
      ${sinLat.dias.includes(n) ? `<div class="note"><b>Sin maletas laterales.</b> Pasar al SH58X: ${esc(sinLat.pasar_al_sh58x.join(', '))}.</div>` : ''}</div>` : ''}

    ${alojamientoCard(e)}
    ${diarioHTML(e)}
    ${e.lavanderia ? `<h2>Lavandería</h2><div class="card"><div class="card-title"><h3>${esc(e.lavanderia.nombre)}</h3><span class="badge">${esc(e.lavanderia.horario)}</span></div>
      <p>${esc(e.lavanderia.direccion)} · <a href="${mapsSearch(e.lavanderia.nombre + ', ' + e.lavanderia.direccion)}" target="_blank" rel="noopener">mapa ↗</a></p><p>${esc(e.lavanderia.precio)}</p><div class="note info">${esc(e.lavanderia.plan)}</div></div>` : ''}

    <div class="nav-prev-next">
      ${prev ? `<a class="btn" href="#/etapas/${prev.dia}">← Día ${prev.dia}</a>` : '<span></span>'}
      ${next ? `<a class="btn" href="#/etapas/${next.dia}">Día ${next.dia} →</a>` : '<span></span>'}
    </div>`;
}

function viewNoches() {
  const it = D.data.itinerario, today = todayISO();
  const total = it.reduce((s, d) => { const a = d.alojamiento; if (!a) return s; const pg = pagoInfo(a); return s + (pg ? pg.total_eur : (a.precio_eur || a.precio_total_eur || (a.precio_referencia_eur_noche || 0) * (a.noches || 1))); }, 0);
  const pend = nochesPendientes();
  const pendTotal = pend.reduce((s, e) => s + e.alojamiento.pago.pendiente_eur, 0);
  const pendAprox = pend.some((e) => e.alojamiento.pago.aproximado);
  const pendKeys = pend.map(pagoKey);
  return `<h2>Las ${D.data.alojamientos_resumen.length} noches</h2>
    <p class="muted">Todas reservadas. Total aprox. ${fmtEur(total)}. Toca el teléfono para llamar.</p>
    ${pend.length ? `<div class="card warn"><div class="card-title"><h3>Por pagar en los alojamientos: ${fmtEur(pendTotal, pendAprox)}</h3>${progress(pendKeys)}</div>
      ${pend.map((e) => { const pg = e.alojamiento.pago; return checkItem(pagoKey(e), `${fmtEur(pg.pendiente_eur, pg.aproximado)} · ${e.alojamiento.nombre}`, `Día ${e.dia} · ${fmtFecha(e.fecha)}${pg.pagado_eur ? ` · ya pagados ${fmtEur(pg.pagado_eur, pg.aproximado)}` : ''}${pg.aproximado ? ' · importe por confirmar' : ''}`); }).join('')}
      <p><small>Marca cada uno al pagarlo. Las marcas se guardan en este dispositivo.</small></p></div>` : ''}
    ${D.data.alojamientos_resumen.map((n) => {
      const dia = it.find((d) => d.fecha === n.fecha);
      const a = dia && dia.alojamiento;
      return `<div class="card${n.fecha === today ? ' warn' : ''}">
        <div class="card-title"><h3>Noche ${n.noche} · ${esc(n.lugar)}</h3><span class="muted">${fmtFecha(n.fecha)}</span></div>
        <p><b>${esc(n.alojamiento)}</b></p>
        <div class="row spread"><span>📞 ${telLink(n.telefono)}</span>${a ? estadoBadge(a) : `<span class="badge ok">${esc(n.estado)}</span>`}</div>
        <p class="muted"><small>${esc(n.estado)}</small></p>
        ${dia ? `<p><a class="btn small" href="#/etapas/${dia.dia}">Día ${dia.dia}${a ? ' · ficha completa' : ''}</a>${a ? ` <a class="btn small" href="${mapsDir(a.direccion)}" target="_blank" rel="noopener">Cómo llegar</a>` : ''}</p>` : ''}
      </div>`;
    }).join('')}`;
}

function viewListas() {
  const d = D.data;
  const grupos = { jueves_10: 'Jueves 10', viernes_11: 'Viernes 11 (lo que quede, sábado)', sabado_12_o_domingo_13: 'Domingo 13 por la mañana · salida de prueba', domingo_13_tarde: 'Domingo 13 por la tarde' };
  marcarHechos();
  const previa = Object.keys(d.checklist_previa).map((g) => {
    const items = previaItems(g); const keys = items.map((t) => `previa|${g}|${t.que}`);
    return `<div class="card"><div class="card-title"><h3>${grupos[g] || human(g)}</h3>${progress(keys)}</div>${items.map((t) => checkItem(`previa|${g}|${t.que}`, t.que, t.hecho ? 'Hecho' : '')).join('')}</div>`;
  }).join('');
  const compraKeys = d.compras_pendientes.map((c) => `compra|${c.que}`);
  // Pedido Amazon: cada articulo puede ser un texto o { que, recibido, fecha }. Los recibidos cuentan como hechos.
  const amazon = d.pedido_amazon_llega_2026_09_10.map((x) => typeof x === 'string' ? { que: x } : x);
  const amazonKeys = amazon.map((x) => `amazon|${x.que}`);
  amazon.forEach((x) => { if (x.recibido) D.checks[`amazon|${x.que}`] = true; });
  const amazonRec = amazon.filter((x) => x.recibido).length;
  const faltaKeys = d.ropa_comprada_decathlon_2026_09_09.falta.map((t) => `falta|${t}`);
  const confDias = d.itinerario.filter((e) => e.alojamiento && e.alojamiento.pendiente_confirmar);
  const confKeys = confDias.flatMap(confirmarKeys);
  const contactosPend = ['seguro_asistencia', 'en_casa'].filter((k) => contactoPendiente(contacto(k)));
  const contactoKeys = contactosPend.map((k) => `contacto|${k}`);
  const pagoKeys = nochesPendientes().map(pagoKey);
  const rep = d.reparto_equipaje;
  const MALETAS = { bolsa_deposito_e09cl: '🧳 Bolsa de depósito', sh38x_izquierda_ropa: '⬅️ SH38X izquierda · ropa', sh38x_derecha_taller_y_aseo: '➡️ SH38X derecha · taller y aseo', sh58x_capas_y_lluvia: '⬆️ SH58X · capas y lluvia' };
  const cargaKeys = Object.keys(MALETAS).flatMap((k) => rep[k].map((t) => `carga|${k}|${t}`));
  const carga = Object.keys(MALETAS).map((k) => { const keys = rep[k].map((t) => `carga|${k}|${t}`); return `<details class="card"${keys.every((x) => D.checks[x]) ? '' : ' open'}><summary>${MALETAS[k]} ${progress(keys)}</summary>${rep[k].map((t) => checkItem(`carga|${k}|${t}`, t)).join('')}</details>`; }).join('');
  const all = [...previaKeys(), ...compraKeys, ...amazonKeys, ...faltaKeys, ...confKeys, ...contactoKeys, ...pagoKeys, ...cargaKeys];
  return `<div class="card accent"><div class="card-title"><h1>Listas</h1>${progress(all)}</div>${bar(all)}<p><small>Las marcas se guardan en este dispositivo.</small></p></div>
    <h2>Checklist previa</h2>${previa}
    <h2>Compras pendientes ${progress(compraKeys)}</h2>
    <div class="card">${d.compras_pendientes.map((c) => checkItem(`compra|${c.que}`, c.que, c.hecho ? 'Hecho' : [c.donde, c.cuando].filter((x) => x && x !== '-').join(' · '))).join('')}</div>
    <h2>Pedido Amazon ${progress(amazonKeys)}</h2>
    <div class="card">${amazonRec < amazon.length ? `<p class="muted"><small>Recibidos ${amazonRec} de ${amazon.length}. Faltan: ${esc(amazon.filter((x) => !x.recibido).map((x) => x.que).join(', '))}.</small></p>` : '<p class="muted"><small>Todo recibido.</small></p>'}${amazon.map((x) => checkItem(`amazon|${x.que}`, x.que, x.recibido ? `Recibido${x.fecha ? ` el ${fmtFecha(x.fecha)}` : ''}` : 'Pendiente de llegar')).join('')}</div>
    <h2>Ropa: falta ${progress(faltaKeys)}</h2>
    <div class="card">${d.ropa_comprada_decathlon_2026_09_09.falta.map((t) => checkItem(`falta|${t}`, t)).join('')}</div>
    ${contactosPend.length ? `<h2>Contactos pendientes ${progress(contactoKeys)}</h2>
    <div class="card">${contactosPend.map((k) => { const c = contacto(k); const txt = typeof c === 'string' ? c : (c.nota || ''); return checkItem(`contacto|${k}`, k === 'en_casa' ? 'Contacto en casa' : 'Seguro / asistencia', txt.replace(/^PENDIENTE:\s*/i, '')); }).join('')}</div>` : ''}
    ${pagoKeys.length ? `<h2>Pagos en los alojamientos ${progress(pagoKeys)}</h2>
    <div class="card">${nochesPendientes().map((e) => { const pg = e.alojamiento.pago; return checkItem(pagoKey(e), `${fmtEur(pg.pendiente_eur, pg.aproximado)} · ${e.alojamiento.nombre}`, `Día ${e.dia} · ${fmtFecha(e.fecha)} · ${pg.donde}${pg.aproximado ? ' · importe por confirmar' : ''}`); }).join('')}</div>` : ''}
    <h2>Carga de maletas ${progress(cargaKeys)}</h2>
    <p class="muted"><small>${esc(rep.regla)} Marca cada cosa al meterla el domingo por la tarde.</small></p>
    ${carga}
    <h2>Confirmar con alojamientos ${progress(confKeys)}</h2>
    ${confDias.map((e) => `<div class="card"><div class="card-title"><h3><a href="#/etapas/${e.dia}">Día ${e.dia} · ${esc(e.alojamiento.nombre)}</a></h3>${progress(confirmarKeys(e))}</div><p>📞 ${telLink(e.alojamiento.telefono)}</p>${e.alojamiento.pendiente_confirmar.map((t) => checkItem(`confirmar|${e.dia}|${t}`, t)).join('')}</div>`).join('')}
    <h2>Copia de seguridad</h2>
    <div class="card"><p class="muted"><small>Marcas, teléfono de casa, nº de póliza, matrícula, diario y gastos viven solo en este móvil. Cópialos al portapapeles para pegarlos en otro dispositivo o guardarlos en una nota.</small></p>
      <p class="row"><button class="btn small" type="button" id="backup-copiar">📋 Copiar copia de seguridad</button><button class="btn small" type="button" id="backup-restaurar">📥 Restaurar desde el portapapeles</button></p></div>
    <p style="margin-top:20px"><button class="btn small danger" type="button" id="reset-checks">Borrar todas las marcas</button></p>`;
}

/* Inventario de equipo en propiedad. */
function inventarioHTML(inv) {
  if (!inv) return '';
  const item = (o, extra) => `<li><b>${esc(o.marca)} ${esc(o.modelo)}</b>${extra ? ` <small>${extra}</small>` : ''}</li>`;
  const flags = (o) => [
    o.uso, o.tipo, o.talla ? `talla ${o.talla}` : '', o.membrana,
    o.impermeable === true ? 'impermeable' : (o.impermeable === false ? 'no impermeable' : ''),
    o.forro_termico_desmontable ? 'forro térmico' : '', o.forro_impermeable_desmontable ? 'forro impermeable' : '',
    o.espaldera === true ? 'con espaldera' : (o.espaldera === false ? 'SIN espaldera' : '')
  ].filter(Boolean).join(' · ');
  const m = inv.moto, e = inv.equipaje, c = inv.casco;
  return `<h2>Equipo en propiedad</h2>
    <div class="card"><dl>
      <dt>Moto</dt><dd><b>${esc(m.marca)} ${esc(m.modelo)}</b> · carnet ${esc(m.carnet)}<br><small>${(m.accesorios || []).map((a) => `${esc(a.marca)} ${esc(a.modelo)} (${esc(a.tipo.toLowerCase())})`).join('<br>')}</small></dd>
      <dt>Maletas</dt><dd>${esc(e.marca)} ${esc(e.baul)} + 2× ${esc(e.maletas_laterales)}<br><small>Bolsa de depósito ${esc(e.bolsa_deposito.modelo)}, ${esc(e.bolsa_deposito.anclaje)}${e.bolsa_deposito.cierre_con_llave ? ', con cierre de llave' : ''}</small></dd>
      <dt>Casco</dt><dd><b>${esc(c.marca)} ${esc(c.modelo)}</b> · ${esc(c.tipo)} · talla ${esc(c.talla)}${c.intercomunicador ? `<br><small>Intercomunicador ${esc(c.intercomunicador.marca)} ${esc(c.intercomunicador.modelo)}${c.intercomunicador.integrado ? ' integrado' : ''}</small>` : ''}</dd>
      <dt>Botas</dt><dd><b>${esc(inv.botas.marca)} ${esc(inv.botas.modelo)}</b><br><small>${flags(inv.botas)}</small></dd>
      ${inv.ropa_tecnica ? `<dt>Primera capa</dt><dd><b>${esc(inv.ropa_tecnica.marca)} ${esc(inv.ropa_tecnica.modelo)}</b>: ${esc((inv.ropa_tecnica.piezas || []).join(', ').toLowerCase())}<br><small>${esc(inv.ropa_tecnica.uso)}</small></dd>` : ''}
      ${inv.camara ? `<dt>Cámara</dt><dd><b>${esc(inv.camara.marca)} ${esc(inv.camara.modelo)}</b> · ${esc(inv.camara.tipo)}${inv.camara.soporte ? `<br><small>Soporte ${esc(inv.camara.soporte.marca)}: ${esc(inv.camara.soporte.tipo.toLowerCase())}, ${esc(inv.camara.soporte.anclajes.toLowerCase())}</small>` : ''}</dd>` : ''}
    </dl>
    ${inv.camara && inv.camara.pendiente_probar ? `<div class="note"><b>Por probar:</b> ${esc(inv.camara.pendiente_probar)}</div>` : ''}
    <h4>Chaquetas</h4><ul>${inv.chaquetas.map((x) => item(x, flags(x))).join('')}</ul>
    <h4>Pantalones</h4><ul>${inv.pantalones.map((x) => item(x, flags(x))).join('')}</ul>
    <h4>Guantes</h4><ul>${inv.guantes.map((x) => item(x, flags(x))).join('')}</ul>
    ${inv.protecciones && inv.protecciones.espaldera ? `<h4>Espaldera</h4><p>${esc(inv.protecciones.espaldera.marca)} ${esc(inv.protecciones.espaldera.modelo)} · montada en ${esc(inv.protecciones.espaldera.montada_en)}</p>` : ''}
    <p><small>${esc(inv.nota)}</small></p></div>`;
}

function viewEquipaje() {
  const d = D.data, eq = d.equipacion_moto, rep = d.reparto_equipaje, ropa = d.ropa_comprada_decathlon_2026_09_09, lav = d.ropa_y_lavanderia, mat = d.material_en_propiedad;
  const MALETAS = { bolsa_deposito_e09cl: '🧳 Bolsa de depósito E09CL', sh38x_izquierda_ropa: '⬅️ SH38X izquierda · ropa', sh38x_derecha_taller_y_aseo: '➡️ SH38X derecha · taller y aseo', sh58x_capas_y_lluvia: '⬆️ SH58X · capas y lluvia' };
  return `<h2>Equipación de moto</h2>
    ${eq.aviso_espaldera ? `<div class="card warn"><div class="card-title"><h3>⚠️ Espaldera</h3><span class="badge warn">Antes de salir</span></div><p>${esc(eq.aviso_espaldera)}</p></div>` : ''}
    <div class="card"><p><b>${esc(eq.decision)}</b></p><h4>Puesto siempre</h4>${list(eq.puesto_siempre)}${eq.lluvia ? `<h4>Si llueve</h4><p>${esc(eq.lluvia)}</p>` : ''}<h4>Tapones</h4><p>${esc(eq.tapones)}</p>${eq.sixs ? `<h4>Primera capa SIXS</h4><p>${esc(eq.sixs)}</p>` : ''}</div>
    <div class="grid">${Object.keys(eq.configuracion_por_tipo_de_dia).map((k) => { const c = eq.configuracion_por_tipo_de_dia[k]; const t = tipoInfo(k); return `<div class="card"><div class="card-title"><h3>${t.icon} ${human(k)}</h3><span class="badge ${t.cls}">Días ${c.dias.join(', ')}</span></div><dl><dt>Pantalón</dt><dd>${esc(c.pantalon)}</dd><dt>Chaqueta</dt><dd>${esc(c.chaqueta)}</dd>${c.nota ? `<dt>Nota</dt><dd>${esc(c.nota)}</dd>` : ''}</dl></div>`; }).join('')}</div>

    <h2>Reparto del equipaje</h2>
    <p class="muted">${esc(rep.regla)}</p>
    ${Object.keys(MALETAS).map((k) => `<div class="card"><h3>${MALETAS[k]}</h3>${list(rep[k])}</div>`).join('')}
    <div class="card warn"><h3>Días sin maletas laterales: ${rep.dias_sin_laterales.dias.map((n) => `<a href="#/etapas/${n}">día ${n}</a>`).join(' y ')}</h3><p>Pasar al SH58X:</p>${list(rep.dias_sin_laterales.pasar_al_sh58x)}</div>
    <div class="card"><h3>🔑 Llaves</h3><p>${esc(rep.llaves)}</p></div>

    <h2>Material en propiedad</h2>
    <div class="card"><dl>${['compresor', 'antirrobo', 'powerbank'].map((k) => `<dt>${human(k)}</dt><dd><b>${esc(mat[k].modelo)}</b><br><small>${esc(mat[k].nota)}</small>${k === 'compresor' && d.proyecto.moto.presiones ? `<br><small>Presiones NX500: ${presionesHTML(d.proyecto.moto, true)}</small>` : ''}</dd>`).join('')}<dt>Otros</dt><dd>${esc(mat.otros.join(', '))}</dd></dl></div>

    <h2>Ropa y lavandería</h2>
    <div class="card"><p>${esc(lav.filosofia)}</p>
      <div class="tbl-wrap"><table><thead><tr><th>Noche</th><th>Lugar</th><th>Cómo</th></tr></thead><tbody>${lav.lavados.map((l) => `<tr><td><b>${l.noche}</b></td><td>${esc(l.lugar)}</td><td>${esc(l.como)}</td></tr>`).join('')}</tbody></table></div>
      <div class="note info"><b>Merino:</b> ${esc(lav.cuidado_merino)}</div></div>
    ${inventarioHTML(d.inventario)}
    <details class="card"><summary>Compra Decathlon del 9 sept (${ropa.total_eur.toFixed(2)} €)</summary>
      <div class="tbl-wrap"><table><thead><tr><th>Artículo</th><th>Talla</th><th>Ud.</th></tr></thead><tbody>${ropa.articulos.map((a) => `<tr><td>${esc(a.articulo)}${a.nota ? `<br><small>${esc(a.nota)}</small>` : ''}</td><td>${esc(a.talla)}</td><td>${a.cantidad}${a.pares_total ? ` <small>(${a.pares_total} pares)</small>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${ropa.boxers ? `<h4>Boxers</h4><p>${esc(ropa.boxers)}</p>` : ''}<h4>Falta</h4>${list(ropa.falta)}</details>`;
}

function viewGuia() {
  const d = D.data, nav = d.proyecto.navegacion, k = nav.kurviger, m = d.proyecto.moto, meta = d.meta;
  const KV = { extra_curvy: 'Extra Curvy', fast: 'Fast', fast_and_curvy: 'Fast & Curvy', curvy: 'Curvy', shaping_points: 'Shaping points', control: 'Control' };
  const conGuia = d.itinerario.filter((e) => e.guia);
  return `${conGuia.length ? `<h2>Guía turística por etapa</h2>
    <div class="card"><p class="muted">Qué ver, dónde parar, qué comer y qué hacer por la tarde. Está en la ficha de cada día.</p>
      <div class="guia-index">${conGuia.map((e) => `<a class="guia-link" href="#/etapas/${e.dia}"><span class="badge">Día ${e.dia}</span><span>${esc((d.alojamientos_resumen.find((n) => n.fecha === e.fecha) || {}).lugar || e.destino.replace(/\s*\(.*\)\s*$/, ''))}</span><small>${esc((e.guia.ver || []).filter((v) => !v.opcional).slice(0, 3).map((v) => v.lugar).join(' · '))}</small></a>`).join('')}</div></div>` : ''}
    <h2>Rutas en Kurviger</h2>
    ${rutasKurvigerHTML()}
    <h2>Navegación</h2>
    <div class="card"><dl><dt>Pantalla</dt><dd>${esc(nav.pantalla)}</dd><dt>Móvil</dt><dd>${esc(nav.movil)}</dd><dt>App</dt><dd>${esc(nav.app)}</dd><dt>Ubicación</dt><dd>${esc(nav.ubicacion_compartida)}</dd><dt>Si falla</dt><dd>${esc(nav.fallback)}</dd></dl></div>
    <div class="card"><h3>Kurviger</h3><dl>${Object.keys(KV).map((key) => `<dt>${KV[key]}</dt><dd>${esc(k[key])}</dd>`).join('')}<dt>Mapas offline</dt><dd>${esc(k.mapas_offline.join(', '))} (${k.mapas_offline.length} provincias)</dd><dt>Rutas a crear</dt><dd>${k.rutas_a_crear}</dd></dl>${k.en_ruta ? `<h4>Siguiendo la ruta</h4>${list(k.en_ruta)}<p><small>Los puntos de despiste de cada día están en su ficha.</small></p>` : ''}</div>

    ${d.seguro ? `<h2>Seguro</h2><div class="card">${seguroHTML(true)}</div>` : ''}
    <h2>La moto</h2>
    <div class="card"><dl><dt>Modelo</dt><dd>${esc(m.modelo)}</dd><dt>Rueda delantera</dt><dd>${esc(m.rueda_delantera)}</dd><dt>Neumáticos</dt><dd>${esc(m.neumaticos)}</dd><dt>Toma USB-C</dt><dd>${m.toma_usb_c ? 'Sí' : 'No'}</dd><dt>Autonomía</dt><dd>${m.autonomia_orientativa_km} km orientativos</dd><dt>Gasolina</dt><dd>${esc(m.regla_gasolina)}</dd>${m.presiones ? `<dt>Presiones</dt><dd>${presionesHTML(m)}</dd>` : ''}${m.precarga_trasera ? `<dt>Precarga trasera</dt><dd><b>Posición ${esc(m.precarga_trasera.recomendada)}</b> (de serie: ${esc(m.precarga_trasera.de_serie)}; ${m.precarga_trasera.posiciones} posiciones)<br><small>${esc(m.precarga_trasera.como)} ${esc(m.precarga_trasera.por_que)}</small></dd>` : ''}${m.carga ? `<dt>Carga</dt><dd>Estimación del viaje: <b>${m.carga.estimacion_viaje.total_kg} kg</b> (piloto ${m.carga.estimacion_viaje.piloto_kg} + equipación ${m.carga.estimacion_viaje.equipacion_puesta_kg} + maletas ${m.carga.estimacion_viaje.maletas_vacias_kg} + contenido ${m.carga.estimacion_viaje.contenido_kg}) frente a unos ${m.carga.carga_maxima_kg_aprox} kg de carga máxima.<br><small>${esc(m.carga.regla)} ${esc(m.carga.carga_maxima_nota)}</small></dd>` : ''}<dt>Equipaje</dt><dd>${esc(m.equipaje.join(', '))}</dd></dl></div>

    <h2>Vacaciones</h2>
    <div class="card"><p>Del ${fmtFecha(d.proyecto.vacaciones.inicio)} al ${fmtFecha(d.proyecto.vacaciones.fin)}. Margen tras el viaje: ${d.proyecto.vacaciones.margen_tras_el_viaje_dias} días.</p></div>

    <h2>Principios del plan</h2>
    <div class="card">${list(d.principios_para_claude)}</div>

    <h2>Versión del plan</h2>
    <div class="card"><p><b>JSON v${meta.version}${meta.revision ? `.${meta.revision}` : ''}</b> · actualizado ${meta.actualizado}<br><small>${esc(meta.sustituye_a)}</small></p><p><small>${esc(meta.uso)}</small></p><details><summary>Cambios en v${meta.version}</summary>${list(meta.cambios_v3)}</details></div>`;
}

/* Resumen de la poliza (sin datos personales). full=true: version completa para la Guia. */
function seguroHTML(full) {
  const s = D.data.seguro; if (!s) return '';
  const seg = contacto('seguro_asistencia');
  const tel = seg && typeof seg === 'object' ? [seg.telefono, ...(seg.telefonos_alternativos || [])].filter(Boolean) : [];
  const pasos = (arr) => `<ol>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`;
  const cob = `<div class="tbl-wrap"><table class="seguro"><tbody>${s.coberturas.map((c) => `<tr><td>${esc(c.nombre)}</td><td>${esc(c.limite)}</td></tr>`).join('')}</tbody></table></div>`;
  const acc = s.accesorios_declarados && s.accesorios_declarados.length ? `<h4>Accesorios declarados</h4><ul>${s.accesorios_declarados.map((a) => `<li>${esc(a.nombre)}${a.valor_eur ? ` <small>(${fmtEur(a.valor_eur)})</small>` : ''}</li>`).join('')}</ul>` : '';
  const basico = `<p><b>${esc(s.compania)}</b> · ${esc(s.producto)}<br><small>Vigente del ${fmtFecha(s.vigencia.desde)} ${s.vigencia.desde.slice(0, 4)} al ${fmtFecha(s.vigencia.hasta)} ${s.vigencia.hasta.slice(0, 4)}.</small></p>
    <p>📞 Asistencia 24 h: ${tel.map(telLink).join(' · ')}</p>
    ${s.no_incluye ? `<div class="note"><b>Ojo:</b> ${esc(s.no_incluye)}</div>` : ''}
    <h4>Si hay avería o accidente</h4>${pasos(s.en_caso_de.averia_o_accidente)}
    <h4>Si roban la moto</h4>${pasos(s.en_caso_de.robo)}`;
  if (!full) return `${basico}<p><small>${esc(s.documento)}</small></p>`;
  return `${basico}
    <h4>Coberturas y límites</h4>${cob}
    ${acc}
    <h4>Lo que no cubre (lo que importa en este viaje)</h4>${list(s.exclusiones_relevantes)}
    ${s.aviso ? `<div class="note"><b>Por comprobar:</b> ${esc(s.aviso)}</div>` : ''}
    <p><small>${esc(s.documento)}</small></p>`;
}

/* Tabla con las 11 rutas tal y como se llaman en Kurviger (nombre del GPX), km y tiempo. */
function rutasKurvigerHTML() {
  const it = D.data.itinerario; const con = it.filter((e) => e.gpx && e.gpx.track);
  if (!con.length) return '';
  con.forEach(trackLoad);
  const col = D.data.proyecto.navegacion.kurviger.coleccion;
  const info = (e) => { const k = e.gpx.kurviger; const t = D.tracks[e.dia] && D.tracks[e.dia].data; return k ? { nombre: k.nombre, km: k.km, min: k.duracion_min, url: k.cloud_url, cortes: k.cortes_reportados } : t ? { nombre: t.nombre, km: t.km, min: t.duracion_min } : null; };
  const rows = con.map((e) => { const i = info(e); return `<tr><td><a href="#/etapas/${e.dia}">Día ${e.dia}</a></td><td>${i ? (i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.nombre.replace(/^Día \d+ · /, ''))}</a>` : esc(i.nombre)) : '<span class="muted">cargando…</span>'}${i && i.cortes ? ` <span class="badge warn" title="Cortes de carretera reportados">🚧 ${i.cortes}</span>` : ''}</td><td>${i ? fmtKm(i.km) : `${e.km_aprox} km`}</td><td>${i ? fmtMin(i.min) : '–'}</td><td><a href="${esc(e.gpx.archivo)}" download title="Descargar GPX">⬇️</a></td></tr>`; }).join('');
  const tot = con.reduce((s, e) => { const i = info(e); return s + (i ? i.km : e.km_aprox); }, 0);
  const min = con.reduce((s, e) => { const i = info(e); return s + (i && i.min ? i.min : 0); }, 0);
  return `<div class="card">${col ? `<p><b>Colección «${esc(col.nombre)}»</b> en Kurviger Cloud · ${col.rutas} rutas · ${fmtKm(Math.round(col.km_total))} · ${fmtMin(col.duracion_min)} · +${fmtM(col.desnivel_subida_m)}<br><a class="btn small primary" href="${esc(col.url)}" target="_blank" rel="noopener">🧭 Abrir la colección en Kurviger</a></p><p class="muted"><small>Toca el nombre de una ruta para abrirla en Kurviger (app o web). Comprueba que en el móvil tienes estas ${con.length} rutas descargadas.</small></p>` : `<p class="muted"><small>Nombre exacto de cada ruta en Kurviger, según el GPX guardado. Comprueba que en el móvil tienes estas ${con.length} rutas.</small></p>`}
    <div class="tbl-wrap"><table class="rutas"><thead><tr><th>Día</th><th>Ruta en Kurviger</th><th>km</th><th>Kurviger</th><th></th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td></td><td><b>Total</b></td><td><b>${fmtKm(Math.round(tot))}</b></td><td><b>${fmtMin(min)}</b></td><td></td></tr></tfoot></table></div>
    <p class="row">${window.VIAJE_DATA ? '' : '<button class="btn primary" type="button" data-mapa="todos">🗺️ Mapa del viaje completo</button>'}<a class="btn" href="#/hoja">📄 Hoja de ruta</a></p></div>`;
}

/* Hoja de ruta: todo el viaje en una pagina compacta, pensada para imprimir o por si falla el movil. */
function viewHoja() {
  const d = D.data, it = d.itinerario, p = d.proyecto, c = d.contactos;
  const seg = contacto('seguro_asistencia'), casa = contacto('en_casa');
  const telTxt = (x) => typeof x === 'string' ? x : (x && x.telefono) || '—';
  const rows = it.map((e) => {
    const a = e.alojamiento; const n = d.alojamientos_resumen.find((x) => x.fecha === e.fecha);
    const t = D.tracks[e.dia] && D.tracks[e.dia].data;
    return `<tr><td><b>${e.dia}</b><br><small>${cap(e.dia_semana).slice(0, 3)} ${fmtFecha(e.fecha)}</small></td>
      <td><b>${esc(e.origen)} → ${esc(e.destino)}</b><br><small>${esc(e.waypoints.join(' · '))}</small>${e.gpx && e.gpx.kurviger ? `<br><small class="muted">Kurviger: ${esc(e.gpx.kurviger.nombre)}</small>` : t ? `<br><small class="muted">Kurviger: ${esc(t.nombre)}</small>` : ''}</td>
      <td class="num">${e.km_aprox} km<br><small>${esc(e.tiempo_real_aprox)}</small><br><small>${esc(e.salida.split(' ')[0])} → ${esc(e.llegada_prevista.split(' ')[0])}</small></td>
      <td>${a ? `<b>${esc(a.nombre)}</b><br><small>${esc(a.direccion)}</small><br>${telLink(a.telefono)}${pagoInfo(a) && pagoInfo(a).pendiente ? `<br><small>Por pagar: ${fmtEur(a.pago.pendiente_eur, a.pago.aproximado)}</small>` : ''}` : n ? `<b>${esc(n.alojamiento)}</b><br><small>${esc(n.lugar)}</small><br>${telLink(n.telefono)}` : '<small>Casa</small>'}</td></tr>`;
  }).join('');
  it.forEach(trackLoad);
  return `<div class="card accent hoja"><div class="card-title"><h1>Hoja de ruta · ${esc(p.nombre)}</h1><button class="btn small" type="button" id="imprimir">🖨️ Imprimir</button></div>
      <p class="muted">${fmtFecha(p.fechas.inicio)} – ${fmtFecha(p.fechas.fin)} ${p.fechas.inicio.slice(0, 4)} · ${it.length} etapas · ${p.distancia_total_aprox_km} km · ${esc(p.moto.modelo)} · ${esc(p.piloto.nombre)}</p>
      <p><b>Emergencias ${telLink(c.emergencias)}</b> · Seguro ${typeof seg === 'object' ? esc(seg.compania) + ' ' : ''}${telLink(telTxt(seg))}${typeof seg === 'object' && seg.telefonos_alternativos ? ` / ${seg.telefonos_alternativos.map(telLink).join(' / ')}` : ''} · En casa ${typeof casa === 'object' && casa.telefono ? telLink(casa.telefono) : '<small>(número en el móvil)</small>'}</p>
    </div>
    <div class="card hoja"><div class="tbl-wrap"><table class="hoja-tabla"><thead><tr><th>Día</th><th>Etapa y puntos de paso</th><th>km</th><th>Noche</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <div class="card hoja"><h3>Reglas</h3><ul><li>Conducción real: objetivo ${esc(p.reglas_globales.conduccion_real_objetivo)}, máximo ${esc(p.reglas_globales.conduccion_real_maximo)}.</li><li>${esc(p.reglas_globales.horario)}</li><li>${esc(p.moto.regla_gasolina)}</li>${p.moto.presiones ? `<li>Presiones: ${presionesHTML(p.moto, true)}.</li>` : ''}<li>${esc(d.meteo.regla)}</li>${d.seguro ? `<li>Seguro ${esc(d.seguro.compania)}, ${esc(d.seguro.producto.split(' (')[0])}: en avería o accidente llamar a asistencia ANTES de pedir grúa o taller.${contactosLocales()['seguro_asistencia:poliza'] ? ` Póliza nº ${esc(contactosLocales()['seguro_asistencia:poliza'])}.` : ''}</li>` : ''}</ul></div>
    <p class="version no-print"><a href="#/resumen">← Resumen</a></p>`;
}

/* ---------- router y arranque ---------- */
const VIEWS = { resumen: viewResumen, etapas: viewEtapas, noches: viewNoches, tiempo: viewTiempo, listas: viewListas, equipaje: viewEquipaje, guia: viewGuia, hoja: viewHoja, sos: viewSos, buscar: viewBuscar };

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [view, arg] = h.split('/');
  return { view: VIEWS[view] ? view : 'resumen', arg };
}

function render() {
  if (!D.data) return;
  const { view, arg } = route();
  document.getElementById('view').innerHTML = VIEWS[view](arg);
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  const titles = { resumen: 'Resumen', etapas: arg ? `Día ${arg}` : 'Etapas', noches: 'Noches', tiempo: 'Tiempo', listas: 'Listas', equipaje: 'Equipaje', guia: 'Guía', hoja: 'Hoja de ruta', sos: 'Emergencia', buscar: 'Buscar' };
  document.body.classList.toggle('vista-sos', view === 'sos');
  document.title = `${titles[view]} · Viaje NX500`;
  window.scrollTo(0, 0);
  const q = document.getElementById('buscar-q'); if (q && !arg) { try { q.focus(); } catch (e) { /* nada */ } }
  const chip = document.querySelector('.chip.active');
  if (chip && chip.scrollIntoView) { try { chip.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) { /* navegadores antiguos */ } }
}

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (!(el instanceof HTMLInputElement) || !el.dataset.key) return;
  if (el.checked) D.checks[el.dataset.key] = true; else delete D.checks[el.dataset.key];
  saveChecks();
  el.closest('.check').classList.toggle('done', el.checked);
  // Refresca contadores sin perder el scroll.
  const y = window.scrollY; render(); window.scrollTo(0, y);
});

document.addEventListener('submit', (ev) => {
  const g = ev.target.closest('.gasto-form');
  if (g) {
    ev.preventDefault();
    const dia = g.dataset.gasto; const all = lsGet(GASTOS_KEY, {}); const imp = parseFloat(String(g.importe.value).replace(',', '.'));
    if (!(imp > 0)) return;
    (all[dia] = all[dia] || []).push({ tipo: g.tipo.value, importe: Math.round(imp * 100) / 100, concepto: g.concepto.value.trim(), t: Date.now() });
    lsSet(GASTOS_KEY, all); const y = window.scrollY; render(); window.scrollTo(0, y); return;
  }
  const b = ev.target.closest('#buscar-form');
  if (b) { ev.preventDefault(); location.hash = `#/buscar/${encodeURIComponent(document.getElementById('buscar-q').value.trim())}`; return; }
  const f = ev.target.closest('.tel-local'); if (!f) return;
  ev.preventDefault();
  const k = f.dataset.campo === 'poliza' ? `${f.dataset.contacto}:poliza` : f.dataset.campo === 'texto' ? `${f.dataset.contacto}:texto` : f.dataset.contacto;
  setContactoLocal(k, f.querySelector('input').value.trim());
  const y = window.scrollY; render(); window.scrollTo(0, y);
});
let DIARIO_T = 0;
document.addEventListener('input', (ev) => {
  const ta = ev.target.closest('[data-diario]'); if (!ta) return;
  clearTimeout(DIARIO_T);
  DIARIO_T = setTimeout(() => { const all = lsGet(DIARIO_KEY, {}); if (ta.value.trim()) all[ta.dataset.diario] = ta.value; else delete all[ta.dataset.diario]; lsSet(DIARIO_KEY, all); }, 400);
});

document.addEventListener('click', (ev) => {
  if (ev.target.closest('#reload-plan')) { ev.preventDefault(); location.reload(); return; }
  if (ev.target.closest('#meteo-refresh')) { meteoFetch(true); render(); return; }
  const del = ev.target.closest('[data-borrar]');
  if (del) { const f = del.closest('.tel-local'); setContactoLocal(f.dataset.campo === 'poliza' ? `${f.dataset.contacto}:poliza` : f.dataset.campo === 'texto' ? `${f.dataset.contacto}:texto` : f.dataset.contacto, ''); const y = window.scrollY; render(); window.scrollTo(0, y); return; }
  const mb = ev.target.closest('[data-mapa]'); if (mb) { openMap(mb.dataset.mapa); return; }
  const av = ev.target.closest('[data-avisar]'); if (av) { avisarCasa(av.dataset.avisar); return; }
  const lz = ev.target.closest('[data-localizar]'); if (lz) { localizar(lz.dataset.localizar); return; }
  if (ev.target.closest('[data-compartir-pos]')) { compartirPos(); return; }
  const gb = ev.target.closest('[data-gasto-borrar]'); if (gb) { const [dia, i] = gb.dataset.gastoBorrar.split('|'); const all = lsGet(GASTOS_KEY, {}); (all[dia] || []).splice(+i, 1); lsSet(GASTOS_KEY, all); const y = window.scrollY; render(); window.scrollTo(0, y); return; }
  if (ev.target.closest('#tema')) { ciclarTema(); return; }
  if (ev.target.closest('#backup-copiar')) { backupCopiar(); return; }
  if (ev.target.closest('#backup-restaurar')) { backupRestaurar(); return; }
  if (ev.target.closest('#imprimir')) { ev.preventDefault(); window.print(); return; }
  if (ev.target.closest('#instalar')) { const p = D.installEvt; if (!p) return; D.installEvt = null; p.prompt(); p.userChoice.then(() => render()).catch(() => render()); return; }
  if (ev.target.closest('#ios-hint-ok')) { try { localStorage.setItem('viaje-nx500-ios-hint', '1'); } catch (e) { /* nada */ } render(); return; }
  if (ev.target.closest('#mapa-cerrar')) { closeMap(); return; }
  const btn = ev.target.closest('#reset-checks');
  if (!btn) return;
  if (confirm('¿Borrar todas las marcas de las listas en este dispositivo?')) { D.checks = {}; saveChecks(); render(); }
});

window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); D.installEvt = ev; rerender('resumen'); });
window.addEventListener('appinstalled', () => { D.installEvt = null; toast('App instalada'); rerender('resumen'); });
/* Al imprimir se abren todos los desplegables y se restauran despues. */
let PRINT_OPEN = [];
window.addEventListener('beforeprint', () => { PRINT_OPEN = [...document.querySelectorAll('details:not([open])')]; PRINT_OPEN.forEach((d) => { d.open = true; }); });
window.addEventListener('afterprint', () => { PRINT_OPEN.forEach((d) => { d.open = false; }); PRINT_OPEN = []; });

/* Tema: auto (segun el sistema), claro o oscuro. Con sol en la carretera el claro se lee mejor. */
const TEMAS = ['auto', 'light', 'dark'];
function aplicarTema() {
  const t = lsGet(TEMA_KEY, 'auto');
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const b = document.getElementById('tema'); if (b) { b.textContent = t === 'auto' ? '◐' : t === 'light' ? '☀️' : '🌙'; b.title = `Tema: ${t === 'auto' ? 'según el sistema' : t === 'light' ? 'claro' : 'oscuro'} (pulsa para cambiar)`; }
}
function ciclarTema() { const t = lsGet(TEMA_KEY, 'auto'); lsSet(TEMA_KEY, TEMAS[(TEMAS.indexOf(t) + 1) % TEMAS.length]); aplicarTema(); }

/* Copia de seguridad de todo lo local (portapapeles). */
const LOCAL_KEYS = [STORAGE_KEY, CONTACTOS_KEY, DIARIO_KEY, GASTOS_KEY, TEMA_KEY, 'viaje-nx500-ios-hint'];
async function backupCopiar() {
  const out = { app: 'viaje-nx500', fecha: new Date().toISOString(), datos: {} };
  LOCAL_KEYS.forEach((k) => { const v = localStorage.getItem(k); if (v != null) out.datos[k] = v; });
  const txt = JSON.stringify(out);
  try { await navigator.clipboard.writeText(txt); toast('Copia de seguridad copiada al portapapeles'); }
  catch (e) { prompt('Copia este texto y guárdalo:', txt); }
}
async function backupRestaurar() {
  let txt = '';
  try { txt = await navigator.clipboard.readText(); } catch (e) { txt = prompt('Pega aquí la copia de seguridad:') || ''; }
  let obj; try { obj = JSON.parse(txt); } catch (e) { toast('Eso no es una copia de seguridad válida'); return; }
  if (!obj || obj.app !== 'viaje-nx500' || !obj.datos) { toast('Eso no es una copia de seguridad válida'); return; }
  if (!confirm(`Restaurar la copia del ${new Date(obj.fecha).toLocaleString('es-ES')}? Sustituye las marcas y datos locales de este móvil.`)) return;
  Object.keys(obj.datos).forEach((k) => { if (LOCAL_KEYS.includes(k)) localStorage.setItem(k, obj.datos[k]); });
  D.checks = loadChecks(); aplicarTema(); render(); toast('Copia restaurada');
}

function updateNet() { const n = document.getElementById('net'); n.classList.toggle('off', !navigator.onLine); n.title = navigator.onLine ? 'Con conexión' : 'Sin conexión (modo offline)'; }
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);

function registerSW() {
  if (!('serviceWorker' in navigator) || window.VIAJE_DATA) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing; if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          const t = document.getElementById('toast');
          document.getElementById('toast-text').textContent = 'Hay una versión nueva del plan.';
          t.hidden = false;
          document.getElementById('toast-btn').onclick = () => { nw.postMessage('skipWaiting'); };
        }
      });
    });
  }).catch(() => { /* sin SW (p. ej. file://) */ });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded) return; reloaded = true; location.reload(); });
}

async function init() {
  updateNet(); aplicarTema();
  try {
    if (window.VIAJE_DATA) {
      D.data = window.VIAJE_DATA; // version empaquetada en un solo fichero
    } else {
      const res = await fetch('data/viaje.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      D.fromCache = res.headers.get('X-Viaje-Cache') === 'offline';
      D.data = await res.json();
    }
  } catch (err) {
    document.getElementById('view').innerHTML = `<div class="card warn"><h3>No se pudo cargar el plan</h3><p>${esc(err.message)}</p><p><small>Si abres el archivo directamente (file://), sirve la carpeta con un servidor local o usa la versión publicada.</small></p></div>`;
    return;
  }
  const f = D.data.proyecto.fechas;
  document.getElementById('brand-sub').textContent = `${fmtFecha(f.inicio)} – ${fmtFecha(f.fin)} ${f.inicio.slice(0, 4)} · ${planVersion()}`;
  meteoLoadCache(); meteoHLoadCache();
  window.addEventListener('hashchange', () => { closeMap(); render(); });
  render();
  registerSW();
  if (route().view !== 'tiempo') meteoFetch(false); // la vista Tiempo ya lo pide
}

init();
