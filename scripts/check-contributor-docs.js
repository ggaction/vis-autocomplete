import { readFile, access } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['README.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md',
  'GOVERNANCE.md', 'THIRD_PARTY_NOTICES.md', 'docs/README.md', 'docs/development.md',
  'docs/architecture.md', 'docs/licensing.md', 'docs/maintaining.md',
  '.github/pull_request_template.md'];
const errors = [];
let links = 0;
for (const file of files) {
  const source = await readFile(resolve(root, file), 'utf8');
  // The curated guides use inline Markdown links. Ignore examples in fenced code.
  const prose = source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  for (const match of prose.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) continue;
    const pathname = decodeURIComponent(href.split(/[?#]/, 1)[0]);
    const target = resolve(root, dirname(file), pathname);
    const rel = relative(root, target);
    if (rel === '..' || rel.startsWith(`..${sep}`)) { errors.push(`${file}: link escapes repository: ${href}`); continue; }
    try { await access(target); links++; } catch { errors.push(`${file}: missing local link: ${href}`); }
  }
}
for (const file of ['LICENSE', 'NOTICE', 'CITATION.cff', '.nvmrc', '.editorconfig',
  '.github/CODEOWNERS', '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/documentation.yml']) await access(resolve(root, file));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
if (pkg.license !== 'Apache-2.0' || lock.packages[''].license !== pkg.license) errors.push('Package and lockfile licenses must be Apache-2.0.');
if (!pkg.private) errors.push('The application must remain a private npm package.');
const license = await readFile(resolve(root, 'LICENSE'), 'utf8');
if (!license.includes('Apache License') || !license.includes('Version 2.0, January 2004')) errors.push('Apache-2.0 license text is missing.');
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Contributor docs: ${files.length} guides, ${links} local links, metadata and community files checked.`);
