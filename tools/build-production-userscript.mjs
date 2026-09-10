import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [version, outputPath] = process.argv.slice(2);

if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('version must be semver x.y.z');
if (!outputPath) throw new Error('output path is required');

const source = fs.readFileSync(path.join(root, 'tessa-matrix-studio.user.js'), 'utf8');
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(outputPath, source, 'utf8');

throw new Error('Warehouse production composition is not implemented yet');
