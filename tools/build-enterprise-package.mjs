import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function httpsUrl(value, originOnly = false) {
  if (typeof value !== 'string' || /[\s*<>"'\\]/.test(value)) throw new Error('Expected an explicit HTTPS URL, without wildcards or whitespace.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (originOnly && (url.pathname !== '/' || url.search || url.port))) throw new Error('Invalid HTTPS origin/update URL.');
  return originOnly ? url.origin : url.href;
}
const xml = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function enterpriseFiles(source, config) {
  const version = source.match(/^\/\/ @version\s+([\d.]+)$/m)?.[1];
  if (!version || !/^\d+(\.\d+){1,3}$/.test(version) || version.split('.').some(part => Number(part) > 65535 || (part.length > 1 && part.startsWith('0')))) throw new Error('Invalid source extension version.');
  if (!Array.isArray(config.origins) || !config.origins.length) throw new Error('At least one exact TESSA HTTPS origin is required.');
  const origins = [...new Set(config.origins.map(value => httpsUrl(value, true)))];
  const hasUpdate = [config.extensionId, config.updateUrl, config.crxUrl].some(Boolean);
  if (hasUpdate && (!/^[a-p]{32}$/.test(config.extensionId || '') || !config.updateUrl || !config.crxUrl)) throw new Error('Updating requires the real extension ID, updateUrl and crxUrl together.');
  const updateUrl = hasUpdate ? httpsUrl(config.updateUrl) : null;
  const crxUrl = hasUpdate ? httpsUrl(config.crxUrl) : null;
  const manifest = {
    manifest_version: 3, name: 'TESSA Matrix Studio', version,
    description: 'Редактирование матриц TESSA через Excel с предварительной проверкой изменений.',
    content_scripts: [{ matches: origins.map(origin => `${origin}/*`), js: ['studio.js'], run_at: 'document_idle', world: 'MAIN', all_frames: false }],
    ...(updateUrl ? { update_url: updateUrl } : {}),
  };
  // Static code only. No loader, eval, remote dependencies, privileged bridge or credentials.
  const files = new Map([
    ['extension/manifest.json', JSON.stringify(manifest, null, 2) + '\n'],
    ['extension/studio.js', source],
    ['BUILD.json', JSON.stringify({ version, sourceSha256: hash(source), origins, signed: false, updateConfigured: hasUpdate }, null, 2) + '\n'],
  ]);
  if (hasUpdate) {
    files.set('update.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0"><app appid="${config.extensionId}"><updatecheck codebase="${xml(crxUrl)}" version="${version}" /></app></gupdate>\n`);
    const settings = { [config.extensionId]: { installation_mode: 'force_installed', update_url: updateUrl, override_update_url: true } };
    files.set('policy/ExtensionSettings.json', JSON.stringify(settings, null, 2) + '\n');
    files.set('policy/ExtensionInstallForcelist.txt', `${config.extensionId};${updateUrl}\n`);
  }
  files.set('SHA256SUMS.txt', [...files].map(([name, value]) => `${hash(value)}  ${name}`).join('\n') + '\n');
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourcePath, configPath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !configPath || !outputPath) throw new Error('Usage: node tools/build-enterprise-package.mjs <exact-userscript> <config.json> <new-output-directory>');
  const files = enterpriseFiles(fs.readFileSync(sourcePath, 'utf8'), JSON.parse(fs.readFileSync(configPath, 'utf8')));
  const output = path.resolve(outputPath);
  if (fs.existsSync(output) && fs.readdirSync(output).length) throw new Error('Output must be empty; existing release files are never overwritten.');
  for (const [name, value] of files) {
    const target = path.join(output, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value, { flag: 'wx' });
  }
  console.log(`Unsigned enterprise package: ${output}`);
}
