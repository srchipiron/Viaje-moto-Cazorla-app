#!/usr/bin/env python3
"""Comprueba todos los viajes de viajes/: que el indice y cada viaje.json sean JSON valido, que cada
dia tenga lo minimo que necesita la app y que existan los ficheros a los que apunta.

Uso: python3 tools/validar.py [--viaje <id>]      (sin argumentos, todos los del indice)
Sale con codigo 1 si hay errores. Los avisos no bloquean.
"""
import datetime, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import ROOT, INDICE, argv_viaje

DIA_OBLIGATORIO = ('dia', 'fecha', 'origen', 'destino', 'km_aprox')

def cargar(ruta, errores):
    try:
        with open(ruta, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        errores.append(f'{os.path.relpath(ruta, ROOT)}: no existe')
    except json.JSONDecodeError as e:
        errores.append(f'{os.path.relpath(ruta, ROOT)}: JSON roto ({e})')
    return None

def validar_viaje(vid, errores, avisos):
    carpeta = os.path.join(ROOT, 'viajes', vid)
    plan = cargar(os.path.join(carpeta, 'viaje.json'), errores)
    if plan is None:
        return
    pre = f'viajes/{vid}'
    p = plan.get('proyecto') or {}
    if not p.get('nombre'):
        errores.append(f'{pre}: falta proyecto.nombre')
    it = plan.get('itinerario')
    if not isinstance(it, list) or not it:
        errores.append(f'{pre}: itinerario vacio')
        return
    anterior = None
    for i, e in enumerate(it, 1):
        falta = [k for k in DIA_OBLIGATORIO if e.get(k) in (None, '')]
        if falta:
            errores.append(f'{pre} dia {e.get("dia", i)}: falta {", ".join(falta)}')
            continue
        if e['dia'] != i:
            errores.append(f'{pre}: el dia en la posicion {i} dice ser el {e["dia"]}')
        try:
            f = datetime.date.fromisoformat(e['fecha'])
            if anterior and (f - anterior).days != 1:
                avisos.append(f'{pre} dia {i}: {e["fecha"]} no es el dia siguiente al anterior')
            anterior = f
        except ValueError:
            errores.append(f'{pre} dia {i}: fecha {e["fecha"]!r} no es AAAA-MM-DD')
        g = e.get('gpx')
        if g:
            if g.get('track'):
                t = cargar(os.path.join(carpeta, g['track']), errores)
                if t is not None and not t.get('track'):
                    errores.append(f'{pre} dia {i}: {g["track"]} no trae puntos')
            if g.get('archivo') and not os.path.isfile(os.path.join(carpeta, g['archivo'])):
                errores.append(f'{pre} dia {i}: no existe {g["archivo"]}')
        else:
            avisos.append(f'{pre} dia {i}: sin gpx (no habra mapa, radares ni gasolineras)')
    if p.get('fechas', {}).get('inicio') and p['fechas']['inicio'] != it[0]['fecha']:
        avisos.append(f'{pre}: proyecto.fechas.inicio ({p["fechas"]["inicio"]}) no coincide con el dia 1 ({it[0]["fecha"]})')
    for extra in ('radares.json', 'gasolineras.json'):
        ruta = os.path.join(carpeta, extra)
        if os.path.exists(ruta):
            cargar(ruta, errores)
        else:
            avisos.append(f'{pre}: sin {extra} (generarlo con tools/{extra.replace(".json", ".py")} --viaje {vid})')
    # Datos personales: el repositorio es publico. Un contacto personal va con local: true y sin numero.
    casa = (plan.get('contactos') or {}).get('en_casa')
    if isinstance(casa, dict) and casa.get('telefono'):
        errores.append(f'{pre}: contactos.en_casa lleva un telefono; el repositorio es publico (usar "local": true y telefono null)')

def main():
    vid, _ = argv_viaje()
    errores, avisos = [], []
    idx = cargar(INDICE, errores)
    if idx is None:
        print('\n'.join(errores)); return 1
    ids = [v['id'] for v in idx.get('viajes', [])]
    if idx.get('activo') not in ids:
        errores.append(f'viajes/index.json: el activo {idx.get("activo")!r} no esta en la lista')
    en_disco = sorted(d for d in os.listdir(os.path.join(ROOT, 'viajes')) if os.path.isdir(os.path.join(ROOT, 'viajes', d)))
    for d in en_disco:
        if d not in ids:
            avisos.append(f'viajes/{d}/ no esta en viajes/index.json (no se podra abrir desde la app)')
    for v in ([vid] if vid else ids):
        validar_viaje(v, errores, avisos)
    for a in avisos:
        print('aviso:', a)
    for e in errores:
        print('ERROR:', e)
    print(f'{len(ids)} viajes, {len(errores)} errores, {len(avisos)} avisos')
    return 1 if errores else 0

if __name__ == '__main__':
    sys.exit(main())
