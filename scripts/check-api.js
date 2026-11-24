'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' || e.name === '.next' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const rel = (f) => path.relative(root, f).split(path.sep).join('/');
const problems = [];

const apiDir = path.join(root, 'src', 'pages', 'api');
const routes = walk(apiDir).filter((f) => f.endsWith('.ts'));
for (const f of routes) {
  const s = fs.readFileSync(f, 'utf8');
  if (!/export const config = \{ api: \{ bodyParser: false \}/.test(s)) problems.push(`${rel(f)}: config.api.bodyParser harus false`);
  if (!/export default /.test(s)) problems.push(`${rel(f)}: tidak ada default export`);
}

const routePaths = routes.map((f) => rel(f).replace(/^src\/pages/, '').replace(/\.ts$/, '').replace(/\/index$/, '')).filter((r) => !r.includes('[[...'));
const concrete = routePaths.map((r) => r.replace(/\[[^\]]+\]/g, 'x'));
const clientFiles = [...walk(path.join(root, 'src', 'pages')).filter((f) => !f.includes(`${path.sep}api${path.sep}`)), ...walk(path.join(root, 'src', 'components')), path.join(root, 'src', 'shared', 'api-client.ts')].filter((f) => /\.tsx?$/.test(f));
const calls = new Set();
for (const f of clientFiles) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/[`'"](\/api\/[^`'"\s?]*)/g)) calls.add(m[1].replace(/\/$/, ''));
}
for (const c of [...calls].sort()) {
  const re = new RegExp(`^${c.split(/\$\{[^}]*\}/).map((t) => t.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('[^/]+')}$`);
  if (!concrete.some((r) => re.test(r))) problems.push(`frontend memanggil ${c} tetapi tidak ada route-nya di pages/api`);
}

for (const f of [...walk(root).filter((x) => /\.(js|ts|tsx)$/.test(x) && !rel(x).startsWith('tests/') && !rel(x).startsWith('dist/') && rel(x) !== 'scripts/check-api.js')]) {
  const s = fs.readFileSync(f, 'utf8');
  if (/require\(['"](express|helmet|compression|express-rate-limit)['"]\)|from ['"](express|helmet|compression|express-rate-limit)['"]/.test(s)) problems.push(`${rel(f)}: masih mengimpor Express/helmet/compression`);
}

console.log(`route API: ${routes.length} berkas, ${concrete.length} pola; URL dipanggil frontend: ${calls.size}`);
if (problems.length) { console.error(problems.map((p) => ` - ${p}`).join('\n')); process.exit(1); }
console.log('OK: semua route konsisten.');
