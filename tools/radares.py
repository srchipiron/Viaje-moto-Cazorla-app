#!/usr/bin/env python3
"""Genera data/radares.json: radares fijos y de tramo de la DGT que caen sobre los
tracks del viaje.

Fuente: fichero DATEX II del punto de acceso nacional de la DGT (datos abiertos).
Cubre solo la red gestionada por la DGT: no incluye Cataluna ni Pais Vasco, ni los
radares autonomicos o municipales, ni los moviles.

Uso:
    python3 tools/radares.py            # descarga y regenera data/radares.json
    python3 tools/radares.py fichero.xml  # usa un XML ya descargado
"""
import json, math, os, sys, datetime
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'https://nap.dgt.es/datex2/dgt/PredefinedLocationsPublication/radares/content.xml'
UMBRAL_M = 250.0          # a menos de esto del track, el radar esta en la ruta
R = 6371000.0

def tag(e):
    return e.tag.split('}')[-1]

def primer_valor(e, nombre):
    for c in e.iter():
        if tag(c) == nombre and (c.text or '').strip():
            return c.text.strip()
    return ''

def descriptores(pt):
    """Nombres TPEG de un punto: linkName (carretera), townName (municipio), other."""
    out = {}
    for n in pt:
        if tag(n) != 'name':
            continue
        valor = tipo = ''
        for c in n.iter():
            if tag(c) == 'value':
                valor = (c.text or '').strip()
            if tag(c) == 'tpegDescriptorType':
                tipo = (c.text or '').strip()
        if tipo and valor:
            out.setdefault(tipo, valor)
    return out

MINUS = {'DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y', 'EN'}

def bonito(s):
    """ALMERIA -> Almeria; VILLANUEVA DE LOS INFANTES -> Villanueva de los Infantes."""
    if not s:
        return ''
    ps = s.strip().split()
    return ' '.join(p.capitalize() if (i == 0 or p not in MINUS) else p.lower() for i, p in enumerate(ps))

def parse(xml_txt):
    root = ET.fromstring(xml_txt)
    publicado = (primer_valor(root, 'publicationTime') or '')[:10]
    rads = []
    for pset in root.iter():
        if tag(pset) != 'predefinedLocationSet':
            continue
        conjunto = ''
        for c in pset:
            if tag(c) == 'predefinedLocationSetName':
                conjunto = primer_valor(c, 'value')
        for pl in pset:
            if tag(pl) != 'predefinedLocation':
                continue
            interior = [c for c in pl if tag(c) == 'predefinedLocation']
            if not interior:
                continue
            interior = interior[0]
            puntos = []
            for p in interior.iter():
                if tag(p) not in ('point', 'from', 'to'):
                    continue
                lat = lon = None
                for c in p.iter():
                    if tag(c) == 'latitude':
                        lat = float(c.text)
                    if tag(c) == 'longitude':
                        lon = float(c.text)
                if lat is not None:
                    puntos.append({'rol': tag(p), 'lat': lat, 'lon': lon, **descriptores(p)})
            ref = {}
            for r in interior.iter():
                if tag(r) != 'referencePoint':
                    continue
                for c in r.iter():
                    k = tag(c)
                    if k not in ('roadNumber', 'directionRelative', 'referencePointDistance',
                                 'directionNamed', 'administrativeArea'):
                        continue
                    v = (c.text or '').strip() or (primer_valor(c, 'value') if k == 'administrativeArea' else '')
                    if v:
                        ref.setdefault(k, v)
            rads.append({'conjunto': conjunto, 'puntos': puntos, 'ref': ref})
    return publicado, rads

def hav_m(a, b):
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    x = math.radians(b[1] - a[1]) * math.cos((la1 + la2) / 2)
    return R * math.hypot(x, la2 - la1)

def dist_a_segmento(p, a, b):
    """Distancia en metros de p al segmento a-b, y posicion relativa t dentro del segmento."""
    cl = math.cos(math.radians(p[0])) * R * math.pi / 180
    rl = R * math.pi / 180
    ax, ay = (a[1] - p[1]) * cl, (a[0] - p[0]) * rl
    bx, by = (b[1] - p[1]) * cl, (b[0] - p[0]) * rl
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L))
    return math.hypot(ax + t * dx, ay + t * dy), t

def main(xml_path=None):
    os.chdir(ROOT)
    if xml_path:
        xml_txt = open(xml_path, encoding='utf-8').read()
    else:
        xml_txt = urllib.request.urlopen(URL, timeout=120).read().decode('utf-8')
    publicado, rads = parse(xml_txt)
    plan = json.load(open('data/viaje.json', encoding='utf-8'))
    fijos = sum(1 for r in rads if r['conjunto'] == 'CabinasCinemometro')
    tramo = sum(1 for r in rads if r['conjunto'] == 'CinemometrosVelocidadMedia')

    por_dia, total = {}, 0
    for dia in plan['itinerario']:
        if not dia.get('gpx') or not dia['gpx'].get('track'):
            continue
        t = json.load(open(dia['gpx']['track'], encoding='utf-8'))
        tk = t['track']
        cum = [0.0]
        for i in range(1, len(tk)):
            cum.append(cum[-1] + hav_m(tk[i - 1], tk[i]))
        escala = t['km'] / (cum[-1] / 1000.0) if cum[-1] else 1.0
        bb = t['bbox']
        hits, vistos = [], set()
        for r in rads:
            for pt in r['puntos']:
                la, lo = pt['lat'], pt['lon']
                if not (bb[0] - 0.02 <= la <= bb[2] + 0.02 and bb[1] - 0.02 <= lo <= bb[3] + 0.02):
                    continue
                mejor = (1e9, 0, 0.0)
                for i in range(len(tk) - 1):
                    d, u = dist_a_segmento((la, lo), tk[i], tk[i + 1])
                    if d < mejor[0]:
                        mejor = (d, i, u)
                if mejor[0] > UMBRAL_M:
                    continue
                clave = (round(la, 5), round(lo, 5))
                if clave in vistos:
                    continue
                vistos.add(clave)
                d, i, u = mejor
                km = (cum[i] + u * (cum[i + 1] - cum[i])) / 1000.0 * escala
                pk = r['ref'].get('referencePointDistance')
                hits.append({
                    'tipo': 'tramo' if r['conjunto'] == 'CinemometrosVelocidadMedia' else 'fijo',
                    'via': r['ref'].get('roadNumber') or pt.get('linkName', ''),
                    'pk': round(float(pk) / 1000.0, 1) if pk else None,
                    'sentido': {'positive': 'creciente', 'negative': 'decreciente'}.get(r['ref'].get('directionRelative'), ''),
                    'hacia': bonito(r['ref'].get('directionNamed', '')),
                    'municipio': bonito(pt.get('townName', '')),
                    'provincia': bonito(r['ref'].get('administrativeArea', '')),
                    'lat': round(la, 5), 'lon': round(lo, 5),
                    'km': round(km, 1), 'dist_m': round(d),
                })
        hits.sort(key=lambda h: h['km'])
        if hits:
            por_dia[str(dia['dia'])] = hits
            total += len(hits)

    out = {
        'fuente': 'DGT · Punto de Acceso Nacional (DATEX II, datos abiertos)',
        'url': URL,
        'publicado': publicado,
        'descargado': datetime.date.today().isoformat(),
        'umbral_m': int(UMBRAL_M),
        'totales': {'fijos': fijos, 'tramo': tramo, 'en_ruta': total},
        'aviso': ('Solo radares fijos y de tramo de la red que gestiona la DGT. No incluye '
                  'Cataluña ni País Vasco, ni radares autonómicos, municipales o móviles: '
                  'en las carreteras pequeñas del viaje los controles suelen ser móviles y '
                  'no salen aquí. El sentido es el de kilometraje del radar; puede estar en '
                  'la calzada contraria.'),
        'por_dia': por_dia,
    }
    open('data/radares.json', 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    print(f"data/radares.json: {fijos} fijos + {tramo} de tramo en España, {total} sobre la ruta")
    for d, hs in por_dia.items():
        print(f"  día {d}: " + ' · '.join(f"km {h['km']} {h['via']} pk {h['pk']} ({h['dist_m']} m)" for h in hs))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
