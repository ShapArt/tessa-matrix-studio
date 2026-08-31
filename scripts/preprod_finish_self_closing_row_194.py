from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')
old = "      const body = rowMatch[2];"
new = "      const body = rowMatch[2] || '';"
if text.count(old) != 1:
    raise SystemExit(f'expected one row body marker, got {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
