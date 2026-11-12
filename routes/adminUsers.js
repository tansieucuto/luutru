// Quản lý tài khoản quản trị — chỉ vai trò Chủ. Đây là ranh giới bảo mật thật,
// không phải việc ẩn nút trên giao diện.
const express = require('express');
const authenticateToken = require('../middleware/auth');
const { requireLevel, LEVEL } = authenticateToken;
const users = require('../userStore');
const mailer = require('../mailer');
const { tenHienThi } = require('../tenBaoTang');
const nhatKy = require('../accountAudit');

const router = express.Router();
router.use(authenticateToken, requireLevel(LEVEL.owner));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ============ HAI CHỐT AN TOÀN ============
// Thiếu một trong hai là có thể rơi vào tình huống không ai vào lại được hệ thống.

// 1. Luôn còn ít nhất một tài khoản Chủ dùng được.
function assertNotLastOwner(target, whatHappens) {
  if (target.role !== 'owner' || target.locked) return;
  if (users.activeOwnerCount() > 1) return;
  throw new HttpError(409,
    `Đây là tài khoản Chủ duy nhất đang dùng được. ${whatHappens} sẽ khiến không còn ai quản lý được tài khoản. ` +
    `Hãy tạo thêm một tài khoản Chủ nữa trước đã.`);
}

// 2. Không tự khóa, tự hạ vai trò hay tự xóa chính mình.
function assertNotSelf(target, req) {
  if (target.id === req.userId) {
    throw new HttpError(409, 'Không thao tác được lên tài khoản của chính bạn.');
  }
}

function getTarget(req) {
  const u = users.findById(req.params.id);
  if (!u) throw new HttpError(404, 'Không tìm thấy tài khoản này');
  return u;
}

function handle(res, fn) {
  try {
    fn();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ============ DANH SÁCH ============
router.get('/', (req, res) => {
  handle(res, () => {
    const list = users.readAll()
      .map(users.publicView)
      // Chủ lên trước, rồi tài khoản đang dùng được, rồi theo tên.
      .sort((a, b) =>
        (users.roleLevel(b.role) - users.roleLevel(a.role))
        || (Number(a.locked) - Number(b.locked))
        || a.name.localeCompare(b.name, 'vi'));
    res.json({
      users: list,
      activeOwnerCount: users.activeOwnerCount(),
      me: req.userId,
    });
  });
});

// ============ NHẬT KÝ THAO TÁC TÀI KHOẢN ============
// Chỉ đọc. CỐ Ý không có route xóa/sửa — xem accountAudit.js.
router.get('/audit', (req, res) => {
  handle(res, () => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
    res.json({ items: nhatKy.doc(limit) });
  });
});

// ============ TẠO TÀI KHOẢN ============
router.post('/', (req, res) => {
  handle(res, () => {
    const name = String(req.body?.name || '').trim();
    const login = String(req.body?.login || '').trim().toLowerCase();
    const role = String(req.body?.role || '').trim();

    if (!name) throw new HttpError(400, 'Chưa nhập tên hiển thị');
    if (!users.LOGIN_RE.test(login)) {
      throw new HttpError(400, 'Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới, dài 3–32 ký tự');
    }
    if (!users.ROLES.includes(role)) throw new HttpError(400, 'Vai trò không hợp lệ');
    if (users.findByLogin(login)) throw new HttpError(409, `Tên đăng nhập "${login}" đã có người dùng`);

    // Mật khẩu do máy chủ sinh, không nhận từ người dùng — tránh mật khẩu yếu kiểu
    // "bt2024".
    const password = users.generatePassword();
    const user = users.create({ name, login, password, role });
    nhatKy.ghi({ req, action: 'user.create', target: user, detail: { role } });

    // Mật khẩu chỉ trả về MỘT LẦN ở đây: không lưu dạng đọc được, không xem lại
    // được. Mất thì đặt lại.
    res.status(201).json({ user: users.publicView(user), password });
  });
});

// ============ ĐỔI VAI TRÒ ============
router.put('/:id/role', (req, res) => {
  handle(res, () => {
    const target = getTarget(req);
    const role = String(req.body?.role || '').trim();
    if (!users.ROLES.includes(role)) throw new HttpError(400, 'Vai trò không hợp lệ');
    if (role === target.role) return res.json({ user: users.publicView(target) });

    assertNotSelf(target, req);
    if (role !== 'owner') assertNotLastOwner(target, 'Hạ vai trò tài khoản này');

    const u = users.update(target.id, { role });
    nhatKy.ghi({ req, action: 'user.role', target: u, detail: { from: target.role, to: role } });
    res.json({ user: users.publicView(u) });
  });
});

// ============ ĐỔI TÊN HIỂN THỊ / TÊN ĐĂNG NHẬP ============
// Được đổi cả tài khoản của chính mình: phiên đăng nhập, nhật ký và quyền hoàn tác đều
// bám theo id, không theo tên đăng nhập (middleware/auth.js, contentHistory.js).
router.put('/:id/identity', (req, res) => {
  handle(res, () => {
    const target = getTarget(req);
    const name = String(req.body?.name ?? target.name).replace(/\s+/g, ' ').trim();
    const login = String(req.body?.login ?? target.login).trim().toLowerCase();

    if (!name) throw new HttpError(400, 'Chưa nhập tên hiển thị');
    if (name.length > 80) throw new HttpError(400, 'Tên hiển thị dài tối đa 80 ký tự');
    if (!users.LOGIN_RE.test(login)) {
      throw new HttpError(400, 'Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới, dài 3–32 ký tự');
    }
    const trung = users.findByLogin(login);
    if (trung && trung.id !== target.id) throw new HttpError(409, `Tên đăng nhập "${login}" đã có người dùng`);
    if (name === target.name && login === target.login) return res.json({ user: users.publicView(target) });

    const doiLogin = login !== target.login;
    // Báo cho CHÍNH người bị đổi ở lần tải trang kế tiếp (GET /auth/me → admin.js). Phiên của
    // họ bám theo id nên không bị cắt, và nếu không báo thì lần sau gõ tên cũ họ chỉ thấy "Sai
    // tài khoản hoặc mật khẩu". Tự đổi của mình thì không cần báo.
    // Đổi nhiều lần trước khi họ kịp xem: giữ tên GỐC họ còn nhớ ở `tu`; đổi về đúng tên gốc
    // thì bỏ thông báo.
    let thongBao;
    if (doiLogin && target.id !== req.userId) {
      const tu = target.thongBaoDoiTen?.tu || target.login;
      thongBao = tu === login ? null : { tu, sang: login, boi: req.userName, luc: new Date().toISOString() };
    }
    const u = users.update(target.id, {
      name, login,
      ...(thongBao !== undefined ? { thongBaoDoiTen: thongBao } : {}),
    });
    const chiTiet = {};
    if (doiLogin) { chiTiet.loginFrom = target.login; chiTiet.loginTo = login; }
    if (name !== target.name) { chiTiet.nameFrom = target.name; chiTiet.nameTo = name; }
    nhatKy.ghi({ req, action: 'user.identity', target: u, detail: chiTiet });
    // Tên đăng nhập của Chủ là nửa đầu của đường "Quên mật khẩu" — báo các Chủ còn lại,
    // như mọi thay đổi nhạy cảm khác của tài khoản Chủ.
    if (login !== target.login && target.role === 'owner') {
      mailer.baoChoChuKhac(req.userId, `${tenHienThi()}: tài khoản Chủ vừa đổi tên đăng nhập`,
        `Tài khoản Chủ "${u.name}" giờ đăng nhập bằng "${login}" (trước đây "${target.login}").\n`
        + `Người đổi: ${req.userName} (${req.userLogin}).\n\n`
        + 'Nếu đây không phải việc do người trong bảo tàng làm, hãy khóa tài khoản đó ngay trong mục Quản lý tài khoản.');
    }
    res.json({ user: users.publicView(u) });
  });
});

// ============ KHÓA / MỞ KHÓA ============
router.put('/:id/locked', (req, res) => {
  handle(res, () => {
    const target = getTarget(req);
    const locked = req.body?.locked === true;

    if (locked) {
      assertNotSelf(target, req);
      assertNotLastOwner(target, 'Khóa tài khoản này');
    }
    const u = users.update(target.id, { locked });
    if (Boolean(target.locked) !== locked) {
      nhatKy.ghi({ req, action: locked ? 'user.lock' : 'user.unlock', target: u });
    }
    res.json({ user: users.publicView(u) });
  });
});

// ============ ĐẶT LẠI MẬT KHẨU CHO NGƯỜI KHÁC ============
router.put('/:id/password', (req, res) => {
  handle(res, () => {
    const target = getTarget(req);
    const password = users.generatePassword();
    users.setPassword(target.id, password);
    // KHÔNG đưa mật khẩu mới vào nhật ký.
    nhatKy.ghi({ req, action: 'password.reset-by-owner', target });
    // Đặt lại mật khẩu cắt luôn các phiên đang mở của người đó: setPassword() ghi
    // passwordChangedAt và middleware/auth.js từ chối token cũ hơn mốc này.
    res.json({ user: users.publicView(target), password });
  });
});

// ============ ĐẶT LẠI MÃ XÁC THỰC (mất điện thoại) ============
// Nguyên tắc "mỗi kênh chỉ mở được một khóa" (CLAUDE.md §5.20): quên mật khẩu →
// email khôi phục; mất điện thoại → CHỈ tài khoản Chủ khác gỡ mã ở đây. Nếu email
// làm được cả hai thì ai chiếm được hộp thư sẽ qua cả hai lớp.
//
// assertNotSelf giữ nguyên tắc đó: chính chủ không tự gỡ mã qua đường này (tự
// tắt thì dùng DELETE /auth/totp — cần cả mật khẩu lẫn một mã đang hợp lệ).
router.put('/:id/totp/reset', (req, res) => {
  handle(res, () => {
    const target = getTarget(req);
    assertNotSelf(target, req);
    if (target.role !== 'owner') {
      throw new HttpError(409, 'Chỉ tài khoản Chủ mới dùng mã xác thực.');
    }
    if (!target.totpSecret) {
      throw new HttpError(409, `${target.name} chưa bật mã xác thực nên không có gì để đặt lại.`);
    }
    users.update(target.id, {
      totpSecret: null, totpEnabledAt: null, totpPending: null, totpLastStep: null,
    });
    nhatKy.ghi({ req, action: 'totp.reset-by-owner', target });
    // Không cắt phiên của họ: mất điện thoại không phải lý do để đá họ ra. Lần
    // đăng nhập sau sẽ không hỏi mã, và giao diện nhắc họ đăng ký lại.
    res.json({ user: users.publicView(users.findById(target.id)) });
  });
});

// ============ XÓA HẲN ============
// Chỉ xóa được tài khoản ĐÃ KHÓA (hai bước), để một cú bấm nhầm không làm mất hẳn
// tài khoản.
router.delete('/:id', (req, res) => {
  handle(res, () => {
    const target = getTarget(req);
    assertNotSelf(target, req);
    if (!target.locked) {
      throw new HttpError(409, 'Hãy khóa tài khoản này trước rồi mới xóa hẳn được.');
    }
    assertNotLastOwner(target, 'Xóa tài khoản này');
    users.remove(target.id);
    // `target` đọc TRƯỚC khi xóa nên vẫn còn tên để ghi — sau này tra "ai là @lan" vẫn được.
    nhatKy.ghi({ req, action: 'user.delete', target });
    res.status(204).end();
  });
});

module.exports = router;
