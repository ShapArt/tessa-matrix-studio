from pathlib import Path

repo = Path('.')
old = '1.9.13'
new = '1.9.14'
user_url = 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.user.js'
meta_url = 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.meta.js'


def replace_once(text: str, old_text: str, new_text: str, label: str) -> str:
    if old_text not in text:
        raise RuntimeError(f'missing anchor for {label}: {old_text!r}')
    return text.replace(old_text, new_text, 1)


# Production userscript: metadata-only update feed, full script download feed.
p = repo / 'tessa-matrix-studio.user.js'
s = p.read_text(encoding='utf-8')
s = replace_once(s, f'// @version      {old}', f'// @version      {new}', 'userscript version')
s = replace_once(s, f'// @updateURL    {user_url}', f'// @updateURL    {meta_url}', 'userscript updateURL')
s = replace_once(s, f"version: '{old}',", f"version: '{new}',", 'runtime version')
assert f'// @downloadURL  {user_url}' in s
assert f'// @updateURL    {meta_url}' in s
p.write_text(s, encoding='utf-8')

# package.json
p = repo / 'package.json'
s = p.read_text(encoding='utf-8')
s = replace_once(s, f'"version": "{old}"', f'"version": "{new}"', 'package version')
p.write_text(s, encoding='utf-8')

# Bug template version.
p = repo / '.github/ISSUE_TEMPLATE/bug_report.yml'
s = p.read_text(encoding='utf-8')
s = replace_once(s, f'placeholder: {old}', f'placeholder: {new}', 'bug template version')
p.write_text(s, encoding='utf-8')

# Documentation contract now requires distinct update/download endpoints.
p = repo / 'tests/docs.mjs'
s = p.read_text(encoding='utf-8')
s = replace_once(
    s,
    "assert(downloadUrl === updateUrl, 'download/update URLs unexpectedly differ');\n",
    "assert(updateUrl !== downloadUrl, 'metadata update URL must stay separate from full userscript download URL');\n",
    'docs distinct URLs',
)
s = replace_once(
    s,
    "assert(downloadUrl === 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.user.js', 'userscript delivery must track latest GitHub Release');\n",
    "assert(downloadUrl === 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.user.js', 'userscript download must track latest GitHub Release');\n"
    "assert(updateUrl === 'https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.meta.js', 'userscript update check must use latest metadata asset');\n"
    "assert(readme.includes(updateUrl), 'README does not document metadata update URL');\n",
    'docs endpoint contract',
)
p.write_text(s, encoding='utf-8')

# README version sync and update-delivery explanation.
p = repo / 'README.md'
s = p.read_text(encoding='utf-8')
s = s.replace(f'version-{old}-', f'version-{new}-')
s = s.replace(f'**v{old} · Автор: Шаповалов Артём**', f'**v{new} · Автор: Шаповалов Артём**')
s = s.replace(f'версии **{old}**', f'версии **{new}**')
s = s.replace(f'- **Версия:** `{old}`', f'- **Версия:** `{new}`')
s = s.replace(f'Текущая версия: **{old}**', f'Текущая версия: **{new}**')
old_auto = f'''### Автоматические обновления через Tampermonkey\n\nНачиная с **v{old}**, Studio больше не использует кэшируемый `jsDelivr @main` для установки и обновлений. В `@updateURL` и `@downloadURL` указан стабильный адрес **последнего опубликованного GitHub Release**:\n\n```text\n{user_url}\n```\n\nКак это работает:\n\n1. Tampermonkey периодически проверяет `@updateURL` и сравнивает `@version`.\n2. Если опубликована более новая версия, Tampermonkey скачивает её по `@downloadURL`.\n3. В Tampermonkey 5.5+ проверка обновлений и их установка разделены, поэтому для полностью автоматического режима включите **Automatic installation** в настройках обновлений Tampermonkey.\n4. Проверить вручную можно через **Dashboard → Installed userscripts → TESSA Matrix Studio → Check for updates** (название пункта может немного отличаться по браузеру/локали).\n\n> [!IMPORTANT]\n> Если у вас уже установлена старая **1.9.3** с `jsDelivr @main`, один раз переустановите Studio кнопкой **УСТАНОВИТЬ** выше. После установки **{old}+** дальнейшие версии будут проверяться через GitHub Releases автоматически.\n'''
new_auto = f'''### Автоматические обновления через Tampermonkey\n\nНачиная с **v{new}**, проверка обновлений и загрузка полного скрипта разделены:\n\n- `@updateURL` указывает на маленький metadata-файл последнего релиза:\n\n```text\n{meta_url}\n```\n\n- `@downloadURL` указывает на полный userscript:\n\n```text\n{user_url}\n```\n\nКак это работает:\n\n1. Tampermonkey периодически получает маленький `tessa-matrix-studio.meta.js` и сравнивает `@version`, не скачивая весь Studio для одной проверки версии.\n2. Только если версия новее, полный `tessa-matrix-studio.user.js` загружается по `@downloadURL`.\n3. Оба адреса используют GitHub `releases/latest/download`, поэтому ведут на последний опубликованный релиз, а release-CI после публикации отдельно проверяет публичные `latest`-ссылки и SHA-256.\n4. В Tampermonkey 5.5+ проверка обновлений и их установка разделены, поэтому для полностью автоматического режима включите **Automatic installation** в настройках обновлений Tampermonkey.\n5. Проверить вручную можно через **Dashboard → Installed userscripts → TESSA Matrix Studio → Check for updates** (название пункта может немного отличаться по браузеру/локали).\n\n> [!IMPORTANT]\n> Если у вас уже установлена старая **1.9.3** с `jsDelivr @main`, один раз переустановите Studio кнопкой **УСТАНОВИТЬ** выше. После установки **{new}+** дальнейшие версии будут проверяться через metadata-файл GitHub Releases автоматически.\n'''
if old_auto not in s:
    raise RuntimeError('README auto-update section anchor not found')
s = s.replace(old_auto, new_auto, 1)
p.write_text(s, encoding='utf-8')

# Changelog.
p = repo / 'CHANGELOG.md'
s = p.read_text(encoding='utf-8')
entry = f'''# Changelog\n\n## {new} — 2026-08-27\n\n- `@updateURL` переведён на отдельный лёгкий `tessa-matrix-studio.meta.js`, а `@downloadURL` оставлен на полном userscript;\n- release workflow автоматически собирает metadata-файл из фактического userscript header, исключая рассинхрон версий;\n- metadata-файл включён в `SHA256SUMS.txt`, release assets и GitHub/Sigstore provenance;\n- после публикации CI анонимно скачивает публичные `releases/latest/download` assets, проверяет `@version`, update/download URL и SHA-256;\n- релиз считается успешным только после подтверждения, что наружу реально отдаётся актуальная версия.\n\n'''
if not s.startswith(f'# Changelog\n\n## {new}'):
    s = s.replace('# Changelog\n\n', entry, 1)
p.write_text(s, encoding='utf-8')

# Final sanity checks.
script = (repo / 'tessa-matrix-studio.user.js').read_text(encoding='utf-8')
assert f'// @version      {new}' in script
assert f'// @updateURL    {meta_url}' in script
assert f'// @downloadURL  {user_url}' in script
assert f"version: '{new}'," in script
