// Mọi đường dẫn dữ liệu của MỘT bảo tàng, và nơi nạp .env của nó.
//
// Một bộ mã nguồn chạy được nhiều bảo tàng: mỗi tiến trình đặt DATA_DIR trỏ vào
// thư mục riêng chứa .env, users.json, mail.json, content/, downloads/. Không đặt
// DATA_DIR thì dữ liệu nằm cạnh server.js như trước — máy chủ đang chạy không phải
// đổi gì. Xem NHIEU_BAO_TANG.md và CLAUDE.md §5.24.
//
// LƯU Ý: DATA_DIR phải đến từ môi trường thật (pm2, Docker, dòng lệnh), không đọc
// được từ .env — chính nó quyết định đọc .env nào.
const fs = require('fs');
const path = require('path');

const APP_DIR = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : APP_DIR;

if (!fs.existsSync(DATA_DIR)) {
  console.error(`[paths] DATA_DIR=${DATA_DIR} khong ton tai. Tao bang: node scripts/tao-bao-tang.js`);
  process.exit(1);
}

// Chỉ nạp .env của ĐÚNG bảo tàng này. Nạp thêm .env cạnh server.js là trộn bí mật
// của bảo tàng khác vào (vd JWT_SECRET). dotenv không ghi đè biến đã có, nên biến
// đặt từ pm2/Docker vẫn thắng.
const ENV_PATH = path.join(DATA_DIR, '.env');
require('dotenv').config({ path: ENV_PATH });

module.exports = {
  APP_DIR,
  DATA_DIR,
  ENV_PATH,
  CONTENT_DIR: path.join(DATA_DIR, 'content'),
  DOWNLOADS_DIR: path.join(DATA_DIR, 'downloads'),
  TMP_IMPORT_DIR: path.join(DATA_DIR, 'tmp_import'),
  USERS_PATH: path.join(DATA_DIR, 'users.json'),
  MAIL_CONFIG_PATH: path.join(DATA_DIR, 'mail.json'),
  // Nhật ký thao tác tài khoản — NGOÀI content/, cùng lý do với users.json (accountAudit.js).
  ACCOUNT_AUDIT_PATH: path.join(DATA_DIR, 'account-audit.ndjson'),
  // Thuật ngữ + trạng thái + đơn vị tính của CMS — cmsSettings.js.
  CMS_SETTINGS_PATH: path.join(DATA_DIR, 'cms-settings.json'),
};
