from pathlib import Path
import json


def replace_once(text: str, before: str, after: str, label: str) -> str:
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, got {count}')
    return text.replace(before, after, 1)

script_path = Path('tessa-matrix-studio.user.js')
script = script_path.read_text(encoding='utf-8')
script = replace_once(script,
    "const previewPreflight = await preflightPlan(plan, { previewOnly: true, bridge, structure, fresh: snapshot });",
    "const previewPreflight = await preflightPlan(plan, { previewOnly: true, bridge, structure });",
    'fresh preview preflight')
script = replace_once(script, '// @version      1.9.19', '// @version      1.9.20', 'metadata version')
script = replace_once(script, "    version: '1.9.19',", "    version: '1.9.20',", 'runtime version')
script_path.write_text(script, encoding='utf-8')

pkg_path = Path('package.json')
pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
pkg['version'] = '1.9.20'
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

readme_path = Path('README.md')
readme = readme_path.read_text(encoding='utf-8').replace('1.9.19', '1.9.20')
anchor = 'На этапе **«Проверить изменения» ничего в TESSA не изменяется**.'
addition = anchor + '\n\nНачиная с **v1.9.20**, Preview дополнительно выполняет read-only preflight на свежем состоянии TESSA: проверяет справочники, дубли, stale-конфликты и зависимости UPDATE/ADD → DELETE. Операции, которые уже сейчас не пройдут Apply, сразу переводятся в **ПРОПУСТИТЬ** и исключаются из счётчика кнопки применения. Перед фактической записью тот же preflight выполняется ещё раз.'
if anchor in readme and 'read-only preflight' not in readme:
    readme = readme.replace(anchor, addition, 1)
readme_path.write_text(readme, encoding='utf-8')

smoke_path = Path('tests/smoke.mjs')
smoke = smoke_path.read_text(encoding='utf-8')
smoke = replace_once(smoke, '// @version      1.9.19', '// @version      1.9.20', 'smoke version')
smoke_path.write_text(smoke, encoding='utf-8')

issue_path = Path('.github/ISSUE_TEMPLATE/bug_report.yml')
issue = issue_path.read_text(encoding='utf-8').replace('placeholder: 1.9.19', 'placeholder: 1.9.20')
issue_path.write_text(issue, encoding='utf-8')

changelog_path = Path('CHANGELOG.md')
changelog = changelog_path.read_text(encoding='utf-8')
if '## 1.9.20 — 2026-08-28' not in changelog:
    section = '''# Changelog

## 1.9.20 — 2026-08-28

- Preview теперь выполняет read-only preflight до отображения итогового плана и не считает заведомо неприменимые операции корректными;
- несуществующие значения справочников, duplicate/stale runtime-конфликты и другие preflight-ошибки сразу переводятся в ПРОПУСТИТЬ с причиной в Preview;
- зависимый DELETE также исключается из Apply, если связанный UPDATE/ADD уже не прошёл Preview-preflight;
- Preview-preflight перечитывает свежий snapshot TESSA вместо reuse session-cache; перед фактической записью Apply повторяет preflight ещё раз;
- planner-plan не мутируется при проекции runtime SKIP в пользовательский Preview; добавлен regression `preview-preflight.mjs`.

'''
    changelog = changelog.replace('# Changelog\n\n', section, 1)
changelog_path.write_text(changelog, encoding='utf-8')

print('v1.9.20 finalization patch applied')
