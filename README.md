# Viaje NX500 · Almería – Cazorla – Cuenca – Albarracín – Gúdar/Maestrazgo – Júcar – Segura – Almería

App web estática (PWA, funciona sin cobertura) con el plan del viaje en moto de 11 días / 10 noches
(14–24 septiembre 2026) en Honda NX500.

## Datos personales

El repositorio no contiene teléfonos ni datos de personas privadas. El contacto en casa se
marca en `data/viaje.json` con `"local": true` y sin número; la app pide el teléfono una vez y
lo guarda en `localStorage` del dispositivo, así que nunca sale del móvil.

## Fuente de verdad

Todo el contenido sale de **`data/viaje.json`** (JSON v3). La app no tiene datos propios:
para cambiar un horario, un teléfono o un estado se edita ese fichero y se sube.

Al retomar el plan con Claude: actualizar estados en el JSON, no rehacer el plan
(ver `principios_para_claude` dentro del propio fichero).

## Qué hay en la app

| Pestaña | Contenido |
| --- | --- |
| Resumen | Cuenta atrás antes de salir; durante el viaje, progreso (día X de 11, km hechos), etapa de hoy con la próxima parada según el horario y la hora, botón «Avisar en casa» y la de mañana. Mapa del viaje completo, hoja de ruta, botón de instalar la app, llamadas rápidas, contactos, reglas, rutina y filosofía |
| Etapas | Las 11 etapas con km, tiempo real, dificultad, fatiga, perfil Kurviger, hora del ocaso, aviso de repostaje en las largas, ruta GPX (croquis, perfil, puntos de paso, mapa interactivo), waypoints (enlace a Google Maps), horario, paradas, guía turística del día (qué ver y dónde parar, qué comer, la tarde, un consejo), decisiones pendientes, notas, equipación del día y ficha del alojamiento |
| Noches | Las 10 noches con teléfono pulsable, estado del pago y «cómo llegar» |
| Tiempo | Previsión diaria de [Open-Meteo](https://open-meteo.com/) (gratuita, sin clave, 16 días) para dos o tres puntos de cada etapa, con veredicto Bueno / Regular / Malo, temperaturas, probabilidad de lluvia y rachas. Se guarda en el móvil y se refresca cada 3 h. La misma previsión aparece en la ficha de cada etapa y en las tarjetas de Resumen. Cuando la etapa está a menos de 16 días, la ficha añade la previsión por horas (07–20 h) con aviso de lluvia o tormenta de tarde |
| Listas | Checklist previa, compras, pedido Amazon, contactos pendientes, pagos, carga de cada maleta y cosas a confirmar con cada alojamiento. Las marcas se guardan en el dispositivo (`localStorage`) |
| Equipaje | Equipación por tipo de día, reparto por maleta, días sin laterales, material, inventario real, ropa y lavandería |
| Guía | Índice de la guía turística, tabla con el nombre exacto de las 11 rutas en Kurviger (km y tiempo), navegación, moto, principios del plan y versión del JSON |
| Emergencia (`#/sos`, botón SOS arriba) | Llamadas grandes (112, Mapfre, casa, alojamiento de hoy), posición GPS con enlace y envío por WhatsApp o compartir, búsquedas cercanas (gasolinera, taller, centro de salud, farmacia), qué decir al 112, matrícula y datos médicos guardados solo en el móvil, pasos con el seguro |
| Buscar (`#/buscar`, lupa arriba) | Busca en etapas, guía, horarios, alojamientos, listas, equipaje y seguro, sin acentos |
| Hoja de ruta (`#/hoja`) | Todo el viaje en una página: etapas, puntos de paso, horas, alojamientos con teléfono y contactos. Pensada para imprimir (botón Imprimir; cualquier vista se imprime limpia) o por si falla el móvil |

Otros detalles:

- **Avisar en casa**: comparte un resumen del día (etapa, horas, km, alojamiento con teléfono y previsión) con la hoja de compartir del móvil o, si no la hay, por WhatsApp. Si el teléfono de casa está guardado en el dispositivo, abre directamente ese chat.
- **Mapa del viaje completo**: los 11 tracks, cada día de un color, con la salida numerada y una cama en cada noche. Tocar una línea abre la ficha del día.
- **Mapas sin conexión**: el service worker guarda las teselas de OpenStreetMap ya vistas (hasta 800), así que las zonas consultadas con cobertura se ven después sin ella.
- **Instalar**: en Android/Chrome aparece el botón «Instalar»; en iPhone, la indicación para añadir a la pantalla de inicio.
- **Dónde estoy**: en cada etapa con GPX (y en Emergencia), el GPS del móvil sitúa la posición sobre el track: km de la etapa, distancia a la ruta (avisa si estás fuera), km que quedan con tiempo estimado y siguiente punto de la ruta. Funciona sin cobertura. La posición se ve también en el mapa interactivo.
- **Puntos de despiste**: por día, los sitios donde Kurviger hace dar la vuelta o repetir carretera, con km y mapa. Los días lineales lo dicen.
- **Diario y gastos**: en cada etapa, un cuaderno de texto y una lista de gastos (gasolina, comida, alojamiento, otros) que se guardan solo en el móvil; el Resumen muestra el total del viaje.
- **Horario en vivo**: el día del viaje, la tabla del horario atenúa lo pasado y resalta la siguiente parada según la hora.
- **Tema**: botón ◐ arriba para forzar claro u oscuro (con sol, el claro se lee mejor); por defecto sigue al sistema.
- **Copia de seguridad**: en Listas, copiar al portapapeles todo lo local (marcas, teléfonos, póliza, diario, gastos) y restaurarlo en otro móvil.

## Rutas GPX de Kurviger

Cada día puede llevar su ruta exportada de Kurviger. En la ficha de la etapa aparece un croquis
del recorrido, distancia y tiempo estimados por Kurviger frente a los del plan, desnivel,
perfil de altitud con tooltip, la tabla de vías con su kilómetro, un botón para descargar el
GPX original (para importarlo en Kurviger en el móvil) y un mapa interactivo con
OpenStreetMap (Leaflet, incluido en `vendor/`; los mapas necesitan conexión, el resto no).

Para añadir la ruta de un día:

```bash
cp "Dia 4 Cuenca - Albarracin.gpx" gpx/dia-04.gpx
python3 tools/gpx2json.py gpx/dia-04.gpx data/tracks/dia-04.json
```

y en `data/viaje.json`, dentro del día 4:

```json
"gpx": { "archivo": "gpx/dia-04.gpx", "track": "data/tracks/dia-04.json", "vias": ["Uña", "Tragacete", "..."] }
```

Cada día admite además un campo `opciones` con las decisiones abiertas (título, estado,
cuándo se decide y las alternativas con su coste y qué tocar en Kurviger). La app las muestra
como «Decisiones del día» y marca la etapa en la lista.

`vias` es opcional: los nombres, en orden, de los puntos de vía de Kurviger (sin la salida ni el
destino) para que la tabla y el mapa muestren el lugar en vez de «Vía 1, Vía 2».

El script simplifica el track (Douglas-Peucker, ~25 m) y genera el perfil, el desnivel y los
kilómetros de cada vía. Si un GPX trae dos etapas juntas, `tools/gpxsplit.py` lo parte por un
punto de ruta (ver su cabecera); así se separaron los días 5 y 6. El service worker precarga automáticamente los tracks listados en el
plan, así que funcionan sin cobertura.

## Publicar en GitHub Pages

1. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
2. Branch: la rama que contenga estos ficheros, carpeta **/ (root)**. Guardar.
3. La app queda en `https://<usuario>.github.io/<repo>/`. Todas las rutas son relativas,
   así que funciona en subcarpeta sin tocar nada.
4. En el móvil: abrir la URL en Chrome y **Añadir a pantalla de inicio**. La primera carga
   guarda la app y el JSON en caché; después funciona sin conexión.

## Actualizar el plan

1. Editar `data/viaje.json` (validar que sigue siendo JSON válido) y subir `meta.revision`.
2. Commit y push. GitHub Pages publica en uno o dos minutos.
3. La app descarga el JSON de la red cada vez que se abre (y con el enlace «Actualizar plan»
   al final de Resumen), así que el cambio se ve al instante. Sin cobertura usa la última
   copia guardada y lo indica en la cabecera. La cabecera muestra siempre «Plan v3.N · fecha»
   para saber qué revisión se está viendo.
4. Solo si cambian `index.html`, `styles.css` o `app.js`: subir también la constante
   `VERSION` en `sw.js`. La app avisa con un botón «Recargar» cuando detecta la versión nueva.

## Probar en local

```bash
python3 -m http.server 8080
# abrir http://localhost:8080
```

Abrir `index.html` directamente con `file://` no funciona: el navegador bloquea el `fetch`
del JSON y el service worker.

Prueba de humo (necesita Playwright con Chromium, global o local):

```bash
python3 -m http.server 8080 &
node tests/smoke.js
```

Recorre todas las vistas, comprueba que no hay errores de JavaScript, que las marcas persisten,
el botón de avisar, la lista de carga, la tabla de rutas, los dos mapas, la meteo por horas con
reloj simulado en mitad del viaje, el service worker y el modo sin conexión. Open-Meteo y las
teselas se simulan.

Versión en un solo fichero (para compartir o abrir sin servidor): `python3 tools/bundle.py`
genera `dist/viaje-nx500.html` con el plan y los tracks incrustados.

## Ficheros

```
index.html            estructura y barra de pestañas
styles.css            estilos (claro/oscuro según el sistema)
app.js                render de vistas, router por hash, checklists persistentes, registro del SW
sw.js                 service worker: precarga, caché stale-while-revalidate y teselas del mapa
manifest.webmanifest  manifiesto PWA
data/viaje.json       fuente de verdad (JSON v3)
data/tracks/          tracks ligeros generados a partir de los GPX
gpx/                  rutas GPX originales exportadas de Kurviger
tools/gpx2json.py     conversor GPX -> track ligero
tools/gpxsplit.py     parte un GPX en dos por un punto de ruta
tools/bundle.py       genera dist/viaje-nx500.html (app + datos + tracks en un solo fichero)
tests/smoke.js        prueba de humo con Playwright
CLAUDE.md             convenciones para trabajar en el repositorio
vendor/leaflet/       Leaflet 1.9.4 (BSD-2) para el mapa interactivo
icons/                iconos SVG (normal y maskable)
.nojekyll             evita que GitHub Pages procese el sitio con Jekyll
```

Sin dependencias, sin build, sin CDN: todo va en el repositorio. La única llamada externa es
a `api.open-meteo.com` para la previsión; si no responde, la app sigue funcionando con la última
previsión guardada o sin ella.

Los puntos de previsión están en `data/viaje.json`, en `meteo_puntos` de cada día
(nombre, latitud y longitud aproximadas).
