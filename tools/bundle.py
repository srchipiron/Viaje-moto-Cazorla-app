#!/usr/bin/env python3
"""Empaqueta la app en un unico HTML autocontenido (para el artefacto de Claude o para
enviar por correo). Incrusta CSS, plan, tracks y JS; el service worker y el mapa
interactivo no aplican en esa version.

Uso: python3 tools/bundle.py [salida.html]   (por defecto dist/viaje-nx500.html)
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main(out_path):
    os.chdir(ROOT)
    css = open('styles.css', encoding='utf-8').read()
    # El visor de artefactos marca data-theme en <html>: duplicar los tokens oscuros para los tres estados.
    m = re.search(r"@media \(prefers-color-scheme: dark\) \{\n  :root \{\n(.*?)\n  \}\n\}", css, re.S)
    if m:
        dark = m.group(1)
        css = css.replace(m.group(0), "@media (prefers-color-scheme: dark) {\n  :root:not([data-theme=\"light\"]) {\n" + dark + "\n  }\n}\n:root[data-theme=\"dark\"] {\n" + dark.replace('\n    ', '\n  ') + "\n}")
    html = open('index.html', encoding='utf-8').read()
    body = html.split('<body>')[1].split('</body>')[0].replace('<script src="app.js"></script>', '')
    plan_txt = open('data/viaje.json', encoding='utf-8').read().strip()
    plan = json.loads(plan_txt)
    tracks = {str(d['dia']): json.load(open(d['gpx']['track'], encoding='utf-8')) for d in plan['itinerario'] if d.get('gpx')}
    js = open('app.js', encoding='utf-8').read()
    out = (f"<title>Viaje NX500</title>\n<style>\n{css}\n</style>\n{body}\n"
           f"<script>window.VIAJE_DATA = {plan_txt};\nwindow.VIAJE_TRACKS = {json.dumps(tracks, ensure_ascii=False, separators=(',', ':'))};</script>\n"
           f"<script>\n{js}\n</script>\n")
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    open(out_path, 'w', encoding='utf-8').write(out)
    print(f"{out_path}: {len(out) // 1024} KB, {len(tracks)} tracks")

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist', 'viaje-nx500.html'))
