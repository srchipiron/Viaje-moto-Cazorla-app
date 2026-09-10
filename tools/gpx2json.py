#!/usr/bin/env python3
"""Convierte un GPX de Kurviger en un JSON ligero para la app.

Uso: python3 tools/gpx2json.py gpx/dia-01.gpx data/tracks/dia-01.json

Genera: track simplificado (Douglas-Peucker ~25 m), perfil de altitud
(200 muestras por distancia), distancia, desnivel, altitudes, duracion
estimada por Kurviger y puntos de via con su km.
"""
import json, math, sys, xml.etree.ElementTree as ET
from datetime import datetime

NS = {'g': 'http://www.topografix.com/GPX/1/1'}
R = 6371000.0

def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def dp(points, eps):
    """Douglas-Peucker sobre indices, con distancia en metros aproximada."""
    if len(points) < 3:
        return list(range(len(points)))
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    lat0 = math.radians(points[0][0])
    kx = 111320.0 * math.cos(lat0); ky = 110540.0
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        x1, y1 = points[i][1] * kx, points[i][0] * ky
        x2, y2 = points[j][1] * kx, points[j][0] * ky
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        best, bi = 0.0, -1
        for k in range(i + 1, j):
            x, y = points[k][1] * kx, points[k][0] * ky
            t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / L2))
            px, py = x1 + t * dx, y1 + t * dy
            d = math.hypot(x - px, y - py)
            if d > best:
                best, bi = d, k
        if best > eps:
            keep[bi] = True
            stack.append((i, bi)); stack.append((bi, j))
    return [k for k in range(len(points)) if keep[k]]

def main(src, dst):
    root = ET.parse(src).getroot()
    name = root.findtext('g:metadata/g:name', default='', namespaces=NS)
    pts = []  # (lat, lon, ele, time)
    for seg in root.findall('g:trk/g:trkseg', NS):
        for p in seg.findall('g:trkpt', NS):
            ele = p.findtext('g:ele', default=None, namespaces=NS)
            tm = p.findtext('g:time', default=None, namespaces=NS)
            pts.append((float(p.get('lat')), float(p.get('lon')), float(ele) if ele else None, tm))
    if not pts:
        raise SystemExit('El GPX no tiene track')
    # distancia acumulada
    cum = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[-1] + hav(pts[i - 1], pts[i]))
    total = cum[-1]
    # desnivel con suavizado (media movil de 5) y umbral de 3 m
    eles = [p[2] for p in pts]
    if all(e is not None for e in eles):
        sm = [sum(eles[max(0, i - 2):i + 3]) / len(eles[max(0, i - 2):i + 3]) for i in range(len(eles))]
        up = down = 0.0; ref = sm[0]
        for e in sm[1:]:
            d = e - ref
            if d >= 3: up += d; ref = e
            elif d <= -3: down += -d; ref = e
        emin, emax = min(eles), max(eles)
    else:
        up = down = None; emin = emax = None
    # duracion estimada (tiempos de Kurviger)
    dur = None
    if pts[0][3] and pts[-1][3]:
        t0 = datetime.fromisoformat(pts[0][3].replace('Z', '+00:00'))
        t1 = datetime.fromisoformat(pts[-1][3].replace('Z', '+00:00'))
        dur = int((t1 - t0).total_seconds() // 60)
    # track simplificado
    idx = dp([(p[0], p[1]) for p in pts], 25.0)
    track = [[round(pts[i][0], 5), round(pts[i][1], 5)] for i in idx]
    # perfil: 200 muestras por distancia
    perfil = []
    if emin is not None:
        n = 200; j = 0
        for k in range(n + 1):
            target = total * k / n
            while j < len(cum) - 1 and cum[j + 1] < target:
                j += 1
            perfil.append([round(cum[j] / 1000, 2), round(eles[j])])
    # puntos de ruta (vias y shaping)
    vias = []
    start = 0  # los puntos de ruta van en orden: buscar siempre hacia delante
    for rp in root.findall('g:rte/g:rtept', NS):
        typ = rp.findtext('g:type', default='', namespaces=NS)
        nm = rp.findtext('g:name', default='', namespaces=NS)
        lat, lon = float(rp.get('lat')), float(rp.get('lon'))
        best, bi = 1e12, start
        for i in range(start, len(pts)):
            d = (pts[i][0] - lat) ** 2 + ((pts[i][1] - lon) * math.cos(math.radians(lat))) ** 2
            if d < best: best, bi = d, i
            if d < 1e-9: break
        start = bi
        vias.append({'nombre': nm, 'tipo': typ or 'via', 'lat': round(lat, 5), 'lon': round(lon, 5), 'km': round(cum[bi] / 1000, 1)})
    lats = [p[0] for p in pts]; lons = [p[1] for p in pts]
    out = {
        'nombre': name,
        'fuente': 'Kurviger GPX',
        'km': round(total / 1000, 1),
        'duracion_min': dur,
        'subida_m': round(up) if up is not None else None,
        'bajada_m': round(down) if down is not None else None,
        'alt_min_m': round(emin) if emin is not None else None,
        'alt_max_m': round(emax) if emax is not None else None,
        'bbox': [round(min(lats), 5), round(min(lons), 5), round(max(lats), 5), round(max(lons), 5)],
        'puntos_track_original': len(pts),
        'track': track,
        'perfil': perfil,
        'vias': vias,
    }
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f"{dst}: {out['km']} km, {len(track)} pts (de {len(pts)}), +{out['subida_m']} m / -{out['bajada_m']} m, "
          f"{out['alt_min_m']}-{out['alt_max_m']} m, {dur} min, {len(vias)} puntos de ruta")

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
