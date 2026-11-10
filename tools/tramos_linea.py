#!/usr/bin/env python3
"""Añade a cada radar de tramo de radares.json su trazado por carretera (`linea`), para que el
mapa lo pinte siguiendo la vía y no en línea recta entre las dos cabinas.

El trazado es la ruta de OSRM (datos de OpenStreetMap) entre el inicio y el fin del tramo,
simplificada. Se guarda en tools/tramos_linea.json para no depender de la red al regenerar:
solo se pide a OSRM lo que no está ya guardado. Si la ruta no cuadra con el tramo (sale mucho
más larga que la recta, porque el punto cae en la calzada contraria), se prueba en sentido
contrario; si tampoco, el tramo se queda sin `linea` y la app lo pinta recto.

`linea` es una lista plana [lat, lon, lat, lon, ...] y `largo_km` pasa a ser el largo por carretera.

Uso:
    python3 tools/tramos_linea.py [--viaje <id>]     # lo llama tools/radares.py al terminar
"""
import json, math, os, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import dir_viaje, argv_viaje

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tramos_linea.json')
OSRM = 'https://router.project-osrm.org/route/v1/driving/{},{};{},{}?overview=full&geometries=geojson'
TOLERANCIA_M = 8.0     # simplificación del trazado
MAX_FACTOR = 1.6       # ruta válida si no pasa de esto por la recta (más 300 m)


def hav_m(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def simplificar(pts, tol):
    """Douglas-Peucker en metros (proyección local)."""
    if len(pts) < 3:
        return pts
    k = math.cos(math.radians(pts[0][0])) * 111320.0
    xy = [((p[1] - pts[0][1]) * k, (p[0] - pts[0][0]) * 110540.0) for p in pts]
    keep, pila = {0, len(pts) - 1}, [(0, len(pts) - 1)]
    while pila:
        i, j = pila.pop()
        (x1, y1), (x2, y2) = xy[i], xy[j]
        dx, dy = x2 - x1, y2 - y1
        n = math.hypot(dx, dy) or 1e-9
        peor, idx = 0.0, None
        for m in range(i + 1, j):
            d = abs(dy * (xy[m][0] - x1) - dx * (xy[m][1] - y1)) / n
            if d > peor:
                peor, idx = d, m
        if idx is not None and peor > tol:
            keep.add(idx); pila += [(i, idx), (idx, j)]
    return [pts[i] for i in sorted(keep)]


def osrm(a, b):
    url = OSRM.format(a[1], a[0], b[1], b[0])
    for intento in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'viajes-en-moto'})
            r = json.load(urllib.request.urlopen(req, timeout=40))['routes'][0]
            return r['distance'], [(c[1], c[0]) for c in r['geometry']['coordinates']]
        except Exception:
            time.sleep(3 * (intento + 1))
    return None


def trazado(a, b, cache):
    clave = f'{a[0]:.5f},{a[1]:.5f};{b[0]:.5f},{b[1]:.5f}'
    if clave in cache:
        return cache[clave]
    recta = hav_m(a, b)
    mejor = None
    for ini, fin, invertir in ((a, b, False), (b, a, True)):
        r = osrm(ini, fin)
        if r is None:
            return None            # sin red: no se guarda nada, se reintenta otro día
        dist, pts = r
        if dist <= recta * MAX_FACTOR + 300:
            if invertir:
                pts = pts[::-1]
            mejor = (dist, pts)
            break
        time.sleep(1)
    if mejor is None:
        cache[clave] = False       # ninguna ruta cuadra: recto
        return False
    dist, pts = mejor
    pts = simplificar([a[:2]] + pts + [b[:2]], TOLERANCIA_M)
    cache[clave] = {'km': round(dist / 1000.0, 1), 'linea': [round(v, 5) for p in pts for v in p]}
    time.sleep(1)
    return cache[clave]


def aplicar(rad, cache=None):
    """Pone `linea` y el largo por carretera en rad['tramos']. Devuelve (con_linea, total)."""
    propio = cache is None
    if propio:
        cache = json.load(open(CACHE, encoding='utf-8')) if os.path.exists(CACHE) else {}
    antes, n = len(cache), 0
    for t in rad.get('tramos', []):
        a, b = rad['radares'][t['inicio']], rad['radares'][t['fin']]
        r = trazado((a[0], a[1]), (b[0], b[1]), cache)
        t.pop('linea', None)
        if r:
            t['linea'], t['largo_km'] = r['linea'], r['km']
            n += 1
    if propio and len(cache) != antes:
        json.dump(cache, open(CACHE, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    return n, len(rad.get('tramos', []))


def escribir(rad, ruta):
    txt = json.dumps(rad, ensure_ascii=False, separators=(',', ':'))
    a, b = txt.index('"radares":['), txt.index('],"tramos"')
    filas = txt[a:b].replace('],[', '],\n[').replace('"radares":[', '"radares":[\n')
    open(ruta, 'w', encoding='utf-8').write(txt[:a] + filas + '\n' + txt[b:] + '\n')


if __name__ == '__main__':
    vid, _ = argv_viaje()
    vid, carpeta = dir_viaje(vid)
    ruta = os.path.join(carpeta, 'radares.json')
    rad = json.load(open(ruta, encoding='utf-8'))
    n, total = aplicar(rad)
    escribir(rad, ruta)
    print(f'{vid}: {n} de {total} radares de tramo con trazado por carretera')
