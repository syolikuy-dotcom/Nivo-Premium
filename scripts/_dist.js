'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const marker = path.join(root, 'dist', 'server', 'core', 'config.js');

function buildServer() {
  const r = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.server.json'], { cwd: root, stdio: 'inherit' });
  if (!fs.existsSync(marker)) { console.error('Kompilasi server gagal. Jalankan: npm run build:server'); process.exit(1); }
  if (r.status !== 0) console.warn('PERINGATAN: tsc melaporkan error tipe; kode tetap dikompilasi. Perbaiki dengan: npm run typecheck');
}
function requireDist(name) {
  if (!fs.existsSync(marker)) buildServer();
  return require(path.join(root, 'dist', 'server', name));
}
module.exports = { requireDist, buildServer, root, marker };
