#!/usr/bin/env python3
"""Genera viajes/<id>/radares.json con los radares fijos de OpenStreetMap, para viajes fuera
de la red de la DGT (Marruecos). Mismo formato que tools/radares.py: lista columnar con
`campos` + `radares` y `por_dia` con los que pisan cada track (en_ruta) y los cercanos (cerca).

Fuente: nodos highway=speed_camera de OpenStreetMap (datos abiertos, licencia ODbL), pedidos
a la API Overpass en el rectángulo que cubre los tracks del viaje. Es una lista INCOMPLETA:
solo lo que la gente ha mapeado. No incluye radares móviles.

Uso:
    python3 tools/radares_osm.py --viaje <id>              # descarga de Overpass y regenera
    python3 tools/radares_osm.py --viaje <id> datos.csv    # usa un CSV ya descargado
El CSV es la salida de Overpass con
    [out:csv(::id,::lat,::lon,maxspeed,direction;false;",")];node["highway"="speed_camera"](S,O,N,E);out;
"""
import json, os, sys, datetime, urllib.request, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import dir_viaje, argv_viaje
from radares import hav_m, dist_a_segmento, EN_RUTA_M, CERCA_M, CAMPOS

OVERPASS = 'https://overpass.openstreetmap.fr/api/interpreter'
NOMBRE_CERCA_M = 35000.0   # el radar se rotula con el punto de ruta con nombre más cercano a menos de esto


def cargar_tracks(plan):
    tracks = []
    for dia in plan['itinerario']:
        if not dia.get('gpx') or not dia['gpx'].get('track'):
            continue
        t = json.load(open(dia['gpx']['track'], encoding='utf-8'))
        tk = t['track']
        cum = [0.0]
        for i in range(1, len(tk)):
            cum.append(cum[-1] + hav_m(tk[i - 1], tk[i]))
        escala = t['km'] / (cum[-1] / 1000.0) if cum[-1] else 1.0
        tracks.append({'dia': dia['dia'], 'tk': tk, 'cum': cum, 'escala': escala, 'bbox': t['bbox'], 'vias': t.get('vias', [])})
    return tracks


def descargar(bbox):
    s, o, n, e = bbox
    q = f'[out:csv(::id,::lat,::lon,maxspeed,direction;false;",")][timeout:90];node["highway"="speed_camera"]({s},{o},{n},{e});out;'
    req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'viajes-en-moto/1.0'})
    return urllib.request.urlopen(req, timeout=150).read().decode('utf-8')


def main(csv_path=None, vid=None):
    vid, carpeta = dir_viaje(vid)
    csv_path = os.path.abspath(csv_path) if csv_path else None
    os.chdir(carpeta)
    plan = json.load(open('viaje.json', encoding='utf-8'))
    tracks = cargar_tracks(plan)
    if not tracks:
        raise SystemExit('El viaje no tiene tracks')
    m = 0.3
    bbox = [min(t['bbox'][0] for t in tracks) - m, min(t['bbox'][1] for t in tracks) - m,
            max(t['bbox'][2] for t in tracks) + m, max(t['bbox'][3] for t in tracks) + m]
    txt = open(csv_path, encoding='utf-8').read() if csv_path else descargar(bbox)

    nombres = [(v['lat'], v['lon'], v['nombre']) for t in tracks for v in t['vias'] if v.get('nombre')]
    filas, vistos = [], set()
    for linea in txt.splitlines():
        p = linea.strip().split(',')
        if len(p) < 3 or not p[1]:
            continue
        la, lo = round(float(p[1]), 5), round(float(p[2]), 5)
        if (la, lo) in vistos:
            continue
        vistos.add((la, lo))
        vel = p[3].strip() if len(p) > 3 else ''
        sentido = (p[4].strip() if len(p) > 4 else '').replace(';', ' y ')
        cerca = min(nombres, key=lambda x: hav_m((la, lo), x[:2])) if nombres else None
        sitio = f"cerca de {cerca[2].split(' (')[0]}" if cerca and hav_m((la, lo), cerca[:2]) <= NOMBRE_CERCA_M else ''
        filas.append([la, lo, 'fijo', f'límite {vel} km/h' if vel else '', None,
                      f'{sentido}°' if sentido else '', sitio, '', '', None])

    def mas_cerca(la, lo, tk, cum, escala):
        mejor = (1e9, 0, 0.0)
        for i in range(len(tk) - 1):
            d, u = dist_a_segmento((la, lo), tk[i], tk[i + 1])
            if d < mejor[0]:
                mejor = (d, i, u)
        d, i, u = mejor
        return d, (cum[i] + u * (cum[i + 1] - cum[i])) / 1000.0 * escala

    por_dia, en_ruta_total, cerca_total = {}, 0, 0
    for t in tracks:
        en_ruta, cerca = [], []
        for idx, f in enumerate(filas):
            d, km = mas_cerca(f[0], f[1], t['tk'], t['cum'], t['escala'])
            if d > CERCA_M:
                continue
            (en_ruta if d <= EN_RUTA_M else cerca).append({'i': idx, 'km': round(km, 1), 'dist_m': round(d)})
        en_ruta.sort(key=lambda h: h['km']); cerca.sort(key=lambda h: h['km'])
        if en_ruta or cerca:
            por_dia[str(t['dia'])] = {'en_ruta': en_ruta, 'cerca': cerca}
            en_ruta_total += len(en_ruta); cerca_total += len(cerca)

    hoy = datetime.date.today().isoformat()
    out = {
        'fuente': 'OpenStreetMap (highway=speed_camera, licencia ODbL)',
        'url': 'https://www.openstreetmap.org/copyright',
        'organismo': 'de OpenStreetMap',
        'ambito': 'de la zona del viaje',
        'publicado': hoy,
        'descargado': hoy,
        'en_ruta_m': int(EN_RUTA_M),
        'cerca_m': int(CERCA_M),
        'totales': {'fijos': len(filas), 'tramo': 0, 'puntos': len(filas), 'en_ruta': en_ruta_total, 'cerca': cerca_total},
        'aviso': ('Radares fijos mapeados en OpenStreetMap: la lista está INCOMPLETA (Marruecos tiene '
                  'unos 670 fijos y la mayoría no están en el mapa) y no incluye los radares móviles de la '
                  'Policía y la Gendarmería, que son los más habituales, sobre todo a la entrada de los pueblos. '
                  'Muchos fijos nuevos controlan los dos sentidos. Respetar siempre los límites.'),
        'campos': CAMPOS,
        'radares': filas,
        'tramos': [],
        'por_dia': por_dia,
    }
    j = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    j = j.replace('],[', '],\n[').replace('"radares":[', '"radares":[\n').replace('],"tramos"', '\n],"tramos"')
    open('radares.json', 'w', encoding='utf-8').write(j + '\n')
    print(f'{vid}: {len(filas)} radares de OpenStreetMap; {en_ruta_total} sobre la ruta y {cerca_total} a menos de {int(CERCA_M / 1000)} km')
    for d, h in sorted(por_dia.items(), key=lambda x: int(x[0])):
        print(f"  día {d}: {len(h['en_ruta'])} en ruta, {len(h['cerca'])} cerca")


if __name__ == '__main__':
    vid, resto = argv_viaje()
    main(resto[0] if resto else None, vid)
