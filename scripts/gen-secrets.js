'use strict';
const c = require('crypto');
console.log('SESSION_SECRET=' + c.randomBytes(48).toString('base64url'));
console.log('DATA_KEY=' + c.randomBytes(32).toString('hex'));
console.log('\nSalin dua baris di atas ke file .env. Simpan DATA_KEY baik-baik: kalau hilang, akun yang sudah terkirim tidak bisa dibuka lagi.');
