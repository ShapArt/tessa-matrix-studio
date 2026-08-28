const fs = require('fs');
const { execFileSync } = require('child_process');

const path = 'README.md';
let readme = fs.readFileSync(path, 'utf8');
const mainReadme = execFileSync('git', ['show', 'origin/main:README.md'], { encoding: 'utf8' });

const startMarker = '\n# Права и безопасность\n';
const endMarker = '\n# Боевой UAT перед раздачей пользователям\n';
const start = mainReadme.indexOf(startMarker);
const end = mainReadme.indexOf(endMarker, start);
if (start < 0 || end < 0 || end <= start) throw new Error('main README safety/troubleshooting block not found');
const preserved = mainReadme.slice(start, end);

if (!readme.includes('# Права и безопасность')) {
  const insertAt = readme.indexOf(endMarker);
  if (insertAt < 0) throw new Error('branch README UAT anchor not found');
  readme = readme.slice(0, insertAt) + preserved + readme.slice(insertAt);
}

for (const token of ['# Права и безопасность', '# Если что-то не работает', 'Ссылка .user.js открылась как текст или установка не стартовала']) {
  if (!readme.includes(token)) throw new Error(`README restoration failed: ${token}`);
}
fs.writeFileSync(path, readme);
console.log('README security and troubleshooting sections restored');
