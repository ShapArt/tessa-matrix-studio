import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(path, 'utf8');

const returnBefore = `      return { ...link, card, values, roles, flat, fingerprint: fingerprintFlat(flat) };`;
const returnAfter = `      // Snapshot rows cross the bridge into planner/Excel/cache code. Keep them plain:\n      // a live TESSA Card contains EventHandler back-references (fieldChanged._sender)\n      // and must never enter serializable application state.\n      return { ...link, values, roles, flat, fingerprint: fingerprintFlat(flat) };`;
if (!source.includes(returnBefore)) throw new Error('snapshot row return with live card not found');
source = source.replace(returnBefore, returnAfter);

const controlBefore = `    const control = snapshotOk ? snapshot.rows.find(row => Object.values(row.values || {}).some(items => items.some(v => v.to != null))) || snapshot.rows[0] : null;\n    await run('saved-validation', 'Сервер: сохранённая строка', async () => {\n      await bridge.validateDuplicate(control.card, control.versionId); return { detail: 'Сервер разрешил проверку существующей версии.' };\n    }, Boolean(control));\n    await run('rebuilt-validation', 'Сервер: та же строка после перестройки', async () => {\n      const card = control.card.clone(); bridge.rebuildRowCard(card, control.versionId, desiredFromRow(control), structure, snapshot);`;
const controlAfter = `    const control = snapshotOk ? snapshot.rows.find(row => Object.values(row.values || {}).some(items => items.some(v => v.to != null))) || snapshot.rows[0] : null;\n    // Diagnostics is the exceptional path that needs a native Card. Load it on demand\n    // by the real row CardID instead of retaining runtime objects in snapshot rows.\n    let controlNativeCard = null;\n    const getControlNativeCard = async () => {\n      if (!control?.rowCardId) throw new Error('У контрольной строки отсутствует CardID.');\n      if (!controlNativeCard) controlNativeCard = await bridge.getCard(control.rowCardId);\n      return controlNativeCard;\n    };\n    await run('saved-validation', 'Сервер: сохранённая строка', async () => {\n      const nativeCard = await getControlNativeCard();\n      await bridge.validateDuplicate(nativeCard, control.versionId); return { detail: 'Сервер разрешил проверку существующей версии.' };\n    }, Boolean(control));\n    await run('rebuilt-validation', 'Сервер: та же строка после перестройки', async () => {\n      const nativeCard = await getControlNativeCard();\n      if (typeof nativeCard?.clone !== 'function') throw new Error('Нативная карточка контрольной строки не поддерживает clone().');\n      const card = nativeCard.clone(); bridge.rebuildRowCard(card, control.versionId, desiredFromRow(control), structure, snapshot);`;
if (!source.includes(controlBefore)) throw new Error('diagnostics control.card block not found');
source = source.replace(controlBefore, controlAfter);

if (/control\.card/.test(source)) throw new Error('live snapshot control.card reference remains');
fs.writeFileSync(path, source);
console.log('snapshot DTO boundary patch applied');
