// Cài đặt gửi thư của hệ thống — chỉ vai trò Chủ. CLAUDE.md §5.24.
//
// Giống "Verified identities" của AWS SES: một cấu hình chỉ được lưu và bật SAU KHI mã
// 6 số gửi bằng CHÍNH cấu hình đó đã tới được một hộp thư thật. Sai mật khẩu ứng dụng,
// sai vùng AWS, địa chỉ gửi chưa được nhà cung cấp chấp nhận... đều lộ ra ngay lúc cài,
// không phải đúng hôm có người quên mật khẩu.
//
// LƯU Ý: thư khôi phục mật khẩu của MỌI tài khoản Chủ đi qua cấu hình này. Người trỏ nó
// về máy chủ thư của mình là đọc được mã khôi phục của Chủ khác — nên đổi/tắt đều đòi
// nhập lại mật khẩu, và báo cho các tài khoản Chủ còn lại.
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const authenticateToken = require('../middleware/auth');
const { requireLevel, LEVEL } = authenticateToken;
const users = require('../userStore');
const mailer = require('../mailer');
const { tenHienThi } = require('../tenBaoTang');

const router = express.Router();
router.use(authenticateToken, requireLevel(LEVEL.owner));

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

// Cấu hình đang chờ xác minh, theo từng tài khoản. Chỉ giữ trong bộ nhớ: mật khẩu SMTP
// chưa được chứng minh là đúng thì không ghi xuống đĩa. Máy chủ khởi động lại thì cài lại.
const dangCho = new Map();

// Mỗi lần gửi là một bức thư thật — chặt. Nhập mã thì nới hơn (xem routes/auth.js).
const guiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Gửi thư quá nhiều lần, vui lòng thử lại sau ít phút' }),
});
const nhapLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Quá nhiều lần thử mã, vui lòng thử lại sau ít phút' }),
});

const EMAIL_RE = users.EMAIL_RE;

function nguoiDung(req, res) {
  const u = users.findById(req.userId);
  if (!u) res.status(401).json({ error: 'Tài khoản không còn tồn tại' });
  return u;
}

function dungMatKhau(u, req, res) {
  if (bcrypt.compareSync(String(req.body?.currentPassword || ''), u.passwordHash)) return true;
  res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
  return false;
}

function khoaVaoEnv(res) {
  if (!mailer.laEnv()) return false;
  res.status(409).json({
    error: 'Cấu hình gửi thư đang nằm trong tệp .env của máy chủ. Muốn cài ở đây, kỹ thuật viên phải xóa '
      + 'MAIL_API_KEY và MAIL_FROM khỏi .env rồi khởi động lại máy chủ.',
  });
  return true;
}

router.get('/', (req, res) => {
  const u = nguoiDung(req, res);
  if (!u) return;
  const p = dangCho.get(u.id);
  res.json({
    trangThai: mailer.trangThai(),
    dangCho: p && Date.parse(p.expiresAt) > Date.now()
      ? { guiToi: p.guiToi, provider: p.cfg.provider, lamEmailKhoiPhuc: p.lamEmailKhoiPhuc }
      : null,
    goiYGuiToi: u.recoveryEmail || null,
  });
});

// ---- Bước 1: thử cấu hình mới bằng một bức thư chứa mã 6 số ----
router.post('/xac-minh/gui', guiLimiter, async (req, res) => {
  if (khoaVaoEnv(res)) return;
  const u = nguoiDung(req, res);
  if (!u || !dungMatKhau(u, req, res)) return;
  // CMS chỉ cài được Gmail (quyết định 2026-10-04). mailer vẫn GỬI được bằng cấu hình loại
  // khác đã lưu từ trước hoặc nằm trong .env, để máy chủ đang chạy không bị hỏng.
  if (req.body?.provider !== 'gmail') {
    return res.status(400).json({ error: 'Chỉ cài được gửi thư bằng Gmail.' });
  }

  let cfg;
  try {
    cfg = mailer.chuanHoa(req.body || {}, mailer.docFile());
  } catch (err) {
    if (err instanceof mailer.LoiCauHinh) return res.status(400).json({ error: err.message });
    throw err;
  }
  // Lần cài đầu tiên thường cũng là lúc người đó chưa có email khôi phục — mà đặt email
  // khôi phục lại cần gửi được thư. Cho làm gộp: nhập đúng mã tức là đã chứng minh mở
  // được hộp thư nhận mã, đủ điều kiện như luồng /auth/recovery-email.
  const lamEmailKhoiPhuc = req.body?.lamEmailKhoiPhuc === true;
  const guiToiNhap = String(req.body?.guiToi || '').trim().toLowerCase();
  if (lamEmailKhoiPhuc && !guiToiNhap) {
    return res.status(400).json({ error: 'Nhập email riêng của bạn vào ô "Gửi mã xác minh tới" để dùng làm email khôi phục' });
  }
  const guiToi = guiToiNhap || cfg.from;
  if (!EMAIL_RE.test(guiToi)) return res.status(400).json({ error: 'Địa chỉ nhận mã xác minh không hợp lệ' });

  const code = users.generateCode();
  try {
    await mailer.guiVoi(cfg, {
      to: guiToi,
      subject: `Mã xác minh cài đặt gửi thư: ${code}`,
      text: `Chào ${u.name},\n\n`
        + `Mã xác minh của bạn là: ${code}\n\n`
        + `Nhập mã này vào trang Quản lý tài khoản của ${tenHienThi()} để bật gửi thư qua ${mailer.NHA_CUNG_CAP[cfg.provider]}.\n`
        + 'Nhận được thư này nghĩa là cấu hình đã gửi thư được. Mã có hiệu lực trong 10 phút.\n\n'
        + 'Nếu bạn không yêu cầu việc này, hãy bỏ qua thư.',
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }

  dangCho.set(u.id, {
    cfg, guiToi, lamEmailKhoiPhuc, codeHash: users.hashCode(code), attempts: 0,
    expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  res.json({ ok: true, guiToi, expiresInMinutes: CODE_TTL_MS / 60000 });
});

// ---- Bước 2: nhập mã → lưu và bật cấu hình ----
router.post('/xac-minh', nhapLimiter, (req, res) => {
  if (khoaVaoEnv(res)) return;
  const u = nguoiDung(req, res);
  if (!u) return;
  const p = dangCho.get(u.id);
  if (!p || Date.parse(p.expiresAt) < Date.now()) {
    dangCho.delete(u.id);
    return res.status(410).json({ error: 'Mã đã hết hạn. Hãy bấm "Gửi mã xác minh" lại.' });
  }
  if (!users.checkCode(String(req.body?.code || '').trim(), p.codeHash)) {
    p.attempts += 1;
    if (p.attempts >= MAX_CODE_ATTEMPTS) {
      dangCho.delete(u.id);
      return res.status(429).json({ error: 'Sai mã quá nhiều lần. Hãy bấm "Gửi mã xác minh" lại.' });
    }
    return res.status(400).json({ error: `Mã không đúng. Còn ${MAX_CODE_ATTEMPTS - p.attempts} lần thử.` });
  }

  try {
    mailer.luu(p.cfg, { verifiedBy: u.login, verifiedTo: p.guiToi });
  } catch (err) {
    console.error('[mail] khong ghi duoc mail.json:', err.message);
    return res.status(500).json({ error: 'Không ghi được cài đặt lên máy chủ' });
  }
  dangCho.delete(u.id);

  let recoveryEmail = null;
  if (p.lamEmailKhoiPhuc) {
    recoveryEmail = p.guiToi;
    users.update(u.id, { recoveryEmail, recoveryEmailAt: new Date().toISOString(), pendingEmail: null });
  }

  mailer.baoChoChuKhac(u.id, `${tenHienThi()}: cài đặt gửi thư vừa được thay đổi`,
    `Tài khoản Chủ "${u.name}" (${u.login}) vừa đổi cài đặt gửi thư sang ${mailer.NHA_CUNG_CAP[p.cfg.provider]}, `
    + `gửi từ ${p.cfg.from}.\n`
    + (recoveryEmail ? `Cùng lúc đặt email khôi phục của mình là ${users.maskEmail(recoveryEmail)}.\n` : '')
    + '\nMã quên mật khẩu của mọi tài khoản Chủ đi qua cài đặt này. Nếu đây không phải việc do người đó tự làm, '
    + 'hãy khóa tài khoản đó ngay trong mục Quản lý tài khoản.');
  res.json({ ok: true, trangThai: mailer.trangThai(), recoveryEmail });
});

// ---- Gửi một thư thử bằng cấu hình đang dùng ----
router.post('/thu', guiLimiter, async (req, res) => {
  const u = nguoiDung(req, res);
  if (!u) return;
  if (!mailer.isConfigured()) return res.status(409).json({ error: mailer.configHint() });
  const to = String(req.body?.to || '').trim().toLowerCase() || u.recoveryEmail || mailer.trangThai().from;
  if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'Địa chỉ nhận không hợp lệ' });
  try {
    await mailer.sendMail({
      to,
      subject: `Thư thử từ ${tenHienThi()}`,
      text: `Chào ${u.name},\n\nĐây là thư thử. Nhận được nó nghĩa là máy chủ đang gửi thư bình thường — `
        + 'mã quên mật khẩu sẽ tới được hộp thư.\n',
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
  res.json({ ok: true, to });
});

// ---- Tắt gửi thư ----
router.delete('/', (req, res) => {
  if (khoaVaoEnv(res)) return;
  const u = nguoiDung(req, res);
  if (!u || !dungMatKhau(u, req, res)) return;
  // Báo TRƯỚC khi xóa — xóa rồi thì không còn đường nào gửi thư báo.
  mailer.baoChoChuKhac(u.id, `${tenHienThi()}: gửi thư của hệ thống vừa bị TẮT`,
    `Tài khoản Chủ "${u.name}" (${u.login}) vừa tắt gửi thư của hệ thống.\n`
    + 'Từ giờ "Quên mật khẩu" bằng email không dùng được — quên mật khẩu thì phải nhờ một tài khoản Chủ khác đặt lại.');
  mailer.xoa();
  dangCho.delete(u.id);
  res.json({ ok: true });
});

module.exports = router;
