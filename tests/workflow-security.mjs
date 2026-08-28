import fs from 'node:fs';

const workflowDir = new URL('../.github/workflows/', import.meta.url);
const workflowFiles = fs.readdirSync(workflowDir)
  .filter(name => /\.ya?ml$/i.test(name))
  .sort();

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const indentOf = line => (line.match(/^\s*/) || [''])[0].length;

function blockAfter(lines, startIndex) {
  const startIndent = indentOf(lines[startIndex]);
  const block = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith('#')) {
      block.push(line);
      continue;
    }
    if (indentOf(line) <= startIndent) break;
    block.push(line);
  }
  return block;
}

function findExactLine(lines, text, indent) {
  return lines.findIndex(line => indentOf(line) === indent && line.trim() === text);
}

function mappingFromBlock(block, indent) {
  const out = new Map();
  for (const line of block) {
    if (!line.trim() || line.trimStart().startsWith('#') || indentOf(line) !== indent) continue;
    const match = line.trim().match(/^([^:#]+):\s*(.*?)\s*$/);
    if (match) out.set(match[1].trim(), match[2].trim());
  }
  return out;
}

function jobBlock(lines, jobName) {
  const jobsIndex = findExactLine(lines, 'jobs:', 0);
  assert(jobsIndex >= 0, 'quality workflow must contain jobs');
  const jobs = blockAfter(lines, jobsIndex);
  const relative = findExactLine(jobs, `${jobName}:`, 2);
  assert(relative >= 0, `quality workflow must contain ${jobName} job`);
  return blockAfter(jobs, relative);
}

function permissionsFromBlock(block, ownerLabel) {
  const permissionsIndex = findExactLine(block, 'permissions:', 4);
  assert(permissionsIndex >= 0, `${ownerLabel} must declare job-level permissions`);
  return mappingFromBlock(blockAfter(block, permissionsIndex), 6);
}

// Supply-chain rule: discover every workflow automatically so a newly added YAML file
// cannot silently re-introduce a floating @vN/@main action reference.
for (const name of workflowFiles) {
  const path = `.github/workflows/${name}`;
  const text = fs.readFileSync(new URL(name, workflowDir), 'utf8');
  const uses = [...text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+).*$/gm)].map(match => match[1]);

  for (const ref of uses) {
    // Local reusable actions (./...) are part of this repository and do not need a remote SHA.
    if (ref.startsWith('./')) continue;
    const at = ref.lastIndexOf('@');
    assert(at > 0, `${path}: action reference has no @ref: ${ref}`);
    const revision = ref.slice(at + 1);
    assert(/^[0-9a-f]{40}$/i.test(revision), `${path}: external action must be pinned to a full 40-char commit SHA: ${ref}`);
  }
}

// Least privilege rule for Quality & Security: ordinary tests need only read access.
// security-events: write belongs specifically to CodeQL, not to every job in the workflow.
const qualityText = fs.readFileSync(new URL('quality.yml', workflowDir), 'utf8');
const qualityLines = qualityText.split(/\r?\n/);
const topPermissionsIndex = findExactLine(qualityLines, 'permissions:', 0);
assert(topPermissionsIndex >= 0, 'quality workflow must declare top-level permissions');
const topPermissions = mappingFromBlock(blockAfter(qualityLines, topPermissionsIndex), 2);
assert(topPermissions.get('contents') === 'read', 'quality workflow must default to contents: read');
assert(topPermissions.get('security-events') !== 'write', 'quality workflow must not grant security-events: write globally');

const testsPermissionsIndex = findExactLine(jobBlock(qualityLines, 'tests'), 'permissions:', 4);
assert(testsPermissionsIndex < 0, 'tests job should inherit the read-only workflow permissions and must not add write permissions');

const codeqlPermissions = permissionsFromBlock(jobBlock(qualityLines, 'codeql'), 'codeql job');
assert(codeqlPermissions.get('contents') === 'read', 'codeql job must retain contents: read');
assert(codeqlPermissions.get('security-events') === 'write', 'codeql job must receive security-events: write');

console.log('TESSA Matrix Studio workflow supply-chain and least-privilege checks: OK');
