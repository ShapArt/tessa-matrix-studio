from pathlib import Path

p = Path('tessa-matrix-studio.user.js')
text = p.read_text(encoding='utf-8')
text = text.replace('// @version      1.9.37', '// @version      1.9.38', 1)
text = text.replace("    version: '1.9.37',", "    version: '1.9.38',", 1)
if '// @version      1.9.38' not in text or "version: '1.9.38'" not in text:
    raise SystemExit('version markers were not updated')
p.write_text(text, encoding='utf-8')
print('userscript bumped to 1.9.38')
