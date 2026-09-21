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

## Radares

- `data/radares.json` lo genera `python3 tools/radares.py` desde el fichero DATEX II del
  Punto de Acceso Nacional de la DGT (datos abiertos). Lleva **todos** los radares de
  España (769 puntos: 690 fijos y 47 de tramo, que aportan inicio y fin) en formato
  columnar —`campos` + `radares`, una fila por línea— más `por_dia` con los que están
  sobre el track (`en_ruta`, a menos de 250 m) y los que quedan cerca (`cerca`, menos de
  5 km), con el km de la etapa. Las filas de `por_dia` son índices (`i`) a `radares`.
- En la app: `radaresDia(n)` da `{ en_ruta, cerca }` hidratados, `radaresCerca(pos, km, n)`
  los más próximos a una posición mire donde mire, y `#/radares` es la vista completa.
- Cubre solo la red que gestiona la DGT: ni Cataluña ni País Vasco, ni radares autonómicos,
  municipales o móviles. No inventar radares ni copiarlos de webs de terceros.
- Al regenerarlo, subir `VERSION` en `sw.js` no hace falta si solo cambia el JSON, pero sí
  conviene subir `meta.revision` del plan para que se note el cambio.

## Probar y publicar

- Servidor local: `python3 -m http.server 8080` desde la raíz.
- Prueba de humo: `node tests/smoke.js` (Playwright global o local, Chromium).
- Antes de nada, comprobar que el JSON sigue siendo valido: nunca commitear sin
  `python3 -c "import json; json.load(open('data/viaje.json'))"`. Hay un gancho en
  `.githooks/pre-commit` que lo hace solo: activarlo con `git config core.hooksPath .githooks`.
- Artefacto de Claude (un solo HTML): `python3 tools/bundle.py` genera `dist/viaje-nx500.html`;
  republicar con la herramienta Artifact sobre esa ruta. `dist/` no se versiona.
- Commits en español, autor Javier; rama de trabajo la indicada por la sesión.

## Estructura de la app

`app.js` es un único fichero con router por hash (`#/resumen`, `#/etapas/N`, `#/noches`,
`#/tiempo`, `#/listas`, `#/equipaje`, `#/guia`, `#/hoja`, `#/sos`, `#/buscar`, `#/ahora`, `#/pueblos`, `#/radares`). Cada vista es
una función `viewX()` que devuelve HTML; `render()` lo pinta. Estado en `D`. Persistencia en
`localStorage` (marcas de listas, contactos y datos locales, diario, gastos, repostajes, tema,
caché de meteo).

`#/ahora` es el motor de contexto: `etapaActual()` elige la etapa (la de hoy si estás a menos de
3 km de su track, si no la más cercana de las cargadas), `posEnEtapa()` da km, distancia a la ruta
y siguiente punto, y `viewAhora()` monta tarjetas con una prioridad numérica y las ordena. Para
añadir un consejo nuevo basta con empujar `{ p, html }` a `cards`. `seguirPos()` mantiene un
`watchPosition` mientras la vista está abierta y repinta cuando te mueves más de 300 m.

`#/pueblos` geocodifica un nombre con `geocoding-api.open-meteo.com` (solo resultados de España) y
`puebloContraRuta()` lo proyecta sobre los 11 tracks: distancia mínima, km de la etapa y estimación
del desvío (×1,4 por carretera, ida y vuelta). Ojo con `rerender()` en vistas con formulario: repinta
el DOM y borra lo tecleado; la vista lee el valor actual del input antes de repintar.
El diario, los gastos y las marcas viven solo en el móvil, así que desde el repositorio no se
pueden escribir. Para apuntar algo en el diario hay un enlace profundo:
`#/diario/N/<texto codificado con encodeURIComponent>` añade una línea al diario del día N
(no pisa lo escrito) y abre su ficha.

Todo lo que sea dato personal (teléfonos, póliza, matrícula, médico) va en localStorage, nunca en el JSON. Meteo: Open-Meteo, sin clave.
Mapa: Leaflet vendorizado en `vendor/leaflet`, tiles de OpenStreetMap.
