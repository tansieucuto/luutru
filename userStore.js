// Kho tài khoản quản trị (users.json). Thay cho ADMIN_USERNAME/ADMIN_PASSWORD_HASH
// trong .env — hai biến đó giờ chỉ dùng MỘT lần để tạo tài khoản Chủ đầu tiên.
//
// users.json nằm NGOÀI content/ có chủ ý: nhập ZIP và khôi phục sao lưu xóa/ghi đè
// bên trong content/, để file tài khoản ở đó là có ngày cả bảo tàng không đăng
// nhập được. LƯU Ý: file này có trong .gitignore và được scripts/backup-content.sh
// sao lưu riêng (dòng EXTRA).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const { USERS_PATH } = require('./paths');

// Thứ tự QUAN TRỌNG: vị trí trong mảng chính là cấp quyền (xem roleLevel).
const ROLES = ['viewer', 'editor', 'owner'];
const ROLE_LABEL = { owner: 'Chủ', editor: 'Biên tập', viewer: 'Chỉ xem' };

function roleLevel(role) {
  const i = ROLES.indexOf(role);
  return i < 0 ? 0 : i + 1; // viewer=1, editor=2, owner=3
}

function hasLevel(role, needed) {
  return roleLevel(role) >= needed;
}

// Nhớ bản đọc gần nhất theo (mtime, size): middleware/auth.js đọc kho tài khoản
// ở mỗi request, cache để tránh đọc đĩa thừa.
let cache = null; // { key, users }

function readAll() {
  try {
    const st = fs.statSync(USERS_PATH);
    const key = `${st.mtimeMs}:${st.size}`;
    if (cache && cache.key === key) return cache.users;
    const raw = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
    const users = Array.isArray(raw.users) ? raw.users : [];
    cache = { key, users };
    return users;
  } catch {
    return []; // Chưa có file → kho rỗng; ensureBootstrap() sẽ tạo.
  }
}

function writeAll(users) {
  // Ghi file tạm rồi đổi tên: mất điện giữa chừng thì file cũ vẫn nguyên vẹn.
  const tmp = `${USERS_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, USERS_PATH);
  cache = null; // Lần sau đọc lại từ đĩa — mtime có thể trùng trong cùng mili giây.
}

// Lần chạy đầu tiên (chưa có users.json): tạo tài khoản Chủ từ
// ADMIN_USERNAME/ADMIN_PASSWORD_HASH trong .env để mật khẩu đang dùng vẫn đăng nhập
// được. Từ đó về sau .env không còn là nguồn xác thực.
function ensureBootstrap() {
  if (readAll().length) return null;
  const login = process.env.ADMIN_USERNAME;
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!login || !hash) return null;
  const user = {
    id: crypto.randomUUID(),
    name: login,
    login,
    passwordHash: hash,
    role: 'owner',
    locked: false,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };
  writeAll([user]);
  console.log(`[users] Da tao tai khoan Chu dau tien tu .env: "${login}". Vao trang Quan ly tai khoan de doi ten hien thi va tao them tai khoan.`);
  return user;
}

function findByLogin(login) {
  const key = String(login || '').trim().toLowerCase();
  return readAll().find((u) => u.login.toLowerCase() === key) || null;
}

function findById(id) {
  return readAll().find((u) => u.id === id) || null;
}

// Số tài khoản Chủ còn DÙNG ĐƯỢC (chưa bị khóa).
function activeOwnerCount() {
  return readAll().filter((u) => u.role === 'owner' && !u.locked).length;
}

function update(id, patch) {
  const users = readAll();
  const i = users.findIndex((u) => u.id === id);
  if (i < 0) return null;
  users[i] = { ...users[i], ...patch };
  writeAll(users);
  return users[i];
}

function create({ name, login, password, role }) {
  const users = readAll();
  const user = {
    id: crypto.randomUUID(),
    name,
    login,
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    locked: false,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };
  users.push(user);
  writeAll(users);
  return user;
}

function remove(id) {
  const users = readAll();
  const next = users.filter((u) => u.id !== id);
  if (next.length === users.length) return false;
  writeAll(next);
  return true;
}

// cutSessions = true (mặc định): ghi mốc passwordChangedAt để cắt mọi phiên đăng
// nhập cũ (xem middleware/auth.js). Dùng cho "lấy lại mật khẩu", khi Chủ đặt lại
// mật khẩu cho người khác, và khi tự đổi mật khẩu (giao diện bắt đăng nhập lại).
//
// cutSessions = false: giữ phiên cũ — hiện không còn chỗ nào dùng.
function setPassword(id, password, { cutSessions = true } = {}) {
  return update(id, {
    passwordHash: bcrypt.hashSync(password, 10),
    ...(cutSessions ? { passwordChangedAt: new Date().toISOString() } : {}),
    reset: null, // mật khẩu đã đổi thì mã khôi phục đang chờ (nếu có) hết hiệu lực
  });
}

// ---------- Email khôi phục (chỉ tài khoản Chủ) ----------

// Mã 6 số gửi qua email, không dùng đường link: bộ quét liên kết của Gmail/Outlook
// hay tự mở thư trước, làm hỏng link dùng-một-lần trước khi người thật kịp bấm.
function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashCode(code) {
  return bcrypt.hashSync(String(code), 10);
}

function checkCode(code, hash) {
  if (!hash) return false;
  try {
    return bcrypt.compareSync(String(code), hash);
  } catch {
    return false;
  }
}

// Che bớt địa chỉ khi hiển thị: "thuha@gmail.com" → "th•••@gmail.com". Đủ để chủ
// hộp thư nhận ra, không lộ địa chỉ đầy đủ trên màn hình đăng nhập.
function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at < 1) return '';
  const ten = s.slice(0, at);
  const giu = ten.slice(0, Math.min(2, ten.length));
  return `${giu}${'•'.repeat(Math.max(3, ten.length - giu.length))}${s.slice(at)}`;
}

// Kiểm tra email ở mức "đủ dùng", cố ý không dùng biểu thức phức tạp: bước xác
// minh bằng mã mới là thứ thật sự chặn được địa chỉ gõ nhầm.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// ---------- Mã xác thực 6 số (TOTP) ----------
// Chỉ vai trò Chủ. Tài khoản nhân viên do Chủ tạo và đặt lại được bất cứ lúc nào,
// nên không cần thêm lớp này.

function coTotp(u) {
  return Boolean(u && u.totpSecret);
}

// Ghi số thứ tự khoảng thời gian vừa dùng để không chấp nhận lại chính mã đó
// (mỗi mã sống 30 giây — đủ để ai nhìn trộm màn hình dùng lại).
function markTotpUsed(id, step) {
  return update(id, { totpLastStep: step });
}

function daDungMa(u, step) {
  return typeof u?.totpLastStep === 'number' && step <= u.totpLastStep;
}

function touchLogin(id) {
  return update(id, { lastLoginAt: new Date().toISOString() });
}

// Bản gửi ra ngoài: TUYỆT ĐỐI không kèm passwordHash hay totpSecret.
function publicView(u) {
  return {
    id: u.id,
    name: u.name,
    login: u.login,
    role: u.role,
    roleLabel: ROLE_LABEL[u.role] || u.role,
    locked: !!u.locked,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt || null,
    // Chỉ cho biết CÓ hay KHÔNG. Địa chỉ thật chỉ trả cho chính chủ tài khoản
    // (GET /auth/me), không có trong danh sách tài khoản.
    hasRecoveryEmail: Boolean(u.recoveryEmail),
    // Chủ khác cần biết để hiện đúng nút "Đặt lại mã". Không bao giờ trả về
    // totpSecret.
    totpEnabled: Boolean(u.totpSecret),
    totpEnabledAt: u.totpEnabledAt || null,
  };
}

// Sinh mật khẩu mạnh để người quản lý không phải tự nghĩ. Bỏ các ký tự dễ nhầm
// khi đọc/chép tay: 0/O, 1/l/I.
function generatePassword() {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const pick = (n) => Array.from(crypto.randomBytes(n)).map((b) => cs[b % cs.length]).join('');
  return `${pick(3)}-${pick(4)}-${pick(4)}`;
}

const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;

module.exports = {
  USERS_PATH,
  ROLES,
  ROLE_LABEL,
  roleLevel,
  hasLevel,
  readAll,
  ensureBootstrap,
  findByLogin,
  findById,
  activeOwnerCount,
  create,
  update,
  remove,
  setPassword,
  touchLogin,
  publicView,
  coTotp,
  markTotpUsed,
  daDungMa,
  generatePassword,
  generateCode,
  hashCode,
  checkCode,
  maskEmail,
  LOGIN_RE,
  EMAIL_RE,
};
