from pathlib import Path

# userscript version
p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')
s = s.replace('// @version      1.9.25', '// @version      1.9.26', 1)
s = s.replace("version: '1.9.25'", "version: '1.9.26'", 1)
p.write_text(s, encoding='utf-8')

# package version
p = Path('package.json')
s = p.read_text(encoding='utf-8')
s = s.replace('"version": "1.9.25"', '"version": "1.9.26"', 1)
p.write_text(s, encoding='utf-8')

# README current-version references only
p = Path('README.md')
s = p.read_text(encoding='utf-8')
repls = [
  ('version-1.9.25-EF233C', 'version-1.9.26-EF233C'),
  ('**v1.9.25 · Автор: Шаповалов Артём**', '**v1.9.26 · Автор: Шаповалов Артём**'),
  ('Подтвердите установку версии **1.9.25**', 'Подтвердите установку версии **1.9.26**'),
  ('- **Версия:** `1.9.25`', '- **Версия:** `1.9.26`'),
  ('Текущая версия: **1.9.25**', 'Текущая версия: **1.9.26**'),
]
for old, new in repls:
    if old not in s: raise SystemExit(f'README anchor not found: {old}')
    s = s.replace(old, new, 1)
marker = '> [!TIP]\n> Перед первой правкой сохраните исходную выгрузку отдельно.'
insert = '> [!IMPORTANT]\n> Начиная с **v1.9.26**, Studio fail-closed блокирует Excel-формулы в редактируемых ячейках матрицы и не доверяет cached `<v>`. Также строковые критерии, которые Excel сохранил как числовые ячейки, переводятся в **ПРОПУСТИТЬ**: это защищает от потери ведущих нулей, scientific notation, процентов и дробей. Настоящие Int/Decimal в General/Text и Date/DateTime serial values остаются допустимыми.\n\n'
if marker not in s: raise SystemExit('README safety marker not found')
s = s.replace(marker, insert + marker, 1)
p.write_text(s, encoding='utf-8')

# changelog prepend
p = Path('CHANGELOG.md')
s = p.read_text(encoding='utf-8')
section = '''# Changelog\n\n## 1.9.26 — 2026-08-29\n\n- XLSX-reader сохраняет наличие и текст Excel-формулы в metadata рабочей ячейки; формулы в редактируемых критериях fail-closed переводят строку в ПРОПУСТИТЬ, cached `<v>` не применяется как обычное значение;\n- строковый критерий, который Excel сериализовал как numeric cell, блокируется как потенциально преобразованный: исходное отображение могло потерять ведущие нули или измениться через scientific notation, проценты/дроби;\n- number-format classifier различает built-in/custom `percent`, `scientific` и `fraction` наряду с `date`, `text` и `general`;\n- настоящие Int/Decimal в General/Text и Date/DateTime Excel serial продолжают работать без новых ограничений;\n- добавлен TDD regression pack для formula cached values и типовых Excel coercion-сценариев.\n\n'''
if not s.startswith('# Changelog\n\n'): raise SystemExit('CHANGELOG header mismatch')
s = section + s[len('# Changelog\n\n'):]
p.write_text(s, encoding='utf-8')

# bug report version + scenario
p = Path('.github/ISSUE_TEMPLATE/bug_report.yml')
s = p.read_text(encoding='utf-8')
s = s.replace('placeholder: 1.9.25', 'placeholder: 1.9.26', 1)
anchor = '        - Выбрать Excel — Excel автоматически преобразовал значение в дату\n'
if anchor not in s: raise SystemExit('issue template anchor not found')
s = s.replace(anchor, anchor + '        - Выбрать Excel — Excel-формула / числовое автопреобразование\n', 1)
p.write_text(s, encoding='utf-8')
