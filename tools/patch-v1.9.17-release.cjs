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
  ['// @version      1.9.16', '// @version      1.9.17', 'metadata version'],
  ["    version: '1.9.16',", "    version: '1.9.17',", 'runtime version'],
]);
patch('tests/smoke.mjs', [
  ["assert(code.includes('// @version      1.9.16'), 'wrong userscript version');", "assert(code.includes('// @version      1.9.17'), 'wrong userscript version');", 'smoke version'],
]);
patch('package.json', [
  ['"version": "1.9.16"', '"version": "1.9.17"', 'package version'],
]);
patch('README.md', [
  ['version-1.9.16-EF233C', 'version-1.9.17-EF233C', 'badge'],
  ['**v1.9.16 · Автор: Шаповалов Артём**', '**v1.9.17 · Автор: Шаповалов Артём**', 'header version'],
  ['Подтвердите установку версии **1.9.16** в Tampermonkey.', 'Подтвердите установку версии **1.9.17** в Tampermonkey.', 'quick start version'],
  ['- **Версия:** `1.9.16`', '- **Версия:** `1.9.17`', 'install version'],
  ['Текущая версия: **1.9.16**', 'Текущая версия: **1.9.17**', 'support version'],
]);
patch('CHANGELOG.md', [
  ['# Changelog\n\n## 1.9.16 — 2026-08-28', '# Changelog\n\n## 1.9.17 — 2026-08-28\n\n- исправлен второй TOCTOU-сценарий: ADD, созданный копированием существующей строки, теперь сохраняет provenance source identity отдельно от identity новой строки;\n- перед CardNew preflight повторно проверяет source MatrixVersionID/MatrixRowID и экспортный BaseFingerprint;\n- если source копии изменилась или исчезла после Preview, новая строка не создаётся — операция переводится в runtime SKIP и требует повторного «Проверить изменения»;\n- добавлен regression `preflight-stale-copied-add-source.mjs`, подтверждающий, что stale копия не доходит до preparedAdds.\n\n## 1.9.16 — 2026-08-28', 'changelog section'],
]);
