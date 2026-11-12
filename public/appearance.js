// Phần dùng chung cho mọi trang quản trị (admin.html, users.html): đổi giao diện
// sáng/tối, đổi bảng màu, đóng/mở menu tài khoản. Lựa chọn lưu trong
// localStorage nên áp dụng cho cả hai trang.
//
// Mọi phần tử đều tùy chọn: trang nào thiếu thì bỏ qua.

/* ---------- Giao diện sáng / tối ---------- */
const themeToggleBtn = document.getElementById('theme-toggle');
const themeIconDark = document.getElementById('theme-icon-dark');
const themeIconLight = document.getElementById('theme-icon-light');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  if (themeIconDark) themeIconDark.style.display = theme === 'light' ? 'none' : 'block';
  if (themeIconLight) themeIconLight.style.display = theme === 'light' ? 'block' : 'none';
  try { localStorage.setItem('beacon-admin-theme-v3', theme); } catch { /* bị chặn: chỉ không nhớ */ }
}

// Khóa '-v3': đổi sang phong cách Trình diễn (nền sáng, thanh bên màu mực) làm mặc định.
// Dùng khóa mới để máy đã lưu lựa chọn cũ cũng nhận giao diện mới một lần; sau đó tự chọn lại được.
applyTheme(localStorage.getItem('beacon-admin-theme-v3') || 'light');

if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'light' ? 'dark' : 'light');
  });
}

/* ---------- Bảng màu ---------- */
const paletteBtn = document.getElementById('palette-btn');
const paletteSwatches = document.querySelectorAll('.palette-swatch');

function applyPalette(palette) {
  document.documentElement.setAttribute('data-palette', palette);
  try { localStorage.setItem('beacon-admin-palette-v3', palette); } catch { /* bị chặn: chỉ không nhớ */ }
  paletteSwatches.forEach((btn) => btn.classList.toggle('active', btn.dataset.palette === palette));
}

applyPalette(localStorage.getItem('beacon-admin-palette-v3') || 'stage');

if (paletteBtn) {
  paletteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('.palette-panel')) return;
    paletteBtn.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!paletteBtn.contains(e.target)) paletteBtn.classList.remove('open');
  });
  paletteSwatches.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      applyPalette(btn.dataset.palette);
    });
  });
}

/* ---------- Menu tài khoản (chỉ lo đóng/mở) ---------- */
// Bấm vào vùng trống của menu thì giữ nguyên; bấm một mục thì đóng lại. Mỗi mục
// làm gì do từng trang tự gắn (admin.js có "Đổi mật khẩu").
const avatarBtn = document.getElementById('avatar-btn');
if (avatarBtn) {
  avatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target.closest('.avatar-panel') && !e.target.closest('.avatar-menu-item')) return;
    avatarBtn.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!avatarBtn.contains(e.target)) avatarBtn.classList.remove('open');
  });
}

/* ---------- Tên bảo tàng ----------
   Một bộ mã nguồn chạy cho nhiều bảo tàng, nên tên lấy từ máy chủ (museum.name trong
   manifest) chứ không viết cứng trong HTML. */
fetch('/api/v1/site')
  .then((r) => r.json())
  .then(({ ten }) => {
    if (!ten) return;
    document.title = document.title.replace(/[^·]*$/, ` ${ten}`);
    // Cố ý KHÔNG hiện tên đơn vị dưới logo nữa (chủ dự án yêu cầu, 2026-11-12).
  })
  .catch(() => { /* không có tên thì giữ tên thương hiệu */ });


/* ---------- Bàn phím cho 3 nút mở panel (thêm 2026-09-16) ----------
   Ba nút này buộc phải là <div>: bên trong chứa panel có nút con, mà nút lồng
   trong nút là HTML không hợp lệ. Bù lại bằng role="button" + tabindex trong
   admin.html và tự xử Enter/Space ở đây — nếu không thì KHÔNG đăng xuất và
   không đổi mật khẩu được bằng bàn phím. */
document.querySelectorAll('[data-nut-ban-phim]').forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      el.click();
    }
  });
});

// Esc đóng mọi panel đang mở, và trả focus về đúng nút vừa mở nó.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.palette-btn.open, .notif-btn.open, .avatar-btn.open').forEach((el) => {
    el.classList.remove('open');
    if (el.matches('[data-nut-ban-phim]')) el.focus();
  });
});
