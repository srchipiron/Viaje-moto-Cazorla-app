# Viaje NX500 · Almería – Cazorla – Cuenca – Albarracín – Gúdar/Maestrazgo – Júcar – Segura – Almería

App web estática (PWA, funciona sin cobertura) con el plan del viaje en moto de 11 días / 10 noches
(14–24 septiembre 2026) en Honda NX500.

## Fuente de verdad

Todo el contenido sale de **`data/viaje.json`** (JSON v3). La app no tiene datos propios:
para cambiar un horario, un teléfono o un estado se edita ese fichero y se sube.

Al retomar el plan con Claude: actualizar estados en el JSON, no rehacer el plan
(ver `principios_para_claude` dentro del propio fichero).

## Qué hay en la app

| Pestaña | Contenido |
| --- | --- |
| Resumen | Cuenta atrás o etapa de hoy, contactos, reglas globales, rutina diaria, filosofía |
| Etapas | Las 11 etapas con km, tiempo real, dificultad, fatiga, perfil Kurviger, waypoints (enlace a Google Maps), horario, paradas, notas, equipación del día y ficha del alojamiento |
| Noches | Las 10 noches con teléfono pulsable y «cómo llegar» |
| Tiempo | Previsión diaria de [Open-Meteo](https://open-meteo.com/) (gratuita, sin clave, 16 días) para dos puntos de cada etapa, con veredicto Bueno / Regular / Malo, temperaturas, probabilidad de lluvia y rachas. Se guarda en el móvil y se refresca cada 3 h. La misma previsión aparece en la ficha de cada etapa y en las tarjetas de Resumen |
| Listas | Checklist previa, compras, pedido Amazon, contactos pendientes y cosas a confirmar con cada alojamiento. Las marcas se guardan en el dispositivo (`localStorage`) |
| Equipaje | Equipación por tipo de día, reparto por maleta, días sin laterales, material, ropa y lavandería |
| Guía | Navegación y ajustes de Kurviger, moto, principios del plan y versión del JSON |

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

## Ficheros

```
index.html            estructura y barra de pestañas
styles.css            estilos (claro/oscuro según el sistema)
app.js                render de vistas, router por hash, checklists persistentes, registro del SW
sw.js                 service worker: precarga y caché stale-while-revalidate
manifest.webmanifest  manifiesto PWA
data/viaje.json       fuente de verdad (JSON v3)
icons/                iconos SVG (normal y maskable)
.nojekyll             evita que GitHub Pages procese el sitio con Jekyll
```

Sin dependencias, sin build, sin CDN: todo va en el repositorio. La única llamada externa es
a `api.open-meteo.com` para la previsión; si no responde, la app sigue funcionando con la última
previsión guardada o sin ella.

Los puntos de previsión están en `data/viaje.json`, en `meteo_puntos` de cada día
(nombre, latitud y longitud aproximadas).
