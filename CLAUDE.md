# Viajes en moto · notas para trabajar en este repositorio

App web estática (PWA) para llevar viajes en moto en el móvil. Sin build, sin dependencias de
npm, sin CDN. Se publica en GitHub Pages desde la raíz de la rama.

## Viajes

- Cada viaje vive en `viajes/<id>/`: `viaje.json`, `gpx/`, `tracks/`, `radares.json`,
  `gasolineras.json`. Las rutas dentro de `viaje.json` son relativas a esa carpeta.
- `viajes/index.json` lista los viajes y dice cuál es el `activo` (el que abre la app sin
  `?viaje=<id>`). Las herramientas trabajan sobre el activo salvo con `--viaje <id>`.
- Viaje nuevo: `python3 tools/nuevo_viaje.py <id> --nombre ... --inicio AAAA-MM-DD [--activar] dia1.gpx ...`
  genera un `viaje.json` mínimo, tracks, radares y gasolineras. Luego se completa a mano.
- `viajes/2026-09-cazorla/` es el primer viaje (terminado) y el modelo completo de todas las
  secciones. `viajes/ejemplo/` es el mínimo generado por el script; está `oculto` en el índice y
  lo usa la prueba de humo: no borrarlo.
- La app normaliza el plan al cargarlo (`completar()` en `app.js`): lo único obligatorio es
  `proyecto.nombre` y el itinerario con `dia`, `fecha`, `origen`, `destino`, `km_aprox`. Cada
  sección opcional se ve solo si existe. Si una vista nueva lee una sección del plan, que no
  rompa cuando falta: darle valor por defecto en `completar()` o comprobarla antes.
- localStorage: lo de cada viaje (marcas, diario, gastos, repostajes, meteo, precios, pueblos)
  lleva el sufijo `@<id>` (ver `claves()`); el primer viaje conserva las claves sin sufijo porque
  así están en el móvil. Contactos personales, póliza y tema son del dispositivo, sin sufijo.

## Fuente de verdad

- El `viaje.json` de cada viaje es la única fuente de datos. La app no tiene datos propios.
- Al cambiar el plan: subir `meta.revision` y añadir una línea en `meta.cambios` (en el primer
  viaje se llama `meta.cambios_v3`; la app acepta las dos).
- Los principios de planificación están en `principios_para_claude` dentro del JSON:
  no cambiar destinos ni bases sin razón fuerte, no añadir turismo por añadir,
  no proponer jornadas de más de 4 h reales, no inventar horarios ni precios.
- Datos personales: el repositorio es público. No guardar teléfonos ni datos de
  personas privadas. Un contacto con `"local": true` y `telefono: null` pide el
  número en la app y lo guarda solo en el dispositivo.

## Cuándo subir versiones

- Cambia solo un `viaje.json` o `viajes/index.json`: basta con `meta.revision`. La app los pide por red
  al abrirse y lo muestra al instante.
- Cambia `app.js`, `styles.css`, `index.html` o `sw.js`: subir `VERSION` en `sw.js`,
  si no los móviles siguen con la copia cacheada.

## Rutas GPX

- Originales de Kurviger en `viajes/<id>/gpx/dia-NN.gpx`; track ligero en `viajes/<id>/tracks/dia-NN.json`
  generado con `python3 tools/gpx2json.py <gpx> <track>`. Tras cambiar un track, regenerar radares
  y gasolineras de ese viaje.
- En el JSON, cada día enlaza su ruta en `gpx` (archivo, track, `vias` con los nombres
  de las vías en orden, nota). `tools/gpxsplit.py` parte un GPX por un punto de ruta.
- Los GPX de Kurviger llegan con numeración antigua: comprobar siempre origen y destino
  por coordenadas antes de asignar el día.

## Radares

- `viajes/<id>/radares.json` lo genera `python3 tools/radares.py [--viaje <id>]` desde el fichero DATEX II del
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

## Gasolineras

- `viajes/<id>/gasolineras.json` lo genera `python3 tools/gasolineras.py [--viaje <id>]` desde el listado completo del
  Ministerio (Geoportal de hidrocarburos, datos abiertos, 12 MB): solo las gasolineras a menos de
  400 m de cada track, con el km de la etapa, sin precio, y las provincias que toca cada día.
- Los precios los pide la app en vivo (`preciosFetch`) al endpoint
  `FiltroProvinciaProducto/{provincia}/1` (95 E5, ~50 KB por provincia, CORS abierto) y los guarda
  en `localStorage` (`viaje-nx500-gasolina`) hasta que cambia el día. `gasolinerasDia(n)` devuelve
  la lista con precio, `gasMasBarata()` la más barata. Sin red, salen sin precio.

## Probar y publicar

- Servidor local: `python3 -m http.server 8080` desde la raíz.
- Prueba de humo: `node tests/smoke.js` (Playwright global o local, Chromium).
- Antes de nada, comprobar que el JSON sigue siendo valido: nunca commitear sin
  `python3 tools/validar.py` (índice, cada viaje, campos mínimos, ficheros que existen y ningún
  teléfono personal). Hay un gancho en `.githooks/pre-commit` que lo hace solo: activarlo con
  `git config core.hooksPath .githooks`.
- Artefacto de Claude (un solo HTML): `python3 tools/bundle.py [--viaje <id>]` genera `dist/viaje-nx500.html`;
  republicar con la herramienta Artifact sobre esa ruta. `dist/` no se versiona.
- Commits en español, autor Javier; rama de trabajo la indicada por la sesión.

## Estructura de la app

`app.js` es un único fichero con router por hash (`#/resumen`, `#/etapas/N`, `#/noches`,
`#/tiempo`, `#/listas`, `#/equipaje`, `#/guia`, `#/hoja`, `#/sos`, `#/buscar`, `#/ahora`, `#/pueblos`, `#/radares`, `#/gasolina`). Cada vista es
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
