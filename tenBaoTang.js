// Tên bảo tàng = museum.name ở ngôn ngữ mặc định trong manifest. Một nguồn duy nhất cho
// app trên tablet, tiêu đề trang quản trị, tên người gửi thư và tên hiện trong ứng dụng
// xác thực — mỗi bảo tàng tự khác nhau mà không phải sửa mã nguồn.
const fs = require('fs');
const path = require('path');
const { CONTENT_DIR } = require('./paths');

const MANIFEST_PATH = path.join(CONTENT_DIR, 'manifest.json');
let cache = null; // { key, ten } — manifest có thể nặng hàng chục MB, chỉ đọc lại khi đổi

function tenBaoTang() {
  try {
    const st = fs.statSync(MANIFEST_PATH);
    const key = `${st.mtimeMs}:${st.size}`;
    if (cache && cache.key === key) return cache.ten;
    const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const n = m.museum?.name || {};
    const ten = String(n[m.fallbackLanguage] || Object.values(n)[0] || '').trim();
    cache = { key, ten };
    return ten;
  } catch {
    return '';
  }
}

// Dùng ở chỗ bắt buộc phải có chữ (tiêu đề thư, tên trong ứng dụng xác thực).
function tenHienThi() {
  return tenBaoTang() || 'Thuyết minh';
}

module.exports = { tenBaoTang, tenHienThi };
