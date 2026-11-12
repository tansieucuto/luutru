// Mã xác thực 6 số (TOTP, RFC 6238) — tương thích Google Authenticator, Authy,
// Microsoft Authenticator và các ứng dụng cùng chuẩn.
//
// Tự cài đặt thay vì dùng thư viện: thuật toán chỉ là HMAC-SHA1 trên số thứ tự
// khoảng thời gian, và `crypto` của Node đã có sẵn. Đã đối chiếu với bộ vector
// kiểm thử trong phụ lục B của RFC 6238.
const crypto = require('crypto');

const STEP_SECONDS = 30; // Chuẩn RFC; Google Authenticator không cho đổi.
const DIGITS = 6;

// Chấp nhận lệch ±1 khoảng (±30 giây) vì đồng hồ điện thoại thường lệch vài
// giây. Nới rộng hơn sẽ kéo dài cửa sổ cho kẻ đoán mã.
const WINDOW = 1;

// ---------- Base32 (RFC 4648, không có ký tự '=' đệm) ----------
// Khóa bí mật phải ở dạng base32 vì định dạng otpauth:// yêu cầu vậy.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const sach = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of sach) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------- Sinh và kiểm tra mã ----------

// 20 byte = 160 bit, độ dài khóa HMAC-SHA1 mà RFC 4226 khuyến nghị.
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  // "Dynamic truncation" (RFC 4226 §5.3): 4 bit cuối chỉ ra vị trí bắt đầu.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

function currentStep(atMs = Date.now()) {
  return Math.floor(atMs / 1000 / STEP_SECONDS);
}

// Trả về số thứ tự khoảng thời gian nếu mã đúng, `null` nếu sai.
//
// LƯU Ý: trả về `step` thay vì true/false là có chủ ý — nơi gọi phải lưu lại
// step vừa dùng để không chấp nhận lại chính mã đó (xem routes/auth.js). Mỗi
// mã sống 30 giây; ai nhìn trộm được màn hình có thể dùng lại trong khoảng đó.
function verify(secretBase32, code, atMs = Date.now()) {
  const sach = String(code || '').replace(/\D/g, '');
  if (sach.length !== DIGITS) return null;

  const secretBuf = base32Decode(secretBase32);
  if (!secretBuf.length) return null;

  const now = currentStep(atMs);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const step = now + d;
    // So sánh thời gian hằng số để không rò rỉ thông tin qua thời gian phản hồi.
    const mong = Buffer.from(hotp(secretBuf, step));
    const nhan = Buffer.from(sach);
    if (mong.length === nhan.length && crypto.timingSafeEqual(mong, nhan)) {
      return step;
    }
  }
  return null;
}

// Chuỗi mà ứng dụng xác thực quét từ mã QR. `label` hiện trong ứng dụng — dùng
// email để người dùng phân biệt khi có nhiều tài khoản.
function otpauthUri({ label, issuer, secret }) {
  const nhan = encodeURIComponent(`${issuer}:${label}`);
  const q = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${nhan}?${q.toString()}`;
}

// Chia nhóm 4 ký tự cho dễ gõ tay khi điện thoại không quét được mã QR.
function secretDeDoc(secret) {
  return String(secret).replace(/(.{4})/g, '$1 ').trim();
}

module.exports = {
  generateSecret,
  verify,
  otpauthUri,
  secretDeDoc,
  currentStep,
  STEP_SECONDS,
  DIGITS,
  // Chỉ dùng cho kiểm thử:
  _base32Encode: base32Encode,
  _base32Decode: base32Decode,
  _hotp: hotp,
};
