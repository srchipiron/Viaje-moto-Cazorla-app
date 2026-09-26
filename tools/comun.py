"""Utilidades comunes de las herramientas: donde esta cada viaje.

Cada viaje vive en viajes/<id>/ con viaje.json, tracks/, gpx/, radares.json y gasolineras.json.
viajes/index.json lista los viajes y dice cual es el activo (el que abre la app sin ?viaje=).
Las herramientas trabajan sobre el activo salvo que se les pase --viaje <id>.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDICE = os.path.join(ROOT, 'viajes', 'index.json')

def indice():
    with open(INDICE, encoding='utf-8') as f:
        return json.load(f)

def guardar_indice(idx):
    with open(INDICE, 'w', encoding='utf-8') as f:
        f.write(json.dumps(idx, ensure_ascii=False, indent=1) + '\n')

def dir_viaje(vid=None):
    """(id, carpeta absoluta) del viaje pedido o del activo."""
    vid = vid or indice()['activo']
    d = os.path.join(ROOT, 'viajes', vid)
    if not os.path.isfile(os.path.join(d, 'viaje.json')):
        raise SystemExit(f'No existe el viaje {vid!r} (falta viajes/{vid}/viaje.json)')
    return vid, d

def argv_viaje(argv=None):
    """Saca '--viaje <id>' de los argumentos. Devuelve (id o None, resto de argumentos)."""
    argv = list(sys.argv[1:] if argv is None else argv)
    vid = None
    if '--viaje' in argv:
        i = argv.index('--viaje')
        if i + 1 >= len(argv):
            raise SystemExit('--viaje necesita un id')
        vid = argv[i + 1]
        del argv[i:i + 2]
    return vid, argv

def resumen_indice(vid, plan):
    """Entrada de viajes/index.json a partir del viaje.json."""
    p = plan['proyecto']
    it = plan['itinerario']
    return {
        'id': vid,
        'nombre': p.get('nombre', vid),
        'inicio': p['fechas']['inicio'],
        'fin': p['fechas']['fin'],
        'dias': len(it),
        'km': p.get('distancia_total_aprox_km') or round(sum(d.get('km_aprox') or 0 for d in it)),
        'moto': (p.get('moto') or {}).get('modelo', ''),
    }
