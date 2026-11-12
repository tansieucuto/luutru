// Danh sách máy tham quan (tablet) và lần cuối mỗi máy gửi dữ liệu về.
//
// App không gửi định danh nào khi gọi /version.json hay tải bundle; chỗ DUY NHẤT
// máy tự xưng là trường `device` trong từng dòng của POST /events (một chuỗi ngẫu
// nhiên app tự sinh lần đầu chạy, xem buffering_analytics_sink.dart). Vì vậy
// "máy còn sống" ở đây nghĩa là "máy còn gửi thống kê về" — app gửi một lần mỗi
// chuyến tham quan khi máy về chỗ sạc, nên máy im lặng vài ngày gần như chắc chắn
// là hỏng sạc, mất Wi-Fi, hoặc đã nằm trong ngăn kéo. CLAUDE.md §5.28.
//
// File nằm NGOÀI content/ (cạnh users.json): nhập ZIP và khôi phục sao lưu thay cả
// content/, không được cuốn mất tên máy người quản trị đã đặt.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');

const DEVICES_PATH = path.join(DATA_DIR, 'devices.json');

// POST /events mở cho mọi người (khách không có tài khoản). Không có trần thì ai
// cũng bơm được vô số mã máy giả cho tới khi file phình to. Bảo tàng thật có vài
// chục máy; quá trần thì bỏ qua mã MỚI, máy đã biết vẫn được cập nhật.
const MAX_DEVICES = 300;
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

// Ngưỡng trạng thái. Vàng chứ chưa đỏ ở mức 1–3 ngày: bảo tàng nghỉ một ngày
// trong tuần thì máy im cả ngày là bình thường.
const XANH_MS = 26 * 60 * 60 * 1000;
const VANG_MS = 72 * 60 * 60 * 1000;

let cache = null;

function doc() {
  if (cache) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(DEVICES_PATH, 'utf8'));
    cache = data && typeof data.devices === 'object' && data.devices ? data : { devices: {} };
  } catch {
    cache = { devices: {} };
  }
  return cache;
}

// Ghi file tạm rồi đổi tên: mất điện giữa chừng không để lại file JSON cụt.
function luu() {
  const tmp = `${DEVICES_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DEVICES_PATH);
}

/**
 * Gọi từ POST /events với mọi dòng đã parse (kể cả dòng trùng — máy gửi lại một
 * lô cũ vẫn là bằng chứng máy còn chạy). Lỗi ghi file chỉ báo log, không được
 * làm hỏng việc nhận thống kê.
 */
function ghiNhanLanGui(objs, ip) {
  const theoMay = new Map();
  for (const o of objs) {
    const id = o && typeof o.device === 'string' ? o.device : '';
    if (!ID_RE.test(id)) continue;
    const cur = theoMay.get(id) || { soDong: 0, suKienCuoi: null };
    cur.soDong += 1;
    const at = o.event && typeof o.event.at === 'string' ? o.event.at : null;
    if (at && !Number.isNaN(Date.parse(at)) && (!cur.suKienCuoi || at > cur.suKienCuoi)) cur.suKienCuoi = at;
    theoMay.set(id, cur);
  }
  if (!theoMay.size) return;

  const data = doc();
  const now = new Date().toISOString();
  let doi = false;
  for (const [id, { soDong, suKienCuoi }] of theoMay) {
    let d = data.devices[id];
    if (!d) {
      if (Object.keys(data.devices).length >= MAX_DEVICES) continue;
      d = { ten: '', lanDau: now, soLanGui: 0, soDong: 0, suKienCuoi: null };
      data.devices[id] = d;
    }
    d.lanGuiCuoi = now;
    d.soLanGui += 1;
    d.soDong += soDong;
    // Đồng hồ tablet có thể sai; chỉ nhận mốc không vượt quá giờ máy chủ.
    if (suKienCuoi && suKienCuoi <= now && (!d.suKienCuoi || suKienCuoi > d.suKienCuoi)) d.suKienCuoi = suKienCuoi;
    d.ip = ip || null;
    doi = true;
  }
  if (!doi) return;
  try {
    luu();
  } catch (err) {
    console.error('[thiet-bi] Khong ghi duoc devices.json:', err.message);
  }
}

function trangThai(lanGuiCuoi, now = Date.now()) {
  const t = Date.parse(lanGuiCuoi || '');
  if (Number.isNaN(t)) return 'do';
  const tre = now - t;
  if (tre <= XANH_MS) return 'xanh';
  if (tre <= VANG_MS) return 'vang';
  return 'do';
}

function danhSach() {
  const now = Date.now();
  return Object.entries(doc().devices)
    .map(([id, d]) => ({ id, ...d, trangThai: trangThai(d.lanGuiCuoi, now) }))
    // Máy im lâu nhất lên đầu: đó là thứ người quản trị cần thấy trước.
    .sort((a, b) => String(a.lanGuiCuoi || '').localeCompare(String(b.lanGuiCuoi || '')));
}

function datTen(id, ten) {
  const data = doc();
  if (!data.devices[id]) return false;
  data.devices[id].ten = String(ten || '').trim().slice(0, 60);
  luu();
  return true;
}

// Bỏ máy đã thanh lý khỏi danh sách. Máy đó gửi lại thì sẽ hiện lại như máy mới.
function xoa(id) {
  const data = doc();
  if (!data.devices[id]) return false;
  delete data.devices[id];
  luu();
  return true;
}

module.exports = { ghiNhanLanGui, danhSach, datTen, xoa, trangThai, DEVICES_PATH, XANH_MS, VANG_MS };
