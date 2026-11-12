/* ---------- Cấu hình hiệu ứng reveal (tương đương RevealText) ---------- */
// Chữ chạy = tên thương hiệu đã cài (thuatNgu.js nạp trước), thay cho "BEACON" cũ.
const TEXT = (window.tt ? tt('{THUONGHIEU}') : 'QUẢN TRỊ');
const LETTER_DELAY = 90;     // ms giữa các chữ khi bung ra
const SPRING_DURATION = 550; // ms để hiệu ứng spring "lắng" lại
const SWEEP_DELAY = 60;      // ms giữa các chữ khi quét overlay
const SWEEP_DURATION = 450;  // ms mỗi lượt quét

// Trước đây mỗi chữ lấy 6 ảnh phong cảnh từ images.unsplash.com: máy chủ đặt trong mạng
// nội bộ/không có Internet thì trang đăng nhập gọi ra ngoài vô ích (và lộ IP người dùng
// cho bên thứ ba). Nay tô bằng dải màu thuần CSS (login.css .imgfill).

const lettersEl = document.getElementById('letters');
const revealEl = document.getElementById('reveal');
const loginWrap = document.getElementById('login-wrap');

/* ---------- Dựng các chữ cái ---------- */
TEXT.split('').forEach((ch, i) => {
  const span = document.createElement('span');
  span.className = 'letter';
  span.style.animationDelay = `${i * LETTER_DELAY}ms`;
  span.style.setProperty('--sweep-delay', `${i * SWEEP_DELAY}ms`);

  const img = document.createElement('span');
  img.className = 'imgfill';
  img.textContent = ch;

  const sweep = document.createElement('span');
  sweep.className = 'sweep';
  sweep.textContent = ch;

  if (ch === ' ') ch = '\u00A0'; // khoảng trắng trong inline-block bị co mất
  img.textContent = ch;
  sweep.textContent = ch;
  span.append(ch, img, sweep);
  lettersEl.appendChild(span);
});

/* ---------- Điều phối thời gian: bung chữ -> quét overlay -> hiện ô đăng nhập ---------- */
const lastLetterDelay = (TEXT.length - 1) * LETTER_DELAY;
const sweepStart = lastLetterDelay + SPRING_DURATION;
const lastSweepDelay = (TEXT.length - 1) * SWEEP_DELAY;
const revealStart = sweepStart + lastSweepDelay + SWEEP_DURATION + 200;

// Người dùng bật "giảm chuyển động" thì bỏ qua màn chữ chạy, vào thẳng ô đăng nhập.
const giamChuyenDong = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

setTimeout(() => {
  document.querySelectorAll('.letter').forEach((el) => el.classList.add('sweep-on'));
}, giamChuyenDong ? 0 : sweepStart);

setTimeout(() => {
  revealEl.classList.add('hide');
  loginWrap.classList.add('show');
  document.getElementById('login-username').focus();
}, giamChuyenDong ? 0 : revealStart);

/* ---------- Nút con mắt hiện/ẩn mật khẩu ---------- */
const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17.94 17.94A10.94 10.94 0 0112 19c-7 0-11-7-11-7a20.3 20.3 0 015.06-5.94M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 7 11 7a20.3 20.3 0 01-3.05 4.05M14.12 14.12a3 3 0 11-4.24-4.24"/><path d="M1 1l22 22"/></svg>';
document.querySelectorAll('.pw-eye-btn').forEach((btn) => {
  btn.innerHTML = EYE_ICON;
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF_ICON : EYE_ICON;
  });
});

/* ---------- Tên bảo tàng (cùng nguồn với appearance.js) ---------- */
fetch('/api/v1/site')
  .then((r) => r.json())
  .then(({ ten }) => {
    if (!ten) return;
    document.title = `Đăng nhập · ${ten}`;
    document.querySelector('.login-sub').textContent = `Đăng nhập để quản lý ${ten}`;
  })
  .catch(() => { /* giữ câu mặc định trong HTML */ });

/* Luồng "quên mật khẩu" chỉ dành cho tài khoản Chủ có email khôi phục: mã gửi về
 * hộp thư riêng của chủ tài khoản, nên người đã nghỉ việc dù nhớ mật khẩu cũ cũng
 * không dùng được. (Route đổi mật khẩu công khai cũ đã gỡ — xem cuối routes/auth.js.) */

/* ---------- Quên mật khẩu (chỉ tài khoản Chủ có email khôi phục) ---------- */
const loginForm = document.getElementById('login-form');
const forgotForm = document.getElementById('forgot-form');
const forgotMsg = document.getElementById('forgot-msg');
const forgotBtn = document.getElementById('forgot-btn');
const forgotStep2 = document.getElementById('forgot-step2');
let daGuiMa = false;

function showForgot(hien) {
  loginForm.hidden = hien;
  forgotForm.hidden = !hien;
  forgotMsg.textContent = '';
  forgotMsg.className = 'login-msg';
  if (hien) {
    document.getElementById('forgot-username').value = document.getElementById('login-username').value.trim();
    document.getElementById('forgot-username').focus();
  }
}

function forgotError(text) {
  forgotMsg.className = 'login-msg';
  forgotMsg.textContent = text;
  forgotForm.classList.remove('shake');
  void forgotForm.offsetWidth;
  forgotForm.classList.add('shake');
}

function forgotOk(text) {
  forgotMsg.className = 'login-msg ok';
  forgotMsg.textContent = text;
}

/* ---------- Popup "Quên mật khẩu?" ----------
 * Bấm "Quên mật khẩu?" KHÔNG mở thẳng form nhập mã nữa. Với gần như mọi người
 * (Biên tập / Chỉ xem) thì câu trả lời đúng là "nhờ tài khoản Chủ đặt lại giúp",
 * còn luồng mã email chỉ dành cho chính tài khoản Chủ - đưa thẳng vào đó sẽ làm
 * nhân viên loay hoay chờ một bức thư không bao giờ tới. */
const forgotModal = document.getElementById('forgot-modal');

function moPopupQuenMatKhau(mo) {
  forgotModal.hidden = !mo;
  document.body.style.overflow = mo ? 'hidden' : '';
  if (mo) document.getElementById('forgot-modal-ok').focus();
  else document.getElementById('forgot-open').focus();
}

document.getElementById('forgot-open').addEventListener('click', () => moPopupQuenMatKhau(true));
document.getElementById('forgot-modal-close').addEventListener('click', () => moPopupQuenMatKhau(false));
document.getElementById('forgot-modal-ok').addEventListener('click', () => moPopupQuenMatKhau(false));

// Bấm ra nền ngoài thì đóng, nhưng bấm trong thẻ thì không.
forgotModal.addEventListener('click', (e) => {
  if (e.target === forgotModal) moPopupQuenMatKhau(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !forgotModal.hidden) moPopupQuenMatKhau(false);
});

// Lối phụ: chính tài khoản Chủ mới đi tiếp vào luồng mã email.
document.getElementById('forgot-owner-btn').addEventListener('click', () => {
  moPopupQuenMatKhau(false);
  showForgot(true);
});
document.getElementById('forgot-back').addEventListener('click', () => {
  showForgot(false);
  // Về trạng thái ban đầu, nếu không lần mở sau sẽ thấy ô nhập mã cũ.
  daGuiMa = false;
  forgotStep2.hidden = true;
  forgotBtn.textContent = 'Gửi mã về email';
  document.getElementById('forgot-username').readOnly = false;
});

forgotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('forgot-username').value.trim();
  if (!username) { forgotError('Chưa nhập tên tài khoản.'); return; }

  forgotBtn.disabled = true;
  const nhanCu = forgotBtn.textContent;
  forgotBtn.textContent = 'Đang xử lý...';

  try {
    if (!daGuiMa) {
      const res = await fetch('/api/v1/auth/forgot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { forgotError(data.error || 'Không gửi được mã.'); return; }

      daGuiMa = true;
      forgotStep2.hidden = false;
      // Khóa ô tên tài khoản: mã đã gửi cho đúng tài khoản này, đổi tên ở bước 2 chỉ
      // dẫn tới lỗi "mã không đúng" khó hiểu.
      document.getElementById('forgot-username').readOnly = true;
      forgotBtn.textContent = 'Đặt mật khẩu mới';
      forgotOk(data.message || 'Đã gửi mã.');
      document.getElementById('forgot-code').focus();
      return;
    }

    const code = document.getElementById('forgot-code').value.trim();
    const newPassword = document.getElementById('forgot-newpw').value;
    if (!code) { forgotError('Chưa nhập mã trong email.'); return; }
    if (newPassword.length < 8) { forgotError('Mật khẩu mới phải có ít nhất 8 ký tự.'); return; }

    const res = await fetch('/api/v1/auth/forgot/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, code, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { forgotError(data.error || 'Mã không đúng.'); return; }

    showForgot(false);
    document.getElementById('login-username').value = username;
    document.getElementById('login-password').value = '';
    document.getElementById('login-password').focus();
    const m = document.getElementById('login-msg');
    m.className = 'login-msg ok';
    m.textContent = 'Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.';
  } catch {
    forgotError('Không thể kết nối tới server, vui lòng thử lại.');
  } finally {
    forgotBtn.disabled = false;
    if (forgotBtn.textContent === 'Đang xử lý...') forgotBtn.textContent = nhanCu;
  }
});

/* ---------- Xử lý đăng nhập (gọi API thật /api/v1/auth/login) ---------- */
const form = document.getElementById('login-form');
const msg = document.getElementById('login-msg');
const submitBtn = form.querySelector('.login-btn');
const card = form;

// Lời nhắn do trang quản trị để lại khi đưa người dùng ra đây (vd vừa đổi mật khẩu).
try {
  const nhan = sessionStorage.getItem('beacon_login_msg');
  if (nhan) {
    sessionStorage.removeItem('beacon_login_msg');
    msg.className = 'login-msg ok';
    msg.textContent = nhan;
  }
} catch { /* sessionStorage bị chặn thì thôi */ }

function showError(text) {
  msg.textContent = text;
  card.classList.remove('shake');
  void card.offsetWidth;
  card.classList.add('shake');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang đăng nhập...';
  msg.textContent = '';

  try {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));

    // LƯU Ý: phải kiểm mfaRequired TRƯỚC chốt `!data.token` bên dưới — đăng nhập có
    // mã xác thực thì phản hồi cố ý không kèm token (chỉ có vé tạm).
    if (res.ok && data.mfaRequired && data.mfaToken) {
      moBuocMa(data.mfaToken, data.name);
      return;
    }

    if (!res.ok || !data.token) {
      showError(data.error || 'Sai tài khoản hoặc mật khẩu.');
      return;
    }

    sessionStorage.setItem('beacon_admin_token', data.token);
    window.location.replace('admin.html');
  } catch (err) {
    showError('Không thể kết nối tới server, vui lòng thử lại.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Đăng nhập';
  }
});


/* ---------- Bước 2 của đăng nhập: mã 6 số ----------
 * Vé tạm (mfaToken) sống 5 phút và không dùng được ở route nào khác. Chỉ giữ trong
 * biến của trang, không ghi vào sessionStorage — tải lại trang thì nhập lại mật khẩu. */
const mfaForm = document.getElementById('mfa-form');
const mfaMsg = document.getElementById('mfa-msg');
const mfaBtn = document.getElementById('mfa-btn');
const mfaCode = document.getElementById('mfa-code');
let veTam = null;

function moBuocMa(token, ten) {
  veTam = token;
  loginForm.hidden = true;
  forgotForm.hidden = true;
  mfaForm.hidden = false;
  document.getElementById('mfa-sub').textContent =
    `Chào ${ten || 'bạn'}, mở ứng dụng xác thực trên điện thoại và nhập mã 6 số.`;
  mfaMsg.textContent = '';
  mfaCode.value = '';
  mfaCode.focus();
}

function veLaiDangNhap() {
  veTam = null;
  mfaForm.hidden = true;
  loginForm.hidden = false;
  document.getElementById('login-password').value = '';
  document.getElementById('login-password').focus();
}

document.getElementById('mfa-back').addEventListener('click', veLaiDangNhap);

mfaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = mfaCode.value.trim();
  if (!code) { mfaMsg.textContent = 'Chưa nhập mã.'; return; }

  mfaBtn.disabled = true;
  mfaBtn.textContent = 'Đang kiểm tra...';
  mfaMsg.className = 'login-msg';
  mfaMsg.textContent = '';
  try {
    const res = await fetch('/api/v1/auth/login/mfa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken: veTam, code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) {
      mfaMsg.textContent = data.error || 'Mã không đúng.';
      mfaCode.value = '';
      mfaCode.focus();
      mfaForm.classList.remove('shake');
      void mfaForm.offsetWidth;
      mfaForm.classList.add('shake');
      // Vé tạm đã hết hạn thì quay về bước mật khẩu, thay vì để người dùng gõ mã mãi.
      if (res.status === 401 && /quá hạn/.test(data.error || '')) setTimeout(veLaiDangNhap, 1800);
      return;
    }
    sessionStorage.setItem('beacon_admin_token', data.token);
    window.location.replace('admin.html');
  } catch {
    mfaMsg.textContent = 'Không thể kết nối tới server, vui lòng thử lại.';
  } finally {
    mfaBtn.disabled = false;
    mfaBtn.textContent = 'Xác nhận';
  }
});

// Gõ đủ 6 số là tự gửi — mã chỉ sống 30 giây.
mfaCode.addEventListener('input', () => {
  mfaCode.value = mfaCode.value.replace(/\D/g, '');
  if (mfaCode.value.length === 6) mfaForm.requestSubmit();
});
