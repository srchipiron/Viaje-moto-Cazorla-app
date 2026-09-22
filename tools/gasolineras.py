#!/usr/bin/env python3
"""Genera data/gasolineras.json: las gasolineras que estan sobre los tracks del viaje
(a menos de 400 m), con el km de la etapa. Sin precios: los precios cambian a diario
y la app los pide en vivo al Ministerio (Geoportal de hidrocarburos, datos abiertos)
por provincia y producto, y los cruza por IDEESS.

Fuente: https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/

Uso:
    python3 tools/gasolineras.py              # descarga el listado completo (12 MB) y regenera
    python3 tools/gasolineras.py fichero.json # usa un listado ya descargado
"""
import json, math, os, sys, datetime
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/'
UMBRAL_M = 400.0
R = 6371000.0

def hav_m(a, b):
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    x = math.radians(b[1] - a[1]) * math.cos((la1 + la2) / 2)
    return R * math.hypot(x, la2 - la1)

def dist_a_segmento(p, a, b):
    cl = math.cos(math.radians(p[0])) * R * math.pi / 180
    rl = R * math.pi / 180
    ax, ay = (a[1] - p[1]) * cl, (a[0] - p[0]) * rl
    bx, by = (b[1] - p[1]) * cl, (b[0] - p[0]) * rl
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L))
    return math.hypot(ax + t * dx, ay + t * dy), t

def num(s):
    try:
        return float(str(s).replace(',', '.'))
    except ValueError:
        return None

def bonito(s):
    ps = (s or '').strip().split()
    return ' '.join(p.capitalize() for p in ps)

def main(path=None):
    os.chdir(ROOT)
    if path:
        datos = json.load(open(path, encoding='utf-8'))
    else:
        datos = json.loads(urllib.request.urlopen(API, timeout=180).read().decode('utf-8'))
    plan = json.load(open('data/viaje.json', encoding='utf-8'))
    est = []
    for e in datos['ListaEESSPrecio']:
        la, lo = num(e['Latitud']), num(e['Longitud (WGS84)'])
        if la is None or lo is None:
            continue
        est.append((la, lo, e))

    por_dia, provincias, total = {}, {}, 0
    for dia in plan['itinerario']:
        if not dia.get('gpx') or not dia['gpx'].get('track'):
            continue
        t = json.load(open(dia['gpx']['track'], encoding='utf-8'))
        tk, bb = t['track'], t['bbox']
        cum = [0.0]
        for i in range(1, len(tk)):
            cum.append(cum[-1] + hav_m(tk[i - 1], tk[i]))
        escala = t['km'] / (cum[-1] / 1000.0) if cum[-1] else 1.0
        hits = []
        for la, lo, e in est:
            if not (bb[0] - 0.01 <= la <= bb[2] + 0.01 and bb[1] - 0.01 <= lo <= bb[3] + 0.01):
                continue
            mejor = (1e9, 0, 0.0)
            for i in range(len(tk) - 1):
                d, u = dist_a_segmento((la, lo), tk[i], tk[i + 1])
                if d < mejor[0]:
                    mejor = (d, i, u)
            d, i, u = mejor
            if d > UMBRAL_M:
                continue
            km = (cum[i] + u * (cum[i + 1] - cum[i])) / 1000.0 * escala
            hits.append({
                'id': e['IDEESS'], 'prov': e['IDProvincia'],
                'rotulo': bonito(e['Rótulo']) or 'Sin rótulo',
                'municipio': e['Municipio'], 'direccion': bonito(e['Dirección']),
                'horario': e['Horario'], 'lat': round(la, 5), 'lon': round(lo, 5),
                'km': round(km, 1), 'dist_m': round(d),
            })
        hits.sort(key=lambda h: h['km'])
        if hits:
            por_dia[str(dia['dia'])] = hits
            provincias[str(dia['dia'])] = sorted({h['prov'] for h in hits})
            total += len(hits)

    out = {
        'fuente': 'Ministerio para la Transición Ecológica · Geoportal de hidrocarburos (datos abiertos)',
        'api': API,
        'producto': {'id': 1, 'nombre': 'Gasolina 95 E5'},
        'generado': datetime.date.today().isoformat(),
        'umbral_m': int(UMBRAL_M),
        'aviso': ('Precios del día que publica cada gasolinera al Ministerio; pueden cambiar a lo largo del día. '
                  'Solo gasolineras a menos de 400 m del track: las del pueblo de al lado no salen. '
                  'El horario es el declarado; en pueblos pequeños, comprobarlo.'),
        'por_dia': por_dia,
        'provincias_por_dia': provincias,
    }
    open('data/gasolineras.json', 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    print(f"data/gasolineras.json: {total} gasolineras sobre la ruta ({len(datos['ListaEESSPrecio'])} en España, listado del {datos['Fecha']})")
    for d, hs in sorted(por_dia.items(), key=lambda x: int(x[0])):
        print(f"  día {d}: {len(hs)} · provincias {','.join(provincias[d])}")

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
