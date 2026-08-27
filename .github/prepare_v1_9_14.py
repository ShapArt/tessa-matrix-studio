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

# Release workflow: generate metadata asset, checksum it, publish it, then verify public latest URLs.
p = repo / '.github/workflows/release.yml'
s = p.read_text(encoding='utf-8')
old_build = '''          VERSION="${{ steps.version.outputs.version }}"\n          mkdir -p dist\n          cp tessa-matrix-studio.user.js dist/tessa-matrix-studio.user.js\n          zip -r "dist/tessa-matrix-studio-v$VERSION.zip" \\\n            tessa-matrix-studio.user.js README.md CHANGELOG.md SECURITY.md\n          (\n            cd dist\n            sha256sum \\\n              tessa-matrix-studio.user.js \\\n              "tessa-matrix-studio-v$VERSION.zip" \\\n              > SHA256SUMS.txt\n          )\n'''
new_build = '''          VERSION="${{ steps.version.outputs.version }}"\n          mkdir -p dist\n          cp tessa-matrix-studio.user.js dist/tessa-matrix-studio.user.js\n          awk 'BEGIN { emit=0 } /^\\/\\/ ==UserScript==/ { emit=1 } emit { print } /^\\/\\/ ==\\/UserScript==/ { exit }' \\\n            tessa-matrix-studio.user.js > dist/tessa-matrix-studio.meta.js\n          test -s dist/tessa-matrix-studio.meta.js\n          grep -Fqx "// @version      $VERSION" dist/tessa-matrix-studio.meta.js\n          grep -Fqx "// @updateURL    https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.meta.js" dist/tessa-matrix-studio.meta.js\n          grep -Fqx "// @downloadURL  https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.user.js" dist/tessa-matrix-studio.meta.js\n          zip -r "dist/tessa-matrix-studio-v$VERSION.zip" \\\n            tessa-matrix-studio.user.js README.md CHANGELOG.md SECURITY.md\n          (\n            cd dist\n            sha256sum \\\n              tessa-matrix-studio.meta.js \\\n              tessa-matrix-studio.user.js \\\n              "tessa-matrix-studio-v$VERSION.zip" \\\n              > SHA256SUMS.txt\n          )\n'''
if old_build not in s:
    raise RuntimeError('release build anchor not found')
s = s.replace(old_build, new_build, 1)

s = s.replace(
    '''              dist/tessa-matrix-studio.user.js \\\n              "dist/tessa-matrix-studio-v$VERSION.zip" \\\n              dist/SHA256SUMS.txt \\\n              --clobber\n''',
    '''              dist/tessa-matrix-studio.meta.js \\\n              dist/tessa-matrix-studio.user.js \\\n              "dist/tessa-matrix-studio-v$VERSION.zip" \\\n              dist/SHA256SUMS.txt \\\n              --clobber\n''',
    1,
)
s = s.replace(
    '''              dist/tessa-matrix-studio.user.js \\\n              "dist/tessa-matrix-studio-v$VERSION.zip" \\\n              dist/SHA256SUMS.txt \\\n              --title "TESSA Matrix Studio v$VERSION" \\\n''',
    '''              dist/tessa-matrix-studio.meta.js \\\n              dist/tessa-matrix-studio.user.js \\\n              "dist/tessa-matrix-studio-v$VERSION.zip" \\\n              dist/SHA256SUMS.txt \\\n              --title "TESSA Matrix Studio v$VERSION" \\\n''',
    1,
)

verify_step = '''\n      - name: Verify public latest delivery\n        if: steps.changed.outputs.changed == 'true'\n        env:\n          EXPECTED_VERSION: ${{ steps.version.outputs.version }}\n        shell: bash\n        run: |\n          set -euo pipefail\n          PUBLIC_DIR="$(mktemp -d)"\n          BASE="https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download"\n          META_URL="$BASE/tessa-matrix-studio.meta.js"\n          USER_URL="$BASE/tessa-matrix-studio.user.js"\n          ZIP_URL="$BASE/tessa-matrix-studio-v$EXPECTED_VERSION.zip"\n          SUMS_URL="$BASE/SHA256SUMS.txt"\n\n          ok=false\n          for attempt in 1 2 3 4 5 6 7 8; do\n            rm -f "$PUBLIC_DIR"/*\n            if curl --fail --location --silent --show-error --retry 2 --retry-all-errors "$META_URL" -o "$PUBLIC_DIR/tessa-matrix-studio.meta.js" \\\n              && curl --fail --location --silent --show-error --retry 2 --retry-all-errors "$USER_URL" -o "$PUBLIC_DIR/tessa-matrix-studio.user.js" \\\n              && curl --fail --location --silent --show-error --retry 2 --retry-all-errors "$ZIP_URL" -o "$PUBLIC_DIR/tessa-matrix-studio-v$EXPECTED_VERSION.zip" \\\n              && curl --fail --location --silent --show-error --retry 2 --retry-all-errors "$SUMS_URL" -o "$PUBLIC_DIR/SHA256SUMS.txt"; then\n              META_VERSION="$(awk '/@version/{print $3; exit}' "$PUBLIC_DIR/tessa-matrix-studio.meta.js")"\n              USER_VERSION="$(awk '/@version/{print $3; exit}' "$PUBLIC_DIR/tessa-matrix-studio.user.js")"\n              if [[ "$META_VERSION" == "$EXPECTED_VERSION" && "$USER_VERSION" == "$EXPECTED_VERSION" ]]; then\n                ok=true\n                break\n              fi\n            fi\n            echo "Public latest is not v$EXPECTED_VERSION yet (attempt $attempt/8); retrying..."\n            sleep 3\n          done\n\n          [[ "$ok" == "true" ]] || { echo "Public latest delivery never converged to v$EXPECTED_VERSION"; exit 1; }\n          grep -Fqx "// @updateURL    $META_URL" "$PUBLIC_DIR/tessa-matrix-studio.meta.js"\n          grep -Fqx "// @downloadURL  $USER_URL" "$PUBLIC_DIR/tessa-matrix-studio.meta.js"\n          grep -Fqx "// @updateURL    $META_URL" "$PUBLIC_DIR/tessa-matrix-studio.user.js"\n          grep -Fqx "// @downloadURL  $USER_URL" "$PUBLIC_DIR/tessa-matrix-studio.user.js"\n          (\n            cd "$PUBLIC_DIR"\n            sha256sum --check SHA256SUMS.txt\n          )\n'''
if '      - name: Verify public latest delivery\n' in s:
    raise RuntimeError('public delivery verification already exists unexpectedly')
s = s.rstrip() + verify_step + '\n'
p.write_text(s, encoding='utf-8')

# Changelog.
p = repo / 'CHANGELOG.md'
s = p.read_text(encoding='utf-8')
entry = f'''# Changelog\n\n## {new} — 2026-08-27\n\n- `@updateURL` переведён на отдельный лёгкий `tessa-matrix-studio.meta.js`, а `@downloadURL` оставлен на полном userscript;\n- release workflow автоматически собирает metadata-файл из фактического userscript header, исключая рассинхрон версий;\n- metadata-файл включён в `SHA256SUMS.txt`, release assets и GitHub/Sigstore provenance;\n- после публикации CI анонимно скачивает публичные `releases/latest/download` assets, проверяет `@version`, update/download URL и SHA-256;\n- релиз считается успешным только после подтверждения, что наружу реально отдаётся актуальная версия.\n\n'''
if not s.startswith(f'# Changelog\n\n## {new}'):
    s = s.replace('# Changelog\n\n', entry, 1)
p.write_text(s, encoding='utf-8')

# Final sanity checks before the helper workflow runs npm test.
script = (repo / 'tessa-matrix-studio.user.js').read_text(encoding='utf-8')
assert f'// @version      {new}' in script
assert f'// @updateURL    {meta_url}' in script
assert f'// @downloadURL  {user_url}' in script
assert f"version: '{new}'," in script
