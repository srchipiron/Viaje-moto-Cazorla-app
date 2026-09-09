/* Viaje NX500 · app estática. Lee data/viaje.json (fuente de verdad) y guarda
   las marcas de checklist en localStorage. Sin dependencias ni build. */
'use strict';

const STORAGE_KEY = 'viaje-nx500-v3-checks';
const D = { data: null, checks: loadChecks() };

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
function dots(n, max = 5) { return `<span class="dots d${n}" title="${n}/${max}">${'●'.repeat(n)}${'○'.repeat(max - n)}</span>`; }
function tipoInfo(t) { const m = t.startsWith('montaña'); return { icon: m ? '⛰️' : '☀️', cls: m ? 'mount' : 'hot', label: human(t) }; }
function list(items) { return `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`; }
function fmtVal(k, v) {
  if (Array.isArray(v)) return esc(v.join(', '));
  if (typeof v === 'number') {
    if (/precio.*eur|_eur_/.test(k) || /_eur$/.test(k)) return `${v} €`;
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
function previaKeys() { const c = D.data.checklist_previa; return Object.keys(c).flatMap((g) => c[g].map((t) => `previa|${g}|${t}`)); }

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
    <div class="stats"><b>${e.km_aprox} km</b><span><b>${esc(e.tiempo_real_aprox)}</b> reales</span><span>Dif. ${dots(e.dificultad)}</span><span>Fatiga ${dots(e.fatiga)}</span><span>${esc(e.perfil_kurviger)}</span></div>
  </a>`;
}

function viewResumen() {
  const p = D.data.proyecto, it = D.data.itinerario, today = todayISO();
  const hoy = it.find((d) => d.fecha === today);
  let estado;
  if (today < p.fechas.inicio) {
    const n = daysBetween(today, p.fechas.inicio);
    const keys = previaKeys();
    estado = `<div class="card warn"><div class="card-title"><h3>Faltan ${n} día${n === 1 ? '' : 's'} para la salida</h3>${progress(keys)}</div>
      <p>Salida el lunes ${fmtFecha(p.fechas.inicio)} a las ${esc(it[0].salida)} hacia ${esc(it[0].destino)}.</p>${bar(keys)}
      <p><a class="btn small" href="#/listas">Checklist previa</a> <a class="btn small" href="#/etapas/1">Ver día 1</a></p></div>`;
  } else if (hoy) {
    const manana = it.find((d) => d.dia === hoy.dia + 1);
    estado = `<h2>Hoy</h2>${etapaCard(hoy, { hoy: true })}${manana ? `<h4>Mañana</h4>${etapaCard(manana)}` : ''}`;
  } else if (today > p.fechas.fin) {
    estado = `<div class="card ok"><h3>Viaje terminado</h3><p>Hasta el ${fmtFecha(p.vacaciones.fin)} quedan ${p.vacaciones.margen_tras_el_viaje_dias} días de margen de vacaciones.</p></div>`;
  }
  const r = p.reglas_globales, m = p.moto, c = D.data.contactos, rd = D.data.rutina_diaria;
  const contactoRow = (label, val) => {
    const pend = /^PENDIENTE/i.test(val);
    return `<dt>${label}</dt><dd>${pend ? `<span class="badge warn">Pendiente</span> <small>${esc(val.replace(/^PENDIENTE:\s*/i, ''))}</small>` : telLink(val)}</dd>`;
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
    </div>
    ${estado || ''}
    <h2>Contactos</h2>
    <div class="card"><dl>${contactoRow('Emergencias', c.emergencias)}${contactoRow('Seguro / asistencia', c.seguro_asistencia)}${contactoRow('En casa', c.en_casa)}</dl>
      <p><a class="btn small" href="#/noches">Teléfonos de alojamientos</a></p></div>
    <h2>Reglas del viaje</h2>
    <div class="card">
      <dl>
        <dt>Conducción real</dt><dd>Objetivo <b>${esc(r.conduccion_real_objetivo)}</b>, máximo <b>${esc(r.conduccion_real_maximo)}</b></dd>
        <dt>Superficie</dt><dd>${esc(r.superficie)}</dd>
        <dt>Horario</dt><dd>${esc(r.horario)}</dd>
        <dt>Paradas</dt><dd>${esc(r.paradas)}</dd>
        <dt>Gasolina</dt><dd>${esc(m.regla_gasolina)} Autonomía orientativa: ${m.autonomia_orientativa_km} km.</dd>
        <dt>Recortable</dt><dd>${esc(r.recortables_sin_cambiar_alojamiento.join(' · '))}</dd>
      </dl>
    </div>
    <h2>Rutina diaria</h2>
    <div class="card">
      ${Object.keys(rd).map((k) => `<details${k === 'mañana' || k === 'en_ruta' ? ' open' : ''}><summary>${human(k)}</summary>${list(rd[k])}</details>`).join('')}
    </div>
    <h2>Filosofía</h2>
    <div class="card"><p class="muted">${esc(p.piloto.nombre)} · ${esc(p.piloto.nivel)}</p>${list(p.piloto.filosofia)}</div>`;
}

function alojamientoCard(dia) {
  const a = dia.alojamiento; if (!a) return '';
  const LABELS = { tipo: 'Tipo', precio_eur: 'Precio', precio_total_eur: 'Precio total', precio_referencia_eur_noche: 'Precio ref. / noche', moto_eur_dia: 'Moto / día', checkin: 'Check-in', recepcion: 'Recepción', servicios: 'Servicios', horario_google: 'Horario (Google)', parking: 'Parking', moto: 'Moto', desayuno: 'Desayuno', restaurante: 'Restaurante', noches: 'Noches', fechas: 'Fechas', altitud_m: 'Altitud' };
  const rows = Object.keys(LABELS).filter((k) => a[k] != null).map((k) => `<dt>${LABELS[k]}</dt><dd>${fmtVal(k, a[k])}</dd>`).join('');
  const keys = confirmarKeys(dia);
  const pend = a.pendiente_confirmar ? `<h4>Pendiente de confirmar ${progress(keys)}</h4>${a.pendiente_confirmar.map((t) => checkItem(`confirmar|${dia.dia}|${t}`, t)).join('')}` : '';
  const planB = a.plan_b_cena || a.plan_b;
  return `<h2>Alojamiento</h2>
    <div class="card ok">
      <div class="card-title"><h3>${esc(a.nombre)}</h3><span class="badge ok">${esc(a.estado)}</span></div>
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
      ${e.objetivo ? `<div class="note info"><b>Objetivo:</b> ${esc(e.objetivo)}</div>` : ''}
      ${e.equipaje ? `<div class="note"><b>Equipaje:</b> ${esc(e.equipaje)}</div>` : ''}
      ${e.opcional ? `<div class="note mount"><b>Opcional:</b> ${esc(e.opcional)}</div>` : ''}
    </div>

    <h2>Waypoints (${e.waypoints.length})</h2>
    <div class="card"><ol class="wp">${e.waypoints.map((w) => `<li><a href="${mapsSearch(w)}" target="_blank" rel="noopener">${esc(w)}</a><span class="go">mapa ↗</span></li>`).join('')}</ol>
      <p><small>Enlaces de consulta en Google Maps. La ruta real se crea en Kurviger con estos puntos como shaping points sobre la carretera.</small></p></div>

    ${e.horario_orientativo ? `<h2>Horario orientativo</h2><div class="card"><div class="tbl-wrap"><table><thead><tr><th>Hora</th><th>Lugar</th><th>Qué</th></tr></thead><tbody>${e.horario_orientativo.map((h) => `<tr><td><b>${esc(h.hora)}</b></td><td>${esc(h.lugar)}</td><td>${esc(h.que)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    ${e.paradas ? `<h2>Paradas</h2><div class="card">${list(e.paradas)}</div>` : ''}
    ${e.notas ? `<h2>Notas</h2><div class="card">${list(e.notas)}</div>` : ''}

    ${cfg ? `<h2>Equipación del día</h2><div class="card"><p class="muted">Configuración «${human(cfgKey)}»</p><dl><dt>Pantalón</dt><dd>${esc(cfg.pantalon)}</dd><dt>Chaqueta</dt><dd>${esc(cfg.chaqueta)}</dd>${cfg.nota ? `<dt>Nota</dt><dd>${esc(cfg.nota)}</dd>` : ''}</dl>
      ${sinLat.dias.includes(n) ? `<div class="note"><b>Sin maletas laterales.</b> Pasar al SH58X: ${esc(sinLat.pasar_al_sh58x.join(', '))}.</div>` : ''}</div>` : ''}

    ${alojamientoCard(e)}
    ${e.lavanderia ? `<h2>Lavandería</h2><div class="card"><div class="card-title"><h3>${esc(e.lavanderia.nombre)}</h3><span class="badge">${esc(e.lavanderia.horario)}</span></div>
      <p>${esc(e.lavanderia.direccion)} · <a href="${mapsSearch(e.lavanderia.nombre + ', ' + e.lavanderia.direccion)}" target="_blank" rel="noopener">mapa ↗</a></p><p>${esc(e.lavanderia.precio)}</p><div class="note info">${esc(e.lavanderia.plan)}</div></div>` : ''}

    <div class="nav-prev-next">
      ${prev ? `<a class="btn" href="#/etapas/${prev.dia}">← Día ${prev.dia}</a>` : '<span></span>'}
      ${next ? `<a class="btn" href="#/etapas/${next.dia}">Día ${next.dia} →</a>` : '<span></span>'}
    </div>`;
}

function viewNoches() {
  const it = D.data.itinerario, today = todayISO();
  const total = it.reduce((s, d) => { const a = d.alojamiento; return s + (a ? (a.precio_eur || a.precio_total_eur || (a.precio_referencia_eur_noche || 0) * (a.noches || 1)) : 0); }, 0);
  return `<h2>Las ${D.data.alojamientos_resumen.length} noches</h2>
    <p class="muted">Todas reservadas y pagadas. Total aprox. ${total} €. Toca el teléfono para llamar.</p>
    ${D.data.alojamientos_resumen.map((n) => {
      const dia = it.find((d) => d.fecha === n.fecha);
      const a = dia && dia.alojamiento;
      return `<div class="card${n.fecha === today ? ' warn' : ''}">
        <div class="card-title"><h3>Noche ${n.noche} · ${esc(n.lugar)}</h3><span class="muted">${fmtFecha(n.fecha)}</span></div>
        <p><b>${esc(n.alojamiento)}</b></p>
        <div class="row spread"><span>📞 ${telLink(n.telefono)}</span><span class="badge ok">${esc(n.estado)}</span></div>
        ${dia ? `<p><a class="btn small" href="#/etapas/${dia.dia}">Día ${dia.dia}${a ? ' · ficha completa' : ''}</a>${a ? ` <a class="btn small" href="${mapsDir(a.direccion)}" target="_blank" rel="noopener">Cómo llegar</a>` : ''}</p>` : ''}
      </div>`;
    }).join('')}`;
}

function viewListas() {
  const d = D.data;
  const grupos = { jueves_10: 'Jueves 10', viernes_11: 'Viernes 11', sabado_12_o_domingo_13: 'Sábado 12 o domingo 13', domingo_13_tarde: 'Domingo 13 por la tarde' };
  const previa = Object.keys(d.checklist_previa).map((g) => {
    const keys = d.checklist_previa[g].map((t) => `previa|${g}|${t}`);
    return `<div class="card"><div class="card-title"><h3>${grupos[g] || human(g)}</h3>${progress(keys)}</div>${d.checklist_previa[g].map((t) => checkItem(`previa|${g}|${t}`, t)).join('')}</div>`;
  }).join('');
  const compraKeys = d.compras_pendientes.map((c) => `compra|${c.que}`);
  const amazonKeys = d.pedido_amazon_llega_2026_09_10.map((t) => `amazon|${t}`);
  const faltaKeys = d.ropa_comprada_decathlon_2026_09_09.falta.map((t) => `falta|${t}`);
  const confDias = d.itinerario.filter((e) => e.alojamiento && e.alojamiento.pendiente_confirmar);
  const confKeys = confDias.flatMap(confirmarKeys);
  const contactoKeys = ['contacto|seguro_asistencia', 'contacto|en_casa'];
  const all = [...previaKeys(), ...compraKeys, ...amazonKeys, ...faltaKeys, ...confKeys, ...contactoKeys];
  return `<div class="card accent"><div class="card-title"><h1>Listas</h1>${progress(all)}</div>${bar(all)}<p><small>Las marcas se guardan en este dispositivo.</small></p></div>
    <h2>Checklist previa</h2>${previa}
    <h2>Compras pendientes ${progress(compraKeys)}</h2>
    <div class="card">${d.compras_pendientes.map((c) => checkItem(`compra|${c.que}`, c.que, [c.donde, c.cuando].filter((x) => x && x !== '-').join(' · '))).join('')}</div>
    <h2>Pedido Amazon (llega 10 sept) ${progress(amazonKeys)}</h2>
    <div class="card">${d.pedido_amazon_llega_2026_09_10.map((t) => checkItem(`amazon|${t}`, t)).join('')}</div>
    <h2>Ropa: falta ${progress(faltaKeys)}</h2>
    <div class="card">${d.ropa_comprada_decathlon_2026_09_09.falta.map((t) => checkItem(`falta|${t}`, t)).join('')}</div>
    <h2>Contactos pendientes ${progress(contactoKeys)}</h2>
    <div class="card">${checkItem('contacto|seguro_asistencia', 'Seguro / asistencia', d.contactos.seguro_asistencia)}${checkItem('contacto|en_casa', 'Contacto en casa', d.contactos.en_casa)}</div>
    <h2>Confirmar con alojamientos ${progress(confKeys)}</h2>
    ${confDias.map((e) => `<div class="card"><div class="card-title"><h3><a href="#/etapas/${e.dia}">Día ${e.dia} · ${esc(e.alojamiento.nombre)}</a></h3>${progress(confirmarKeys(e))}</div><p>📞 ${telLink(e.alojamiento.telefono)}</p>${e.alojamiento.pendiente_confirmar.map((t) => checkItem(`confirmar|${e.dia}|${t}`, t)).join('')}</div>`).join('')}
    <p style="margin-top:20px"><button class="btn small danger" type="button" id="reset-checks">Borrar todas las marcas</button></p>`;
}

function viewEquipaje() {
  const d = D.data, eq = d.equipacion_moto, rep = d.reparto_equipaje, ropa = d.ropa_comprada_decathlon_2026_09_09, lav = d.ropa_y_lavanderia, mat = d.material_en_propiedad;
  const MALETAS = { bolsa_deposito_e09cl: '🧳 Bolsa de depósito E09CL', sh38x_izquierda_ropa: '⬅️ SH38X izquierda · ropa', sh38x_derecha_taller_y_aseo: '➡️ SH38X derecha · taller y aseo', sh58x_capas_y_lluvia: '⬆️ SH58X · capas y lluvia' };
  return `<h2>Equipación de moto</h2>
    <div class="card"><p><b>${esc(eq.decision)}</b></p><h4>Puesto siempre</h4>${list(eq.puesto_siempre)}<h4>Tapones</h4><p>${esc(eq.tapones)}</p></div>
    <div class="grid">${Object.keys(eq.configuracion_por_tipo_de_dia).map((k) => { const c = eq.configuracion_por_tipo_de_dia[k]; const t = tipoInfo(k); return `<div class="card"><div class="card-title"><h3>${t.icon} ${human(k)}</h3><span class="badge ${t.cls}">Días ${c.dias.join(', ')}</span></div><dl><dt>Pantalón</dt><dd>${esc(c.pantalon)}</dd><dt>Chaqueta</dt><dd>${esc(c.chaqueta)}</dd>${c.nota ? `<dt>Nota</dt><dd>${esc(c.nota)}</dd>` : ''}</dl></div>`; }).join('')}</div>

    <h2>Reparto del equipaje</h2>
    <p class="muted">${esc(rep.regla)}</p>
    ${Object.keys(MALETAS).map((k) => `<div class="card"><h3>${MALETAS[k]}</h3>${list(rep[k])}</div>`).join('')}
    <div class="card warn"><h3>Días sin maletas laterales: ${rep.dias_sin_laterales.dias.map((n) => `<a href="#/etapas/${n}">día ${n}</a>`).join(' y ')}</h3><p>Pasar al SH58X:</p>${list(rep.dias_sin_laterales.pasar_al_sh58x)}</div>
    <div class="card"><h3>🔑 Llaves</h3><p>${esc(rep.llaves)}</p></div>

    <h2>Material en propiedad</h2>
    <div class="card"><dl>${['compresor', 'antirrobo', 'powerbank'].map((k) => `<dt>${human(k)}</dt><dd><b>${esc(mat[k].modelo)}</b><br><small>${esc(mat[k].nota)}</small></dd>`).join('')}<dt>Otros</dt><dd>${esc(mat.otros.join(', '))}</dd></dl></div>

    <h2>Ropa y lavandería</h2>
    <div class="card"><p>${esc(lav.filosofia)}</p>
      <div class="tbl-wrap"><table><thead><tr><th>Noche</th><th>Lugar</th><th>Cómo</th></tr></thead><tbody>${lav.lavados.map((l) => `<tr><td><b>${l.noche}</b></td><td>${esc(l.lugar)}</td><td>${esc(l.como)}</td></tr>`).join('')}</tbody></table></div>
      <div class="note info"><b>Merino:</b> ${esc(lav.cuidado_merino)}</div></div>
    <details class="card"><summary>Compra Decathlon del 9 sept (${ropa.total_eur.toFixed(2)} €)</summary>
      <div class="tbl-wrap"><table><thead><tr><th>Artículo</th><th>Talla</th><th>Ud.</th></tr></thead><tbody>${ropa.articulos.map((a) => `<tr><td>${esc(a.articulo)}${a.nota ? `<br><small>${esc(a.nota)}</small>` : ''}</td><td>${esc(a.talla)}</td><td>${a.cantidad}${a.pares_total ? ` <small>(${a.pares_total} pares)</small>` : ''}</td></tr>`).join('')}</tbody></table></div>
      <h4>Falta</h4>${list(ropa.falta)}</details>`;
}

function viewGuia() {
  const d = D.data, nav = d.proyecto.navegacion, k = nav.kurviger, m = d.proyecto.moto, meta = d.meta;
  const KV = { extra_curvy: 'Extra Curvy', fast: 'Fast', fast_and_curvy: 'Fast & Curvy', curvy: 'Curvy', shaping_points: 'Shaping points', control: 'Control' };
  return `<h2>Navegación</h2>
    <div class="card"><dl><dt>Pantalla</dt><dd>${esc(nav.pantalla)}</dd><dt>Móvil</dt><dd>${esc(nav.movil)}</dd><dt>App</dt><dd>${esc(nav.app)}</dd><dt>Ubicación</dt><dd>${esc(nav.ubicacion_compartida)}</dd><dt>Si falla</dt><dd>${esc(nav.fallback)}</dd></dl></div>
    <div class="card"><h3>Kurviger</h3><dl>${Object.keys(KV).map((key) => `<dt>${KV[key]}</dt><dd>${esc(k[key])}</dd>`).join('')}<dt>Mapas offline</dt><dd>${esc(k.mapas_offline.join(', '))} (${k.mapas_offline.length} provincias)</dd><dt>Rutas a crear</dt><dd>${k.rutas_a_crear}</dd></dl></div>

    <h2>La moto</h2>
    <div class="card"><dl><dt>Modelo</dt><dd>${esc(m.modelo)}</dd><dt>Rueda delantera</dt><dd>${esc(m.rueda_delantera)}</dd><dt>Neumáticos</dt><dd>${esc(m.neumaticos)}</dd><dt>Toma USB-C</dt><dd>${m.toma_usb_c ? 'Sí' : 'No'}</dd><dt>Autonomía</dt><dd>${m.autonomia_orientativa_km} km orientativos</dd><dt>Gasolina</dt><dd>${esc(m.regla_gasolina)}</dd><dt>Equipaje</dt><dd>${esc(m.equipaje.join(', '))}</dd></dl></div>

    <h2>Vacaciones</h2>
    <div class="card"><p>Del ${fmtFecha(d.proyecto.vacaciones.inicio)} al ${fmtFecha(d.proyecto.vacaciones.fin)}. Margen tras el viaje: ${d.proyecto.vacaciones.margen_tras_el_viaje_dias} días.</p></div>

    <h2>Principios del plan</h2>
    <div class="card">${list(d.principios_para_claude)}</div>

    <h2>Versión del plan</h2>
    <div class="card"><p><b>JSON v${meta.version}</b> · actualizado ${meta.actualizado}<br><small>${esc(meta.sustituye_a)}</small></p><p><small>${esc(meta.uso)}</small></p><details><summary>Cambios en v${meta.version}</summary>${list(meta.cambios_v3)}</details></div>`;
}

/* ---------- router y arranque ---------- */
const VIEWS = { resumen: viewResumen, etapas: viewEtapas, noches: viewNoches, listas: viewListas, equipaje: viewEquipaje, guia: viewGuia };

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
  const titles = { resumen: 'Resumen', etapas: arg ? `Día ${arg}` : 'Etapas', noches: 'Noches', listas: 'Listas', equipaje: 'Equipaje', guia: 'Guía' };
  document.title = `${titles[view]} · Viaje NX500`;
  window.scrollTo(0, 0);
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

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('#reset-checks');
  if (!btn) return;
  if (confirm('¿Borrar todas las marcas de las listas en este dispositivo?')) { D.checks = {}; saveChecks(); render(); }
});

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
  updateNet();
  try {
    if (window.VIAJE_DATA) {
      D.data = window.VIAJE_DATA; // version empaquetada en un solo fichero
    } else {
      const res = await fetch('data/viaje.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      D.data = await res.json();
    }
  } catch (err) {
    document.getElementById('view').innerHTML = `<div class="card warn"><h3>No se pudo cargar el plan</h3><p>${esc(err.message)}</p><p><small>Si abres el archivo directamente (file://), sirve la carpeta con un servidor local o usa la versión publicada.</small></p></div>`;
    return;
  }
  const f = D.data.proyecto.fechas;
  document.getElementById('brand-sub').textContent = `${fmtFecha(f.inicio)} – ${fmtFecha(f.fin)} ${f.inicio.slice(0, 4)}`;
  window.addEventListener('hashchange', render);
  render();
  registerSW();
}

init();
