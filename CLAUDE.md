# Viaje NX500 · notas para trabajar en este repositorio

App web estática (PWA) con el plan de un viaje en moto de 11 días. Sin build, sin
dependencias de npm, sin CDN. Se publica en GitHub Pages desde la raíz de la rama.

## Fuente de verdad

- `data/viaje.json` es la única fuente de datos. La app no tiene datos propios.
- Al cambiar el plan: subir `meta.revision` y añadir una línea en `meta.cambios_v3`.
- Los principios de planificación están en `principios_para_claude` dentro del JSON:
  no cambiar destinos ni bases sin razón fuerte, no añadir turismo por añadir,
  no proponer jornadas de más de 4 h reales, no inventar horarios ni precios.
- Datos personales: el repositorio es público. No guardar teléfonos ni datos de
  personas privadas. Un contacto con `"local": true` y `telefono: null` pide el
  número en la app y lo guarda solo en el dispositivo.

## Cuándo subir versiones

- Cambia solo `data/viaje.json`: basta con `meta.revision`. La app pide el JSON por red
  al abrirse y lo muestra al instante.
- Cambia `app.js`, `styles.css`, `index.html` o `sw.js`: subir `VERSION` en `sw.js`,
  si no los móviles siguen con la copia cacheada.

## Rutas GPX

- Originales de Kurviger en `gpx/dia-NN.gpx`; track ligero en `data/tracks/dia-NN.json`
  generado con `python3 tools/gpx2json.py gpx/dia-NN.gpx data/tracks/dia-NN.json`.
- En el JSON, cada día enlaza su ruta en `gpx` (archivo, track, `vias` con los nombres
  de las vías en orden, nota). `tools/gpxsplit.py` parte un GPX por un punto de ruta.
- Los GPX de Kurviger llegan con numeración antigua: comprobar siempre origen y destino
  por coordenadas antes de asignar el día.

## Probar y publicar

- Servidor local: `python3 -m http.server 8080` desde la raíz.
- Prueba de humo: `node tests/smoke.js` (Playwright global o local, Chromium).
- Artefacto de Claude (un solo HTML): `python3 tools/bundle.py` genera `dist/viaje-nx500.html`;
  republicar con la herramienta Artifact sobre esa ruta. `dist/` no se versiona.
- Commits en español, autor Javier; rama de trabajo la indicada por la sesión.

## Estructura de la app

`app.js` es un único fichero con router por hash (`#/resumen`, `#/etapas/N`, `#/noches`,
`#/tiempo`, `#/listas`, `#/equipaje`, `#/guia`). Cada vista es una función `viewX()` que
devuelve HTML; `render()` lo pinta. Estado en `D`. Persistencia en `localStorage`
(marcas de listas, contactos locales, caché de meteo). Meteo: Open-Meteo, sin clave.
Mapa: Leaflet vendorizado en `vendor/leaflet`, tiles de OpenStreetMap.
