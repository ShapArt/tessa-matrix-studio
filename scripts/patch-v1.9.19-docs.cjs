const fs = require('fs');
const path = 'README.md';
let readme = fs.readFileSync(path, 'utf8');
const anchor = 'В Excel сохраняются скрытые служебные идентификаторы строк. Они нужны для точного сопоставления и **не должны редактироваться вручную**.';
if (!readme.includes(anchor)) throw new Error('README hidden-ID safety anchor not found');
if (!readme.includes('baseline-ledger')) {
  readme = readme.replace(anchor, `${anchor}\n\nRoundtrip V6 дополнительно хранит на veryHidden-листе **baseline-ledger** с исходными MatrixRowID, MatrixVersionID и BaseFingerprint. Он нужен для безопасной проверки физического DELETE и целостности файла: если служебная identity или fingerprint повреждены либо удаляемая строка успела измениться в TESSA, Studio отказывается угадывать и просит свежую выгрузку.`);
}
fs.writeFileSync(path, readme);
console.log('V6 baseline safety documentation preserved');
