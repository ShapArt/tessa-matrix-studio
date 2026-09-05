from pathlib import Path
import json

OLD = '1.11.3'
NEW = '1.11.4'
DATE = '2026-09-05'

# userscript: release metadata only; runtime logic is already verified on main.
p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')
assert s.count(f'// @version      {OLD}') == 1, 'userscript @version mismatch'
assert s.count(f"version: '{OLD}'") == 1, 'APP.version mismatch'
s = s.replace(f'// @version      {OLD}', f'// @version      {NEW}', 1)
s = s.replace(f"version: '{OLD}'", f"version: '{NEW}'", 1)
p.write_text(s, encoding='utf-8')

# package metadata.
for name in ['package.json', 'package-lock.json']:
    p = Path(name)
    data = json.loads(p.read_text(encoding='utf-8'))
    assert data.get('version') == OLD, f'{name} root version mismatch: {data.get("version")}'
    data['version'] = NEW
    if name == 'package-lock.json':
        assert data.get('packages', {}).get('', {}).get('version') == OLD, 'package-lock packages[""] version mismatch'
        data['packages']['']['version'] = NEW
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

# Public README version references used by docs contract.
p = Path('README.md')
s = p.read_text(encoding='utf-8')
replacements = [
    (f'version-{OLD}-', f'version-{NEW}-'),
    (f'**v{OLD} · Автор: Шаповалов Артём**', f'**v{NEW} · Автор: Шаповалов Артём**'),
    (f'Подтвердите установку версии **{OLD}**', f'Подтвердите установку версии **{NEW}**'),
    (f'Текущая версия: **{OLD}**', f'Текущая версия: **{NEW}**'),
]
for before, after in replacements:
    assert before in s, f'README target missing: {before}'
    s = s.replace(before, after, 1)
p.write_text(s, encoding='utf-8')

# Bug-report version placeholder.
p = Path('.github/ISSUE_TEMPLATE/bug_report.yml')
s = p.read_text(encoding='utf-8')
assert f'placeholder: {OLD}' in s, 'bug report placeholder mismatch'
s = s.replace(f'placeholder: {OLD}', f'placeholder: {NEW}', 1)
p.write_text(s, encoding='utf-8')

# Changelog: diagnostic UX convenience, not an interval bug fix.
p = Path('CHANGELOG.md')
s = p.read_text(encoding='utf-8')
header = '# Changelog\n\n'
assert s.startswith(header), 'CHANGELOG header mismatch'
assert f'## {NEW} —' not in s, 'v1.11.4 changelog already present'
entry = f'''## {NEW} — {DATE}\n\n- «Проверки и диагностика» теперь автоматически добавляет read-only interval diagnostics в обычный `TESSA_Diagnostics_*.zip`, когда текущий Preview содержит `duplicate-interval-extractor`. Отдельный ручной запуск «Диагностика интервалов» остаётся доступным.\n- Если успешная interval diagnostics уже была собрана в текущей сессии, Studio переиспользует `APP.lastIntervalDiagnostics` и не повторяет серверные probes.\n- В ZIP добавляются `interval/TESSA_Interval_Diagnostics.json` с полным opt-in raw evidence и `interval/interval-summary.json` с privacy-safe whitelist: outcomes/codes/structuralMode и обезличенный `identityTopology`, без сырых запросов, серверных сообщений, GUID, ФИО и бизнес-значений.\n- Изменение касается только диагностического UX. Apply, Store, Delete, preflight и серверный ValidateDuplicate не менялись; `writesAttempted = 0` сохраняется. Issue #57 и `LeftOperandExtractor is null` этим релизом не объявляются исправленными.\n\n'''
s = header + entry + s[len(header):]
p.write_text(s, encoding='utf-8')

print('v1.11.4 release metadata patched')
