from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

old = "      if (!links.length && sectionCount === 0) {\n"
new = "      if (!links.length && sectionCount === 0 && native.controlName) {\n"
if old not in text:
    raise SystemExit('empty snapshot evidence marker not found')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
print('v1.9.40 empty snapshot native-control evidence fix applied')
