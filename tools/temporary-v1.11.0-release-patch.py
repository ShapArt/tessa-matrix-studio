from pathlib import Path

OLD = '1.10.3'
NEW = '1.11.0'
DATE = '2026-09-05'


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, before, after, label):
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, got {count}')
    return text.replace(before, after, 1)


# Userscript metadata/runtime version only. No runtime logic changes in this release PR.
path = 'tessa-matrix-studio.user.js'
text = read(path)
text = replace_once(text, '// @version      1.10.3', '// @version      1.11.0', 'userscript @version')
text = replace_once(text, "    version: '1.10.3',", "    version: '1.11.0',", 'APP.version')
write(path, text)

# npm metadata.
path = 'package.json'
text = read(path)
text = replace_once(text, '"version": "1.10.3"', '"version": "1.11.0"', 'package version')
write(path, text)

path = 'package-lock.json'
text = read(path)
if text.count('"version": "1.10.3"') != 2:
    raise RuntimeError(f'package-lock version: expected 2 matches, got {text.count(chr(34) + "version" + chr(34) + ": " + chr(34) + OLD + chr(34))}')
text = text.replace('"version": "1.10.3"', '"version": "1.11.0"', 2)
write(path, text)

# Public README version references only.
path = 'README.md'
text = read(path)
replacements = [
    ('version-1.10.3-EF233C', 'version-1.11.0-EF233C', 'README badge'),
    ('**v1.10.3 · Автор: Шаповалов Артём**', '**v1.11.0 · Автор: Шаповалов Артём**', 'README title version'),
    ('Подтвердите установку версии **1.10.3**', 'Подтвердите установку версии **1.11.0**', 'README install version'),
    ('Текущая версия: **1.10.3**', 'Текущая версия: **1.11.0**', 'README current version'),
]
for before, after, label in replacements:
    text = replace_once(text, before, after, label)
write(path, text)

# Bug report default.
path = '.github/ISSUE_TEMPLATE/bug_report.yml'
text = read(path)
text = replace_once(text, '      placeholder: 1.10.3', '      placeholder: 1.11.0', 'bug report placeholder')
write(path, text)

# Keep the new support-report regression valid across future version bumps.
path = 'tests/preview-support-ux.mjs'
text = read(path)
text = replace_once(
    text,
    "assert.equal(support.studioVersion, '1.10.3');",
    "const declaredStudioVersion = code.match(/\\/\\/ @version\\s+([^\\s]+)/)?.[1];\nassert.equal(support.studioVersion, declaredStudioVersion, 'support report must use the declared userscript version');",
    'release-agnostic Preview support version assertion',
)
write(path, text)

# Changelog entry. Keep explicit statement that interval server blocker is not fixed.
path = 'CHANGELOG.md'
text = read(path)
anchor = '# Changelog\n\n'
if not text.startswith(anchor):
    raise RuntimeError('CHANGELOG header changed')
entry = f'''## {NEW} — {DATE}\n\n- В Preview добавлен отдельный фильтр «Ошибки»: он показывает пропущенные строки со стабильным кодом ошибки, а «Пропустить» по-прежнему показывает весь набор отклонённых строк. Поиск по номеру Excel-строки, полю и видимому значению остаётся presentation-only и не меняет состав Apply.\n- Для значений функций/ролей Preview показывает тип роли: стандартные TESSA RoleType 0–7 выводятся понятными подписями, а неизвестные и корпоративные типы отображаются как `RoleTypeID: N` без догадок.\n- Добавлена ручная кнопка «Отчёт для поддержки». JSON `TESSA_MATRIX_SUPPORT_REPORT_V1` содержит только версию Studio, счётчики, стабильные reason codes, источники пропусков, встреченные RoleTypeID и доступность Apply; ФИО, бизнес-значения, row/role IDs и сырые серверные сообщения по умолчанию не включаются. MatrixID/TemplateID доступны только через явную опцию builder-а, UI-экспорт остаётся privacy-safe.\n- Фильтры «Пропустить» и «Ошибки» нельзя использовать для bulk «Выбрать N»: отклонённые строки не могут случайно превратиться в пакет Apply через fallback на «Все».\n- Apply, Store, Delete и серверный ValidateDuplicate этим релизом не менялись. Известная ошибка `LeftOperandExtractor is null` для нового interval/CardNew duplicate-check не объявляется исправленной и остаётся fail-closed.\n\n'''
text = anchor + entry + text[len(anchor):]
write(path, text)

# Self-clean temporary release machinery before the commit.
for temp in [
    Path('.github/workflows/temporary-v1.11.0-release-patch.yml'),
    Path('tools/temporary-v1.11.0-release-patch.py'),
]:
    if temp.exists():
        temp.unlink()

print('Prepared v1.11.0 release metadata, release-agnostic test, and removed temporary patch files')
