import urllib.parse, re

def uri(svg):
    svg = re.sub(r'\s+', ' ', svg.strip())
    return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe="/:=' ,;()-.") + '")'

ASSETS = {
 '__PETAL__': """<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M12 1C5 8 3 15 12 23c9-8 7-15 0-22z' fill='#e9a8b5'/><path d='M12 5v14' stroke='#d98aa0' stroke-width='.8' fill='none'/></svg>""",
 '__LEAF__': """<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M3 21C3 10 10 3 21 3c0 11-7 18-18 18z' fill='#6b8e63'/><path d='M3 21L15 9' stroke='#e9f1e6' stroke-width='1.2' fill='none'/></svg>""",
 '__LEAF_WHITE__': """<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M3 21C3 10 10 3 21 3c0 11-7 18-18 18z' fill='#ffffff'/><path d='M3 21L15 9' stroke='#c16e41' stroke-width='1.4' fill='none'/></svg>""",
 '__BGTILE__': """<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260' viewBox='0 0 260 260' fill='none' stroke='#3a5335' stroke-opacity='.07' stroke-width='1.4' stroke-linecap='round'><g transform='translate(34 40) rotate(-28)'><path d='M0 36C0 14 14 0 36 0c0 22-14 36-36 36z'/><path d='M0 36L26 10'/></g><g transform='translate(170 30) rotate(35)'><path d='M0 30C0 12 12 0 30 0c0 18-12 30-30 30z'/><path d='M0 30L22 8'/></g><g transform='translate(120 120)'><circle r='4'/><ellipse cx='0' cy='-11' rx='4' ry='7'/><ellipse cx='0' cy='11' rx='4' ry='7'/><ellipse cx='-11' cy='0' rx='7' ry='4'/><ellipse cx='11' cy='0' rx='7' ry='4'/></g><g transform='translate(40 170) rotate(15)'><path d='M0 40C0 16 16 0 40 0c0 24-16 40-40 40z'/><path d='M0 40L30 10'/><path d='M12 28l10 2M18 20l10 2'/></g><g transform='translate(205 190) rotate(-50)'><path d='M0 28C0 11 11 0 28 0c0 17-11 28-28 28z'/><path d='M0 28L20 8'/></g><circle cx='230' cy='110' r='3'/><circle cx='80' cy='95' r='2.5'/><circle cx='20' cy='240' r='3'/></svg>""",
 '__MONSTERA__': """<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200' fill='none' stroke='#ffffff' stroke-opacity='.10' stroke-width='2' stroke-linecap='round'><path d='M100 190C40 170 10 120 30 60 50 20 110 10 150 40c35 30 30 100-10 130-12 9-26 15-40 20z'/><path d='M100 190V40M100 150L55 120M100 150l45-30M100 110L60 82M100 110l40-28M100 72L74 52M100 72l26-20'/></svg>""",
 '__DROP__': """<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M12 2C7 9 5 12.5 5 15.5a7 7 0 0014 0C19 12.5 17 9 12 2z' fill='#5aa7c7'/><path d='M9 16a3 3 0 003 3' stroke='#ffffff' stroke-opacity='.7' stroke-width='1.6' fill='none' stroke-linecap='round'/></svg>""",
}

css = open('style.src.css', encoding='utf-8').read()
for k, v in ASSETS.items():
    css = css.replace(f'url({k})', uri(v))
left = re.findall(r'url\(__[A-Z_]+__\)', css)
assert not left, left
open('style.css', 'w', encoding='utf-8').write(css)
print('style.css gerado:', len(css), 'bytes')
