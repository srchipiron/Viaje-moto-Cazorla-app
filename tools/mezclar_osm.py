#!/usr/bin/env python3
"""Añade a radares.json y gasolineras.json de un viaje (los de la DGT y el Ministerio, solo España)
los radares y gasolineras de OpenStreetMap del tramo fuera de España (p. ej. Portugal).

Uso, después de tools/radares.py y tools/gasolineras.py:
    python3 tools/mezclar_osm.py --viaje <id> radares.csv gasolineras.psv
Los dos ficheros son las salidas de Overpass que leen tools/radares_osm.py y tools/gasolineras_osm.py,
ya filtradas a lo que está fuera de España (si no, se duplican las de España).
Además calcula `huecos` (tramo más largo sin gasolinera) para todos los días.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import dir_viaje, argv_viaje
import radares_osm, gasolineras_osm
from radares_osm import cargar_tracks


def main(csv_path, psv_path, vid=None):
    vid, carpeta = dir_viaje(vid)
    csv_path, psv_path = os.path.abspath(csv_path), os.path.abspath(psv_path)
    rad = json.load(open(os.path.join(carpeta, 'radares.json'), encoding='utf-8'))
    gas = json.load(open(os.path.join(carpeta, 'gasolineras.json'), encoding='utf-8'))
    if 'osm' in rad.get('fuente', '').lower():
        raise SystemExit('radares.json ya lleva datos de OSM: regenerar antes con tools/radares.py')
    cwd = os.getcwd()
    radares_osm.main(csv_path, vid); os.chdir(cwd)
    gasolineras_osm.main(psv_path, vid); os.chdir(cwd)
    ro = json.load(open(os.path.join(carpeta, 'radares.json'), encoding='utf-8'))
    go = json.load(open(os.path.join(carpeta, 'gasolineras.json'), encoding='utf-8'))

    # Radares: filas de OSM al final de la lista y sus índices desplazados
    base = len(rad['radares'])
    rad['radares'] += ro['radares']
    for dia, h in ro['por_dia'].items():
        d = rad['por_dia'].setdefault(dia, {'en_ruta': [], 'cerca': []})
        for k in ('en_ruta', 'cerca'):
            d[k] = sorted(d[k] + [dict(x, i=x['i'] + base) for x in h[k]], key=lambda x: x['km'])
    t = rad['totales']
    t['osm_fuera_de_espana'] = len(ro['radares'])
    t['en_ruta'] = sum(len(h['en_ruta']) for h in rad['por_dia'].values())
    t['cerca'] = sum(len(h['cerca']) for h in rad['por_dia'].values())
    rad['fuente'] = rad['fuente'] + ' + OpenStreetMap (fuera de España, ODbL)'
    rad['aviso'] = ((rad.get('aviso') or '') + ' Fuera de España, solo los radares fijos mapeados en OpenStreetMap: '
                    'la lista está incompleta (en Portugal faltan muchos de la red SINCRO y todos los móviles).').strip()
    j = json.dumps(rad, ensure_ascii=False, separators=(',', ':'))
    j = j.replace('],[', '],\n[').replace('"radares":[', '"radares":[\n').replace('],"tramos"', '\n],"tramos"')
    open(os.path.join(carpeta, 'radares.json'), 'w', encoding='utf-8').write(j + '\n')

    # Gasolineras: las de OSM sin precio, mezcladas por km; huecos de todos los días
    for dia, lista in go['por_dia'].items():
        gas['por_dia'][dia] = sorted(gas['por_dia'].get(dia, []) + lista, key=lambda s: s['km'])
    plan = json.load(open(os.path.join(carpeta, 'viaje.json'), encoding='utf-8'))
    huecos = {}
    os.chdir(carpeta)
    for tr in cargar_tracks(plan):
        dia = str(tr['dia'])
        total = round(tr['cum'][-1] / 1000.0 * tr['escala'], 1)
        marcas = [0.0] + [s['km'] for s in gas['por_dia'].get(dia, [])] + [total]
        mayor = max(((b - a, a, b) for a, b in zip(marcas, marcas[1:])), default=(0, 0, 0))
        huecos[dia] = {'max_km': round(mayor[0]), 'desde_km': round(mayor[1], 1), 'hasta_km': round(mayor[2], 1)}
    gas['huecos'] = huecos
    gas['fuente'] = gas['fuente'] + ' + OpenStreetMap (fuera de España, ODbL)'
    gas['aviso'] = ((gas.get('aviso') or '') + ' Fuera de España, gasolineras de OpenStreetMap sin precio: '
                    'puede faltar alguna y no se sabe si está abierta.').strip()
    open(os.path.join(carpeta, 'gasolineras.json'), 'w', encoding='utf-8').write(json.dumps(gas, ensure_ascii=False, separators=(',', ':')) + '\n')
    os.chdir(cwd)
    print(f'{vid}: {len(ro["radares"])} radares y {sum(len(v) for v in go["por_dia"].values())} gasolineras de OSM añadidos')
    for d, h in sorted(huecos.items(), key=lambda x: int(x[0])):
        print(f"  día {d}: {len(gas['por_dia'].get(d, []))} gasolineras · hueco máximo {h['max_km']} km · radares en ruta {len(rad['por_dia'].get(d, {}).get('en_ruta', []))}")


if __name__ == '__main__':
    vid, resto = argv_viaje()
    if len(resto) != 2:
        raise SystemExit(__doc__)
    main(resto[0], resto[1], vid)
