import fs from 'node:fs';

const file = new URL('../README.md', import.meta.url);
let text = fs.readFileSync(file, 'utf8');
const row = '| Проверки и диагностический пакет | [Studio Diagnostics](docs/STUDIO-DIAGNOSTICS.md) |';
const addition = `${row}\n| Стратегия тестирования и релизные ворота | [Test Strategy](docs/TEST-STRATEGY.md) |`;
if (text.includes('[Test Strategy](docs/TEST-STRATEGY.md)')) {
  console.log('README already links TEST-STRATEGY');
  process.exit(0);
}
if (!text.includes(row)) throw new Error('README documentation table anchor not found');
text = text.replace(row, addition);
fs.writeFileSync(file, text);
console.log('Linked TEST-STRATEGY from README');
