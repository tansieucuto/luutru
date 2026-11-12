// Gửi thư của hệ thống: mã xác minh email khôi phục, mã quên mật khẩu, thư báo cho các
// tài khoản Chủ khác. Thiết kế: CLAUDE.md §5.17 và §5.24.
//
// Cấu hình lấy từ MỘT trong hai nguồn, theo thứ tự:
//   1. .env — MAIL_API_KEY + MAIL_FROM (Brevo), kiểu cũ, vẫn chạy. Có thì CMS chỉ hiện
//      chứ không cho sửa.
//   2. mail.json trong DATA_DIR — Chủ cài trên trang Quản lý tài khoản. Chỉ được ghi SAU
//      KHI một thư thật gửi bằng chính cấu hình đó đã tới hộp thư (routes/adminMail.js).
// Không có nguồn nào thì tính năng tắt: isConfigured() trả false và giao diện nói rõ —
// thà báo "chưa cài" còn hơn một cơ chế khôi phục hỏng mà không ai biết.
//
// LƯU Ý: mail.json chứa mật khẩu SMTP / khóa API — quyền 600, không bao giờ trả về
// trình duyệt (xem trangThai()).
const fs = require('fs');
const smtp = require('./smtp');
const { MAIL_CONFIG_PATH } = require('./paths');
const { tenHienThi } = require('./tenBaoTang');

const NHA_CUNG_CAP = {
  ses: 'Amazon SES',
  gmail: 'Gmail',
  smtp: 'Máy chủ SMTP khác',
  brevo: 'Brevo',
};
// 465/2465: TLS ngay từ đầu. 587/2587: STARTTLS. Không nhận cổng 25: đa số VPS chặn,
// và không bắt buộc mã hóa.
const CONG_SMTP = [465, 587, 2465, 2587];
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const TIMEOUT_MS = 20000;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

class LoiCauHinh extends Error {}
const motDong = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

// ---------- Nguồn cấu hình ----------

function tuEnv() {
  const apiKey = process.env.MAIL_API_KEY || '';
  const from = process.env.MAIL_FROM || '';
  if (!apiKey && !from) return null;
  return {
    nguon: 'env', provider: 'brevo', apiKey, from,
    fromName: process.env.MAIL_FROM_NAME || '',
    apiUrl: process.env.MAIL_API_URL || BREVO_URL,
  };
}

// Bản thô trong file, kể cả bí mật. Chỉ dùng phía máy chủ.
function docFile() {
  try {
    return JSON.parse(fs.readFileSync(MAIL_CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function cauHinh() {
  const env = tuEnv();
  if (env) return env.apiKey && env.from ? env : null;
  const f = docFile();
  return f && f.verifiedAt ? { ...f, nguon: 'file' } : null;
}

function isConfigured() {
  return Boolean(cauHinh());
}

// Lý do chưa gửi được thư — hiện thẳng trên trang Quản lý tài khoản.
function configHint() {
  if (isConfigured()) return null;
  const env = tuEnv();
  if (env) {
    const thieu = [!env.apiKey && 'MAIL_API_KEY', !env.from && 'MAIL_FROM'].filter(Boolean);
    return `Cấu hình gửi thư trong .env của máy chủ còn thiếu ${thieu.join(' và ')}.`;
  }
  return 'Chưa cài đặt gửi thư. Hãy cài ở ô "Gửi thư của hệ thống" ngay phía trên.';
}

// Bản an toàn để gửi ra trình duyệt: không mật khẩu, không khóa API.
function trangThai() {
  const env = tuEnv();
  const c = env || docFile();
  if (!c) return { nguon: null };
  const che = (s) => (s && s.length > 8 ? `${s.slice(0, 4)}•••${s.slice(-4)}` : s ? '•••' : '');
  return {
    nguon: env ? 'env' : 'file',
    daBat: isConfigured(),
    provider: c.provider,
    nhan: NHA_CUNG_CAP[c.provider] || c.provider,
    from: c.from || '',
    fromName: c.fromName || '',
    tenMacDinh: tenHienThi(),
    host: c.host || null,
    port: c.port || null,
    region: c.region || null,
    // Gmail: tên đăng nhập chính là địa chỉ gửi. SES: là mã khóa, che bớt.
    user: c.provider === 'ses' ? che(c.user) : (c.user || null),
    verifiedAt: c.verifiedAt || null,
    verifiedBy: c.verifiedBy || null,
    verifiedTo: c.verifiedTo || null,
  };
}

// ---------- Kiểm tra dữ liệu Chủ nhập vào ----------

/**
 * Chuẩn hóa + kiểm tra cấu hình. `cu` là cấu hình đang lưu: ô mật khẩu để trống thì
 * dùng lại bí mật cũ — nhưng CHỈ khi cùng nhà cung cấp, cùng máy chủ, cùng tài khoản.
 * LƯU Ý: đổi máy chủ mà vẫn tái dùng mật khẩu cũ là gửi mật khẩu đó tới một máy lạ.
 */
function chuanHoa(input = {}, cu = null) {
  const provider = String(input.provider || '');
  if (!NHA_CUNG_CAP[provider]) throw new LoiCauHinh('Chưa chọn cách gửi thư');
  const from = String(input.from || '').trim().toLowerCase();
  if (!EMAIL_RE.test(from)) throw new LoiCauHinh('Địa chỉ gửi không hợp lệ');
  const cfg = { provider, from, fromName: motDong(input.fromName).slice(0, 80) };

  if (provider === 'gmail') {
    cfg.host = 'smtp.gmail.com';
    cfg.port = 465;
    cfg.user = from; // Gmail chỉ cho gửi đúng từ tài khoản đã đăng nhập
  } else if (provider === 'ses') {
    const region = String(input.region || '').trim().toLowerCase();
    if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) throw new LoiCauHinh('Vùng AWS không hợp lệ (vd ap-southeast-1)');
    cfg.region = region;
    cfg.host = `email-smtp.${region}.amazonaws.com`;
    cfg.port = 465;
    cfg.user = String(input.user || '').trim();
    if (!cfg.user) throw new LoiCauHinh('Chưa nhập tên đăng nhập SMTP của Amazon SES');
  } else if (provider === 'smtp') {
    const host = String(input.host || '').trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
      throw new LoiCauHinh('Tên máy chủ SMTP không hợp lệ (vd smtp.tenmien.vn)');
    }
    const port = Number(input.port);
    if (!CONG_SMTP.includes(port)) throw new LoiCauHinh(`Cổng phải là một trong ${CONG_SMTP.join(', ')}`);
    cfg.host = host;
    cfg.port = port;
    cfg.user = String(input.user || '').trim();
  }

  const cungTaiKhoan = cu && cu.provider === provider
    && (provider === 'brevo' || (cu.host === cfg.host && cu.user === cfg.user));
  const biMat = (ten) => String(input[ten] ?? '').trim() || (cungTaiKhoan && cu[ten]) || '';

  if (provider === 'brevo') {
    cfg.apiKey = biMat('apiKey');
    if (!cfg.apiKey) throw new LoiCauHinh('Chưa nhập khóa API của Brevo');
  } else {
    // Google hiện mật khẩu ứng dụng thành 4 nhóm cách nhau — bỏ khoảng trắng cho tiện dán.
    cfg.pass = provider === 'gmail' ? biMat('pass').replace(/\s+/g, '') : biMat('pass');
    if (provider === 'gmail' && !cfg.pass) throw new LoiCauHinh('Chưa nhập mật khẩu ứng dụng của Gmail');
    if (provider === 'ses' && !cfg.pass) throw new LoiCauHinh('Chưa nhập mật khẩu SMTP của Amazon SES');
    if (provider === 'smtp' && Boolean(cfg.user) !== Boolean(cfg.pass)) {
      throw new LoiCauHinh('Tên đăng nhập và mật khẩu SMTP phải điền cả hai, hoặc để trống cả hai');
    }
  }
  return cfg;
}

// ---------- Lưu / xóa ----------

function luu(cfg, { verifiedBy, verifiedTo }) {
  const data = { ...cfg, verifiedAt: new Date().toISOString(), verifiedBy, verifiedTo };
  delete data.nguon;
  const tmp = `${MAIL_CONFIG_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, MAIL_CONFIG_PATH);
}

function xoa() {
  fs.rmSync(MAIL_CONFIG_PATH, { force: true });
}

// ---------- Gửi ----------

// Câu lỗi người không rành kỹ thuật đọc được VÀ biết phải sửa ở đâu. Chi tiết kỹ thuật
// chỉ ghi vào nhật ký máy chủ.
function loiDeHieu(e, cfg) {
  const ten = NHA_CUNG_CAP[cfg.provider];
  const ct = String(e.chiTiet || '');
  switch (e.buoc) {
    case 'ket-noi':
    case 'het-gio':
      return `Không kết nối được tới máy chủ thư ${cfg.host}:${cfg.port}. Kiểm tra tên máy chủ và cổng; `
        + 'một số nhà cung cấp VPS chặn cổng gửi thư — hãy hỏi họ mở cổng 465 hoặc 587.';
    case 'tls':
    case 'starttls':
      return `Máy chủ thư ${cfg.host} không hỗ trợ kết nối mã hóa an toàn, nên không thể gửi mật khẩu qua đó.`;
    case 'đăng nhập':
      if (cfg.provider === 'gmail') {
        return 'Gmail từ chối đăng nhập. Phải dùng MẬT KHẨU ỨNG DỤNG 16 ký tự (tạo ở myaccount.google.com/apppasswords, '
          + 'cần bật xác minh 2 bước), không phải mật khẩu Gmail thường.';
      }
      if (cfg.provider === 'ses') {
        return 'Amazon SES từ chối tên đăng nhập/mật khẩu SMTP. Đó phải là "SMTP credentials" tạo trong trang SES '
          + '(không phải Access key của IAM), và đúng vùng đã chọn.';
      }
      return `${ten} từ chối tên đăng nhập hoặc mật khẩu.`;
    case 'địa chỉ gửi':
      return cfg.provider === 'ses'
        ? `Amazon SES chưa cho gửi từ ${cfg.from}. Vào SES → Verified identities và xác minh địa chỉ (hoặc tên miền) này trước.`
        : `Máy chủ thư không cho gửi từ địa chỉ ${cfg.from}.`;
    case 'địa chỉ nhận':
      return cfg.provider === 'ses'
        ? 'Amazon SES từ chối địa chỉ nhận. Tài khoản SES mới ở chế độ "sandbox" chỉ gửi được tới địa chỉ đã xác minh — '
          + 'xác minh luôn địa chỉ nhận trong SES, hoặc xin AWS cho ra khỏi sandbox.'
        : 'Máy chủ thư từ chối địa chỉ nhận. Kiểm tra lại địa chỉ.';
    case 'gửi nội dung':
      if (cfg.provider === 'ses' && /not verified/i.test(ct)) {
        return 'Amazon SES từ chối vì có địa chỉ chưa được xác minh. Nếu tài khoản SES còn ở chế độ "sandbox" thì '
          + `cả ${cfg.from} lẫn địa chỉ nhận đều phải nằm trong Verified identities.`;
      }
      return `${ten} không nhận bức thư (mã ${e.smtpCode}). Thử lại sau ít phút.`;
    default:
      return `${ten} không gửi được thư lúc này. Thử lại sau ít phút.`;
  }
}

async function guiBrevo(cfg, { to, subject, text }, fromName) {
  let res;
  try {
    res = await fetch(cfg.apiUrl || BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: fromName, email: cfg.from }, to: [{ email: to }], subject, textContent: text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    console.error('[mail] khong goi duoc Brevo:', err.message);
    throw new Error('Không kết nối được tới Brevo. Thử lại sau ít phút.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[mail] Brevo tra ve ${res.status}: ${body.slice(0, 400)}`);
    if (res.status === 401) throw new Error('Brevo từ chối khóa API (sai hoặc đã hết hạn).');
    if (/sender/i.test(body)) throw new Error(`Brevo chưa cho gửi từ ${cfg.from}. Vào Brevo → Senders và xác minh địa chỉ này.`);
    throw new Error('Brevo không gửi được thư lúc này. Thử lại sau ít phút.');
  }
}

/** Gửi bằng một cấu hình cụ thể (kể cả cấu hình CHƯA lưu — dùng lúc xác minh). */
async function guiVoi(cfg, { to, subject, text }) {
  const fromName = cfg.fromName || tenHienThi();
  if (cfg.provider === 'brevo') return guiBrevo(cfg, { to, subject, text }, fromName);
  try {
    await smtp.gui(cfg, { from: cfg.from, fromName, to, subject, text }, { timeoutMs: TIMEOUT_MS });
  } catch (e) {
    console.error(`[mail] SMTP ${cfg.host}:${cfg.port} loi o buoc "${e.buoc}": ${e.message} ${e.chiTiet || ''}`);
    throw new Error(e instanceof smtp.LoiSmtp ? loiDeHieu(e, cfg) : 'Không gửi được thư lúc này.');
  }
}

async function sendMail(thu) {
  const cfg = cauHinh();
  if (!cfg) throw new Error(configHint());
  return guiVoi(cfg, thu);
}

// Báo cho các tài khoản Chủ CÒN LẠI khi có thay đổi nhạy cảm. Gửi ngầm: lỗi gửi thư
// không được làm hỏng thao tác chính. Cấu hình được chốt NGAY lúc gọi, nên gọi xong
// rồi tắt gửi thư thì các thư này vẫn đi.
function baoChoChuKhac(exceptId, subject, text) {
  const cfg = cauHinh();
  if (!cfg) return;
  const users = require('./userStore');
  for (const u of users.readAll()) {
    if (u.id === exceptId || u.role !== 'owner' || u.locked || !u.recoveryEmail) continue;
    guiVoi(cfg, { to: u.recoveryEmail, subject, text })
      .catch((err) => console.error('[mail] khong bao duoc cho tai khoan Chu khac:', err.message));
  }
}

module.exports = {
  NHA_CUNG_CAP,
  LoiCauHinh,
  isConfigured,
  configHint,
  trangThai,
  docFile,
  chuanHoa,
  luu,
  xoa,
  guiVoi,
  sendMail,
  baoChoChuKhac,
  laEnv: () => Boolean(tuEnv()),
};
