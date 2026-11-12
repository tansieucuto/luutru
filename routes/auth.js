// Đăng nhập (mật khẩu + mã 6 số), đổi mật khẩu, email khôi phục, mã xác thực 2 lớp
// và quên mật khẩu — mọi thứ dưới /api/v1/auth. Thiết kế: CLAUDE.md §5.16–5.20.
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const authenticateToken = require('../middleware/auth');
const { requireLevel, LEVEL } = authenticateToken;
const users = require('../userStore');
const nhatKy = require('../accountAudit');
const mailer = require('../mailer');
const totp = require('../totp');
const QRCode = require('qrcode-svg');
const { tenHienThi } = require('../tenBaoTang');

const router = express.Router();

const TOKEN_TTL_ADMIN = '8h';
// Vé tạm giữa bước mật khẩu và bước mã 6 số — ngắn hạn, vì người giữ vé đã qua được
// lớp mật khẩu.
const MFA_TICKET_TTL = '5m';

// Chống dò mật khẩu: tối đa 10 lần đăng nhập THẤT BẠI / 15 phút / IP. Đăng nhập
// thành công không bị tính, nên nhiều người cùng mạng bảo tàng không bị khóa oan.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    res.status(429).json({ error: 'Quá nhiều lần đăng nhập thất bại, vui lòng thử lại sau ít phút' });
  },
});

// Đăng nhập bằng tài khoản trong users.json (mỗi tài khoản một vai trò).
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Thiếu tên đăng nhập hoặc mật khẩu' });
  }

  // Lần chạy đầu tiên: tự tạo tài khoản Chủ từ .env (xem userStore.ensureBootstrap).
  users.ensureBootstrap();

  const user = users.findByLogin(username);
  // So mật khẩu kể cả khi không có tài khoản (với một hash giả) để thời gian phản hồi
  // không lộ tên đăng nhập nào tồn tại.
  const hash = user ? user.passwordHash : '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const ok = bcrypt.compareSync(password, hash);

  if (!user || !ok) {
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  }
  if (user.locked) {
    return res.status(403).json({ error: 'Tài khoản này đã bị khóa. Liên hệ quản lý để mở khóa.' });
  }

  // ---- Bước 2: mã 6 số, nếu tài khoản đã bật ----
  // Chưa cấp token thật: chỉ cấp vé tạm (purpose: 'mfa') sống 5 phút, mà
  // middleware/auth.js không chấp nhận — không dùng được ở route nào khác.
  if (users.coTotp(user)) {
    const mfaToken = jwt.sign(
      { user_id: user.id, purpose: 'mfa' },
      process.env.JWT_SECRET,
      { expiresIn: MFA_TICKET_TTL }
    );
    return res.json({
      mfaRequired: true,
      mfaToken,
      name: user.name,
      expiresInSeconds: 300,
    });
  }

  res.json(capTokenThat(user));
});

// Cấp token thật và ghi lần đăng nhập — dùng chung cho cả hai đường.
function capTokenThat(user) {
  users.touchLogin(user.id);
  const token = jwt.sign(
    { sub: user.login, user_id: user.id, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL_ADMIN }
  );
  return {
    token,
    role: user.role,
    roleLabel: users.ROLE_LABEL[user.role],
    name: user.name,
    expiresIn: TOKEN_TTL_ADMIN,
  };
}

// ---- Bước 2 của đăng nhập: đổi vé tạm + mã 6 số lấy token thật ----
const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20, // rộng hơn /login vì gõ nhầm mã là chuyện thường
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Quá nhiều lần nhập mã sai, vui lòng thử lại sau ít phút' }),
});

router.post('/login/mfa', mfaLimiter, (req, res) => {
  const { mfaToken, code } = req.body || {};
  if (!mfaToken || !code) return res.status(400).json({ error: 'Thiếu mã xác thực' });

  let payload;
  try {
    payload = jwt.verify(mfaToken, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Phiên đăng nhập đã quá hạn, vui lòng nhập lại mật khẩu' });
  }
  // LƯU Ý: bắt buộc kiểm purpose — thiếu dòng này thì một token đăng nhập thật
  // (8 giờ) cũng dùng được ở đây để xin token mới vô hạn.
  if (payload.purpose !== 'mfa') return res.status(401).json({ error: 'Vé đăng nhập không hợp lệ' });

  const user = users.findById(payload.user_id);
  if (!user || user.locked) return res.status(401).json({ error: 'Tài khoản không dùng được' });
  if (!users.coTotp(user)) return res.status(400).json({ error: 'Tài khoản này chưa bật mã xác thực' });

  const step = totp.verify(user.totpSecret, code);
  if (step === null) return res.status(401).json({ error: 'Mã xác thực không đúng. Kiểm tra lại đồng hồ điện thoại nếu sai nhiều lần.' });

  // Chống dùng lại: mỗi mã sống 30 giây, đủ để người nhìn trộm gửi lại y nguyên.
  if (users.daDungMa(user, step)) {
    return res.status(401).json({ error: 'Mã này vừa được dùng rồi. Hãy đợi mã mới trên điện thoại.' });
  }
  users.markTotpUsed(user.id, step);

  res.json(capTokenThat(users.findById(user.id)));
});

// Thông tin của chính người đang đăng nhập — trang quản trị dùng để ẩn/hiện chức năng.
router.get('/me', authenticateToken, (req, res) => {
  const user = users.findById(req.userId);
  if (!user) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });
  if (user.locked) return res.status(403).json({ error: 'Tài khoản đã bị khóa' });
  res.json({
    ...users.publicView(user),
    // Địa chỉ đầy đủ chỉ trả cho chính chủ tài khoản; danh sách tài khoản không có.
    recoveryEmail: user.recoveryEmail || null,
    pendingRecoveryEmail: user.pendingEmail?.email || null,
    mailConfigured: mailer.isConfigured(),
    mailHint: mailer.configHint(),
    totpEnabled: users.coTotp(user),
    totpEnabledAt: user.totpEnabledAt || null,
    // Chỉ trả cho CHÍNH chủ tài khoản — xem PUT /admin/users/:id/identity.
    thongBaoDoiTen: user.thongBaoDoiTen || null,
  });
});

// Bấm "Đã hiểu" trên thông báo đổi tên đăng nhập. Chỉ xóa thông báo của chính mình.
router.post('/me/da-doc-thong-bao', authenticateToken, (req, res) => {
  try {
    users.update(req.userId, { thongBaoDoiTen: null });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Không ghi được file tài khoản trên server' });
  }
});

const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Quá nhiều lần thử, vui lòng thử lại sau ít phút' });
  },
});

// Đổi mật khẩu CỦA CHÍNH MÌNH — mọi vai trò.
router.put('/password', authenticateToken, changePasswordLimiter, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Thiếu mật khẩu hiện tại hoặc mật khẩu mới' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 8 ký tự' });
  }

  const user = users.findById(req.userId);
  if (!user) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });
  if (!bcrypt.compareSync(currentPassword, user.passwordHash)) {
    return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
  }

  try {
    // Cắt MỌI phiên, kể cả phiên đang dùng: giao diện đưa người dùng về trang đăng
    // nhập ngay sau khi đổi, phiên cũ (máy khác, tab khác, nút Back) không còn dùng được.
    users.setPassword(user.id, newPassword);
  } catch (err) {
    return res.status(500).json({ error: 'Không ghi được file tài khoản trên server' });
  }
  nhatKy.ghi({ req, action: 'password.self-change', target: user });
  res.json({ ok: true });
});

// ============================================================================
// EMAIL KHÔI PHỤC — CHỈ TÀI KHOẢN CHỦ
// ============================================================================
// Chỉ cứu một tình huống: người làm Chủ quên mật khẩu của chính mình. Nhân viên
// quên thì Chủ đặt lại giúp, nên hệ thống không giữ email của nhân viên.
//
// LƯU Ý: email gắn với CON NGƯỜI, không gắn với chức vụ. Đổi người quản lý thì tạo
// tài khoản Chủ mới và khóa tài khoản cũ — nếu dùng chung, người đã nghỉ vẫn "quên
// mật khẩu" để vào lại được. CLAUDE.md §5.17.

const CODE_TTL_MS = 10 * 60 * 1000;   // mã sống 10 phút
const MAX_CODE_ATTEMPTS = 5;          // sai 5 lần thì hủy mã, phải xin mã khác
const RESEND_COOLDOWN_MS = 60 * 1000; // trong 1 phút không gửi lại mã mới

function hetHan(obj) {
  return !obj || !obj.expiresAt || Date.parse(obj.expiresAt) < Date.now();
}

// Báo cho các tài khoản Chủ CÒN LẠI khi có thay đổi nhạy cảm (đổi email khôi phục,
// đặt lại mật khẩu, bật/tắt mã) — xem mailer.baoChoChuKhac.
const { baoChoChuKhac } = mailer;

// LƯU Ý: HAI giới hạn tách riêng, đừng gộp. Gửi mã phải chặt (mỗi lần là một bức
// thư thật). Nhập mã thì nới hơn: một lần lấy lại mật khẩu có thể gõ nhầm vài lần,
// gộp chung bộ đếm là người dùng kẹt giữa chừng. Mỗi mã đã tự hủy sau 5 lần sai
// (MAX_CODE_ATTEMPTS), nên ở đây chỉ cần chặn máy dò tự động.
const sendCodeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Quá nhiều lần gửi mã, vui lòng thử lại sau ít phút' }),
});

const checkCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Quá nhiều lần thử mã, vui lòng thử lại sau ít phút' }),
});

// ---- Đặt / đổi email khôi phục (đang đăng nhập, vai trò Chủ) ----
// Bắt nhập lại mật khẩu: nếu không, ai ngồi vào máy đang mở sẵn trang quản trị có
// thể trỏ đường khôi phục về hộp thư của họ.
router.post('/recovery-email', authenticateToken, requireLevel(LEVEL.owner), sendCodeLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const currentPassword = String(req.body?.currentPassword || '');

  if (!users.EMAIL_RE.test(email)) return res.status(400).json({ error: 'Địa chỉ email không hợp lệ' });
  if (!mailer.isConfigured()) return res.status(503).json({ error: mailer.configHint() });

  const user = users.findById(req.userId);
  if (!user) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });
  if (!bcrypt.compareSync(currentPassword, user.passwordHash)) {
    return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
  }

  const code = users.generateCode();
  try {
    await mailer.sendMail({
      to: email,
      subject: `Mã xác minh email khôi phục ${tenHienThi()}: ${code}`,
      text: `Chào ${user.name},\n\n`
        + `Mã xác minh của bạn là: ${code}\n\n`
        + `Nhập mã này vào trang Quản lý tài khoản để hoàn tất việc đặt email khôi phục.\n`
        + `Mã có hiệu lực trong 10 phút.\n\n`
        + `Nếu bạn không yêu cầu việc này, hãy bỏ qua thư và đổi mật khẩu tài khoản ${tenHienThi()} của bạn ngay.`,
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }

  users.update(user.id, {
    pendingEmail: { email, codeHash: users.hashCode(code), expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(), attempts: 0 },
  });
  res.json({ ok: true, email, expiresInMinutes: CODE_TTL_MS / 60000 });
});

// ---- Xác minh mã để kích hoạt email khôi phục ----
router.post('/recovery-email/verify', authenticateToken, requireLevel(LEVEL.owner), checkCodeLimiter, (req, res) => {
  const code = String(req.body?.code || '').trim();
  const user = users.findById(req.userId);
  if (!user) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });

  const pending = user.pendingEmail;
  if (hetHan(pending)) {
    users.update(user.id, { pendingEmail: null });
    return res.status(410).json({ error: 'Mã đã hết hạn. Hãy nhập lại địa chỉ email để nhận mã mới.' });
  }
  if (!users.checkCode(code, pending.codeHash)) {
    const attempts = (pending.attempts || 0) + 1;
    if (attempts >= MAX_CODE_ATTEMPTS) {
      users.update(user.id, { pendingEmail: null });
      return res.status(429).json({ error: 'Sai mã quá nhiều lần. Hãy nhập lại địa chỉ email để nhận mã mới.' });
    }
    users.update(user.id, { pendingEmail: { ...pending, attempts } });
    return res.status(400).json({ error: `Mã không đúng. Còn ${MAX_CODE_ATTEMPTS - attempts} lần thử.` });
  }

  const cu = user.recoveryEmail || null;
  users.update(user.id, {
    recoveryEmail: pending.email,
    recoveryEmailAt: new Date().toISOString(),
    pendingEmail: null,
  });
  baoChoChuKhac(user.id, `${tenHienThi()}: có tài khoản Chủ vừa đổi email khôi phục`,
    `Tài khoản Chủ "${user.name}" (${user.login}) vừa đặt email khôi phục là ${users.maskEmail(pending.email)}.\n`
    + (cu ? `Địa chỉ trước đó: ${users.maskEmail(cu)}\n` : '')
    + `\nNếu đây không phải việc do người đó tự làm, hãy khóa tài khoản này ngay trong mục Quản lý tài khoản.`);

  res.json({ ok: true, recoveryEmail: pending.email });
});

// ---- Gỡ email khôi phục ----
router.delete('/recovery-email', authenticateToken, requireLevel(LEVEL.owner), checkCodeLimiter, (req, res) => {
  const user = users.findById(req.userId);
  if (!user) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });
  if (!bcrypt.compareSync(String(req.body?.currentPassword || ''), user.passwordHash)) {
    return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
  }
  // Giữ bất biến "có mã 6 số ⇒ có email khôi phục": gỡ email lúc đang bật mã thì
  // người dùng kẹt sau hai lớp mà không còn đường tự lấy lại mật khẩu.
  if (users.coTotp(user)) {
    return res.status(409).json({
      error: 'Đang bật mã xác thực 2 lớp thì không gỡ được email khôi phục. Hãy tắt mã xác thực trước đã — nếu không, quên mật khẩu là không còn đường nào tự lấy lại.',
    });
  }
  users.update(user.id, { recoveryEmail: null, recoveryEmailAt: null, pendingEmail: null, reset: null });
  baoChoChuKhac(user.id, `${tenHienThi()}: có tài khoản Chủ vừa gỡ email khôi phục`,
    `Tài khoản Chủ "${user.name}" (${user.login}) vừa gỡ email khôi phục.\n`
    + `Từ giờ tài khoản đó quên mật khẩu thì phải nhờ một tài khoản Chủ khác đặt lại.`);
  res.json({ ok: true });
});

// ============================================================================
// MÃ XÁC THỰC 6 SỐ (TOTP) — CHỈ TÀI KHOẢN CHỦ
// ============================================================================
// Giống AWS: đăng nhập bằng tên + mật khẩu, rồi hỏi mã 6 số từ ứng dụng xác thực.
// Hai lớp độc lập: mật khẩu ở máy chủ, khóa sinh mã ở điện thoại.
//
// LƯU Ý — mỗi kênh chỉ mở được MỘT khóa (CLAUDE.md §5.20):
//   - Quên mật khẩu  → email đã xác minh (POST /forgot).
//   - Mất điện thoại → tài khoản Chủ KHÁC đặt lại (PUT /admin/users/:id/totp/reset).
//   - Mất cả hai và Chủ kia cũng không dùng được → lệnh SSH trên máy chủ.
// Không được để email đặt lại được cả mật khẩu lẫn mã.

const totpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Quá nhiều lần thử, vui lòng thử lại sau ít phút' }),
});

// ---- Bước 1: sinh khóa + mã QR (chưa bật) ----
router.post('/totp/setup', authenticateToken, requireLevel(LEVEL.owner), totpLimiter, (req, res) => {
  const user = users.findById(req.userId);
  if (!user) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });
  if (!bcrypt.compareSync(String(req.body?.currentPassword || ''), user.passwordHash)) {
    return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
  }
  // Phải có email đã xác minh TRƯỚC khi bật mã, nếu không quên mật khẩu là không còn
  // đường tự lấy lại.
  if (!user.recoveryEmail) {
    return res.status(409).json({
      error: 'Hãy đặt email khôi phục trước đã. Nếu không, quên mật khẩu là không còn đường nào tự lấy lại.',
    });
  }

  // Chỉ lưu vào totpPending. Tài khoản chỉ thật sự bật sau khi nhập đúng một mã từ
  // khóa này — chứng minh điện thoại đã quét được và đồng hồ khớp.
  const secret = totp.generateSecret();
  users.update(user.id, { totpPending: { secret, at: new Date().toISOString() } });

  const uri = totp.otpauthUri({
    label: user.recoveryEmail || user.login,
    // Tên hiện trong ứng dụng xác thực: tên bảo tàng, hoặc TOTP_ISSUER trong .env.
    // Chỉ ảnh hưởng mã QR sinh từ lúc đổi; khóa đã có trong điện thoại không bị gì.
    issuer: process.env.TOTP_ISSUER || tenHienThi(),
    secret,
  });
  res.json({
    qrSvg: new QRCode({ content: uri, width: 232, height: 232, padding: 2, ecl: 'M' }).svg(),
    // Luôn kèm chuỗi để gõ tay, phòng điện thoại không quét được mã QR.
    secretText: totp.secretDeDoc(secret),
    label: user.recoveryEmail || user.login,
  });
});

// ---- Bước 2: nhập mã đầu tiên để bật thật ----
router.post('/totp/enable', authenticateToken, requireLevel(LEVEL.owner), totpLimiter, (req, res) => {
  const user = users.findById(req.userId);
  if (!user) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });
  const pending = user.totpPending;
  if (!pending?.secret) return res.status(409).json({ error: 'Chưa có mã QR nào đang chờ. Hãy bắt đầu lại từ đầu.' });

  const step = totp.verify(pending.secret, req.body?.code);
  if (step === null) {
    return res.status(400).json({
      error: 'Mã không đúng. Nếu đã quét đúng mã QR thì kiểm tra giờ trên điện thoại có bị lệch không.',
    });
  }

  users.update(user.id, {
    totpSecret: pending.secret,
    totpEnabledAt: new Date().toISOString(),
    totpLastStep: step, // mã vừa dùng để bật thì không dùng lại để đăng nhập được
    totpPending: null,
  });
  baoChoChuKhac(user.id, `${tenHienThi()}: có tài khoản Chủ vừa bật mã xác thực 2 lớp`,
    `Tài khoản Chủ "${user.name}" (${user.login}) vừa bật mã xác thực 6 số.\n`
    + `Từ giờ đăng nhập tài khoản đó cần cả mật khẩu lẫn điện thoại.`);
  res.json({ ok: true });
});

// ---- Tắt mã xác thực của chính mình ----
// LƯU Ý: bắt buộc hỏi cả mật khẩu LẪN một mã đang hợp lệ. Chỉ hỏi mật khẩu thì kẻ
// trộm được mật khẩu sẽ tự tắt lớp thứ hai.
router.delete('/totp', authenticateToken, requireLevel(LEVEL.owner), totpLimiter, (req, res) => {
  const user = users.findById(req.userId);
  if (!user) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });
  if (!users.coTotp(user)) return res.status(409).json({ error: 'Tài khoản này chưa bật mã xác thực' });
  if (!bcrypt.compareSync(String(req.body?.currentPassword || ''), user.passwordHash)) {
    return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
  }
  if (totp.verify(user.totpSecret, req.body?.code) === null) {
    return res.status(401).json({ error: 'Mã xác thực không đúng' });
  }
  users.update(user.id, { totpSecret: null, totpEnabledAt: null, totpPending: null, totpLastStep: null });
  baoChoChuKhac(user.id, `${tenHienThi()}: có tài khoản Chủ vừa TẮT mã xác thực 2 lớp`,
    `Tài khoản Chủ "${user.name}" (${user.login}) vừa tắt mã xác thực 6 số.\n`
    + `Nếu đây không phải việc do người đó tự làm, hãy khóa tài khoản này ngay.`);
  res.json({ ok: true });
});

// ============================================================================
// QUÊN MẬT KHẨU (CÔNG KHAI — không cần đăng nhập)
// ============================================================================
// Đường công khai duy nhất chạm vào mật khẩu, nên phải chặt:
//   - chỉ tài khoản Chủ, đang dùng được, ĐÃ xác minh email;
//   - mã gửi về đúng hộp thư đã xác minh — không nhận địa chỉ từ người gửi;
//   - trả lời CHUNG CHUNG để không lộ tên đăng nhập nào tồn tại;
//   - đổi mật khẩu xong thì mọi phiên cũ bị cắt (passwordChangedAt).

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5, // rất thấp: việc này vài tháng mới xảy ra một lần
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ error: 'Quá nhiều yêu cầu, vui lòng thử lại sau ít phút' }),
});

const TRA_LOI_CHUNG = 'Nếu tài khoản này có email khôi phục, mã xác minh đã được gửi tới hộp thư đó. Hãy kiểm tra cả mục Spam.';

router.post('/forgot', forgotLimiter, async (req, res) => {
  const login = String(req.body?.username || '').trim();
  users.ensureBootstrap();
  const user = users.findByLogin(login);

  const duDieuKien = user && user.role === 'owner' && !user.locked && user.recoveryEmail && mailer.isConfigured();
  if (!duDieuKien) return res.json({ ok: true, message: TRA_LOI_CHUNG });

  // Vừa gửi chưa tới 1 phút thì không gửi thêm — tránh biến route này thành công cụ
  // dội thư vào hộp thư người khác.
  const cu = user.reset;
  if (cu && !hetHan(cu) && Date.now() - Date.parse(cu.sentAt || 0) < RESEND_COOLDOWN_MS) {
    return res.json({ ok: true, message: TRA_LOI_CHUNG });
  }

  const code = users.generateCode();
  try {
    await mailer.sendMail({
      to: user.recoveryEmail,
      subject: `Mã lấy lại mật khẩu ${tenHienThi()}: ${code}`,
      text: `Chào ${user.name},\n\n`
        + `Có người vừa yêu cầu lấy lại mật khẩu cho tài khoản ${tenHienThi()} "${user.login}".\n\n`
        + `Mã xác minh: ${code}\n`
        + `Mã có hiệu lực trong 10 phút và chỉ dùng được một lần.\n\n`
        + `Nếu không phải bạn yêu cầu, hãy bỏ qua thư này - mật khẩu hiện tại vẫn nguyên vẹn.`,
    });
  } catch (err) {
    // Cố ý KHÔNG giấu lỗi: gửi thất bại mà vẫn báo "đã gửi" thì người dùng chờ mãi
    // một bức thư không bao giờ tới. Đổi lại lộ chút thông tin — chấp nhận được.
    return res.status(502).json({ error: err.message });
  }

  users.update(user.id, {
    reset: {
      codeHash: users.hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      sentAt: new Date().toISOString(),
      attempts: 0,
    },
  });
  res.json({ ok: true, message: TRA_LOI_CHUNG, sentTo: users.maskEmail(user.recoveryEmail) });
});

router.post('/forgot/verify', checkCodeLimiter, (req, res) => {
  const login = String(req.body?.username || '').trim();
  const code = String(req.body?.code || '').trim();
  const newPassword = String(req.body?.newPassword || '');

  if (newPassword.length < 8) return res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 8 ký tự' });

  const user = users.findByLogin(login);
  const reset = user?.reset;
  if (!user || user.role !== 'owner' || user.locked || hetHan(reset)) {
    return res.status(400).json({ error: 'Mã không đúng hoặc đã hết hạn. Hãy bấm "Gửi lại mã" để nhận mã mới.' });
  }

  if (!users.checkCode(code, reset.codeHash)) {
    const attempts = (reset.attempts || 0) + 1;
    if (attempts >= MAX_CODE_ATTEMPTS) {
      users.update(user.id, { reset: null });
      return res.status(429).json({ error: 'Sai mã quá nhiều lần. Hãy bấm "Gửi lại mã" để nhận mã mới.' });
    }
    users.update(user.id, { reset: { ...reset, attempts } });
    return res.status(400).json({ error: `Mã không đúng. Còn ${MAX_CODE_ATTEMPTS - attempts} lần thử.` });
  }

  try {
    users.setPassword(user.id, newPassword); // xóa luôn `reset` và đặt passwordChangedAt
  } catch {
    return res.status(500).json({ error: 'Không ghi được file tài khoản trên server' });
  }

  // Người làm là chính chủ tài khoản (qua mã email) — chưa đăng nhập nên req không có userId.
  nhatKy.ghi({ req, action: 'password.reset-email', target: user, actor: user });

  baoChoChuKhac(user.id, `${tenHienThi()}: có tài khoản Chủ vừa đặt lại mật khẩu bằng email`,
    `Tài khoản Chủ "${user.name}" (${user.login}) vừa đặt lại mật khẩu bằng mã gửi qua email khôi phục.\n`
    + `Thời điểm: ${new Date().toLocaleString('vi-VN')}\n\n`
    + `Nếu đây không phải việc do người đó tự làm, hãy khóa tài khoản này ngay trong mục Quản lý tài khoản.`);

  res.json({ ok: true });
});

// PUT /password/public ĐÃ GỠ: route đó đổi được mật khẩu mà không cần đăng nhập,
// nên người vừa nghỉ việc (còn nhớ mật khẩu chung) có thể khóa cả bảo tàng ra
// ngoài. Giờ mỗi người có tài khoản riêng và luôn có hai tài khoản Chủ đặt lại cho
// nhau. CLAUDE.md §5.16.

module.exports = router;
