from pathlib import Path

OLD = '1.9.29'
NEW = '1.9.30'

def replace_once_or_current(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'{label}: expected old value not found')
    return text.replace(old, new, 1)

# userscript metadata/runtime version
p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')
s = replace_once_or_current(s, '// @version      1.9.29', '// @version      1.9.30', 'userscript metadata')
s = replace_once_or_current(s, "    version: '1.9.29',", "    version: '1.9.30',", 'APP.version')
p.write_text(s, encoding='utf-8')

# package
p = Path('package.json')
s = p.read_text(encoding='utf-8')
s = replace_once_or_current(s, '"version": "1.9.29"', '"version": "1.9.30"', 'package version')
p.write_text(s, encoding='utf-8')

# README
p = Path('README.md')
s = p.read_text(encoding='utf-8')
for old, new, label in [
    ('version-1.9.29-EF233C', 'version-1.9.30-EF233C', 'README badge'),
    ('**v1.9.29 · Автор: Шаповалов Артём**', '**v1.9.30 · Автор: Шаповалов Артём**', 'README title version'),
    ('Подтвердите установку версии **1.9.29**', 'Подтвердите установку версии **1.9.30**', 'README quick-start version'),
    ('- **Версия:** `1.9.29`', '- **Версия:** `1.9.30`', 'README install version'),
    ('Текущая версия: **1.9.29**', 'Текущая версия: **1.9.30**', 'README support version'),
]:
    s = replace_once_or_current(s, old, new, label)
note = '> Начиная с **v1.9.30**, совместимость XLSX закреплена отдельными regression-наборами: legacy roundtrip V1–V5 читается без V6-only implicit DELETE, а актуализация формирует текущий V6 с baseline-ledger. OOXML Relationship Target теперь нормализуется относительно `xl/workbook.xml`, включая безопасные `.`/`..` URI-сегменты; внешние/выходящие за корень ссылки не угадываются. Export → import → plan дополнительно проверяется на 500, 1000 и 5000 строках.\n'
if note not in s:
    anchor = '> Начиная с **v1.9.29**, XLSX-reader корректно разбирает namespace-prefixed `sharedStrings.xml` (`<x:si>/<x:t>`) и rich-text runs. Для ячеек `t="s"` индекс общей строки теперь обязан быть целым неотрицательным и существовать в таблице; повреждённая ссылка fail-closed отклоняет Excel вместо тихой подмены значения на пустую строку.\n'
    if anchor not in s:
        raise SystemExit('README v1.9.29 note anchor not found')
    s = s.replace(anchor, anchor + '\n> [!NOTE]\n' + note, 1)
p.write_text(s, encoding='utf-8')

# bug report placeholder
p = Path('.github/ISSUE_TEMPLATE/bug_report.yml')
s = p.read_text(encoding='utf-8')
s = replace_once_or_current(s, 'placeholder: 1.9.29', 'placeholder: 1.9.30', 'issue version')
p.write_text(s, encoding='utf-8')

# changelog
p = Path('CHANGELOG.md')
s = p.read_text(encoding='utf-8')
entry = '''## 1.9.30 — 2026-08-29\n\n- OOXML Relationship Target для листов теперь разрешается относительно `xl/workbook.xml` с нормализацией безопасных `.`/`..` URI-сегментов вместо буквального поиска пути внутри ZIP;\n- внешние URI и Relationship, выходящие выше корня XLSX-пакета, fail-closed отклоняются вместо попытки угадать локальную часть;\n- добавлен regression-pack V1–V5: старые roundtrip-форматы продолжают читаться и строить чистый Preview, но физически отсутствующая строка не превращается в V6-only implicit DELETE без baseline-ledger;\n- актуализация legacy workbook сохраняет текущие строки TESSA и последующий export формирует V6 с полным baseline-ledger;\n- добавлен нагрузочный export → import → plan regression на 500 / 1000 / 5000 строк; untouched книги обязаны давать только NOOP и оставаться в действующих XLSX/SpreadsheetML лимитах.\n\n'''
if '## 1.9.30 — 2026-08-29' not in s:
    if not s.startswith('# Changelog\n\n'):
        raise SystemExit('unexpected CHANGELOG header')
    s = '# Changelog\n\n' + entry + s[len('# Changelog\n\n'):]
p.write_text(s, encoding='utf-8')

print('v1.9.30 release metadata synchronized')
