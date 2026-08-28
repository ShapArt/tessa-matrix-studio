from pathlib import Path

path = Path('README.md')
text = path.read_text(encoding='utf-8')
start = '\n---\n# Боевой UAT перед раздачей пользователям\n'
end = '\n\n---\n\n# Для сопровождения\n'

if text.count(start) != 1:
    raise RuntimeError(f'expected exactly one UAT start marker, got {text.count(start)}')
if text.count(end) != 1:
    raise RuntimeError(f'expected exactly one following maintenance marker, got {text.count(end)}')

before, rest = text.split(start, 1)
_, after = rest.split(end, 1)
new_text = before.rstrip() + '\n\n---\n\n# Для сопровождения\n' + after

if '# Боевой UAT перед раздачей пользователям' in new_text:
    raise RuntimeError('UAT heading still present after patch')
if 'Стоп-критерии' in new_text:
    raise RuntimeError('UAT stop-criteria block still present after patch')

path.write_text(new_text, encoding='utf-8')
print('public README UAT block removed')
