from pathlib import Path

repo = Path('.')
old = '1.9.12'
new = '1.9.13'
old_url = 'https://cdn.jsdelivr.net/gh/ShapArt/tessa-matrix-studio@main/tessa-matrix-studio.user.js'
latest_url = 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.user.js'

# Production userscript metadata/runtime version.
p = repo / 'tessa-matrix-studio.user.js'
s = p.read_text(encoding='utf-8')
s = s.replace(f'// @version      {old}', f'// @version      {new}', 1)
s = s.replace(f"version: '{old}',", f"version: '{new}',", 1)
s = s.replace(f'// @updateURL    {old_url}', f'// @updateURL    {latest_url}', 1)
s = s.replace(f'// @downloadURL  {old_url}', f'// @downloadURL  {latest_url}', 1)
assert f'// @version      {new}' in s
assert f"version: '{new}'," in s
assert f'// @updateURL    {latest_url}' in s
assert f'// @downloadURL  {latest_url}' in s
p.write_text(s, encoding='utf-8')

# package.json
p = repo / 'package.json'
s = p.read_text(encoding='utf-8')
s = s.replace(f'"version": "{old}"', f'"version": "{new}"', 1)
p.write_text(s, encoding='utf-8')

# Smoke test version follows release while keeping the new update-path regression.
p = repo / 'tests/smoke.mjs'
s = p.read_text(encoding='utf-8').replace(f"// @version      {old}", f"// @version      {new}", 1)
p.write_text(s, encoding='utf-8')

# Documentation contract: require release-latest URL and forbid stale jsDelivr branch path.
p = repo / 'tests/docs.mjs'
s = p.read_text(encoding='utf-8')
anchor = "assert(downloadUrl === updateUrl, 'download/update URLs unexpectedly differ');\n"
addition = (
    "assert(downloadUrl === 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.user.js', "
    "'userscript delivery must track latest GitHub Release');\n"
    "assert(!readme.includes('cdn.jsdelivr.net/gh/ShapArt/tessa-matrix-studio@main/tessa-matrix-studio.user.js'), "
    "'README must not use stale jsDelivr @main install/update path');\n"
)
if addition not in s:
    s = s.replace(anchor, anchor + addition, 1)
p.write_text(s, encoding='utf-8')

# README: all install/import buttons now track the latest published GitHub Release.
p = repo / 'README.md'
s = p.read_text(encoding='utf-8')
s = s.replace(old_url, latest_url)
s = s.replace(f'version-{old}-', f'version-{new}-')
s = s.replace(f'**v{old} · Автор: Шаповалов Артём**', f'**v{new} · Автор: Шаповалов Артём**')
s = s.replace(f'версии **{old}**', f'версии **{new}**')
s = s.replace(f'- **Версия:** `{old}`', f'- **Версия:** `{new}`')
s = s.replace(f'Текущая версия: **{old}**', f'Текущая версия: **{new}**')
s = s.replace(
    '### Если корпоративная сеть блокирует jsDelivr\n\n1. Откройте [последний GitHub Release](https://github.com/ShapArt/tessa-matrix-studio/releases/latest).',
    '### Если GitHub Release скачался как файл, а Tampermonkey не открыл установку\n\n1. Откройте [последний GitHub Release](https://github.com/ShapArt/tessa-matrix-studio/releases/latest).'
)

auto_section = '''\n### Автоматические обновления через Tampermonkey\n\nНачиная с **v1.9.13**, Studio больше не использует кэшируемый `jsDelivr @main` для установки и обновлений. В `@updateURL` и `@downloadURL` указан стабильный адрес **последнего опубликованного GitHub Release**:\n\n```text\nhttps://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.user.js\n```\n\nКак это работает:\n\n1. Tampermonkey периодически проверяет `@updateURL` и сравнивает `@version`.\n2. Если опубликована более новая версия, Tampermonkey скачивает её по `@downloadURL`.\n3. В Tampermonkey 5.5+ проверка обновлений и их установка разделены, поэтому для полностью автоматического режима включите **Automatic installation** в настройках обновлений Tampermonkey.\n4. Проверить вручную можно через **Dashboard → Installed userscripts → TESSA Matrix Studio → Check for updates** (название пункта может немного отличаться по браузеру/локали).\n\n> [!IMPORTANT]\n> Если у вас уже установлена старая **1.9.3** с `jsDelivr @main`, один раз переустановите Studio кнопкой **УСТАНОВИТЬ** выше. После установки **1.9.13+** дальнейшие версии будут проверяться через GitHub Releases автоматически.\n'''
if '### Автоматические обновления через Tampermonkey' not in s:
    s = s.replace('\n## 3. Проверьте установку\n', auto_section + '\n## 3. Проверьте установку\n', 1)

# Update outdated troubleshooting wording about jsDelivr.
s = s.replace(
    'Основная ссылка README использует jsDelivr, а не GitHub Raw. Если корпоративная сеть блокирует jsDelivr, скачайте `.user.js` из **GitHub Releases** и добавьте его через **Dashboard → Add a new script**.',
    'Основная ссылка README ведёт на `releases/latest/download/...user.js`, то есть на последний опубликованный GitHub Release. Если браузер просто скачал файл, добавьте его через **Dashboard → Add a new script** или импорт URL в **Utilities**.'
)
p.write_text(s, encoding='utf-8')

# Bug template version.
p = repo / '.github/ISSUE_TEMPLATE/bug_report.yml'
s = p.read_text(encoding='utf-8').replace(f'placeholder: {old}', f'placeholder: {new}', 1)
p.write_text(s, encoding='utf-8')

# Changelog.
p = repo / 'CHANGELOG.md'
s = p.read_text(encoding='utf-8')
entry = f'''# Changelog\n\n## {new} — 2026-08-27\n\n- установка и автообновление Tampermonkey переведены с кэшируемого `jsDelivr @main` на `GitHub Releases /latest/download`;\n- `@updateURL` и `@downloadURL` теперь всегда ведут на последний опубликованный `.user.js`;\n- README-кнопка `УСТАНОВИТЬ` и ручной URL-импорт используют тот же актуальный release endpoint;\n- добавлена инструкция по `Automatic installation` в Tampermonkey 5.5+ и одноразовой переустановке старых 1.9.3;\n- regression запрещает возврат к stale `jsDelivr @main` в metadata и README.\n\n'''
if not s.startswith(f'# Changelog\n\n## {new}'):
    s = s.replace('# Changelog\n\n', entry, 1)
p.write_text(s, encoding='utf-8')
