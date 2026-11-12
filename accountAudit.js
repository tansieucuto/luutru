// Nhật ký thao tác TÀI KHOẢN: ai tạo / đổi tên / đổi vai trò / khóa / đặt lại mật khẩu /
// gỡ mã xác thực / xóa tài khoản nào, lúc nào, từ IP nào. Thêm 2026-09-16 — xem CLAUDE.md §5.26.
//
// VÌ SAO CẦN: nhật ký NỘI DUNG (contentHistory.js) ghi đúng người theo userId, nhưng trước
// đây thao tác trên TÀI KHOẢN không để lại dấu vết nào. Ai đó dùng tài khoản Chủ đặt lại mật
// khẩu của nhân viên "lan", đăng nhập vào rồi xóa hiện vật — nhật ký nội dung sẽ ghi "lan"
// đã xóa và không có cách nào chứng minh ngược lại.
//
// Ba quyết định cố ý:
// - File nằm NGOÀI content/ (cạnh users.json), cùng lý do với users.json (§5.16): nhập ZIP
//   và khôi phục sao lưu thay thế cả content/, không được cuốn mất nhật ký bảo mật.
// - CHỈ GHI THÊM, không có route xóa hay sửa. Người có quyền Chủ vẫn xóa được file bằng SSH,
//   nhưng không làm được từ giao diện web — tức là không xóa dấu vết bằng chính tài khoản
//   vừa bị chiếm.
// - Ghi thất bại thì KHÔNG chặn thao tác, chỉ báo ra log pm2. Đĩa đầy mà chặn luôn việc đặt
//   lại mật khẩu là tự khóa bảo tàng ra ngoài — tệ hơn mất một dòng nhật ký.
//
// TUYỆT ĐỐI không đưa mật khẩu, mã, hash hay totpSecret vào `detail`. Hàm này chỉ chép đúng
// id/tên/tên đăng nhập/vai trò của tài khoản, không bao giờ chép nguyên object.
const fs = require('fs');
const { ACCOUNT_AUDIT_PATH } = require('./paths');

function nguoi(u) {
  return u ? { id: u.id || null, name: u.name || null, login: u.login || null, role: u.role || null } : null;
}

function ghi({ req, action, target, detail = {}, actor }) {
  const dong = {
    t: new Date().toISOString(),
    action,
    actor: actor ? nguoi(actor)
      : (req && req.userId ? { id: req.userId, name: req.userName || null, login: req.userLogin || null, role: req.userRole || null } : null),
    target: nguoi(target),
    detail,
    // server.js đặt `trust proxy` = 1 nên đây là IP thật của người dùng, không phải của nginx.
    ip: req?.ip ? String(req.ip).replace(/^::ffff:/, '') : null,
  };
  try {
    fs.appendFileSync(ACCOUNT_AUDIT_PATH, JSON.stringify(dong) + '\n', { mode: 0o600 });
  } catch (err) {
    console.error('[nhat-ky-tai-khoan] KHONG GHI DUOC:', err.message, JSON.stringify(dong));
  }
}

// Đọc N dòng mới nhất. Thao tác tài khoản hiếm (vài lần mỗi tháng) nên đọc cả file là đủ
// nhẹ trong nhiều năm — không như thống kê khách (§5.15) phải đọc theo luồng.
function doc(limit = 200) {
  let text;
  try {
    text = fs.readFileSync(ACCOUNT_AUDIT_PATH, 'utf8');
  } catch {
    return [];
  }
  const lines = text.split('\n').filter(Boolean);
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try { out.push(JSON.parse(lines[i])); } catch { /* dòng ghi dở lúc mất điện — bỏ qua */ }
  }
  return out;
}

module.exports = { ghi, doc };
