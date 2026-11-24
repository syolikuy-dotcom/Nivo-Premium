'use strict';
const { requireDist } = require('./_dist');
requireDist('core/migrate').run().then(() => { console.log('Migrasi selesai.'); process.exit(0); }).catch((e) => { console.error('Migrasi gagal:', e.message); process.exit(1); });
