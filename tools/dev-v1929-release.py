from pathlib import Path

# userscript version
p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')
s = s.replace('// @version      1.9.28', '// @version      1.9.29', 1)
s = s.replace("    version: '1.9.28',", "    version: '1.9.29',", 1)
p.write_text(s, encoding='utf-8')

# package
p = Path('package.json')
s = p.read_text(encoding='utf-8').replace('"version": "1.9.28"', '"version": "1.9.29"', 1)
p.write_text(s, encoding='utf-8')

# README
p = Path('README.md')
s = p.read_text(encoding='utf-8')
s = s.replace('version-1.9.28-EF233C', 'version-1.9.29-EF233C', 1)
s = s.replace('**v1.9.28 · Автор: Шаповалов Артём**', '**v1.9.29 · Автор: Шаповалов Артём**', 1)
s = s.replace('Подтвердите установку версии **1.9.28**', 'Подтвердите установку версии **1.9.29**', 1)
s = s.replace('- **Версия:** `1.9.28`', '- **Версия:** `1.9.29`', 1)
s = s.replace('Текущая версия: **1.9.28**', 'Текущая версия: **1.9.29**', 1)
needle = '> Начиная с **v1.9.28**, DELETE recheck больше не перечитывает всю матрицу перед каждой удаляемой строкой. Studio делает один targeted `CardGet` конкретной row-card, подтверждает наличие исходной `MatrixVersionID` и тем же decoder вычисляет raw fingerprint. Это сохраняет fail-closed поведение v1.9.27, но убирает рост запросов порядка `N × DELETE`; микроокно между targeted CardGet и кастомным `DeleteRow` остаётся клиентским, так как серверного аналога `AffectVersion` для этого request не используется.\n'
addition = needle + '\n> [!NOTE]\n> Начиная с **v1.9.29**, XLSX-reader корректно разбирает namespace-prefixed `sharedStrings.xml` (`<x:si>/<x:t>`) и rich-text runs. Для ячеек `t="s"` индекс общей строки теперь обязан быть целым неотрицательным и существовать в таблице; повреждённая ссылка fail-closed отклоняет Excel вместо тихой подмены значения на пустую строку.\n'
if needle not in s:
    raise SystemExit('README v1.9.28 note anchor not found')
s = s.replace(needle, addition, 1)
p.write_text(s, encoding='utf-8')

# issue template
p = Path('.github/ISSUE_TEMPLATE/bug_report.yml')
s = p.read_text(encoding='utf-8').replace('placeholder: 1.9.28', 'placeholder: 1.9.29', 1)
p.write_text(s, encoding='utf-8')

# changelog
p = Path('CHANGELOG.md')
s = p.read_text(encoding='utf-8')
entry = '''# Changelog\n\n## 1.9.29 — 2026-08-29\n\n- `sharedStrings.xml` теперь разбирается одинаково для обычных и namespace-prefixed SpreadsheetML-элементов (`<si>/<t>` и `<x:si>/<x:t>`);\n- rich-text shared strings корректно собираются из нескольких `<t>`-runs в порядке документа;\n- для ячеек `t="s"` индекс общей строки валидируется fail-closed: отрицательные, дробные, нечисловые и выходящие за таблицу ссылки отклоняют XLSX с явной диагностикой вместо тихого значения `''`;\n- валидная shared-string с пустым текстом остаётся допустимой; inline strings, обычные `str`, числа, даты и формулы не менялись;\n- добавлен TDD regression на namespaced sharedStrings, rich-text concatenation и invalid/out-of-range indexes.\n\n'''
if not s.startswith('# Changelog\n\n'):
    raise SystemExit('unexpected CHANGELOG header')
s = entry + s[len('# Changelog\n\n'):]
p.write_text(s, encoding='utf-8')

print('v1.9.29 release metadata synchronized')
