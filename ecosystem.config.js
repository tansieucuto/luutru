// Cấu hình pm2 — tự khởi động lại máy chủ khi lỗi hoặc khi máy khởi động lại.
// Dùng qua scripts/beacon.sh (hoặc: pm2 start ecosystem.config.js).
//
// Nhiều bảo tàng (NHIEU_BAO_TANG.md): mỗi mục trong bao-tang.json — do
// scripts/tao-bao-tang.js ghi — thành một app pm2 tên "beacon-<mã>", cùng mã nguồn,
// khác DATA_DIR. App "beacon-server" (dữ liệu cạnh server.js, như trước) vẫn chạy khi
// thư mục này còn content/ của chính nó.
//
// LƯU Ý: DATA_DIR CHỈ nằm ở đây. Khởi động lại bằng `pm2 restart <app> --update-env`
// là lấy môi trường của shell đang gõ — không có DATA_DIR, app sẽ đọc nhầm dữ liệu cạnh
// server.js. scripts/beacon.sh luôn đi qua file này.
const fs = require('fs');
const path = require('path');

const chung = {
  script: 'server.js',
  cwd: __dirname,
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  watch: false,
  // 600M: nhập ZIP có thể tới 1.2 GB. RAM đã ổn định nhờ xử lý theo luồng, nhưng
  // vượt ngưỡng thì pm2 giết máy chủ ĐÚNG LÚC đang ghi đè images/audio và để lại
  // content/ dở dang — biên an toàn quan trọng hơn vài trăm MB RAM. CLAUDE.md §5.9.
  max_memory_restart: '600M',
};

function danhSachBaoTang() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'bao-tang.json'), 'utf8')).baoTang || [];
  } catch {
    return [];
  }
}

const ds = danhSachBaoTang().filter((b) => path.resolve(b.thuMuc) !== __dirname);
const apps = [];
if (!ds.length || fs.existsSync(path.join(__dirname, 'content', 'manifest.json'))) {
  apps.push({ ...chung, name: 'beacon-server', env: { NODE_ENV: 'production' } });
}
for (const b of ds) {
  apps.push({ ...chung, name: `beacon-${b.ma}`, env: { NODE_ENV: 'production', DATA_DIR: path.resolve(b.thuMuc) } });
}

module.exports = { apps };
