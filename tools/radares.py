#!/usr/bin/env python3
"""Genera viajes/<id>/radares.json: TODOS los radares fijos y de tramo de la DGT, mas el
indice de los que caen sobre los tracks del viaje.

El fichero lleva la lista completa de Espana (formato columnar para que ocupe poco) y,
por cada dia, los radares que estan sobre la ruta (a menos de 250 m del track) y los
que quedan cerca (a menos de 5 km), con el km de la etapa. La app usa la lista completa
para avisar de lo que tienes alrededor aunque te salgas de la ruta.

Fuente: fichero DATEX II del punto de acceso nacional de la DGT (datos abiertos).
Cubre solo la red gestionada por la DGT: no incluye Cataluna ni Pais Vasco, ni los
radares autonomicos o municipales, ni los moviles.

Uso:
    python3 tools/radares.py                        # descarga y regenera el radares.json del viaje activo
    python3 tools/radares.py fichero.xml            # usa un XML ya descargado
    python3 tools/radares.py --viaje <id> [xml]     # otro viaje de viajes/
"""
import json, math, os, sys, datetime
import urllib.request
import xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import dir_viaje, argv_viaje

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'https://nap.dgt.es/datex2/dgt/PredefinedLocationsPublication/radares/content.xml'
EN_RUTA_M = 250.0         # a menos de esto del track, el radar esta en la ruta
CERCA_M = 5000.0          # a menos de esto, el radar queda cerca (desvios, vueltas por el pueblo)
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

def radar_normalizado(r, pt, grupo):
    """Una fila de la lista completa, en el orden de CAMPOS."""
    pk = r['ref'].get('referencePointDistance')
    return [
        round(pt['lat'], 5), round(pt['lon'], 5),
        'tramo' if r['conjunto'] == 'CinemometrosVelocidadMedia' else 'fijo',
        r['ref'].get('roadNumber') or pt.get('linkName', ''),
        round(float(pk) / 1000.0, 1) if pk else None,
        {'positive': 'creciente', 'negative': 'decreciente'}.get(r['ref'].get('directionRelative'), ''),
        bonito(pt.get('townName', '')),
        bonito(r['ref'].get('administrativeArea', '')),
        {'from': 'inicio', 'to': 'fin'}.get(pt['rol'], ''),
        grupo,   # numero de tramo (inicio y fin comparten grupo); None en los fijos
    ]

CAMPOS = ['lat', 'lon', 'tipo', 'via', 'pk', 'sentido', 'municipio', 'provincia', 'punto', 'grupo']

def main(xml_path=None, vid=None):
    vid, carpeta = dir_viaje(vid)
    if xml_path:
        xml_txt = open(os.path.abspath(xml_path), encoding='utf-8').read()
    else:
        xml_txt = urllib.request.urlopen(URL, timeout=120).read().decode('utf-8')
    publicado, rads = parse(xml_txt)
    os.chdir(carpeta)   # las rutas de los tracks en viaje.json son relativas a la carpeta del viaje
    plan = json.load(open('viaje.json', encoding='utf-8'))
    fijos = sum(1 for r in rads if r['conjunto'] == 'CabinasCinemometro')
    tramo = sum(1 for r in rads if r['conjunto'] == 'CinemometrosVelocidadMedia')

    # lista completa: una fila por punto (los de tramo tienen inicio y fin)
    filas, vistos, tramos = [], set(), {}
    n_tramo = 0
    for r in rads:
        es_tramo = r['conjunto'] == 'CinemometrosVelocidadMedia'
        grupo = None
        if es_tramo:
            grupo = n_tramo
            n_tramo += 1
        for pt in r['puntos']:
            fila = radar_normalizado(r, pt, grupo)
            # dos cabinas pueden compartir punto (una por calzada): solo se descartan las
            # filas identicas en todo, que son el mismo radar repetido en el fichero
            clave = tuple(fila)
            if clave in vistos:
                continue
            vistos.add(clave)
            if es_tramo:
                tramos.setdefault(grupo, {'grupo': grupo})[fila[8] or 'inicio'] = len(filas)
            filas.append(fila)

    # tracks con distancia acumulada, para situar radares sobre la etapa
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
        tracks.append({'dia': dia['dia'], 'tk': tk, 'cum': cum, 'escala': escala, 'bbox': t['bbox']})

    def mas_cerca(la, lo, tk, cum, escala):
        mejor = (1e9, 0, 0.0)
        for i in range(len(tk) - 1):
            d, u = dist_a_segmento((la, lo), tk[i], tk[i + 1])
            if d < mejor[0]:
                mejor = (d, i, u)
        d, i, u = mejor
        return d, (cum[i] + u * (cum[i + 1] - cum[i])) / 1000.0 * escala

    # cada tramo: a que distancia pasa el viaje de el (por el punto medio), en que dia y km
    lista_tramos = []
    for g in sorted(tramos):
        tr = tramos[g]
        if 'inicio' not in tr or 'fin' not in tr:
            continue
        a, b = filas[tr['inicio']], filas[tr['fin']]
        la, lo = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        mejor = None
        for t in tracks:
            d, km = mas_cerca(la, lo, t['tk'], t['cum'], t['escala'])
            if mejor is None or d < mejor[0]:
                mejor = (d, t['dia'], km)
        lista_tramos.append({'grupo': g, 'inicio': tr['inicio'], 'fin': tr['fin'],
                             'largo_km': round(hav_m(a[:2], b[:2]) / 1000.0, 1),
                             'dist_km': round(mejor[0] / 1000.0, 1), 'dia': mejor[1], 'km': round(mejor[2], 1)})
    lista_tramos.sort(key=lambda x: x['dist_km'])

    por_dia, en_ruta_total, cerca_total = {}, 0, 0
    for t in tracks:
        dia = t['dia']
        tk, cum, escala, bb = t['tk'], t['cum'], t['escala'], t['bbox']
        margen = CERCA_M / 111000.0 * 1.4
        en_ruta, cerca = [], []
        for idx, fila in enumerate(filas):
            la, lo = fila[0], fila[1]
            if not (bb[0] - margen <= la <= bb[2] + margen and bb[1] - margen <= lo <= bb[3] + margen):
                continue
            d, km = mas_cerca(la, lo, tk, cum, escala)
            if d > CERCA_M:
                continue
            fila_h = {'i': idx, 'km': round(km, 1), 'dist_m': round(d)}
            (en_ruta if d <= EN_RUTA_M else cerca).append(fila_h)
        en_ruta.sort(key=lambda h: h['km'])
        cerca.sort(key=lambda h: h['km'])
        if en_ruta or cerca:
            por_dia[str(dia)] = {'en_ruta': en_ruta, 'cerca': cerca}
            en_ruta_total += len(en_ruta)
            cerca_total += len(cerca)

    out = {
        'fuente': 'DGT · Punto de Acceso Nacional (DATEX II, datos abiertos)',
        'url': URL,
        'publicado': publicado,
        'descargado': datetime.date.today().isoformat(),
        'en_ruta_m': int(EN_RUTA_M),
        'cerca_m': int(CERCA_M),
        'totales': {'fijos': fijos, 'tramo': tramo, 'puntos': len(filas),
                    'en_ruta': en_ruta_total, 'cerca': cerca_total},
        'aviso': ('Solo radares fijos y de tramo de la red que gestiona la DGT. No incluye '
                  'Cataluña ni País Vasco, ni radares autonómicos, municipales o móviles: '
                  'en las carreteras pequeñas del viaje los controles suelen ser móviles y '
                  'no salen aquí. El sentido es el de kilometraje del radar; puede estar en '
                  'la calzada contraria.'),
        'campos': CAMPOS,
        'radares': filas,
        'tramos': lista_tramos,   # los 47 de tramo, del mas cercano al viaje al mas lejano
        'por_dia': por_dia,
    }
    txt = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    # una fila de radar por linea, para que el diff sea legible
    txt = txt.replace('],[', '],\n[').replace('"radares":[', '"radares":[\n').replace('],"tramos"', '\n],"tramos"')
    open('radares.json', 'w', encoding='utf-8').write(txt + '\n')
    print(f"viajes/{vid}/radares.json: {fijos} fijos + {tramo} de tramo ({len(filas)} puntos) en España, "
          f"{en_ruta_total} sobre la ruta y {cerca_total} a menos de {int(CERCA_M/1000)} km")
    print(f"  tramo mas cercano al viaje: {lista_tramos[0]['dist_km']} km (dia {lista_tramos[0]['dia']})" if lista_tramos else '  sin tramos')
    for d, h in sorted(por_dia.items(), key=lambda x: int(x[0])):
        print(f"  día {d}: {len(h['en_ruta'])} en ruta, {len(h['cerca'])} cerca")

if __name__ == '__main__':
    vid, resto = argv_viaje()
    main(resto[0] if resto else None, vid)
