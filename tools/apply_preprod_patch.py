from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')
replacements = [
    ('// @version      1.9.31', '// @version      1.9.32'),
    ("    version: '1.9.31',", "    version: '1.9.32',"),
]
for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one version marker {old!r}, found {count}')
    text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
print('Bumped userscript to 1.9.32')
