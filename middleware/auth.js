// Xác thực JWT cho các route quản trị và phân quyền theo cấp vai trò.
// Quy ước mã lỗi 401/403: CLAUDE.md §5.18.
const jwt = require('jsonwebtoken');
const userStore = require('../userStore');

function authenticateToken(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.trim().split(' ');

  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return res.status(401).json({ error: 'Thieu hoac sai dinh dang Authorization header' });
  }

  // LƯU Ý — quy ước mã lỗi, giao diện phụ thuộc vào nó:
  //   401 = phiên không còn dùng được (token hỏng/hết hạn, tài khoản bị xóa,
  //         bị khóa, mật khẩu vừa đổi) → giao diện đăng xuất.
  //   403 = đã xác thực nhưng không đủ quyền → giao diện giữ nguyên trang và
  //         hiện câu giải thích.
  jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
    if (err) {
      return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại' });
    }

    const userId = payload.user_id || payload.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại' });
    }

    // Đối chiếu với kho tài khoản ở mỗi request thay vì tin hoàn toàn vào token:
    // khóa tài khoản, hạ vai trò hay đổi mật khẩu có hiệu lực ngay, không phải
    // chờ token hết hạn. users.json nhỏ và đã có cache theo mtime.
    const user = userStore.findById(userId);
    if (!user) {
      return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });
    }
    // 401 chứ không phải 403: tài khoản bị khóa thì không thao tác nào dùng được
    // nữa, nên đưa người dùng về trang đăng nhập (ở đó sẽ thấy lý do).
    if (user.locked) {
      return res.status(401).json({ error: 'Tài khoản này đã bị khóa. Liên hệ quản lý để mở khóa.' });
    }
    if (user.passwordChangedAt && payload.iat) {
      // LƯU Ý: so sánh theo GIÂY ở cả hai vế. `iat` của JWT chỉ có độ phân giải
      // giây, còn passwordChangedAt có mili giây; so thẳng thì token vừa cấp sau
      // khi đổi mật khẩu bị coi là cũ. Đánh đổi: token cấp trong cùng giây với
      // lần đổi mật khẩu vẫn còn hiệu lực — giới hạn của định dạng JWT.
      if (payload.iat < Math.floor(Date.parse(user.passwordChangedAt) / 1000)) {
        return res.status(401).json({ error: 'Mật khẩu đã được đổi, vui lòng đăng nhập lại' });
      }
    }

    req.userId = userId;
    // Vai trò và tên lấy từ kho tài khoản (không lấy từ token) để thay đổi có
    // hiệu lực ngay.
    req.userRole = user.role;
    req.userName = user.name;
    req.userLogin = user.login;
    next();
  });
}

// Kiểm tra theo TÊN vai trò. Không còn route nào dùng — giữ lại để tương thích;
// route mới dùng requireLevel() bên dưới.
function requireRole(role) {
  return (req, res, next) => {
    if (req.userRole !== role) {
      return res.status(403).json({ error: 'Khong co quyen truy cap chuc nang nay' });
    }
    next();
  };
}

// ============ PHÂN QUYỀN THEO CẤP ============
// viewer(1) < editor(2) < owner(3). So theo cấp thay vì theo tên, để "cần Biên
// tập trở lên" viết gọn và không bỏ sót vai trò cao hơn.
//
// LƯU Ý: đây là ranh giới bảo mật thật. Ẩn nút trên giao diện chỉ để dễ dùng —
// gọi thẳng API vẫn bị chặn ở đây.
const { roleLevel, ROLE_LABEL } = userStore;

const LEVEL = { viewer: 1, editor: 2, owner: 3 };

function requireLevel(needed) {
  return (req, res, next) => {
    if (roleLevel(req.userRole) >= needed) return next();
    const label = ROLE_LABEL[req.userRole] || req.userRole;
    // Câu lỗi viết cho người dùng đọc, phòng khi giao diện chưa kịp ẩn nút.
    res.status(403).json({
      error: `Tài khoản của bạn (${label}) không làm được việc này. Nếu bạn cần quyền, hãy liên hệ quản lý.`,
    });
  };
}

module.exports = authenticateToken;
module.exports.requireRole = requireRole;
module.exports.requireLevel = requireLevel;
module.exports.LEVEL = LEVEL;
