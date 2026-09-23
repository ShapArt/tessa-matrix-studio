import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Use the exact, checked-in candidate recipe, including its order and version.
// Only known local Node transforms and the interval append are supported here.
export function buildPagingCandidate(target) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/live-excel-preview-uat-candidate.yml'), 'utf8');
  const recipe = workflow.split('      - name: Build exact candidate\n')[1]?.split('          node --check ')[0];
  if (!recipe) throw new Error('Candidate build recipe is missing.');
  const version = recipe.match(/CANDIDATE_VERSION='([\d.]+)'/)?.[1];
  if (!version) throw new Error('Candidate version is missing.');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, 'tessa-matrix-studio.user.js'), target);
  for (const line of recipe.split('\n')) {
    const transform = line.match(/^          node (hotfixes\/[\w.-]+\.mjs) dist\/tessa-matrix-studio\.user\.js$/);
    if (transform) {
      const result = spawnSync(process.execPath, [path.join(root, transform[1]), target], { cwd: root, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`${transform[1]} failed:\n${result.stdout}\n${result.stderr}`);
    } else if (line.includes('cat hotfixes/interval-add-valid-fallback.js >>')) {
      fs.appendFileSync(target, `\n${fs.readFileSync(path.join(root, 'hotfixes/interval-add-valid-fallback.js'), 'utf8')}\n`);
    } else if (line.trimStart().startsWith('sed -i -E')) {
      const source = fs.readFileSync(target, 'utf8');
      fs.writeFileSync(target, source.replace(/^(\/\/ @version\s+)[\d.]+$/m, `$1${version}`)
        .replace(/^(\s+version: ')[\d.]+(',)$/m, `$1${version}$2`));
    }
  }
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.resolve(process.argv[2] || 'dist/tessa-matrix-studio.user.js');
  buildPagingCandidate(target);
  console.log(`Built ${target}`);
}
