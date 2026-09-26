#!/usr/bin/env python3
"""Crea un viaje nuevo en viajes/<id>/ a partir de los GPX de Kurviger, uno por dia y en orden.

Hace todo lo que la app necesita para abrirlo:
  - copia cada GPX a gpx/dia-NN.gpx y genera su track ligero en tracks/dia-NN.json
  - pone nombre a la salida y la llegada de cada dia (geocodificacion inversa de OpenStreetMap)
  - escribe un viaje.json minimo y valido: fechas, km, tiempo real estimado, horario de salida y
    llegada, dificultad y fatiga orientativas, puntos de meteo y contactos sin numeros personales
  - calcula los radares de la DGT y las gasolineras de la ruta
  - lo apunta en viajes/index.json (y lo deja como activo con --activar)

Lo demas (alojamientos, guia, equipaje, listas) se va rellenando luego en viaje.json: la app
muestra cada seccion solo si existe. Ver viajes/ejemplo/ para un viaje minimo generado asi.

Uso:
  python3 tools/nuevo_viaje.py <id> --nombre "Pirineo 2027" --inicio 2027-06-10 dia1.gpx dia2.gpx ...
Opciones:
  --corto "Pirineo"        nombre corto para la cabecera (por defecto, el nombre)
  --moto "Honda NX500"     modelo de moto;  --autonomia 380   km de autonomia orientativa
  --salida 09:30           hora de salida de cada dia
  --activar                deja este viaje como el que abre la app
  --oculto                 no sale en la lista de viajes de la app (plantillas, pruebas)
  --sin-red                no geocodifica ni descarga radares y gasolineras
  --radares-xml F          usa un XML de radares de la DGT ya descargado
  --gasolineras-json F     usa un listado del Ministerio ya descargado
"""
import argparse, datetime, json, os, shutil, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import ROOT, indice, guardar_indice, resumen_indice
import gpx2json

DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
PRINCIPIOS = [
    'No cambiar destinos ni bases sin una razon fuerte y explicita.',
    'No añadir turismo por añadir.',
    'Priorizar seguridad, fluidez y disfrute sobre kilometraje o espectacularidad.',
    'No proponer jornadas reales de conduccion superiores a 4h.',
    'Justificar cada cambio con impacto en km, tiempo, dificultad y fatiga.',
    'No inventar disponibilidad, horarios ni precios; verificar antes.',
    'Este JSON es la fuente de verdad: actualizar estados, no rehacer el plan.',
]

def lugar(lat, lon, sin_red, defecto):
    """Nombre del pueblo en un punto (Nominatim, 1 peticion por segundo como piden)."""
    if sin_red:
        return defecto
    url = 'https://nominatim.openstreetmap.org/reverse?' + urllib.parse.urlencode(
        {'lat': lat, 'lon': lon, 'format': 'json', 'zoom': 14, 'accept-language': 'es'})
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'viaje-moto-planner/1.0 (tools/nuevo_viaje.py)'})
        a = json.load(urllib.request.urlopen(req, timeout=30)).get('address', {})
        time.sleep(1.1)
        return a.get('village') or a.get('town') or a.get('city') or a.get('hamlet') or a.get('municipality') or defecto
    except Exception:
        return defecto

def hm(minutos):
    minutos = int(round(minutos))
    return f'{minutos // 60:02d}:{minutos % 60:02d}'

def dur(minutos):
    minutos = int(round(minutos / 5.0) * 5)
    return f'{minutos // 60}h{minutos % 60:02d}'

def nivel(valor, cortes):
    """1..4 segun en que tramo cae el valor."""
    return 1 + sum(valor >= c for c in cortes)

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('id')
    ap.add_argument('gpx', nargs='+')
    ap.add_argument('--nombre', required=True)
    ap.add_argument('--inicio', required=True, help='AAAA-MM-DD del primer dia')
    ap.add_argument('--corto')
    ap.add_argument('--moto', default='Honda NX500')
    ap.add_argument('--autonomia', type=int, default=380)
    ap.add_argument('--salida', default='09:30')
    ap.add_argument('--activar', action='store_true')
    ap.add_argument('--oculto', action='store_true')
    ap.add_argument('--sin-red', action='store_true')
    ap.add_argument('--radares-xml')
    ap.add_argument('--gasolineras-json')
    a = ap.parse_args()

    if not a.id.replace('-', '').replace('_', '').replace('.', '').isalnum():
        raise SystemExit('El id solo puede llevar letras, numeros, guiones, puntos y guiones bajos')
    carpeta = os.path.join(ROOT, 'viajes', a.id)
    if os.path.exists(os.path.join(carpeta, 'viaje.json')):
        raise SystemExit(f'Ya existe viajes/{a.id}/viaje.json: no lo piso')
    inicio = datetime.date.fromisoformat(a.inicio)
    salida_min = int(a.salida[:2]) * 60 + int(a.salida[3:5])
    for g in a.gpx:
        if not os.path.isfile(g):
            raise SystemExit(f'No encuentro {g}')
    os.makedirs(os.path.join(carpeta, 'gpx'), exist_ok=True)
    os.makedirs(os.path.join(carpeta, 'tracks'), exist_ok=True)

    itinerario, anterior = [], None
    for n, origen_gpx in enumerate(a.gpx, 1):
        nn = f'{n:02d}'
        gpx_rel, track_rel = f'gpx/dia-{nn}.gpx', f'tracks/dia-{nn}.json'
        shutil.copyfile(origen_gpx, os.path.join(carpeta, gpx_rel))
        gpx2json.main(os.path.join(carpeta, gpx_rel), os.path.join(carpeta, track_rel))
        t = json.load(open(os.path.join(carpeta, track_rel), encoding='utf-8'))
        if not t['track']:
            raise SystemExit(f'{origen_gpx} no trae track (<trk>): exporta el GPX de Kurviger con la ruta calculada, no solo los puntos')
        ini, fin, mitad = t['track'][0], t['track'][-1], t['track'][len(t['track']) // 2]
        origen = anterior or lugar(ini[0], ini[1], a.sin_red, f'Salida dia {n}')
        destino = lugar(fin[0], fin[1], a.sin_red, f'Llegada dia {n}')
        anterior = destino
        # Tiempo real: el de Kurviger mas un 15 % (arranques, pueblos, repostajes). Paradas: 20 min
        # por cada hora y media de moto. Todo orientativo: se ajusta a mano al preparar el dia.
        kurv = t.get('duracion_min') or t['km'] * 1.1
        real = kurv * 1.15
        paradas = 20 * int(real // 90)
        fecha = inicio + datetime.timedelta(days=n - 1)
        km_subida = (t.get('subida_m') or 0) / max(t['km'], 1)
        itinerario.append({
            'dia': n,
            'fecha': fecha.isoformat(),
            'dia_semana': DIAS_SEMANA[fecha.weekday()],
            'tipo': 'montaña' if (t.get('alt_max_m') or 0) >= 1000 else 'llano',
            'origen': origen,
            'destino': destino,
            'km_aprox': round(t['km']),
            'tiempo_real_aprox': dur(real),
            'dificultad': nivel(km_subida, (8, 13, 18)),
            'fatiga': nivel(t['km'], (120, 200, 260)),
            'perfil_kurviger': 'Por definir',
            'salida': a.salida,
            'llegada_prevista': hm(salida_min + real + paradas),
            'meteo_puntos': [
                {'nombre': f'Mitad del dia {n}', 'lat': round(mitad[0], 2), 'lon': round(mitad[1], 2)},
                {'nombre': destino, 'lat': round(fin[0], 2), 'lon': round(fin[1], 2)},
            ],
            'waypoints': [origen, destino],
            'gpx': {
                'archivo': gpx_rel,
                'track': track_rel,
                'vias': [],
                'nota': f'Generado con tools/nuevo_viaje.py desde {os.path.basename(origen_gpx)} '
                        f'({t["km"]} km, {t.get("duracion_min") or "?"} min de Kurviger). Poner nombre a las vias en "vias".',
            },
            'notas': [f'Horario orientativo: {dur(kurv)} de Kurviger mas un 15 % y {paradas} min de paradas.'],
        })
        print(f'  dia {n}: {origen} -> {destino}, {round(t["km"])} km, {dur(real)} reales')

    km_total = round(sum(d['km_aprox'] for d in itinerario))
    fin_viaje = inicio + datetime.timedelta(days=len(itinerario) - 1)
    hoy = datetime.date.today().isoformat()
    plan = {
        'meta': {'version': 1, 'revision': 1, 'actualizado': hoy,
                 'uso': 'Fuente de verdad del viaje para la app. Actualizar estados en vez de rehacer el plan.',
                 'cambios': [f'Viaje creado con tools/nuevo_viaje.py a partir de {len(itinerario)} GPX']},
        'proyecto': {
            'nombre': a.nombre,
            'nombre_corto': a.corto or a.nombre,
            'fechas': {'inicio': inicio.isoformat(), 'fin': fin_viaje.isoformat(),
                       'dias': len(itinerario), 'noches': max(0, len(itinerario) - 1)},
            'distancia_total_aprox_km': km_total,
            'moto': {'modelo': a.moto, 'autonomia_orientativa_km': a.autonomia,
                     'regla_gasolina': 'En sierra, llenar cada vez que se baje de medio deposito.'},
        },
        'itinerario': itinerario,
        'alojamientos_resumen': [],
        'contactos': {
            'emergencias': '112',
            'en_casa': {'nombre': 'Contacto en casa', 'telefono': None, 'local': True,
                        'nota': 'El numero no se guarda en el repositorio: se introduce en la app y queda solo en el movil.'},
        },
        'principios_para_claude': PRINCIPIOS,
    }
    with open(os.path.join(carpeta, 'viaje.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(plan, ensure_ascii=False, indent=2) + '\n')

    if not a.sin_red or a.radares_xml:
        import radares
        radares.main(a.radares_xml, a.id)
    if not a.sin_red or a.gasolineras_json:
        import gasolineras
        gasolineras.main(a.gasolineras_json, a.id)

    idx = indice()
    entrada = resumen_indice(a.id, plan)
    if a.oculto:
        entrada['oculto'] = True
    idx['viajes'] = [v for v in idx['viajes'] if v['id'] != a.id] + [entrada]
    if a.activar:
        idx['activo'] = a.id
    guardar_indice(idx)
    print(f'viajes/{a.id}/: {len(itinerario)} dias, {km_total} km'
          f'{" · activo" if a.activar else f" · abrir con ?viaje={a.id}"}')

if __name__ == '__main__':
    main()
