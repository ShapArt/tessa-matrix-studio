from pathlib import Path

OLD = '1.9.30'
NEW = '1.9.31'

def replace_once_or_current(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f'{label}: expected old value not found')
    return text.replace(old, new, 1)

p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')
s = replace_once_or_current(s, '// @version      1.9.30', '// @version      1.9.31', 'userscript metadata')
s = replace_once_or_current(s, "    version: '1.9.30',", "    version: '1.9.31',", 'APP.version')
p.write_text(s, encoding='utf-8')

p = Path('package.json')
s = p.read_text(encoding='utf-8')
s = replace_once_or_current(s, '"version": "1.9.30"', '"version": "1.9.31"', 'package version')
p.write_text(s, encoding='utf-8')

p = Path('README.md')
s = p.read_text(encoding='utf-8')
for old, new, label in [
    ('version-1.9.30-EF233C', 'version-1.9.31-EF233C', 'README badge'),
    ('**v1.9.30 · Автор: Шаповалов Артём**', '**v1.9.31 · Автор: Шаповалов Артём**', 'README title'),
    ('Подтвердите установку версии **1.9.30**', 'Подтвердите установку версии **1.9.31**', 'README quickstart'),
    ('- **Версия:** `1.9.30`', '- **Версия:** `1.9.31`', 'README install'),
    ('Текущая версия: **1.9.30**', 'Текущая версия: **1.9.31**', 'README support'),
]:
    s = replace_once_or_current(s, old, new, label)
note = '> Начиная с **v1.9.31**, повторяющиеся fragment/not-found проверки во встроенных справочниках кэшируются в ограниченном per-catalog cache, поэтому одинаковая ошибка в сотнях строк Excel не пересканирует большой справочник для каждой строки. Индекс exact ID больше не дублирует одну запись при пустом `RoleTypeID`. Regression покрывает 25 000+ записей с export → import → plan и неоднозначными display names. XLSX-reader также учитывает OPC `TargetMode`: `External` fail-closed отклоняется даже при локально выглядящем `Target`, а безопасные internal/root-relative/dot-segment пути продолжают поддерживаться.\n'
if note not in s:
    anchor = '> Начиная с **v1.9.30**, совместимость XLSX закреплена отдельными regression-наборами: legacy roundtrip V1–V5 читается без V6-only implicit DELETE, а актуализация формирует текущий V6 с baseline-ledger. OOXML Relationship Target теперь нормализуется относительно `xl/workbook.xml`, включая безопасные `.`/`..` URI-сегменты; внешние/выходящие за корень ссылки не угадываются. Export → import → plan дополнительно проверяется на 500, 1000 и 5000 строках.\n'
    if anchor not in s:
        raise SystemExit('README v1.9.30 note anchor not found')
    s = s.replace(anchor, anchor + '\n> [!NOTE]\n' + note, 1)
p.write_text(s, encoding='utf-8')

p = Path('.github/ISSUE_TEMPLATE/bug_report.yml')
s = p.read_text(encoding='utf-8')
s = replace_once_or_current(s, 'placeholder: 1.9.30', 'placeholder: 1.9.31', 'issue version')
p.write_text(s, encoding='utf-8')

p = Path('CHANGELOG.md')
s = p.read_text(encoding='utf-8')
entry = '''## 1.9.31 — 2026-08-29\n\n- повторные fragment/not-found разрешения одного значения во встроенном справочнике теперь используют bounded per-catalog cache (до 2048 результатов) вместо повторного линейного сканирования большого `searchRows`;\n- exact ID index больше не добавляет одну и ту же запись дважды в fallback-ключ `id|`, когда `RoleTypeID` пуст;\n- добавлен high-cardinality regression: 25 000+ записей справочника, 10 000 exact ID lookup, неоднозначные display names и полный export → import → plan без ложных изменений;\n- OPC worksheet relationships теперь учитывают `TargetMode`: `External` fail-closed отклоняется до разрешения ZIP-part даже при локально выглядящем `Target`;\n- regression покрывает internal/root-relative/dot-segment/backslash targets и отклонение root-escape, URL/file/network-path и explicit External relationship.\n\n'''
if '## 1.9.31 — 2026-08-29' not in s:
    if not s.startswith('# Changelog\n\n'):
        raise SystemExit('unexpected CHANGELOG header')
    s = '# Changelog\n\n' + entry + s[len('# Changelog\n\n'):]
p.write_text(s, encoding='utf-8')

print('v1.9.31 release metadata synchronized')
