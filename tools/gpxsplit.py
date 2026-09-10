#!/usr/bin/env python3
"""Parte un GPX de Kurviger en dos por un punto de ruta (via).

Uso: python3 tools/gpxsplit.py origen.gpx N salida-a.gpx "Nombre A" salida-b.gpx "Nombre B"

N es el indice (desde 0) del rtept donde se corta: ese punto sera el destino
de la primera ruta y la salida de la segunda. El track se corta en el punto
mas cercano a ese rtept.
"""
import copy, math, sys, xml.etree.ElementTree as ET

G = 'http://www.topografix.com/GPX/1/1'
ET.register_namespace('', G)
ET.register_namespace('gpxx', 'http://www.garmin.com/xmlschemas/GpxExtensions/v3')
ET.register_namespace('trp', 'http://www.garmin.com/xmlschemas/TripExtensions/v1')
ET.register_namespace('xsi', 'http://www.w3.org/2001/XMLSchema-instance')
NS = {'g': G}

def q(tag): return '{%s}%s' % (G, tag)

def set_name(root, name):
    for path in ('g:metadata/g:name', 'g:rte/g:name', 'g:trk/g:name'):
        el = root.find(path, NS)
        if el is not None: el.text = name

def set_type(rtept, typ, sym):
    t = rtept.find('g:type', NS); s = rtept.find('g:sym', NS); n = rtept.find('g:name', NS)
    if t is not None: t.text = typ
    if s is not None: s.text = sym
    if n is not None: n.text = 'Start' if typ == 'start' else 'Destination'

def main(src, n, out_a, name_a, out_b, name_b):
    tree = ET.parse(src); root = tree.getroot()
    rte = root.find('g:rte', NS); rpts = rte.findall('g:rtept', NS)
    seg = root.find('g:trk/g:trkseg', NS); tpts = seg.findall('g:trkpt', NS)
    cut = rpts[n]; lat, lon = float(cut.get('lat')), float(cut.get('lon'))
    k = math.cos(math.radians(lat))
    ti = min(range(len(tpts)), key=lambda i: (float(tpts[i].get('lat')) - lat) ** 2 + ((float(tpts[i].get('lon')) - lon) * k) ** 2)
    for part, (ra, rb, ta, tb, name, out, first, last) in enumerate((
            (0, n + 1, 0, ti + 1, name_a, out_a, None, ('destination', 'Flag, Red')),
            (n, len(rpts), ti, len(tpts), name_b, out_b, ('start', 'Flag, Green'), None))):
        r2 = copy.deepcopy(root)
        rte2 = r2.find('g:rte', NS)
        for p in rte2.findall('g:rtept', NS): rte2.remove(p)
        for p in rpts[ra:rb]: rte2.append(copy.deepcopy(p))
        new = rte2.findall('g:rtept', NS)
        if first: set_type(new[0], *first)
        if last: set_type(new[-1], *last)
        seg2 = r2.find('g:trk/g:trkseg', NS)
        for p in seg2.findall('g:trkpt', NS): seg2.remove(p)
        for p in tpts[ta:tb]: seg2.append(copy.deepcopy(p))
        set_name(r2, name)
        ET.ElementTree(r2).write(out, encoding='UTF-8', xml_declaration=True)
        print(f'{out}: {rb - ra} rtepts, {tb - ta} trkpts')

if __name__ == '__main__':
    if len(sys.argv) != 7: raise SystemExit(__doc__)
    main(sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6])
