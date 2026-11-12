#!/usr/bin/env node
// Kiểm tra toàn vẹn dữ liệu từ dòng lệnh — cùng logic với nút "Kiểm tra ngay" trong
// CMS (runIntegrityCheck) và với chốt chặn của /version.json (validateManifest).
// Chạy TRƯỚC mỗi đợt thử nghiệm để lỗi dữ liệu có sẵn không bị nhầm thành lỗi mới.
//
// CHỈ ĐỌC — an toàn chạy ngay trong thư mục thật, kể cả khi server đang chạy.
//
//   node scripts/kiem-tra-du-lieu.js            # dữ liệu cạnh server.js
//   DATA_DIR=/srv/bt-a node scripts/kiem-tra-du-lieu.js
//   node scripts/kiem-tra-du-lieu.js --ca-info  # in cả file mồ côi / mô hình không dùng
//
// Mã thoát: 2 = có lỗi chặn phát hành, 1 = chỉ có cảnh báo, 0 = sạch.

const fs = require('fs');
const path = require('path');
const { CONTENT_DIR } = require('../paths');
const { runIntegrityCheck, validateManifest } = require('../routes/adminContent');

const caInfo = process.argv.includes('--ca-info');
const manifest = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'manifest.json'), 'utf8'));
const findings = runIntegrityCheck(manifest);
const chanPhatHanh = validateManifest(manifest);

const NHAN = { error: 'LỖI     ', warning: 'CẢNH BÁO', info: 'ghi chú ' };
const dem = { error: 0, warning: 0, info: 0 };
console.log(`Dữ liệu: ${CONTENT_DIR}`);
console.log(`bundleVersion: ${manifest.bundleVersion}\n`);
for (const f of findings) {
  dem[f.severity] = (dem[f.severity] || 0) + 1;
  if (f.severity === 'info' && !caInfo) continue;
  console.log(`${NHAN[f.severity] || f.severity}  ${f.message}`);
}
if (chanPhatHanh.length) {
  console.log('\nMáy tham quan sẽ KHÔNG nhận nội dung mới (/version.json trả 503) vì:');
  for (const p of chanPhatHanh) console.log(`  - ${p}`);
}
console.log(`\nTổng: ${dem.error} lỗi, ${dem.warning} cảnh báo, ${dem.info} ghi chú${dem.info && !caInfo ? ' (thêm --ca-info để xem)' : ''}.`);
process.exit(dem.error || chanPhatHanh.length ? 2 : dem.warning ? 1 : 0);
