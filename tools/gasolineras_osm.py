#!/usr/bin/env python3
"""Genera viajes/<id>/gasolineras.json con las gasolineras de OpenStreetMap, para viajes fuera
de España (Marruecos). Mismo formato que tools/gasolineras.py (por_dia con km de la etapa), sin
precios ni API, y además `huecos`: el tramo más largo de cada día sin gasolinera en la ruta.

Fuente: nodos y áreas amenity=fuel de OpenStreetMap (licencia ODbL). La lista puede estar
incompleta y no dice si la gasolinera está abierta o si tiene gasolina sin plomo.

Uso:
    python3 tools/gasolineras_osm.py --viaje <id> datos.psv
El fichero es la salida de Overpass con
    [out:csv(::id,::lat,::lon,brand,name,opening_hours,"addr:city";false;"|")];
    (node["amenity"="fuel"](S,O,N,E);way["amenity"="fuel"](S,O,N,E););out center;
Desde la sesión de Claude no hay red a Overpass: se descarga con el navegador.
"""
import json, os, re, sys, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import dir_viaje, argv_viaje
from radares import hav_m, dist_a_segmento
from radares_osm import cargar_tracks

UMBRAL_M = 500.0          # a menos de esto del track, la gasolinera está en la ruta
FUERA = lambda la, lo: la >= 35.27 and -2.97 <= lo <= -2.90   # Melilla (España): no es Marruecos


def latino(s):
    """La parte en alfabeto latino de un nombre bilingüe ('Afriquia أفريقيا' -> 'Afriquia')."""
    partes = [p for p in re.split(r'\s+', s or '') if p and re.search(r'[A-Za-zÀ-ÿ]', p)]
    return ' '.join(partes).strip(' -')


def main(psv, vid=None):
    vid, carpeta = dir_viaje(vid)
    psv = os.path.abspath(psv)
    os.chdir(carpeta)
    plan = json.load(open('viaje.json', encoding='utf-8'))
    tracks = cargar_tracks(plan)
    nombres = [(v['lat'], v['lon'], v['nombre'].split(' (')[0]) for t in tracks for v in t['vias'] if v.get('nombre')]

    estaciones, vistos = [], set()
    for linea in open(psv, encoding='utf-8'):
        f = linea.rstrip('\n').split('|')
        if len(f) < 3 or not f[1]:
            continue
        la, lo = float(f[1]), float(f[2])
        if FUERA(la, lo) or (round(la, 4), round(lo, 4)) in vistos:
            continue
        vistos.add((round(la, 4), round(lo, 4)))
        marca, nombre = latino(f[3] if len(f) > 3 else ''), latino(f[4] if len(f) > 4 else '')
        rotulo = nombre or marca or 'Gasolinera'
        if marca and marca.lower() not in rotulo.lower():
            rotulo = f'{rotulo} ({marca})'
        ciudad = latino(f[6] if len(f) > 6 else '')
        if not ciudad and nombres:
            c = min(nombres, key=lambda x: hav_m((la, lo), x[:2]))
            ciudad = f'cerca de {c[2]}' if hav_m((la, lo), c[:2]) < 25000 else ''
        horario = (f[5] if len(f) > 5 else '').replace('24/7', 'L-D: 24H').strip('"')
        estaciones.append({'id': f'osm{f[0]}', 'prov': '', 'rotulo': rotulo, 'municipio': ciudad, 'direccion': '',
                           'horario': horario, 'lat': round(la, 5), 'lon': round(lo, 5)})

    def mas_cerca(la, lo, t):
        tk, cum = t['tk'], t['cum']
        mejor = (1e9, 0, 0.0)
        for i in range(len(tk) - 1):
            d, u = dist_a_segmento((la, lo), tk[i], tk[i + 1])
            if d < mejor[0]:
                mejor = (d, i, u)
        d, i, u = mejor
        return d, (cum[i] + u * (cum[i + 1] - cum[i])) / 1000.0 * t['escala']

    por_dia, huecos = {}, {}
    for t in tracks:
        lista = []
        for s in estaciones:
            d, km = mas_cerca(s['lat'], s['lon'], t)
            if d <= UMBRAL_M:
                lista.append(dict(s, km=round(km, 1), dist_m=round(d)))
        lista.sort(key=lambda s: s['km'])
        # varias gasolineras en el mismo punto de una ciudad: se quedan todas, pero el hueco se mide entre puntos distintos
        total = round(t['cum'][-1] / 1000.0 * t['escala'], 1)
        marcas = [0.0] + [s['km'] for s in lista] + [total]
        mayor = max(((b - a, a, b) for a, b in zip(marcas, marcas[1:])), default=(0, 0, 0))
        huecos[str(t['dia'])] = {'max_km': round(mayor[0]), 'desde_km': round(mayor[1], 1), 'hasta_km': round(mayor[2], 1)}
        if lista:
            por_dia[str(t['dia'])] = lista

    hoy = datetime.date.today().isoformat()
    out = {
        'fuente': 'OpenStreetMap (amenity=fuel, licencia ODbL)',
        'generado': hoy,
        'umbral_m': int(UMBRAL_M),
        'aviso': (f'Gasolineras mapeadas en OpenStreetMap a menos de {int(UMBRAL_M)} m del track aproximado: '
                  'puede faltar alguna y no se sabe si está abierta. Sin precios (en Marruecos el precio es '
                  'casi igual en todas). En el sur, llenar en cada ciudad aunque quede medio depósito.'),
        'descripcion': ('Gasolineras de OpenStreetMap a menos de 500 m de cada track, sin precio. '
                        'Para cada día, el tramo más largo sin gasolinera en la ruta.'),
        'por_dia': por_dia,
        'huecos': huecos,
        'provincias_por_dia': {},
    }
    open('gasolineras.json', 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'{vid}: {sum(len(v) for v in por_dia.values())} paradas en ruta ({len(estaciones)} gasolineras leídas)')
    for d, h in sorted(huecos.items(), key=lambda x: int(x[0])):
        print(f"  día {d}: {len(por_dia.get(d, []))} en ruta · tramo más largo sin gasolinera {h['max_km']} km (km {h['desde_km']}–{h['hasta_km']})")


if __name__ == '__main__':
    vid, resto = argv_viaje()
    if not resto:
        raise SystemExit(__doc__)
    main(resto[0], vid)
