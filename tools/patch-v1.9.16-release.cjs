const fs = require('fs');

function patch(path, replacements) {
  let text = fs.readFileSync(path, 'utf8');
  for (const [from, to, label] of replacements) {
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`${path} / ${label}: expected exactly one anchor, got ${count}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path, text);
}

patch('tessa-matrix-studio.user.js', [
  ['// @version      1.9.15', '// @version      1.9.16', 'metadata version'],
  ["    version: '1.9.15',", "    version: '1.9.16',", 'runtime version'],
]);

patch('tests/smoke.mjs', [
  ["assert(code.includes('// @version      1.9.15'), 'wrong userscript version');", "assert(code.includes('// @version      1.9.16'), 'wrong userscript version');", 'smoke version'],
]);

patch('package.json', [
  ['"version": "1.9.15"', '"version": "1.9.16"', 'package version'],
]);

patch('README.md', [
  ['version-1.9.15-EF233C', 'version-1.9.16-EF233C', 'badge'],
  ['**v1.9.15 · Автор: Шаповалов Артём**', '**v1.9.16 · Автор: Шаповалов Артём**', 'header version'],
  ['Подтвердите установку версии **1.9.15** в Tampermonkey.', 'Подтвердите установку версии **1.9.16** в Tampermonkey.', 'quick start version'],
  ['- **Версия:** `1.9.15`', '- **Версия:** `1.9.16`', 'install version'],
  ['Текущая версия: **1.9.15**', 'Текущая версия: **1.9.16**', 'support version'],
]);

patch('CHANGELOG.md', [
  ['# Changelog\n\n## 1.9.15 — 2026-08-27', '# Changelog\n\n## 1.9.16 — 2026-08-28\n\n- исправлен TOCTOU-сценарий REPLACE: перед Apply Studio теперь повторно проверяет не только target, но и source identity копии;\n- если source-строка изменилась или исчезла в TESSA после Preview, REPLACE переводится в runtime SKIP и требует повторного «Проверить изменения»;\n- stale source больше не может быть перенесён в неизменившийся target между Preview и Apply;\n- добавлен отдельный regression `preflight-stale-replace-source.mjs`, воспроизводящий изменение source после Preview при неизменном target.\n\n## 1.9.15 — 2026-08-27', 'changelog section'],
]);
