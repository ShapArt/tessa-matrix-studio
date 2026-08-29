from pathlib import Path

source = Path('tessa-matrix-studio.user.js')
text = source.read_text(encoding='utf-8')
text = text.replace('// @version      1.9.27', '// @version      1.9.28', 1)
text = text.replace("    version: '1.9.27',", "    version: '1.9.28',", 1)
source.write_text(text, encoding='utf-8')

package = Path('package.json')
p = package.read_text(encoding='utf-8').replace('"version": "1.9.27"', '"version": "1.9.28"', 1)
package.write_text(p, encoding='utf-8')

readme = Path('README.md')
r = readme.read_text(encoding='utf-8')
r = r.replace('version-1.9.27-EF233C', 'version-1.9.28-EF233C', 1)
r = r.replace('**v1.9.27 · Автор: Шаповалов Артём**', '**v1.9.28 · Автор: Шаповалов Артём**', 1)
r = r.replace('Подтвердите установку версии **1.9.27**', 'Подтвердите установку версии **1.9.28**', 1)
r = r.replace('- **Версия:** `1.9.26`', '- **Версия:** `1.9.28`', 1)
needle = '> Начиная с **v1.9.27**, Apply дополнительно защищён от изменений, произошедших уже после успешного preflight. UPDATE/ADD сохраняются через TESSA `CardStoreRequest` с `AffectVersion = true`, поэтому сервер проверяет версию карточки непосредственно во время Store; для ADD duplicate-проверка повторяется прямо перед Store. Перед кастомным DELETE Studio повторно читает целевую строку и строго сверяет её MatrixRowID, MatrixVersionID и raw fingerprint. Конфликтующая операция переводится в **ПРОПУСТИТЬ** без auto-merge; независимые безопасные строки могут продолжить применение. Для кастомного DELETE это строгая клиентская recheck-защита, а не серверный version-lock.\n'
addition = needle + '\n> [!NOTE]\n> Начиная с **v1.9.28**, DELETE recheck больше не перечитывает всю матрицу перед каждой удаляемой строкой. Studio делает один targeted `CardGet` конкретной row-card, подтверждает наличие исходной `MatrixVersionID` и тем же decoder вычисляет raw fingerprint. Это сохраняет fail-closed поведение v1.9.27, но убирает рост запросов порядка `N × DELETE`; микроокно между targeted CardGet и кастомным `DeleteRow` остаётся клиентским, так как серверного аналога `AffectVersion` для этого request не используется.\n'
if needle not in r:
    raise SystemExit('README v1.9.27 safety note not found')
r = r.replace(needle, addition, 1)
readme.write_text(r, encoding='utf-8')

issue = Path('.github/ISSUE_TEMPLATE/bug_report.yml')
i = issue.read_text(encoding='utf-8').replace('placeholder: 1.9.27', 'placeholder: 1.9.28', 1)
issue.write_text(i, encoding='utf-8')

changelog = Path('CHANGELOG.md')
c = changelog.read_text(encoding='utf-8')
entry = '''# Changelog\n\n## 1.9.28 — 2026-08-29\n\n- DELETE store-time freshness-check больше не вызывает полный `loadSnapshot()` перед каждой удаляемой строкой: используется targeted `CardGet` только конкретной row-card;\n- общий `readMatrixRowFromCard` теперь используется и полным snapshot, и targeted DELETE recheck, поэтому raw fingerprint рассчитывается одной и той же логикой;\n- targeted recheck явно подтверждает наличие живой `MatrixVersionID` в `MtxRouteMatrixRowVersions`; исчезнувшая версия fail-closed переводит DELETE в ПРОПУСТИТЬ;\n- сохранены строгие проверки `RowCardID + MatrixVersionID + raw fingerprint` и локальный partial-apply без auto-merge; клиентское микроокно `CardGet → DeleteRow` остаётся задокументированным ограничением кастомного DELETE;\n- добавлены TDD-regressions на отсутствие повторного full snapshot и исчезнувшую target-version.\n\n'''
if not c.startswith('# Changelog\n\n'):
    raise SystemExit('unexpected CHANGELOG header')
c = entry + c[len('# Changelog\n\n'):]
changelog.write_text(c, encoding='utf-8')
print('v1.9.28 release metadata synchronized')
