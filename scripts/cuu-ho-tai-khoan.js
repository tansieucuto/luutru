#!/usr/bin/env node
// LƯỚI CUỐI CÙNG - chỉ chạy trực tiếp trên máy chủ qua SSH.
//
// Dùng khi mọi đường khác đã tắc: quên mật khẩu, mất điện thoại (mất mã xác
// thực), VÀ tài khoản Chủ còn lại cũng không dùng được. Ba thứ cùng lúc - hiếm,
// nhưng nếu không có lối này thì cả bảo tàng bị khóa vĩnh viễn.
//
// VÌ SAO PHẢI LÀ SSH: đây là cách duy nhất không làm thủng lớp bảo vệ hằng
// ngày. Mọi phương án "tự phục hồi qua mạng" đều tạo thêm một cánh cửa công
// khai - mà cánh cửa đó chính là thứ đã phải gỡ bỏ ở mục 5.16 (`PUT
// /password/public`). Ai vào được SSH thì đằng nào cũng sửa tay được users.json.
//
// Cách dùng (đứng trong thư mục chứa server.js):
//   node scripts/cuu-ho-tai-khoan.js danh-sach
//   node scripts/cuu-ho-tai-khoan.js dat-mat-khau <tên-đăng-nhập>
//   node scripts/cuu-ho-tai-khoan.js go-ma-xac-thuc <tên-đăng-nhập>
//   node scripts/cuu-ho-tai-khoan.js mo-khoa <tên-đăng-nhập>
//
// Nhiều bảo tàng: thêm DATA_DIR=<thư mục của bảo tàng đó> vào trước lệnh.
//
// SAU KHI CHẠY: không cần restart server. `userStore` đọc lại users.json theo
// (mtime, size) nên thay đổi có hiệu lực ngay ở request kế tiếp.

const path = require('path');

// Chạy từ thư mục gốc của dự án, không phải từ scripts/
process.chdir(path.join(__dirname, '..'));
const users = require('../userStore');

const [, , lenh, tenDangNhap] = process.argv;

function inDanhSach() {
  const ds = users.readAll();
  if (!ds.length) {
    console.log('Chưa có tài khoản nào trong users.json.');
    return;
  }
  console.log(`\n${ds.length} tài khoản:\n`);
  for (const u of ds) {
    const co = [];
    if (u.locked) co.push('ĐÃ KHÓA');
    if (u.totpSecret) co.push('có mã xác thực');
    if (u.recoveryEmail) co.push(`email: ${users.maskEmail(u.recoveryEmail)}`);
    console.log(`  ${u.login.padEnd(20)} ${users.ROLE_LABEL[u.role].padEnd(10)} ${co.join(' · ') || '—'}`);
  }
  console.log('');
}

function timTaiKhoan() {
  if (!tenDangNhap) {
    console.error('Thiếu tên đăng nhập. Chạy "danh-sach" để xem có những ai.');
    process.exit(1);
  }
  const u = users.findByLogin(tenDangNhap);
  if (!u) {
    console.error(`Không tìm thấy tài khoản "${tenDangNhap}". Chạy "danh-sach" để xem có những ai.`);
    process.exit(1);
  }
  return u;
}

switch (lenh) {
  case 'danh-sach':
    inDanhSach();
    break;

  case 'dat-mat-khau': {
    const u = timTaiKhoan();
    const matKhau = users.generatePassword();
    users.setPassword(u.id, matKhau); // cutSessions mặc định -> cắt mọi phiên cũ
    console.log(`\n  Tài khoản : ${u.login} (${u.name})`);
    console.log(`  Mật khẩu  : ${matKhau}`);
    console.log('\n  Ghi lại ngay - mật khẩu này không hiện lại lần nào nữa.');
    if (u.totpSecret) {
      console.log('  ⚠ Tài khoản này VẪN đang bật mã xác thực 6 số. Nếu cũng mất điện thoại,');
      console.log('    chạy thêm: node scripts/cuu-ho-tai-khoan.js go-ma-xac-thuc ' + u.login);
    }
    console.log('');
    break;
  }

  case 'go-ma-xac-thuc': {
    const u = timTaiKhoan();
    if (!u.totpSecret) {
      console.log(`Tài khoản "${u.login}" vốn không bật mã xác thực - không có gì để gỡ.`);
      break;
    }
    users.update(u.id, {
      totpSecret: null, totpEnabledAt: null, totpPending: null, totpLastStep: null,
    });
    console.log(`\n  Đã gỡ mã xác thực của "${u.login}".`);
    console.log('  Lần đăng nhập tới chỉ cần mật khẩu. Vào Quản lý tài khoản để đăng ký lại');
    console.log('  bằng điện thoại mới - đừng để trống, đó là lớp bảo vệ thứ hai.\n');
    break;
  }

  case 'mo-khoa': {
    const u = timTaiKhoan();
    users.update(u.id, { locked: false });
    console.log(`\n  Đã mở khóa "${u.login}".\n`);
    break;
  }

  default:
    console.log(`
Cứu hộ tài khoản quản trị Beacon - chỉ dùng khi mọi đường khác đã tắc.

  node scripts/cuu-ho-tai-khoan.js danh-sach
      Xem có những tài khoản nào, ai đang khóa, ai đã bật mã xác thực.

  node scripts/cuu-ho-tai-khoan.js dat-mat-khau <tên-đăng-nhập>
      Sinh mật khẩu mới và in ra màn hình. Cắt mọi phiên đăng nhập cũ.

  node scripts/cuu-ho-tai-khoan.js go-ma-xac-thuc <tên-đăng-nhập>
      Gỡ mã 6 số khi mất điện thoại. Lần sau đăng nhập chỉ cần mật khẩu.

  node scripts/cuu-ho-tai-khoan.js mo-khoa <tên-đăng-nhập>
      Mở lại tài khoản đã bị khóa.

Không cần restart server sau khi chạy.
`);
    process.exit(lenh ? 1 : 0);
}
