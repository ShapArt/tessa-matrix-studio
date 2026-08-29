from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')
text = text.replace('// @version      1.9.27', '// @version      1.9.28', 1)
text = text.replace("    version: '1.9.27',", "    version: '1.9.28',", 1)
path.write_text(text, encoding='utf-8')
print('v1.9.28 source version synchronized')
