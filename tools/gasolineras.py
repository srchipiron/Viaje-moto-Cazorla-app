#!/usr/bin/env python3
"""Genera viajes/<id>/gasolineras.json: las gasolineras que estan sobre los tracks del viaje
(a menos de 400 m), con el km de la etapa. Sin precios: los precios cambian a diario
y la app los pide en vivo, por provincia (España) o distrito (Portugal), y los cruza por id.

Fuentes (datos abiertos, CORS abierto):
  España: Ministerio para la Transición Ecológica, Geoportal de hidrocarburos
    https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/
  Portugal: DGEG, Preços dos combustíveis (solo si algún track pisa Portugal)
    https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/

En Portugal el id es 'PT-<Id de la DGEG>' y la provincia 'PT-<idDistrito>'; el horario sale de la
ficha de cada gasolinera (una peticion por gasolinera de la ruta).

Uso:
    python3 tools/gasolineras.py                     # descarga el listado completo (12 MB) y regenera el viaje activo
    python3 tools/gasolineras.py fichero.json        # usa un listado de España ya descargado
    python3 tools/gasolineras.py --viaje <id> [json] # otro viaje de viajes/
"""
import json, math, os, sys, datetime, time
import urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import dir_viaje, argv_viaje

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/'
API_PT = 'https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/'
PT_PRODUCTO = {'id': 3201, 'nombre': 'Gasolina simples 95'}
PT_BBOX = (36.9, -9.6, 42.2, -6.1)   # Portugal continental (lat0, lon0, lat1, lon1), con margen
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

def leer_json(url, timeout=120):
    req = urllib.request.Request(url, headers={'User-Agent': 'viaje-moto-planner/1.0 (tools/gasolineras.py)'})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode('utf-8'))

def toca_portugal(tracks):
    la0, lo0, la1, lo1 = PT_BBOX
    return any(b[0] <= la1 and b[2] >= la0 and b[1] <= lo1 and b[3] >= lo0 for b in (t['bbox'] for t in tracks))

def estaciones_pt():
    """Todas las gasolineras de Portugal continental con gasolina 95, distrito a distrito."""
    est = []
    for d in leer_json(API_PT + 'GetDistritos')['resultado']:
        url = (API_PT + f"PesquisarPostos?idsTiposComb={PT_PRODUCTO['id']}&idMarca=&idTipoPosto="
               f"&idDistrito={d['Id']}&idsMunicipios=&qtdPorPagina=9999&pagina=1")
        for e in leer_json(url)['resultado'] or []:
            if e.get('Latitude') and e.get('Longitude'):
                est.append((float(e['Latitude']), float(e['Longitude']), {'pais': 'PT', 'distrito': d['Id'], **e}))
        time.sleep(0.3)
    return est

HORARIO_PT = {'aberto 24 horas': '24 h', 'encerrado': 'cerrada'}

def horario_pt(eid):
    """'L-D: 24 h' o 'L-V: 07:00-22:00; S: ...; D: ...' a partir de la ficha de la DGEG."""
    try:
        h = leer_json(API_PT + f'GetDadosPosto?id={eid}', 30)['resultado'].get('HorarioPosto') or {}
    except Exception:
        return ''
    def t(x):
        x = (x or '').strip()
        return HORARIO_PT.get(x.lower(), x) or '?'
    lv, s, d = t(h.get('DiasUteis')), t(h.get('Sabado')), t(h.get('Domingo'))
    if lv == s == d:
        return '' if lv == '?' else f'L-D: {lv}'   # sin horario declarado: la app pone «–»
    return f'L-V: {lv}; S: {s}; D: {d}'

def ficha(e):
    """Fila del JSON para una gasolinera de España o de Portugal."""
    if e.get('pais') == 'PT':
        marca = (e.get('Marca') or '').strip()
        rotulo = marca if marca and marca.lower() not in ('genérico', 'generico', 'outro', 'outra') else (e.get('Nome') or '')
        return {'id': f"PT-{e['Id']}", 'prov': f"PT-{e['distrito']}",
                'rotulo': (bonito(rotulo) if rotulo.isupper() else rotulo.strip()) or 'Sin rótulo',
                'municipio': e.get('Localidade') or e.get('Municipio') or '', 'direccion': (e.get('Morada') or '').strip(),
                'horario': None, 'pais': 'PT'}
    return {'id': e['IDEESS'], 'prov': e['IDProvincia'], 'rotulo': bonito(e['Rótulo']) or 'Sin rótulo',
            'municipio': e['Municipio'], 'direccion': bonito(e['Dirección']), 'horario': e['Horario']}

def main(path=None, vid=None):
    vid, carpeta = dir_viaje(vid)
    if path:
        datos = json.load(open(os.path.abspath(path), encoding='utf-8'))
    else:
        datos = json.loads(urllib.request.urlopen(API, timeout=180).read().decode('utf-8'))
    os.chdir(carpeta)   # las rutas de los tracks en viaje.json son relativas a la carpeta del viaje
    plan = json.load(open('viaje.json', encoding='utf-8'))
    est = []
    for e in datos['ListaEESSPrecio']:
        la, lo = num(e['Latitud']), num(e['Longitud (WGS84)'])
        if la is None or lo is None:
            continue
        est.append((la, lo, e))
    n_es = len(est)

    dias = [d for d in plan['itinerario'] if d.get('gpx') and d['gpx'].get('track')]
    tracks = {d['dia']: json.load(open(d['gpx']['track'], encoding='utf-8')) for d in dias}
    n_pt = 0
    if toca_portugal(tracks.values()):
        pt = estaciones_pt()
        n_pt = len(pt)
        est += pt

    por_dia, provincias, total = {}, {}, 0
    for dia in dias:
        t = tracks[dia['dia']]
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
            hits.append(dict(ficha(e), lat=round(la, 5), lon=round(lo, 5), km=round(km, 1), dist_m=round(d)))
        hits.sort(key=lambda h: h['km'])
        if hits:
            por_dia[str(dia['dia'])] = hits
            provincias[str(dia['dia'])] = sorted({h['prov'] for h in hits})
            total += len(hits)

    # Horario de las de Portugal: una peticion por gasolinera (la misma puede salir en dos dias).
    horarios = {}
    for hs in por_dia.values():
        for h in hs:
            if h.get('pais') == 'PT':
                if h['id'] not in horarios:
                    horarios[h['id']] = horario_pt(h['id'][3:])
                    time.sleep(0.2)
                h['horario'] = horarios[h['id']]

    out = {
        'fuente': 'Ministerio para la Transición Ecológica · Geoportal de hidrocarburos (datos abiertos)'
                  + (' y DGEG · Preços dos combustíveis (Portugal)' if n_pt else ''),
        'api': API,
        'producto': {'id': 1, 'nombre': 'Gasolina 95 E5'},
    }
    if n_pt:
        out['pt'] = {'fuente': 'DGEG · Preços dos combustíveis (datos abiertos)', 'api': API_PT,
                     'producto': PT_PRODUCTO}
    out.update({
        'generado': datetime.date.today().isoformat(),
        'umbral_m': int(UMBRAL_M),
        'aviso': ('Precios del día que publica cada gasolinera al Ministerio'
                  + (' (en Portugal, a la DGEG)' if n_pt else '') + '; pueden cambiar a lo largo del día. '
                  'Solo gasolineras a menos de 400 m del track: las del pueblo de al lado no salen. '
                  'El horario es el declarado; en pueblos pequeños, comprobarlo.'),
        'por_dia': por_dia,
        'provincias_por_dia': provincias,
    })
    open('gasolineras.json', 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
    print(f"viajes/{vid}/gasolineras.json: {total} gasolineras sobre la ruta ({n_es} en España, listado del {datos['Fecha']}"
          f"{f'; {n_pt} en Portugal' if n_pt else ''})")
    for d, hs in sorted(por_dia.items(), key=lambda x: int(x[0])):
        print(f"  día {d}: {len(hs)} · provincias {','.join(provincias[d])}")

if __name__ == '__main__':
    vid, resto = argv_viaje()
    main(resto[0] if resto else None, vid)
