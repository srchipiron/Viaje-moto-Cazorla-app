#!/usr/bin/env python3
"""Empaqueta la app con un viaje en un unico HTML autocontenido (para el artefacto de Claude o para
enviar por correo). Incrusta CSS, plan, tracks, radares, gasolineras y JS; el service worker y el
mapa interactivo no aplican en esa version.

Uso: python3 tools/bundle.py [--viaje <id>] [salida.html]   (por defecto el viaje activo y
     dist/viaje-nx500.html)
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import ROOT, dir_viaje, argv_viaje

def leer(ruta, defecto='null'):
    return open(ruta, encoding='utf-8').read().strip() if os.path.exists(ruta) else defecto

def main(out_path, vid=None):
    vid, carpeta = dir_viaje(vid)
    os.chdir(ROOT)
    css = open('styles.css', encoding='utf-8').read()
    # El visor de artefactos marca data-theme en <html>: duplicar los tokens oscuros para los tres estados.
    m = re.search(r"@media \(prefers-color-scheme: dark\) \{\n  :root \{\n(.*?)\n  \}\n\}", css, re.S)
    if m:
        dark = m.group(1)
        css = css.replace(m.group(0), "@media (prefers-color-scheme: dark) {\n  :root:not([data-theme=\"light\"]) {\n" + dark + "\n  }\n}\n:root[data-theme=\"dark\"] {\n" + dark.replace('\n    ', '\n  ') + "\n}")
    html = open('index.html', encoding='utf-8').read()
    body = html.split('<body>')[1].split('</body>')[0].replace('<script src="app.js"></script>', '')
    plan_txt = leer(os.path.join(carpeta, 'viaje.json'))
    plan = json.loads(plan_txt)
    tracks = {str(d['dia']): json.load(open(os.path.join(carpeta, d['gpx']['track']), encoding='utf-8'))
              for d in plan['itinerario'] if d.get('gpx') and d['gpx'].get('track')}
    radares = leer(os.path.join(carpeta, 'radares.json'))
    gasolineras = leer(os.path.join(carpeta, 'gasolineras.json'))
    titulo = plan['proyecto'].get('nombre_corto') or plan['proyecto'].get('nombre', 'Viaje')
    js = open('app.js', encoding='utf-8').read()
    out = (f"<title>{titulo}</title>\n<style>\n{css}\n</style>\n{body}\n"
           f"<script>window.VIAJE_ID = {json.dumps(vid)};\nwindow.VIAJE_DATA = {plan_txt};\n"
           f"window.VIAJE_TRACKS = {json.dumps(tracks, ensure_ascii=False, separators=(',', ':'))};\n"
           f"window.VIAJE_RADARES = {radares};\nwindow.VIAJE_GASOLINERAS = {gasolineras};</script>\n"
           f"<script>\n{js}\n</script>\n")
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    open(out_path, 'w', encoding='utf-8').write(out)
    print(f"{out_path}: {len(out) // 1024} KB, viaje {vid}, {len(tracks)} tracks")

if __name__ == '__main__':
    vid, resto = argv_viaje()
    main(resto[0] if resto else os.path.join(ROOT, 'dist', 'viaje-nx500.html'), vid)
