import fs from 'node:fs';

const version = '1.13.0';

const userPath = 'tessa-matrix-studio.user.js';
let user = fs.readFileSync(userPath, 'utf8');
user = user.replace(/^\/\/ @version\s+\S+/m, `// @version      ${version}`);
user = user.replace(/version:\s*'1\.12\.2'/, `version: '${version}'`);
if (!user.includes(`// @version      ${version}`) || !user.includes(`version: '${version}'`)) {
  throw new Error('userscript version bump failed');
}
fs.writeFileSync(userPath, user);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = version;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const lockPath = 'package-lock.json';
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
lock.version = version;
if (!lock.packages?.['']) throw new Error('package-lock root package missing');
lock.packages[''].version = version;
fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

const readmePath = 'README.md';
let readme = fs.readFileSync(readmePath, 'utf8');
readme = readme.replace(/version-1\.12\.2-/, `version-${version}-`);
readme = readme.replace(/\*\*v1\.12\.2 · Автор:/, `**v${version} · Автор:`);
readme = readme.replace(/Подтвердите установку версии \*\*1\.12\.2\*\*/, `Подтвердите установку версии **${version}**`);
readme = readme.replace(/Текущая версия: \*\*1\.12\.2\*\*/, `Текущая версия: **${version}**`);
readme = readme.replace(/- \*\*Версия:\*\* `1\.12\.0`/, `- **Версия:** \`${version}\``);
const oldMatrices = 'Структура, типы полей, функции и справочники читаются из шаблона открытой матрицы. Привязки к названиям «ОРД», конкретным организациям или одному MatrixID нет. Для каждой матрицы скачивайте её собственный Excel: перенос книги между карточками блокируется. Смена карточки или TemplateID сбрасывает предыдущий Preview и выбор значений.';
const newMatrices = 'Структура, типы полей, функции и справочники читаются из шаблона открытой матрицы. Привязки к названиям «ОРД» или конкретным организациям нет. Обычная работа по-прежнему использует Excel своей матрицы. Если книга была выгружена из **другой карточки с тем же TemplateID**, Studio распознаёт это как отдельный перенос желаемого итогового состояния: исходные RowID/VersionID не используются как target, Preview показывает ADD/KEEP/DELETE относительно открытой матрицы, а перед Apply требуется отдельное подтверждение. Книга другого TemplateID и файл без надёжных MatrixID блокируются fail-closed. Смена карточки или TemplateID сбрасывает предыдущий Preview и выбор значений.';
if (!readme.includes(oldMatrices)) throw new Error('README cross-matrix paragraph marker missing');
readme = readme.replace(oldMatrices, newMatrices);
const requiredReadme = [
  `version-${version}-`,
  `**v${version} · Автор:`,
  `Подтвердите установку версии **${version}**`,
  `Текущая версия: **${version}**`,
  `- **Версия:** \`${version}\``,
  'другой карточки с тем же TemplateID',
];
if (requiredReadme.some(marker => !readme.includes(marker))) throw new Error('README version/feature alignment failed');
fs.writeFileSync(readmePath, readme);

const changelogPath = 'CHANGELOG.md';
let changelog = fs.readFileSync(changelogPath, 'utf8');
if (!changelog.includes(`## ${version} —`)) {
  const heading = '# История изменений\n\n';
  if (!changelog.startsWith(heading)) throw new Error('CHANGELOG heading marker missing');
  const entry = `## ${version} — 2026-09-10\n\n`
    + `- Добавлен явный безопасный перенос Excel между разными карточками одной матрицы/шаблона при совпадающем TemplateID: исходные RowID/VersionID не переиспользуются, а целевое состояние рассчитывается как KEEP/ADD/DELETE относительно открытой карточки.\n`
    + `- Перенос требует отдельного подтверждения и обоих MatrixID. Другой TemplateID, отсутствующая identity или неоднозначный контекст блокируются fail-closed.\n`
    + `- Apply для переноса выполняется фазами: общий preflight всех ADD до записи, затем ADD, и только после успешной подготовки нового набора — DELETE старых строк цели. Первая ошибка target DELETE останавливает дальнейшие удаления и помечает состояние UNSAFE.\n`
    + `- При ошибке ADD выполняется компенсация всех VersionID, для которых Store уже был предпринят, включая неопределённый исход ответа. Истина о rollback определяется повторным membership read-back, а не успешностью DeleteRow-response.\n`
    + `- Успешные запросы переноса не считаются завершённым переносом до reconciliation: только полное повторное подтверждение переводит transfer в verified; расхождение даёт unsafe, невозможность проверки — incomplete.\n`
    + `- Перед Apply сохраняется guard несохранённых изменений основной карточки, чтобы штатный editor Save не прихватил посторонние пользовательские правки.\n\n`;
  changelog = changelog.replace(heading, heading + entry);
}
fs.writeFileSync(changelogPath, changelog);

const bugPath = '.github/ISSUE_TEMPLATE/bug_report.yml';
let bug = fs.readFileSync(bugPath, 'utf8');
bug = bug.replace(/placeholder: 1\.12\.2/, `placeholder: ${version}`);
if (!bug.includes(`placeholder: ${version}`)) throw new Error('bug report version placeholder bump failed');
fs.writeFileSync(bugPath, bug);

console.log(`version and release docs aligned to ${version}`);
