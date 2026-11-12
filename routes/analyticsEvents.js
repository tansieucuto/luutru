// POST /events ở gốc domain — nhận dữ liệu thống kê từ app (NDJSON; app gửi một
// lần mỗi chuyến tham quan khi máy về chỗ sạc, xem analytics_uploader.dart).
// Ghi vào content/.analytics/events-YYYY-MM.ndjson.
const express = require('express');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const rateLimit = require('express-rate-limit');
const { CONTENT_DIR } = require('../paths');
const thietBi = require('../thietBi');

const router = express.Router();

const ANALYTICS_LOG_DIR = path.join(CONTENT_DIR, '.analytics');
// File từ trước khi chia theo tháng — vẫn đọc để không mất số liệu cũ.
const LEGACY_LOG_FILE = path.join(ANALYTICS_LOG_DIR, 'events.ndjson');

// ==================== CHIA FILE THEO THÁNG ====================
// Mỗi tháng một file: khởi động không phải đọc cả lịch sử, bộ khóa chống trùng
// chỉ giữ 2 tháng (không phình vô hạn), và tab Thống kê chỉ đọc đúng các tháng
// cần. CLAUDE.md §5.15.
function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function logFileFor(key) {
  return path.join(ANALYTICS_LOG_DIR, `events-${key}.ndjson`);
}

// Trần dung lượng mỗi file tháng — lưới an toàn cuối (giới hạn tần suất bên
// dưới mới là chốt chính). Dùng thật khoảng 37 MB/tháng cho 20 máy.
const MAX_MONTH_BYTES = 200 * 1024 * 1024;

// ==================== CHỐNG TRÙNG ====================
// App gửi theo kiểu "ít nhất một lần": mất mạng sau khi máy chủ đã lưu thì app
// vẫn coi là thất bại và gửi lại nguyên lô. Phải chống trùng khi ghi, không thì
// thống kê bị thổi phồng.
//
// Chỉ giữ khóa của tháng này và tháng trước. Đánh đổi đã chấp nhận: sự kiện gửi
// lại muộn hơn một tháng có thể bị đếm hai lần (thực tế gần như không xảy ra).
let seenKeys = null;        // Set khóa đã nạp
let seenKeysMonth = null;   // tháng mà bộ khóa đang phục vụ
let seenKeysLoading = null; // Promise — các request đầu tiên dùng chung một lần nạp

function dedupeKey(obj) {
  const e = (obj && obj.event) || {};
  return [
    String(obj?.device || ''),
    String(e.sessionId || ''),
    String(e.name || ''),
    String(e.at || ''),
  ].join('|');
}

// Đọc theo luồng (readline) thay vì readFileSync: file lớn nạp nguyên vào chuỗi
// sẽ chặn cả máy chủ và có thể vượt giới hạn chuỗi của V8.
async function collectKeysFromFile(file, keys) {
  if (!fs.existsSync(file)) return;
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      keys.add(dedupeKey(JSON.parse(trimmed)));
    } catch {
      // Dòng hỏng thì bỏ qua, không chặn các dòng còn lại.
    }
  }
}

function previousMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

async function ensureSeenKeys(nowKey) {
  if (seenKeys && seenKeysMonth === nowKey) return seenKeys;
  if (seenKeysLoading && seenKeysMonth === nowKey) return seenKeysLoading;
  seenKeysMonth = nowKey;
  seenKeysLoading = (async () => {
    const keys = new Set();
    await collectKeysFromFile(logFileFor(nowKey), keys);
    await collectKeysFromFile(logFileFor(previousMonthKey(nowKey)), keys);
    // File từ trước khi chia theo tháng — đọc thêm để không nhận trùng.
    await collectKeysFromFile(LEGACY_LOG_FILE, keys);
    seenKeys = keys;
    return keys;
  })();
  return seenKeysLoading;
}

// ==================== GIỚI HẠN TẦN SUẤT ====================
// Route bắt buộc phải mở (khách không có tài khoản), nhưng mở không giới hạn thì
// ai cũng bơm được dữ liệu tới đầy đĩa — mà đĩa đầy sẽ làm hỏng giữa chừng thao
// tác nhập ZIP hay đóng gói.
//
// 60 lần / 15 phút / IP: app chỉ gửi một lần mỗi chuyến, nhưng cả bảo tàng
// thường ra Internet qua cùng một IP và nhiều máy về chỗ sạc cùng lúc lúc đóng
// cửa. Đừng hạ con số này khi chưa đọc CLAUDE.md §5.15.
const eventsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  // Trả 429 để app giữ lại lô dữ liệu và gửi lại sau — không mất dữ liệu.
  message: { error: 'Gửi quá nhiều, thử lại sau' },
});

router.post('/events', eventsLimiter, express.text({ type: '*/*', limit: '2mb' }), async (req, res) => {
  try {
    const nowKey = monthKey(new Date());
    const logFile = logFileFor(nowKey);
    const keys = await ensureSeenKeys(nowKey);

    // Lưới an toàn cuối: file tháng này đã quá trần thì ngừng ghi. Trả 204 (không
    // phải lỗi) để app coi là đã nhận và không gửi lại mãi.
    let currentSize = 0;
    try {
      currentSize = fs.statSync(logFile).size;
    } catch {
      // Chưa có file tháng này — kích thước 0.
    }
    if (currentSize >= MAX_MONTH_BYTES) {
      console.warn(`[analytics] File ${path.basename(logFile)} da vuot ${MAX_MONTH_BYTES} byte - tam ngung ghi cho toi thang sau.`);
      res.status(204).end();
      return;
    }

    const body = typeof req.body === 'string' ? req.body : '';
    const newLines = [];
    const moiDong = [];
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue; // Dòng sai định dạng JSON — bỏ qua, không làm hỏng cả request.
      }
      moiDong.push(obj);
      const key = dedupeKey(obj);
      if (keys.has(key)) continue; // Đã nhận rồi (app gửi lại vì tưởng thất bại).
      keys.add(key);
      newLines.push(trimmed);
    }
    if (newLines.length) {
      fs.mkdirSync(ANALYTICS_LOG_DIR, { recursive: true });
      fs.appendFileSync(logFile, newLines.join('\n') + '\n');
    }
    // Tính cả dòng trùng: máy gửi lại lô cũ vẫn là bằng chứng máy còn chạy.
    thietBi.ghiNhanLanGui(moiDong, req.ip ? String(req.ip).replace(/^::ffff:/, '') : null);
    res.status(204).end();
  } catch (err) {
    console.error('Loi ghi nhan analytics events:', err);
    res.status(500).json({ error: 'Không thể ghi nhận dữ liệu' });
  }
});

module.exports = router;
module.exports.ANALYTICS_LOG_DIR = ANALYTICS_LOG_DIR;
module.exports.LEGACY_LOG_FILE = LEGACY_LOG_FILE;
module.exports.monthKey = monthKey;
module.exports.logFileFor = logFileFor;
