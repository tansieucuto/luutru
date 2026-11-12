/* ---------- Chốt đăng nhập + gọi API thật (JWT lấy từ /api/v1/auth/login) ---------- */
function getToken() {
  return sessionStorage.getItem('beacon_admin_token');
}

// replace() chứ không phải href: trang quản trị không nằm lại trong lịch sử, bấm
// Back sau khi đăng xuất không quay lại được.
function logout(thongBao) {
  sessionStorage.removeItem('beacon_admin_token');
  if (thongBao) sessionStorage.setItem('beacon_login_msg', thongBao);
  window.location.replace('login.html');
}

if (!getToken()) {
  window.location.replace('login.html');
}
// Back/Forward có thể khôi phục trang từ bộ nhớ đệm (bfcache) mà không chạy lại
// script — phải kiểm tra lại phiên mỗi lần trang hiện ra.
window.addEventListener('pageshow', () => {
  if (!getToken()) window.location.replace('login.html');
});

/* ---------- Vai trò của người đang đăng nhập ----------
 * Nguyên tắc: người dùng KHÔNG BAO GIỜ nhìn thấy nút mà họ không được bấm. Ẩn
 * đi tốt hơn để bấm rồi báo lỗi — báo lỗi làm người ta tưởng phần mềm hỏng.
 *
 * LƯU Ý: đây CHỈ là lớp cho dễ dùng. Ranh giới bảo mật thật nằm ở server
 * (requireLevel trong middleware/auth.js). Sửa ở đây không mở thêm quyền gì.
 */
const ROLE_LEVEL = { viewer: 1, editor: 2, owner: 3 };
let currentUser = null;

function myLevel() {
  return ROLE_LEVEL[currentUser?.role] || 0;
}

function applyRoleVisibility() {
  // data-need-role="owner" -> chỉ Chủ thấy
  document.querySelectorAll('[data-need-role]').forEach((el) => {
    el.hidden = currentUser?.role !== el.dataset.needRole;
  });
  // data-need-level="editor" -> Biên tập trở lên mới thấy
  document.querySelectorAll('[data-need-level]').forEach((el) => {
    el.hidden = myLevel() < (ROLE_LEVEL[el.dataset.needLevel] || 99);
  });

  // Danh tính hiện ở đầu menu avatar (góc phải trên). users.html vẫn dùng
  // #side-user-* ở góc dưới sidebar nên giữ cả hai nhánh — mỗi trang chỉ có một.
  const targets = [
    ['me-name', 'me-role'],
    ['side-user-name', 'side-user-role'],
  ];
  for (const [nameId, roleId] of targets) {
    const name = document.getElementById(nameId);
    const role = document.getElementById(roleId);
    if (name) name.textContent = currentUser?.name || '';
    if (role) role.textContent = currentUser?.roleLabel || '';
  }

  // Chỉ xem: không ẩn sạch mọi thứ rồi để trang trống khó hiểu — nói rõ họ đang
  // ở chế độ nào và làm gì nếu cần sửa.
  const banner = document.getElementById('readonly-banner');
  if (banner) banner.hidden = myLevel() >= ROLE_LEVEL.editor;

  // Tab "Giao diện ứng dụng" có ~300 ô nhập. Ẩn nút Lưu là đủ chặn, nhưng vẫn cho
  // gõ thì người ta gõ xong cả trang mới phát hiện không lưu được — nên khóa luôn
  // ô nhập cho vai trò Chỉ xem. Chỉ làm trong ĐÚNG tab này: các tab khác có ô tìm
  // kiếm/lọc mà Chỉ xem vẫn phải dùng được.
  const chiDuocDoc = myLevel() < ROLE_LEVEL.editor;
  document.querySelectorAll('#view-ui-strings input, #view-ui-strings textarea').forEach((el) => {
    // radio/checkbox không có readOnly — phải dùng disabled.
    if (el.type === 'radio' || el.type === 'checkbox') el.disabled = chiDuocDoc;
    else el.readOnly = chiDuocDoc;
  });

  document.body.dataset.role = currentUser?.role || '';
}

async function loadCurrentUser() {
  try {
    const res = await fetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${getToken()}` } });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) return;
    currentUser = await res.json();
  } catch {
    // Mất kết nối: giữ trạng thái ẩn mặc định (ẩn hết các nút ghi) — nghiêng về
    // phía chặt hơn thay vì hiện nút rồi bấm thất bại.
  }
  applyRoleVisibility();
  hienThongBaoDoiTen();
}

// Tên đăng nhập của mình vừa bị tài khoản Chủ đổi (routes/adminUsers.js). Phiên bám theo id
// nên KHÔNG bị cắt — báo ngay lần tải trang kế tiếp, kèm ai đổi và lúc nào. Nếu không, lần sau
// gõ tên cũ họ chỉ thấy "Sai tài khoản hoặc mật khẩu" mà không hiểu vì sao.
// Hiện tới khi bấm "Đã hiểu", KHÔNG tự biến mất như toast — bỏ lỡ là mất tên đăng nhập.
function hienThongBaoDoiTen() {
  const el = document.getElementById('rename-banner');
  const tb = currentUser?.thongBaoDoiTen;
  if (!el) return;
  if (!tb) { el.hidden = true; return; }
  const luc = new Date(tb.luc).toLocaleString('vi-VN');
  el.innerHTML = `Tên đăng nhập của bạn đã được <strong>${escapeHtml(tb.boi || 'tài khoản Chủ')}</strong>
    đổi từ <code>${escapeHtml(tb.tu)}</code> thành <strong><code>${escapeHtml(tb.sang)}</code></strong>
    lúc ${escapeHtml(luc)}. <strong>Lần đăng nhập sau hãy dùng tên mới.</strong>
    <button type="button" class="btn btn-outline btn-tiny" id="rename-banner-ok" style="margin-left:8px;">Đã hiểu</button>`;
  el.hidden = false;
  document.getElementById('rename-banner-ok').addEventListener('click', async () => {
    try {
      await fetch('/api/v1/auth/me/da-doc-thong-bao', { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` } });
    } catch { /* mất mạng: lần tải trang sau hiện lại, không mất gì */ }
    el.hidden = true;
  });
}

// Hai loại lỗi đã được BÁO cho người dùng ngay tại authFetch. Nơi gọi bắt được
// chúng thì im lặng — báo thêm lần nữa sẽ ra hai thông báo chồng nhau.
// Dùng daBaoLoi(err) ở mọi khối catch thay vì so thẳng với từng hằng số.
const SESSION_EXPIRED = new Error('Phien dang nhap het han');
const PERMISSION_DENIED = new Error('Khong du quyen');

function daBaoLoi(err) {
  // LƯU Ý: PHẢI so với SESSION_EXPIRED, KHÔNG được gọi lại chính hàm này. Gọi
  // daBaoLoi() ở đây là đệ quy vô hạn: mọi khối catch ném RangeError thay vì trả
  // true/false, và cả đường xử lý lỗi hỏng mà chỉ lộ ra khi thật sự gặp 401/403.
  return err === SESSION_EXPIRED || err === PERMISSION_DENIED;
}

// fetch có gắn sẵn JWT.
async function authFetch(url, options = {}) {
  const headers = Object.assign({}, options.headers, { Authorization: `Bearer ${getToken()}` });
  const res = await fetch(url, Object.assign({}, options, { headers }));

  // 401 = phiên không còn dùng được (token hết hạn, tài khoản bị xóa/khóa, mật
  // khẩu vừa đổi) -> đăng xuất thật.
  if (res.status === 401) {
    logout();
    throw SESSION_EXPIRED;
  }

  // 403 = KHÔNG ĐỦ QUYỀN: giữ nguyên trang (không đá ra màn đăng nhập, không mất
  // việc đang gõ) và hiện đúng câu từ chối máy chủ gửi về.
  // LƯU Ý: chỉ đúng được vì middleware/auth.js tách mã lỗi — token hỏng trả 401
  // chứ không trả 403. Đổi lại ở đó là hỏng cả chỗ này.
  if (res.status === 403) {
    const data = await res.json().catch(() => ({}));
    pushNotification('error', data.error
      || 'Tài khoản của bạn không làm được việc này. Nếu bạn cần quyền, hãy liên hệ quản lý.');
    throw PERMISSION_DENIED;
  }

  return res;
}

// Chặn hành vi mặc định của trình duyệt khi kéo-thả file: thả hơi lệch ra ngoài
// dropzone (rất dễ xảy ra) thì trình duyệt tự điều hướng cả tab sang
// file:///đường/dẫn/ảnh.png. Chặn ở mức window/document cho MỌI trường hợp;
// dropzone riêng (initDropzone) vẫn chạy bình thường vì listener của nó chạy
// trước (giai đoạn bubbling từ input lên document) và đã tự đọc input.files.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

/* ---------- Topbar watermark (trống đồng / chim lạc) ---------- */
(function initWatermark() {
  const trongDongSvg = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="12" cy="12" r="10.5"/><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></svg>`;
  const chimLacSvg = `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M2 15c3-6 7-9 12-9 3 0 5.5 1.2 7.5 3.2-1.6.2-2.8.9-3.7 2-1 .1-1.9.5-2.6 1.2 2 .1 3.6.9 4.8 2.3-2.4.6-4.6.4-6.6-.7-2.6 1-5.6 1.3-8.4.2z"/><circle cx="6.8" cy="12.4" r="0.9" fill="currentColor" stroke="none"/></svg>`;
  const iconUnitWidth = 34 + 46; // bề rộng icon + khoảng cách gap

  const track = document.getElementById('watermark-track');
  const container = track ? track.parentElement : null;

  function buildWatermark() {
    if (!track || !container) return;
    const containerWidth = container.clientWidth || window.innerWidth;
    const count = Math.max(6, Math.ceil(containerWidth / iconUnitWidth) + 2);
    const icons = [];
    for (let i = 0; i < count; i++) icons.push(i % 2 === 0 ? trongDongSvg : chimLacSvg);
    const groupHtml = icons.map((svg) => `<span class="wm-icon">${svg}</span>`).join('');
    // Lặp lại nhóm icon 2 lần để dải chạy vòng liền mạch, đồng thời phủ kín toàn bộ khoảng trống.
    track.innerHTML = groupHtml + groupHtml;
  }

  buildWatermark();
  window.addEventListener('resize', buildWatermark);
})();

/* ---------- Thông báo (chuông) ---------- */
let notifications = [];
const notifBtn = document.getElementById('notif-btn');
const notifDot = document.getElementById('notif-dot');
const notifList = document.getElementById('notif-list');

function formatNotifTime(date) {
  return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function renderNotifications() {
  notifDot.style.display = notifications.length ? 'block' : 'none';

  if (!notifications.length) {
    notifList.innerHTML = '<div class="notif-empty">Chưa có thông báo nào.</div>';
    return;
  }

  notifList.innerHTML = notifications.map((n) => `
    <div class="notif-item ${n.type}">
      <div class="notif-icon">
        ${n.type === 'success'
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'}
      </div>
      <div class="notif-item-body">
        <div class="notif-item-msg">${escapeHtml(n.message)}</div>
        <div class="notif-item-time">${formatNotifTime(n.time)}</div>
      </div>
    </div>
  `).join('');
}

// Hiệu ứng nút khi lưu thành công: nháy màu xanh + hiện chữ "Đã lưu" trong msgEl.
function flashSaved(btn, msgEl, message) {
  if (msgEl) {
    msgEl.textContent = message;
    msgEl.className = 'form-msg ok';
  }
  if (btn) {
    btn.classList.remove('btn-saved-flash');
    void btn.offsetWidth;
    btn.classList.add('btn-saved-flash');
    setTimeout(() => btn.classList.remove('btn-saved-flash'), 700);
  }
}

function pushNotification(type, message) {
  // Câu lỗi của máy chủ vẫn dùng từ cũ ("hiện vật"...) — đổi sang tên đã cài (thuatNgu.js).
  message = window.CMS ? CMS.ttCu(CMS.tt(String(message ?? ''))) : message;
  notifications.unshift({ type, message, time: new Date() });
  notifications = notifications.slice(0, 30);
  renderNotifications();
  showToast(type, message);
}

/* ---------- Toast (popup nổi góc màn hình, tự biến mất) ---------- */
const TOAST_AUTO_DISMISS_MS = 4000;
const toastContainer = document.getElementById('toast-container');

function showToast(type, message) {
  if (!toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">
      ${type === 'success'
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'}
    </div>
    <div class="toast-msg">${escapeHtml(message)}</div>
    <button type="button" class="toast-close" aria-label="Đóng thông báo">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
  `;

  let dismissTimer;
  const dismiss = () => {
    clearTimeout(dismissTimer);
    toast.classList.add('toast-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  dismissTimer = setTimeout(dismiss, TOAST_AUTO_DISMISS_MS);

  toastContainer.appendChild(toast);
}

notifBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (e.target.closest('.notif-panel')) return;
  notifBtn.classList.toggle('open');
});
document.addEventListener('click', (e) => {
  if (!notifBtn.contains(e.target)) notifBtn.classList.remove('open');
});
document.getElementById('notif-clear').addEventListener('click', (e) => {
  e.stopPropagation();
  notifications = [];
  renderNotifications();
});

renderNotifications();

/* ---------- Tài khoản (avatar) ----------
   Việc đóng/mở menu nằm ở appearance.js (dùng chung với users.html). Ở đây chỉ
   còn việc riêng của trang này. */
document.getElementById('logout-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  logout();
});

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

/* ---------- Đổi mật khẩu ---------- */
const passwordModalOverlay = document.getElementById('password-modal-overlay');
function openPasswordModal() {
  document.getElementById('password-current').value = '';
  document.getElementById('password-new').value = '';
  document.getElementById('password-confirm').value = '';
  document.getElementById('password-modal-msg').textContent = '';
  document.getElementById('password-modal-msg').className = 'form-msg';
  passwordModalOverlay.classList.add('active');
}
function closePasswordModal() {
  passwordModalOverlay.classList.remove('active');
}
document.getElementById('change-password-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  avatarBtn.classList.remove('open');
  openPasswordModal();
});
document.getElementById('password-modal-close').addEventListener('click', closePasswordModal);
passwordModalOverlay.addEventListener('click', (e) => {
  if (e.target === passwordModalOverlay) closePasswordModal();
});

document.getElementById('password-save-btn').addEventListener('click', async () => {
  const btn = document.getElementById('password-save-btn');
  const msgEl = document.getElementById('password-modal-msg');
  const currentPassword = document.getElementById('password-current').value;
  const newPassword = document.getElementById('password-new').value;
  const confirmPassword = document.getElementById('password-confirm').value;

  if (!currentPassword || !newPassword) {
    msgEl.textContent = 'Vui lòng nhập đủ mật khẩu hiện tại và mật khẩu mới.';
    msgEl.className = 'form-msg err';
    return;
  }
  if (newPassword.length < 8) {
    msgEl.textContent = 'Mật khẩu mới phải có ít nhất 8 ký tự.';
    msgEl.className = 'form-msg err';
    return;
  }
  if (newPassword !== confirmPassword) {
    msgEl.textContent = 'Nhập lại mật khẩu mới không khớp.';
    msgEl.className = 'form-msg err';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Đang lưu...';
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await authFetch(`/api/v1/auth/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.textContent = data.error || 'Không thể đổi mật khẩu.';
      msgEl.className = 'form-msg err';
      return;
    }
    // Server đã cắt mọi phiên cũ (kể cả phiên này) — đăng nhập lại bằng mật khẩu mới.
    flashSaved(btn, msgEl, 'Đã đổi mật khẩu. Đang chuyển về trang đăng nhập...');
    setTimeout(() => logout('Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.'), 1200);
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Lỗi kết nối server.';
      msgEl.className = 'form-msg err';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lưu mật khẩu mới';
  }
});

/* Giao diện sáng/tối + bảng màu: xem appearance.js (dùng chung với users.html) */

/* ---------- Chuyển view ---------- */
const titles = {
  home: 'Trang chủ',
  videos: 'Quản lý nội dung',
  search: 'Tìm kiếm nội dung',
  'static-content': 'Lịch sử đóng gói',
  'ui-strings': 'Giao diện ứng dụng',
  history: 'Nhật ký & hoàn tác',
  analytics: 'Thống kê',
};

function switchView(view) {
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');

  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === view));

  document.getElementById('page-title').textContent = titles[view];
  document.getElementById('crumb-current').textContent = titles[view];

  if (view === 'home') { renderHome(); loadVanHanh(); veViecDichTrangChu(); }
  if (view === 'videos') { loadVanHanh(); loadStaticContentStatus(); loadContentMeta(); loadZonesPage(zonePageState.page); loadLanguageBackups(); }
  if (view === 'search') loadContentManifest();
  if (view === 'static-content') loadPackagingHistory();
  if (view === 'ui-strings') { loadLanguagesPanel(); loadMuseumName(); loadBeaconConfig(); loadUiStrings(); loadDoDayDu(); }
  if (view === 'history') loadHistoryLog();
  if (view === 'analytics') loadAnalytics(currentAnalyticsRange);
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  // Mục "Quản lý tài khoản" là thẻ <a> dẫn sang users.html, không có data-view —
  // bỏ qua để trình duyệt tự chuyển trang.
  if (!btn.dataset.view) return;
  btn.addEventListener('click', () => { switchView(btn.dataset.view); datMenu(false); });
});

/* ---------- Menu trên điện thoại ----------
   Dưới 780px thanh bên bị ẩn (admin.css) và TRƯỚC ĐÂY không có gì thay thế: vào
   được trang chủ rồi là mắc kẹt, không còn lối sang tab khác. Nay nút ☰ trượt
   thanh bên ra như ngăn kéo. */
const sidebarEl = document.querySelector('.sidebar');
const menuToggleBtn = document.getElementById('menu-toggle');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');

function datMenu(mo) {
  if (!sidebarEl) return;
  sidebarEl.classList.toggle('open', mo);
  if (sidebarBackdrop) sidebarBackdrop.hidden = !mo;
  if (menuToggleBtn) menuToggleBtn.setAttribute('aria-expanded', String(mo));
}

if (menuToggleBtn) {
  menuToggleBtn.addEventListener('click', () => datMenu(!sidebarEl.classList.contains('open')));
}
if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', () => datMenu(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') datMenu(false); });

// Tải vai trò rồi mới ẩn/hiện — làm SỚM nhất có thể để người dùng không kịp
// nhìn thấy nút mà họ không được bấm.
loadCurrentUser();

/* ---------- Trang chủ ---------- */
function animateCounter(el, target) {
  const start = Number(el.textContent) || 0;
  const duration = 500;
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const value = Math.round(start + (target - start) * progress);
    el.textContent = value;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function renderHome() {
  // Chưa tải xong thì hiện "—", KHÔNG hiện 0: số 0 trông y hệt "kho rỗng" nên
  // người dùng tưởng mất sạch dữ liệu.
  if (!contentManifest) {
    document.getElementById('stat-total-zones').textContent = '—';
    document.getElementById('stat-total-exhibits').textContent = '—';
    const le = document.getElementById('stat-total-langs');
    if (le) le.textContent = '—';
    document.getElementById('donut-percent').textContent = '—';
    return;
  }
  const zones = (contentManifest && contentManifest.zones) || [];
  const languages = (contentManifest && contentManifest.languages) || [];
  const exhibits = [];
  zones.forEach((z) => (z.exhibits || []).forEach((e) => exhibits.push({ ...e, zoneId: z.id, zoneMajor: z.major, zoneName: z.name })));

  animateCounter(document.getElementById('stat-total-zones'), zones.length);
  animateCounter(document.getElementById('stat-total-exhibits'), exhibits.length);
  const langsEl = document.getElementById('stat-total-langs');
  if (langsEl) langsEl.textContent = String(languages.length);
  // Dải hành trình: bước đã có dữ liệu thì tô đặc.
  document.getElementById('journey-step-zones')?.classList.toggle('is-done', zones.length > 0);
  document.getElementById('journey-step-items')?.classList.toggle('is-done', exhibits.length > 0);

  const completeCount = exhibits.filter((e) => describeLangCompleteness(e, languages).complete).length;
  const completePct = exhibits.length ? Math.round((completeCount / exhibits.length) * 100) : 0;
  document.getElementById('status-donut').style.background =
    `conic-gradient(var(--gold) 0deg ${completePct * 3.6}deg, var(--border) ${completePct * 3.6}deg 360deg)`;
  document.getElementById('donut-percent').textContent = completePct + '%';

  const coverageEl = document.getElementById('lang-coverage-list');
  if (!languages.length) {
    coverageEl.innerHTML = '<div class="empty-state">Chưa cấu hình ngôn ngữ nào</div>';
  } else if (!exhibits.length) {
    coverageEl.innerHTML = '<div class="empty-state">Chưa có {muc} nào</div>';
  } else {
    coverageEl.innerHTML = languages.map((lang) => {
      const have = exhibits.filter((e) => e.audio?.tracks?.[lang]?.file).length;
      const pct = Math.round((have / exhibits.length) * 100);
      return `
        <div class="lang-coverage-row">
          <div class="lang-name">${escapeHtml(langLabel(lang))} (${escapeHtml(lang)})</div>
          <div class="lang-bar-track"><div class="lang-bar-fill" style="width:${pct}%"></div></div>
          <div class="lang-count">${have}/${exhibits.length}</div>
        </div>
      `;
    }).join('');
  }

  // Hiện vật mới được thêm vào cuối mảng của từng khu vực — lấy 5 hiện vật cuối làm "gần đây nhất".
  const recent = exhibits.slice(-5).reverse();
  document.getElementById('top-artifacts-body').innerHTML = recent.length ? recent.map((e) => `
    <tr data-zone-id="${e.zoneId}" data-exhibit-id="${e.id}">
      <td><span class="beacon-chip mono">${e.zoneMajor}:${e.minor}</span></td>
      <td>${escapeHtml(dispName(e.name) || e.id)}</td>
      <td>${langCompletenessBadge(e, languages)}</td>
    </tr>
  `).join('') : `<tr><td colspan="3"><div class="empty-state">Chưa có {muc} nào</div></td></tr>`;
}

function describeLangCompleteness(ex, languages) {
  if (!languages.length) return { complete: false, label: '—' };
  const have = languages.filter((l) => ex.audio?.tracks?.[l]?.file).length;
  return have === languages.length
    ? { complete: true, label: 'Đủ ngôn ngữ' }
    : { complete: false, label: `Thiếu ${languages.length - have} ngôn ngữ` };
}

function langCompletenessBadge(ex, languages) {
  const info = describeLangCompleteness(ex, languages);
  return `<span class="badge ${info.complete ? 'active' : 'inactive'}">${info.label}</span>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// Xem trước ảnh/audio hiện vật, đọc từ route tĩnh /content-media/* (server.js).
function mediaUrl(relPath) {
  return relPath ? `/content-media/${relPath}` : '';
}

function setMediaPreview(elId, relPath, altText) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!relPath) {
    el.style.display = 'none';
    el.removeAttribute('src');
    return;
  }
  el.src = mediaUrl(relPath);
  if (el.tagName === 'IMG') el.alt = altText || '';
  // <audio>/<video> không tự làm mới trạng thái hiển thị khi đổi .src bằng JS ở
  // một số trình duyệt (vd chuyển từ sửa khu vực A sang B, dùng lại cùng thẻ) —
  // gọi load() tường minh để chắc chắn hiện đúng file mới.
  if (el.tagName === 'AUDIO' || el.tagName === 'VIDEO') el.load();
  el.style.display = 'block';
}

// Hộp xác nhận dạng popup thay cho confirm() mặc định (hộp mặc định không theo
// giao diện trang, và ở vài trình duyệt còn hiện kèm tên miền nghe như cảnh báo
// bảo mật). Trả về Promise<boolean> nên gọi giống hệt confirm():
// `if (!(await confirmDialog('...'))) return;`
const confirmModalOverlay = document.getElementById('confirm-modal-overlay');
const confirmModalTitle = document.getElementById('confirm-modal-title');
const confirmModalMessage = document.getElementById('confirm-modal-message');
const confirmModalOk = document.getElementById('confirm-modal-ok');
const confirmModalCancel = document.getElementById('confirm-modal-cancel');
let confirmModalResolve = null;

function confirmDialog(message, { title = 'Xác nhận', confirmLabel = 'Đồng ý' } = {}) {
  confirmModalTitle.textContent = title;
  confirmModalMessage.textContent = message;
  confirmModalOk.textContent = confirmLabel;
  confirmModalOverlay.classList.add('active');
  confirmModalOk.focus();
  return new Promise((resolve) => { confirmModalResolve = resolve; });
}

function closeConfirmDialog(result) {
  confirmModalOverlay.classList.remove('active');
  if (confirmModalResolve) {
    const resolve = confirmModalResolve;
    confirmModalResolve = null;
    resolve(result);
  }
}

confirmModalOk.addEventListener('click', () => closeConfirmDialog(true));
confirmModalCancel.addEventListener('click', () => closeConfirmDialog(false));
confirmModalOverlay.addEventListener('click', (e) => {
  if (e.target === confirmModalOverlay) closeConfirmDialog(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && confirmModalOverlay.classList.contains('active')) closeConfirmDialog(false);
});

function hideMediaPreview(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.style.display = 'none';
  el.removeAttribute('src');
}

const DROPZONE_UPLOAD_ICON = '<svg class="dropzone-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 18a4 4 0 01-.6-7.96A5 5 0 0116.9 8.02 4.5 4.5 0 0117.5 18H7z"/><path d="M12 12v7M9 15l3-3 3 3"/></svg>';

// Markup kéo-thả file kiểu Google Drive, dùng cho các ô audio sinh động theo
// ngôn ngữ (renderZoneOtherLangFields/renderExhibitOtherLangFields). Hai ô ảnh/
// audio tĩnh viết thẳng trong admin.html — phải gọi initDropzone() cho cả hai
// loại để gắn hiệu ứng kéo-thả và cập nhật ô "note".
function dropzoneMarkup(id, { accept, title, hint }) {
  return `<label class="dropzone">
    <input class="dropzone-input" type="file" id="${id}" accept="${accept}">
    ${DROPZONE_UPLOAD_ICON}
    <div class="dropzone-title">${escapeHtml(title)}</div>
    <div class="dropzone-hint">${escapeHtml(hint)}</div>
  </label>`;
}

// Input file biến thể "dropzone" (kéo-thả kiểu Google Drive). JS lo 3 việc:
// 1) highlight khi kéo file qua; 2) TỰ ĐỌC DataTransfer và gán lại input.files
// thay vì để trình duyệt tự gán (không ổn định trên mọi nền tảng — vài nguồn
// kéo trên Linux chỉ cung cấp text/uri-list chứ không có File thật); 3) hiện
// xem trước (ảnh/audio) ở ô "-preview" sau khi chọn/thả, dùng chung phần tử với
// lúc hiện file ĐÃ LƯU khi sửa (setMediaPreview trong startEditContentZone/
// startEditExhibit). Ô "-note" hiện tên + dung lượng.
function initDropzone(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const zone = input.closest('.dropzone');
  const noteEl = document.getElementById(`${inputId}-note`);
  const previewEl = document.getElementById(`${inputId}-preview`);
  if (!zone) return;

  ['dragenter', 'dragover'].forEach((evt) => {
    input.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.add('dropzone-drag');
    });
  });
  input.addEventListener('dragleave', () => zone.classList.remove('dropzone-drag'));

  input.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dropzone-drag');
    const dtFiles = e.dataTransfer && e.dataTransfer.files;
    if (!dtFiles || !dtFiles.length) {
      // Nguồn kéo không kèm File thật (vd chỉ có text/uri-list) — HTML5 Drag&Drop
      // không cho đọc nội dung file từ một chuỗi đường dẫn vì lý do bảo mật, phải
      // nhờ người dùng bấm chọn tay.
      const msg = 'Không đọc được file vừa kéo thả từ nguồn này — hãy bấm vào ô để chọn file qua hộp thoại.';
      zone.classList.add('dropzone-invalid');
      if (noteEl) noteEl.textContent = msg;
      pushNotification('error', msg);
      return;
    }
    // Gán thẳng FileList từ DataTransfer vào input.files (kỹ thuật chuẩn, xem MDN
    // "File drag and drop") rồi tự bắn 'change' để dùng chung một logic kiểm tra/
    // xem trước/upload với luồng chọn file qua hộp thoại bên dưới.
    input.files = dtFiles;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const accept = input.getAttribute('accept') || '';
  const isAudio = accept.startsWith('audio');
  const isImage = accept.startsWith('image');

  // Video (và các loại accept khác ngoài ảnh/audio) không có danh sách đuôi và
  // xem trước riêng ở đây — nơi gọi (renderVideoPanel/uploadVideos) tự lo kiểm
  // tra + upload. initDropzone() chỉ lo hiệu ứng kéo-thả ở trên.
  if (!isAudio && !isImage) return;

  const allowed = isAudio ? ALLOWED_AUDIO_EXT : ALLOWED_IMAGE_EXT;
  const kindLabel = isAudio ? 'audio' : 'ảnh';

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) {
      zone.classList.remove('dropzone-invalid');
      if (noteEl) noteEl.textContent = '';
      if (previewEl) hideMediaPreview(previewEl.id);
      return;
    }
    // Chặn ngay tại trình duyệt thay vì để server trả 400 sau khi đã tải xong cả
    // file: accept="audio/*" chỉ LỌC trong hộp chọn file, KHÔNG chặn được file
    // kéo-thả vào, nên vẫn phải tự kiểm ở đây.
    if (!allowed.includes(fileExtension(file.name))) {
      input.value = '';
      zone.classList.add('dropzone-invalid');
      const msg = `"${file.name}" không phải file ${kindLabel} hợp lệ — chỉ nhận ${allowed.join(', ')}.`;
      if (noteEl) noteEl.textContent = msg;
      pushNotification('error', msg);
      if (previewEl) hideMediaPreview(previewEl.id);
      return;
    }
    zone.classList.remove('dropzone-invalid');
    if (noteEl) noteEl.textContent = `Đã chọn: ${file.name} (${formatBytes(file.size)})`;
    if (previewEl) {
      // Xem trước từ file cục bộ (chưa upload) qua object URL — khác setMediaPreview()
      // dùng cho file ĐÃ LƯU trên server (URL /content-media/*).
      if (previewEl.tagName === 'IMG') previewEl.alt = file.name;
      previewEl.src = URL.createObjectURL(file);
      previewEl.style.display = 'block';
    }
  });
}

// Phải khớp ĐÚNG bộ đuôi file mà server nhận (audioExtension() trong
// routes/adminContent.js). Rộng hơn ở đây thì server trả 400 sau khi người
// dùng đã chờ tải xong cả file.
// Audio CHỈ nhận mp3 (quyết định của chủ dự án) để thống nhất một định dạng.
const ALLOWED_AUDIO_EXT = ['mp3'];
const ALLOWED_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'];

function fileExtension(name) {
  const idx = String(name || '').lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i ? 1 : 0)} ${units[i]}`;
}
/* ---------- Tìm kiếm khu vực/hiện vật (đọc content/manifest.json) ---------- */
let contentSearchTab = 'zones';

// Bỏ dấu + hạ chữ thường TRƯỚC khi so, cho cả từ khóa lẫn dữ liệu. Người Việt gõ
// nhanh thường bỏ dấu: trước đây "may bay" ra 0 kết quả dù kho có 4 hiện vật
// "máy bay", nên nhân viên tưởng chưa có rồi nhập trùng.
// đ/Đ KHÔNG nằm trong dải dấu thanh của NFD nên phải thay riêng.
function khongDau(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function renderContentSearch() {
  const query = khongDau(document.getElementById('content-search-input').value);
  const zones = (contentManifest && contentManifest.zones) || [];

  if (contentSearchTab === 'zones') {
    const filtered = zones.filter((z) => {
      const zoneMatch = khongDau(dispName(z.name) || z.id).includes(query);
      const exhibitMatch = (z.exhibits || []).some((e) => khongDau(dispName(e.name) || e.id).includes(query));
      return !query || zoneMatch || exhibitMatch;
    });
    document.getElementById('content-search-count').textContent = `${filtered.length} {nhom}`;

    const listEl = document.getElementById('content-search-zones-list');
    if (!filtered.length) {
      listEl.innerHTML = '<div class="empty-state">Không tìm thấy {nhom} phù hợp</div>';
      return;
    }
    listEl.innerHTML = filtered.map((z) => `
      <div style="border:1px solid var(--border,#333); border-radius:10px; padding:12px 14px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div>
            <strong>${escapeHtml(dispName(z.name) || z.id)}</strong>
            <span class="mono" style="color:var(--muted); margin-left:6px;">major=${z.major}</span>
          </div>
          <span style="display:flex; align-items:center; gap:10px;">
            <span style="color:var(--muted); font-size:12.5px;">${(z.exhibits || []).length} {muc}</span>
            ${nutSuaTuTimKiem(z.id)}
          </span>
        </div>
        ${(z.exhibits || []).length ? `
          <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border,#333); display:flex; flex-direction:column; gap:6px;">
            ${z.exhibits.map((e) => `
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <span>${escapeHtml(dispName(e.name) || e.id)}</span>
                <span style="display:flex; align-items:center; gap:10px;">
                  <span class="mono" style="color:var(--muted);">minor=${e.minor}</span>
                  ${nutSuaTuTimKiem(z.id, e.id)}
                </span>
              </div>
            `).join('')}
          </div>
        ` : '<div style="margin-top:8px; color:var(--muted); font-size:12.5px;">Chưa có {muc}.</div>'}
      </div>
    `).join('');
    applyRoleVisibility();
  } else {
    const allExhibits = [];
    zones.forEach((z) => (z.exhibits || []).forEach((e) => allExhibits.push({
      ...e, zoneId: z.id, zoneName: dispName(z.name) || z.id, zoneMajor: z.major,
    })));
    const filtered = allExhibits.filter((e) => !query
      || khongDau(dispName(e.name) || e.id).includes(query)
      || khongDau(e.zoneName).includes(query));
    document.getElementById('content-search-count').textContent = `${filtered.length} {muc}`;

    const body = document.getElementById('content-search-exhibits-body');
    if (!filtered.length) {
      body.innerHTML = `<tr><td colspan="4"><div class="empty-state">Không tìm thấy {muc} phù hợp</div></td></tr>`;
      return;
    }
    body.innerHTML = filtered.map((e) => `
      <tr>
        <td class="mono">${e.zoneMajor}:${e.minor}</td>
        <td>${escapeHtml(dispName(e.name) || e.id)}</td>
        <td>${escapeHtml(e.zoneName)}</td>
        <td style="text-align:right;">${nutSuaTuTimKiem(e.zoneId, e.id)}</td>
      </tr>
    `).join('');
    applyRoleVisibility();
  }
}

// Nút "Sửa" ngay trên kết quả tìm kiếm: mở thẳng form, không bắt người dùng nhớ
// tên khu vực rồi quay sang tab quản lý lật từng trang. Dùng lại đúng data-act
// của danh sách quản lý (zone-edit / exhibit-edit), nên phân quyền giống hệt.
function nutSuaTuTimKiem(zoneId, exhibitId) {
  return `<button type="button" class="btn btn-outline btn-tiny" data-need-level="editor" hidden
    data-act="${exhibitId ? 'exhibit-edit' : 'zone-edit'}" data-zone="${escapeHtml(zoneId)}"${exhibitId ? ` data-exhibit="${escapeHtml(exhibitId)}"` : ''}>Sửa</button>`;
}

function switchContentSearchTab(tab) {
  contentSearchTab = tab;
  document.querySelectorAll('.search-tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.searchTab === tab));
  document.getElementById('search-zones-panel').style.display = tab === 'zones' ? 'block' : 'none';
  document.getElementById('search-exhibits-panel').style.display = tab === 'exhibits' ? 'block' : 'none';
  renderContentSearch();
}

document.querySelectorAll('.search-tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchContentSearchTab(btn.dataset.searchTab));
});
document.getElementById('content-search-input').addEventListener('input', renderContentSearch);

/* ---------- Modal chi tiết hiện vật (đọc từ contentManifest) ---------- */
const modalOverlay = document.getElementById('modal-overlay');
const modalVideoWrap = document.getElementById('modal-video-wrap');
const modalAudioWrap = document.getElementById('modal-audio-wrap');

// Modal chi tiết dùng chung cho cả khu vực lẫn hiện vật (xem openZoneDetail bên
// dưới) — đặt lại nhãn các ô cho đúng ngữ cảnh hiện vật mỗi lần mở, tránh sót
// nhãn của lần mở khu vực trước.
function resetDetailModalLabelsForExhibit() {
  document.getElementById('modal-major-label').textContent = 'Major';
  document.getElementById('modal-minor-label').textContent = 'Minor';
  document.getElementById('modal-created-label').textContent = '{Nhom}';
  document.getElementById('modal-meaning-label').textContent = 'Ý nghĩa {muc}';
  document.getElementById('modal-intro-label').textContent = 'Tóm tắt {muc}';
}

async function openExhibitDetail(zoneId, exhibitId) {
  const [z, ex] = await Promise.all([
    fetchJson(`${CONTENT_API_BASE}/zones/${zoneId}`, 'Không tải được {nhom}'),
    fetchJson(`${CONTENT_API_BASE}/zones/${zoneId}/exhibits/${exhibitId}`, 'Không tải được {muc}'),
  ]);
  if (!z || !ex) return;
  const { fallbackLanguage } = getLangs();
  const languages = (contentManifest && contentManifest.languages) || [];

  resetDetailModalLabelsForExhibit();
  document.getElementById('modal-chip').textContent = `${z.major}:${ex.minor}`;
  document.getElementById('modal-name').textContent = dispName(ex.name) || ex.id;
  const info = describeLangCompleteness(ex, languages);
  const modalStatus = document.getElementById('modal-status');
  modalStatus.className = `badge ${info.complete ? 'active' : 'inactive'}`;
  modalStatus.textContent = info.label;
  document.getElementById('modal-major').textContent = z.major;
  document.getElementById('modal-minor').textContent = ex.minor;
  document.getElementById('modal-created').textContent = dispName(z.name) || z.id;

  const modalMeaning = document.getElementById('modal-meaning');
  const meaning = ex.meaning?.[fallbackLanguage];
  if (meaning) modalMeaning.innerHTML = vanBanDinhDangHtml(meaning);
  else modalMeaning.textContent = 'Chưa có nội dung ý nghĩa cho {muc} này.';
  modalMeaning.style.color = meaning ? 'var(--text)' : 'var(--muted)';

  const modalIntro = document.getElementById('modal-intro');
  const summary = ex.summary?.[fallbackLanguage];
  if (summary) modalIntro.innerHTML = vanBanDinhDangHtml(summary);
  else modalIntro.textContent = 'Chưa có tóm tắt cho {muc} này.';
  modalIntro.style.color = summary ? 'var(--text)' : 'var(--muted)';

  document.getElementById('modal-image-gallery').innerHTML = ex.image
    ? `<img src="${mediaUrl(ex.image)}" alt="${escapeHtml(dispName(ex.name) || ex.id)}">`
    : '';
  document.getElementById('modal-model-wrap').innerHTML = ex.model3dId
    ? `<div class="form-hint" style="display:flex;gap:10px;align-items:center;margin:8px 0;">
         <span>Mô hình 3D: <strong>${escapeHtml(ex.model3dId)}</strong></span>
         <button type="button" class="btn btn-outline btn-tiny" data-act="m3d-xem-id" data-id="${escapeHtml(ex.model3dId)}">Xem 3D</button>
       </div>`
    : '';
  modalVideoWrap.innerHTML = '';
  modalAudioWrap.innerHTML = languages.map((l) => {
    const file = ex.audio?.tracks?.[l]?.file;
    const label = `${escapeHtml(langLabel(l))} (${escapeHtml(l)})`;
    return file
      ? `<div style="margin-bottom:10px;"><div class="mono" style="font-size:12px;color:var(--muted);margin-bottom:4px;">${label}</div><audio src="${mediaUrl(file)}" controls preload="none"></audio></div>`
      : `<div class="mono" style="font-size:12px;color:var(--muted);margin-bottom:10px;">${label}: chưa có audio</div>`;
  }).join('');

  modalOverlay.classList.add('active');
}

// Bấm một khu vực trong danh sách cũng mở modal chi tiết này, dùng chung giao
// diện với openExhibitDetail (chỉ đổi nhãn + nội dung cho đúng ngữ cảnh khu
// vực: ảnh nền thay gallery, giới thiệu thay ý nghĩa, audio giới thiệu thay
// audio thuyết minh).
async function openZoneDetail(zoneId) {
  document.getElementById('modal-model-wrap').innerHTML = '';
  const z = await fetchJson(`${CONTENT_API_BASE}/zones/${zoneId}`, 'Không tải được {nhom}');
  if (!z) return;
  const { fallbackLanguage } = getLangs();
  const languages = (contentManifest && contentManifest.languages) || [];

  document.getElementById('modal-major-label').textContent = 'Major';
  document.getElementById('modal-minor-label').textContent = 'Số {muc}';
  document.getElementById('modal-created-label').textContent = 'Mã {nhom}';
  document.getElementById('modal-meaning-label').textContent = 'Giới thiệu {nhom}';
  document.getElementById('modal-intro-label').textContent = 'Lời thoại audio giới thiệu';

  document.getElementById('modal-chip').textContent = `major=${z.major}`;
  document.getElementById('modal-name').textContent = dispName(z.name) || z.id;
  const modalStatus = document.getElementById('modal-status');
  modalStatus.className = `badge ${z.exhibitCount ? 'active' : 'inactive'}`;
  modalStatus.textContent = z.exhibitCount ? `${z.exhibitCount} {muc}` : 'Chưa có {muc}';
  document.getElementById('modal-major').textContent = z.major;
  document.getElementById('modal-minor').textContent = z.exhibitCount ?? 0;
  document.getElementById('modal-created').textContent = z.id;

  const modalMeaning = document.getElementById('modal-meaning');
  const welcome = z.welcomeText?.[fallbackLanguage];
  modalMeaning.textContent = welcome || 'Chưa có nội dung giới thiệu cho {nhom} này.';
  modalMeaning.style.color = welcome ? 'var(--text)' : 'var(--muted)';

  const modalIntro = document.getElementById('modal-intro');
  const transcript = z.introAudio?.tracks?.[fallbackLanguage]?.transcript;
  modalIntro.textContent = transcript || 'Chưa có lời thoại cho audio giới thiệu.';
  modalIntro.style.color = transcript ? 'var(--text)' : 'var(--muted)';

  document.getElementById('modal-image-gallery').innerHTML = z.heroImage
    ? `<img src="${mediaUrl(z.heroImage)}" alt="${escapeHtml(dispName(z.name) || z.id)}">`
    : '';
  modalVideoWrap.innerHTML = '';
  modalAudioWrap.innerHTML = languages.map((l) => {
    const file = z.introAudio?.tracks?.[l]?.file;
    const label = `${escapeHtml(langLabel(l))} (${escapeHtml(l)})`;
    return file
      ? `<div style="margin-bottom:10px;"><div class="mono" style="font-size:12px;color:var(--muted);margin-bottom:4px;">${label}</div><audio src="${mediaUrl(file)}" controls preload="none"></audio></div>`
      : `<div class="mono" style="font-size:12px;color:var(--muted);margin-bottom:10px;">${label}: chưa có audio</div>`;
  }).join('');

  modalOverlay.classList.add('active');
}

function closeBeaconDetail() {
  modalOverlay.classList.remove('active');
  modalVideoWrap.innerHTML = '';
  modalAudioWrap.innerHTML = '';
  document.getElementById('modal-image-gallery').innerHTML = '';
}

document.getElementById('modal-close').addEventListener('click', closeBeaconDetail);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeBeaconDetail();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOverlay.classList.contains('active')) closeBeaconDetail();
});

function attachRowClickHandler(tbodyId) {
  document.getElementById(tbodyId).addEventListener('click', (e) => {
    if (e.target.closest('.row-actions')) return;
    const row = e.target.closest('tr[data-exhibit-id]');
    if (!row) return;
    openExhibitDetail(row.dataset.zoneId, row.dataset.exhibitId);
  });
}

attachRowClickHandler('top-artifacts-body');

/* ---------- Đóng gói nội dung mới (content/manifest.json) ---------- */
const STATIC_CONTENT_API_BASE = '/api/v1/admin/static-content';
const staticContentStatusEl = document.getElementById('static-content-status');
const staticContentResultEl = document.getElementById('static-content-result');
const staticContentRebuildBtn = document.getElementById('static-content-rebuild-btn');

async function loadStaticContentStatus() {
  staticContentStatusEl.textContent = 'Đang tải thông tin...';
  try {
    const res = await authFetch(`${STATIC_CONTENT_API_BASE}/status`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      staticContentStatusEl.innerHTML = `<span class="err">${data.error || 'Không đọc được content/manifest.json.'}</span>`;
      return;
    }
    staticContentStatusEl.innerHTML =
      `bundleVersion trong file: <strong>${data.manifestBundleVersion || '(không có)'}</strong>` +
      ` · ${data.zoneCount} {nhom} · ${data.exhibitCount} {muc}`;
  } catch (err) {
    if (!daBaoLoi(err)) {
      staticContentStatusEl.innerHTML = '<span class="err">Không thể kết nối tới server.</span>';
    }
  }
}

staticContentRebuildBtn.addEventListener('click', async () => {
  const originalLabel = staticContentRebuildBtn.textContent;
  staticContentRebuildBtn.disabled = true;
  staticContentRebuildBtn.textContent = 'Đang đóng gói...';
  staticContentResultEl.textContent = '';

  try {
    const res = await authFetch(`${STATIC_CONTENT_API_BASE}/rebuild`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const problemsHtml = Array.isArray(data.problems) && data.problems.length
        ? `<ul style="margin:6px 0 0 18px;">${data.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
        : '';
      staticContentResultEl.innerHTML = `<span class="err">${escapeHtml(data.error || 'Đóng gói thất bại.')}</span>${problemsHtml}`;
      pushNotification('error', data.error || 'Đóng gói nội dung mới thất bại.');
      return;
    }

    // Đang tạm giữ thì đóng gói xong máy tham quan vẫn CHƯA nhận — nói rõ, kẻo
    // người dùng tưởng đã phát hành.
    staticContentResultEl.innerHTML = (vhPhatHanh && vhPhatHanh.dangGiu
      ? '<span class="err">Đang tạm giữ phát hành — {thietBi} chưa nhận bản này cho tới khi bấm "Phát hành ngay".</span><br>'
      : '') +
      `<div class="bundle-ready"><span class="ok">Đóng gói xong (${formatBytes(data.size)})</span>` +
      `<a class="btn btn-primary bundle-download" href="${escapeHtml(data.downloadUrl)}" download>` +
      `Tải file bundle-${escapeHtml(data.bundleVersion)}.tar.gz</a></div>`;
    pushNotification('success', `Đã đóng gói nội dung mới, bản ${data.bundleVersion}.`);
    await loadStaticContentStatus();
  } catch (err) {
    if (!daBaoLoi(err)) {
      staticContentResultEl.innerHTML = '<span class="err">Không thể kết nối tới server.</span>';
    }
  } finally {
    staticContentRebuildBtn.disabled = false;
    staticContentRebuildBtn.textContent = originalLabel;
  }
});

/* ---------- Kiểm tra tính toàn vẹn dữ liệu ---------- */
function renderIntegrityCheckResults(data) {
  const summaryEl = document.getElementById('integrity-check-summary');
  const resultsEl = document.getElementById('integrity-check-results');
  const { summary, findings, checkedAt } = data;

  summaryEl.style.display = 'block';
  summaryEl.innerHTML =
    `<span class="mono" style="color:var(--muted); font-size:12.5px;">Kiểm tra lúc ${escapeHtml(formatBackupTime(checkedAt))} — </span>` +
    `<span style="color:${summary.errors ? 'var(--red2)' : 'var(--green2)'}; font-weight:600;">${summary.errors} lỗi</span>` +
    `<span style="color:var(--muted);"> · </span>` +
    `<span style="color:var(--gold2); font-weight:600;">${summary.warnings} cảnh báo</span>` +
    `<span style="color:var(--muted);"> · </span>` +
    `<span style="color:var(--muted);">${summary.info} thông tin</span>`;

  if (!findings.length) {
    resultsEl.innerHTML = '<div class="empty-state">Không phát hiện vấn đề gì — dữ liệu toàn vẹn.</div>';
    return;
  }

  const order = { error: 0, warning: 1, info: 2 };
  const labelOf = { error: 'Lỗi', warning: 'Cảnh báo', info: 'Thông tin' };
  const colorOf = { error: 'var(--red2)', warning: 'var(--gold2)', info: 'var(--muted)' };
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
  resultsEl.innerHTML = sorted.map((f) => `
    <div style="display:flex; gap:10px; align-items:center; padding:8px 0; border-top:1px solid var(--border,#2a2a2a);">
      <span style="color:${colorOf[f.severity]}; font-weight:600; font-size:12px; flex-shrink:0; width:72px;">${labelOf[f.severity]}</span>
      <span style="font-size:13px; flex:1;">${escapeHtml(f.message)}</span>
      ${f.category === 'orphaned-file' && f.path ? `<button type="button" class="btn btn-danger orphaned-file-delete-btn" style="flex-shrink:0; padding:6px 12px; font-size:12.5px;" data-path="${escapeHtml(f.path)}">Xóa</button>` : ''}
      ${f.category === 'orphaned-model' && f.modelId ? `<button type="button" class="btn btn-danger orphaned-model-delete-btn" style="flex-shrink:0; padding:6px 12px; font-size:12.5px;" data-id="${escapeHtml(f.modelId)}" data-need-level="editor">Xóa</button>` : ''}
    </div>
  `).join('');

  resultsEl.querySelectorAll('.orphaned-file-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteOrphanedFile(btn.dataset.path, btn));
  });
  resultsEl.querySelectorAll('.orphaned-model-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => xoaMoHinhMoCoi(btn.dataset.id, btn));
  });
  applyRoleVisibility();
}

async function deleteOrphanedFile(relPath, btn) {
  if (!confirm(`Xóa file không dùng đến này?\n\n${relPath}\n\nKhông thể hoàn tác.`)) return;
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Đang xóa...';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/orphaned-file`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushNotification('error', data.error || 'Không thể xóa file.');
      btn.disabled = false;
      btn.textContent = originalLabel;
      return;
    }
    pushNotification('success', `Đã xóa file: ${relPath}`);
    document.getElementById('integrity-check-btn').click();
  } catch (err) {
    if (!daBaoLoi(err)) {
      pushNotification('error', 'Không thể kết nối tới server.');
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }
}

document.getElementById('integrity-check-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const summaryEl = document.getElementById('integrity-check-summary');
  const resultsEl = document.getElementById('integrity-check-results');
  btn.disabled = true;
  btn.textContent = 'Đang kiểm tra...';
  summaryEl.style.display = 'none';
  resultsEl.innerHTML = '';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/integrity-check`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      resultsEl.innerHTML = `<div class="empty-state"><span class="err">${escapeHtml(data.error || 'Không thể kiểm tra.')}</span></div>`;
      return;
    }
    renderIntegrityCheckResults(data);
  } catch (err) {
    if (!daBaoLoi(err)) {
      resultsEl.innerHTML = '<div class="empty-state"><span class="err">Không thể kết nối tới server.</span></div>';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Kiểm tra ngay';
  }
});

/* ---------- Nhập gói nội dung (ZIP: manifest.json + images/ + audio/) ---------- */
document.getElementById('import-package-btn').addEventListener('click', async () => {
  const btn = document.getElementById('import-package-btn');
  const msgEl = document.getElementById('import-package-msg');
  const fileInput = document.getElementById('import-package-file');
  const file = fileInput.files[0];

  if (!file) {
    msgEl.textContent = 'Chọn file ZIP trước đã.';
    msgEl.className = 'form-msg err';
    return;
  }
  if (!confirm('Nhập gói này sẽ THAY THẾ TOÀN BỘ nội dung hiện tại ({nhom}, {muc}, ngôn ngữ, chuỗi giao diện, ảnh, audio). Có sao lưu trước khi ghi đè, nhưng vẫn nên chắc chắn trước khi tiếp tục. Đồng ý?')) return;

  btn.disabled = true;
  btn.textContent = 'Đang nhập...';
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const fd = new FormData();
    fd.append('package', file);
    const res = await authFetch(`${CONTENT_API_BASE}/import`, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.textContent = data.error || 'Không thể nhập gói nội dung.';
      msgEl.className = 'form-msg err';
      pushNotification('error', `Không thể nhập gói nội dung: ${data.error || 'lỗi không xác định'}.`);
      return;
    }
    const okMsg = `Đã nhập gói: ${data.zonesCount} {nhom}, ${data.exhibitsCount} {muc}, ${data.languages.length} ngôn ngữ (${data.languages.join(', ')}).`;
    flashSaved(btn, msgEl, okMsg);
    pushNotification('success', okMsg);
    fileInput.value = '';
    // Cập nhật lại toàn bộ giao diện theo dữ liệu/ngôn ngữ mới, không cần tải lại trang.
    await refreshContentViews();
    await loadLanguagesPanel();
    await loadLanguageBackups();
    await loadUiStrings();
    await loadStaticContentStatus();
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Lỗi kết nối server.';
      msgEl.className = 'form-msg err';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Nhập gói nội dung';
  }
});

/* ---------- Lịch sử đóng gói (view "static-content") ---------- */
async function loadPackagingHistory() {
  const body = document.getElementById('pack-history-body');
  body.innerHTML = '<tr><td colspan="5">Đang tải...</td></tr>';
  try {
    const res = await authFetch(`${STATIC_CONTENT_API_BASE}/history`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      body.innerHTML = `<tr><td colspan="5" class="err">${escapeHtml(data.error || 'Không tải được lịch sử.')}</td></tr>`;
      return;
    }
    const history = data.history || [];
    if (history.length === 0) {
      body.innerHTML = '<tr><td colspan="5" style="color:var(--muted);">Chưa có lần đóng gói nào.</td></tr>';
      return;
    }
    body.innerHTML = history.map((h) => `
      <tr>
        <td class="mono">${new Date(h.timestamp).toLocaleString('vi-VN')}</td>
        <td class="mono">${escapeHtml(h.version)}</td>
        <td class="mono">${formatBytes(h.size)}</td>
        <td class="mono" title="${escapeHtml(h.sha256)}">${escapeHtml(h.sha256.slice(0, 16))}…</td>
        <td><a href="/bundle-${encodeURIComponent(h.version)}.tar.gz" target="_blank" rel="noopener">Tải file</a></td>
      </tr>
    `).join('');
  } catch (err) {
    if (!daBaoLoi(err)) {
      body.innerHTML = '<tr><td colspan="5" class="err">Không thể kết nối tới server.</td></tr>';
    }
  }
}

/* ---------- CRUD khu vực/hiện vật ---------- */
const CONTENT_API_BASE = '/api/v1/admin/content';

/* ---------- Video đính kèm khu vực / hiện vật ----------
   Video CHƯA được app đọc (chỉ là kho lưu trữ phía CMS) và có thể nặng hàng
   trăm MB, nên KHÔNG đi chung đường lưu form (multipart của form khu vực/hiện
   vật giới hạn 50 MB, giữ trong RAM) mà upload riêng qua route .../videos.
   Vì vậy chỉ thêm/xóa video khi khu vực/hiện vật ĐÃ TỒN TẠI (cần id để biết
   gắn vào đâu) — lúc đang tạo mới thì chỉ hiện lời nhắc. */

// Upload bằng XHR thay vì fetch để có sự kiện tiến trình — file video lớn mà
// không có thanh % thì người dùng tưởng trang bị treo.
//
// Gửi MỖI REQUEST MỘT FILE (xem uploadVideos) chứ không gom cả lô: giới hạn
// multer `fileSize` tính theo TỪNG file, còn client_max_body_size của nginx
// tính theo CẢ REQUEST — gom 40 video 50 MB thành một request 2 GB sẽ bị nginx
// chặn bằng trang HTML 413 dù không file nào vượt giới hạn. Tách ra còn giúp
// một file lỗi không làm mất cả lô.
function uploadVideoXhr(url, file, fieldName, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append(fieldName, file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* server trả HTML (vd nginx 413) */ }

      // Cùng quy ước với authFetch: 401 là hết phiên -> đăng xuất; 403 là không đủ
      // quyền -> giữ nguyên trang, chỉ báo cho người dùng biết.
      if (xhr.status === 401) {
        logout();
        reject(SESSION_EXPIRED);
        return;
      }
      if (xhr.status === 403) {
        pushNotification('error', data.error
          || 'Tài khoản của bạn không làm được việc này. Nếu bạn cần quyền, hãy liên hệ quản lý.');
        reject(PERMISSION_DENIED);
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Tải lên thất bại (mã ${xhr.status})`));
    });
    xhr.addEventListener('error', () => reject(new Error('Không thể kết nối tới server.')));
    xhr.send(form);
  });
}

// 3 loại "gallery media" dùng CHUNG một cơ chế (dropzone nhiều file + danh sách
// có nút Xóa từng cái): video, và ảnh/audio PHỤ (gallery, tùy chọn, khác ảnh/
// audio CHÍNH bắt buộc ở đầu form). Thêm một loại media mới chỉ cần khai báo
// thêm một mục ở đây, không phải viết lại logic hiện/upload/xóa.
const MEDIA_TYPE_CONFIG = {
  video: {
    seg: 'videos', field: 'videos', accept: 'video/*',
    dropTitle: 'Kéo thả video vào đây, hoặc bấm để chọn (chọn được nhiều file)',
    dropHint: 'MP4, WEBM, MOV, M4V, MKV, AVI — tối đa 2GB mỗi file',
    noun: 'video', emptyNoun: 'video',
  },
  image: {
    seg: 'images', field: 'images', accept: 'image/*',
    dropTitle: 'Kéo thả ảnh vào đây, hoặc bấm để chọn (chọn được nhiều ảnh cùng lúc)',
    dropHint: 'JPG, PNG, WEBP... — tự chuyển sang JPEG, tối đa 50MB/ảnh, tối đa 20 ảnh',
    noun: 'ảnh', emptyNoun: 'ảnh phụ',
  },
  audio: {
    seg: 'audios', field: 'audios', accept: 'audio/*',
    dropTitle: 'Kéo thả audio vào đây, hoặc bấm để chọn (chọn được nhiều file)',
    dropHint: 'Chỉ nhận .mp3 — tối đa 50MB/file, tối đa 10 file',
    noun: 'audio', emptyNoun: 'audio phụ',
  },
};

function mediaItemThumbMarkup(mediaType, item) {
  const src = escapeHtml(mediaUrl(item.file));
  if (mediaType === 'video') return `<video class="video-item-thumb" src="${src}" preload="metadata" muted></video>`;
  if (mediaType === 'image') return `<img class="video-item-thumb" src="${src}" alt="">`;
  return `<audio class="video-item-audio" controls preload="metadata" src="${src}"></audio>`;
}

// Dùng chung cho cả khu vực lẫn hiện vật, cả 3 loại media — chỉ khác đường dẫn
// API và id trên DOM. `ownerIds` = null nghĩa là đang TẠO MỚI (chưa có id, phải
// lưu trước rồi mới đính kèm media phụ được).
function renderMediaPanel(mediaType, ownerKind, ownerIds, items) {
  const cfg = MEDIA_TYPE_CONFIG[mediaType];
  const panel = document.getElementById(`content-${ownerKind}-${cfg.seg}-panel`);
  if (!panel) return;
  const noun = ownerKind === 'zone' ? '{nhom}' : '{muc}';

  if (!ownerIds) {
    panel.innerHTML = `<div class="form-hint">Lưu ${noun} trước, sau đó mở lại để đính kèm ${cfg.noun}.</div>`;
    return;
  }

  // Dải ảnh có thể là chuỗi đường dẫn trần (dữ liệu nhập từ gói cũ) thay vì object
  // {file, originalName, …} — chuẩn hóa để vẫn hiện tên và xóa được.
  const list = (items || []).map((v) => (typeof v === 'string' ? { file: v } : v));
  panel.innerHTML = `
    <label class="dropzone">
      <input class="dropzone-input" type="file" id="content-${ownerKind}-${cfg.seg}-input" accept="${cfg.accept}" multiple>
      ${DROPZONE_UPLOAD_ICON}
      <div class="dropzone-title">${escapeHtml(cfg.dropTitle)}</div>
      <div class="dropzone-hint">${escapeHtml(cfg.dropHint)}</div>
    </label>
    <div class="video-upload-status" id="content-${ownerKind}-${cfg.seg}-status" style="display:none;"></div>
    <div class="video-list" id="content-${ownerKind}-${cfg.seg}-list">
      ${list.length ? list.map((v) => `
        <div class="video-item">
          ${mediaItemThumbMarkup(mediaType, v)}
          <div class="video-item-info">
            <div class="video-item-name">${escapeHtml(v.originalName || v.file.split('/').pop())}</div>
            <div class="video-item-meta">${formatBytes(v.sizeBytes)}${v.uploadedAt ? ` · ${escapeHtml(formatBackupTime(v.uploadedAt))}` : ''}</div>
          </div>
          <button type="button" class="btn btn-danger media-item-delete" data-file="${escapeHtml(v.file)}" style="padding:6px 12px; font-size:12.5px;">Xóa</button>
        </div>
      `).join('') : `<div class="form-hint">Chưa có ${cfg.emptyNoun} nào cho ${noun} này.</div>`}
    </div>
  `;

  initDropzone(`content-${ownerKind}-${cfg.seg}-input`);
  document.getElementById(`content-${ownerKind}-${cfg.seg}-input`)
    .addEventListener('change', (e) => uploadMediaItems(mediaType, ownerKind, ownerIds, e.target.files));
  panel.querySelectorAll('.media-item-delete').forEach((btn) => {
    btn.addEventListener('click', () => deleteMediaItem(mediaType, ownerKind, ownerIds, btn.dataset.file, btn));
  });
}

function mediaApiUrl(mediaType, ownerKind, ownerIds) {
  const seg = MEDIA_TYPE_CONFIG[mediaType].seg;
  return ownerKind === 'zone'
    ? `${CONTENT_API_BASE}/zones/${encodeURIComponent(ownerIds.zoneId)}/${seg}`
    : `${CONTENT_API_BASE}/zones/${encodeURIComponent(ownerIds.zoneId)}/exhibits/${encodeURIComponent(ownerIds.exhibitId)}/${seg}`;
}

async function uploadMediaItems(mediaType, ownerKind, ownerIds, fileList) {
  const cfg = MEDIA_TYPE_CONFIG[mediaType];
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const statusEl = document.getElementById(`content-${ownerKind}-${cfg.seg}-status`);
  statusEl.style.display = 'block';

  const url = mediaApiUrl(mediaType, ownerKind, ownerIds);
  const failed = [];
  let newestList = null;

  // Tuần tự từng file (không Promise.all): vừa để thanh % có ý nghĩa, vừa tránh
  // mở hàng chục kết nối tải lên cùng lúc làm nghẽn đường truyền.
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const prefix = files.length > 1 ? `(${i + 1}/${files.length}) ` : '';
    try {
      const data = await uploadVideoXhr(url, file, cfg.field, (pct) => {
        statusEl.textContent = `${prefix}Đang tải lên "${file.name}" — ${pct}%`;
      });
      newestList = data[cfg.seg];
    } catch (err) {
      if (daBaoLoi(err)) return;
      failed.push(`"${file.name}": ${err.message}`);
    }
  }

  statusEl.style.display = 'none';
  const okCount = files.length - failed.length;
  if (okCount) pushNotification('success', `Đã thêm ${okCount} ${cfg.noun}.`);
  for (const msg of failed) pushNotification('error', `Không tải lên được ${msg}`);
  if (newestList) {
    renderMediaPanel(mediaType, ownerKind, ownerIds, newestList);
    loadContentManifest();
  }
}

async function deleteMediaItem(mediaType, ownerKind, ownerIds, file, btn) {
  const cfg = MEDIA_TYPE_CONFIG[mediaType];
  if (!(await confirmDialog(`Xóa ${cfg.noun} này? Không thể hoàn tác.`, { title: `Xóa ${cfg.noun}`, confirmLabel: `Xóa ${cfg.noun}` }))) return;
  btn.disabled = true;
  btn.textContent = 'Đang xóa...';
  try {
    const res = await authFetch(mediaApiUrl(mediaType, ownerKind, ownerIds), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushNotification('error', data.error || `Không thể xóa ${cfg.noun}.`);
      btn.disabled = false;
      btn.textContent = 'Xóa';
      return;
    }
    pushNotification('success', `Đã xóa ${cfg.noun}.`);
    btn.closest('.video-item').remove();
    loadContentManifest();
  } catch (err) {
    if (!daBaoLoi(err)) {
      pushNotification('error', 'Không thể kết nối tới server.');
      btn.disabled = false;
      btn.textContent = 'Xóa';
    }
  }
}

// Giữ tên renderVideoPanel cho các chỗ đã gọi sẵn — chỉ là lớp mỏng gọi lại
// renderMediaPanel('video', ...).
function renderVideoPanel(ownerKind, ownerIds, videos) {
  renderMediaPanel('video', ownerKind, ownerIds, videos);
}
// `images[]` là mảng chuỗi (dạng app đọc); tên gốc/dung lượng/ngày tải nằm ở
// `imagesMeta` theo đường dẫn — ghép lại để panel hiện như trước.
function renderImagePanel(ownerKind, ownerIds, images, imagesMeta) {
  const meta = imagesMeta || {};
  const list = (images || []).map((v) => (typeof v === 'string' ? { file: v, ...(meta[v] || {}) } : v));
  renderMediaPanel('image', ownerKind, ownerIds, list);
}
function renderAudioPanel(ownerKind, ownerIds, audios) {
  renderMediaPanel('audio', ownerKind, ownerIds, audios);
}

let contentManifest = null;
let editingContentZoneId = null;

initDropzone('content-zone-hero-image');
initDropzone('content-zone-intro-audio');

const zoneModalOverlay = document.getElementById('content-zone-modal-overlay');
const zoneForm2 = document.getElementById('content-zone-form');
const zoneForm2Title = document.getElementById('content-zone-form-title');
const zoneForm2Submit = document.getElementById('content-zone-submit-btn');
const zoneForm2Cancel = document.getElementById('content-zone-cancel-btn');
const zoneForm2Msg = document.getElementById('content-zone-form-msg');
const zonesListEl = document.getElementById('content-zones-list');

// Chỉ tab "Trang chủ" và "Tìm kiếm" dùng bản manifest ĐẦY ĐỦ (2 chỗ đó tính số
// liệu trên toàn kho). Tab quản lý khu vực/hiện vật dùng phân trang nên không
// gọi hàm này — xem refreshContentViews().
async function loadContentManifest() {
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return;
    contentManifest = data;
    renderContentSearch();
  } catch (err) {
    if (!daBaoLoi(err)) { /* im lặng: các tab dùng hàm này tự hiện lỗi riêng */ }
  }
}

// Thông tin nhẹ (ngôn ngữ, tên ngôn ngữ) — cần cho mọi form, tải riêng thay vì
// kéo cả manifest về chỉ để biết có bao nhiêu ngôn ngữ.
let contentMeta = null;
async function loadContentMeta() {
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/languages`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) contentMeta = data;
  } catch (err) {
    if (!daBaoLoi(err)) { /* getLangs() sẽ lùi về mặc định */ }
  }
}

// Gọi sau mỗi thao tác thêm/sửa/xóa: chỉ tải lại trang đang xem, không kéo lại
// cả kho. Giữ nguyên trang hiện tại để người dùng không bị nhảy về trang 1.
async function refreshContentViews() {
  await loadContentMeta();
  await loadZonesPage(zonePageState.page);
  renderZoneOtherLangFields();
  if (contentManifest) loadContentManifest();
}

/* ---------- Danh sách khu vực: phân trang, tải theo trang ----------
 * Kho 3000 hiện vật nặng ~14 MB và vài nghìn dòng DOM — không thể vẽ cả kho
 * một lúc. Nên:
 *   - Danh sách khu vực gọi /zones-page (mỗi trang 10 khu vực, ~4 KB)
 *   - Hiện vật của từng khu chỉ tải khi mở khu đó ra, cũng phân trang
 * Nhờ vậy lượng tải về không tăng theo kích thước kho. */
const ZONES_PER_PAGE = 10;
const EXHIBITS_PER_PAGE = 20;
let zonePageState = { page: 1, q: '' };
const expandedZones = new Map(); // zoneId -> { page, q }

async function loadZonesPage(page = zonePageState.page) {
  zonePageState.page = page;
  zonesListEl.innerHTML = '<div style="color:var(--muted); padding:10px 4px;">Đang tải...</div>';
  try {
    const params = new URLSearchParams({ page, pageSize: ZONES_PER_PAGE });
    if (zonePageState.q) params.set('q', zonePageState.q);
    const res = await authFetch(`${CONTENT_API_BASE}/zones-page?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      zonesListEl.innerHTML = `<span class="err">${escapeHtml(data.error || 'Không tải được danh sách.')}</span>`;
      return;
    }
    renderZonesPage(data);
  } catch (err) {
    if (!daBaoLoi(err)) zonesListEl.innerHTML = '<span class="err">Không thể kết nối tới server.</span>';
  }
}

function renderZonesPage(data) {
  if (!data.total) {
    zonesListEl.innerHTML = zonePageState.q
      ? `<div class="empty-state">Không có {nhom} nào khớp với "${escapeHtml(zonePageState.q)}".</div>`
      : '<div class="empty-state">Chưa có {nhom} nào. Bấm "+ Thêm {nhom}" để tạo mới.</div>';
    return;
  }
  const from = (data.page - 1) * data.pageSize + 1;
  const to = from + data.items.length - 1;
  zonesListEl.innerHTML = `
    <div class="page-summary">
      Hiển thị <strong>${from}–${to}</strong> trong <strong>${data.total}</strong> {nhom}${zonePageState.q ? ' khớp tìm kiếm' : ''}
      · tổng cộng ${data.totalExhibits} {muc}
    </div>
    ${data.items.map((z) => renderZoneRow(z)).join('')}
    ${renderPager(data, 'zones')}
  `;
  // Nút vừa dựng bằng JS không đi qua lần quét lúc khởi động — quên gọi là vai trò
  // Chỉ xem nhìn thấy đủ nút ghi (đúng cái bẫy đã ghi ở CLAUDE.md §5.18).
  applyRoleVisibility();
  for (const z of data.items) {
    if (expandedZones.has(z.id)) loadExhibitsPage(z.id, expandedZones.get(z.id).page);
  }
}

function renderZoneRow(z) {
  const open = expandedZones.has(z.id);
  return `
    <div class="zone-card" data-zone="${escapeHtml(z.id)}">
      <div class="zone-card-head">
        <button type="button" class="zone-toggle${open ? ' open' : ''}" data-toggle-zone="${escapeHtml(z.id)}"
                aria-expanded="${open}" title="${open ? 'Thu gọn' : 'Xem {muc}'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>
        </button>
        <div class="zone-card-title" style="display:flex; align-items:center; gap:8px; cursor:pointer;" data-act="zone-detail" data-zone="${escapeHtml(z.id)}" title="Bấm để xem thông tin {nhom}">
          ${z.heroImage ? `<img src="${mediaUrl(z.heroImage)}" alt="Ảnh {nhom} ${escapeHtml(dispName(z.name) || z.id)}" class="zone-thumb" data-hide-on-error>` : ''}
          <span>
            <strong>${escapeHtml(dispName(z.name) || z.id)}</strong>
            <span class="mono" style="color:var(--muted); margin-left:6px;">major=${z.major}</span>
            ${z.exhibitCount === 0
              ? '<span class="err" style="margin-left:8px;">⚠ chưa có {muc}</span>'
              : `<span style="color:var(--muted); margin-left:8px;">${z.exhibitCount} {muc}</span>`}
          </span>
        </div>
        <div class="row-actions">
          ${z.exhibitCount > 1 ? `<button type="button" class="btn btn-outline" style="padding:4px 10px; font-size:12px;" data-act="sap-xep-hien-vat" data-zone="${escapeHtml(z.id)}" data-need-level="editor" hidden title="Đổi thứ tự {muc} trên máy tablet">Sắp xếp</button>` : ''}
          <button type="button" class="btn btn-outline" style="padding:4px 10px; font-size:12px;" data-act="exhibit-add" data-zone="${escapeHtml(z.id)}" data-need-level="editor" hidden>+ {Muc}</button>
          <button type="button" class="icon-action" title="Sửa {nhom}" data-act="zone-edit" data-zone="${escapeHtml(z.id)}" data-need-level="editor" hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button type="button" class="icon-action danger" title="Xóa {nhom}" data-act="zone-delete" data-zone="${escapeHtml(z.id)}" data-count="${z.exhibitCount}" data-need-level="editor" hidden>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0-1 14a2 2 0 01-2 2H9a2 2 0 01-2-2L6 6"/></svg>
          </button>
        </div>
      </div>
      <div class="zone-exhibits" id="zone-exhibits-${escapeHtml(z.id)}" ${open ? '' : 'hidden'}></div>
    </div>
  `;
}

async function loadExhibitsPage(zoneId, page = 1) {
  const box = document.getElementById(`zone-exhibits-${zoneId}`);
  if (!box) return;
  const state = expandedZones.get(zoneId) || { page: 1, q: '' };
  state.page = page;
  expandedZones.set(zoneId, state);
  box.hidden = false;
  box.innerHTML = '<div style="color:var(--muted); padding:8px;">Đang tải {muc}...</div>';
  try {
    const params = new URLSearchParams({ page, pageSize: EXHIBITS_PER_PAGE });
    if (state.status) params.set('status', state.status);
    const res = await authFetch(`${CONTENT_API_BASE}/zones/${zoneId}/exhibits-page?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      box.innerHTML = `<span class="err">${escapeHtml(data.error || 'Không tải được {muc}.')}</span>`;
      return;
    }
    const boLoc = boLocTrangThaiHtml(zoneId, state.status);
    if (!data.total) {
      box.innerHTML = boLoc + (state.status
        ? '<div style="color:var(--muted); padding:8px;">Không có {muc} nào ở trạng thái này.</div>'
        : '<div style="color:var(--muted); padding:8px;">Chưa có {muc} nào trong {nhom} này.</div>');
      return;
    }
    box.innerHTML = boLoc + data.items.map((e) => `
      <div class="exhibit-row">
        <span class="list-row-info" style="display:flex; align-items:center; gap:8px; cursor:pointer;" data-act="exhibit-detail" data-zone="${escapeHtml(zoneId)}" data-exhibit="${escapeHtml(e.id)}" title="Bấm để xem thông tin {muc}">
          ${e.thumbnail ? `<img src="${mediaUrl(e.thumbnail)}" alt="Ảnh {muc} ${escapeHtml(dispName(e.name) || e.id)}" style="width:28px;height:28px;object-fit:cover;border-radius:5px;flex-shrink:0;" data-hide-on-error>` : ''}
          ${escapeHtml(dispName(e.name) || e.id)} ${listingTomTatHtml(e.listing, e.fields)} <span class="mono" style="color:var(--muted);">minor=${e.minor}</span>
        </span>
        <div class="row-actions">
          <button type="button" class="icon-action" title="Nhân bản {muc} (chép phần chữ sang {muc} mới)" data-act="exhibit-copy" data-zone="${escapeHtml(zoneId)}" data-exhibit="${escapeHtml(e.id)}" data-need-level="editor" hidden>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/></svg>
          </button>
          <button type="button" class="icon-action" title="Chuyển sang {nhom} khác" data-act="exhibit-move" data-zone="${escapeHtml(zoneId)}" data-exhibit="${escapeHtml(e.id)}" data-need-level="editor" hidden>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
          </button>
          <button type="button" class="icon-action" title="Sửa {muc}" data-act="exhibit-edit" data-zone="${escapeHtml(zoneId)}" data-exhibit="${escapeHtml(e.id)}" data-need-level="editor" hidden>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button type="button" class="icon-action danger" title="Xóa {muc}" data-act="exhibit-delete" data-zone="${escapeHtml(zoneId)}" data-exhibit="${escapeHtml(e.id)}" data-name="${escapeHtml(dispName(e.name) || e.id)}" data-need-level="editor" hidden>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0-1 14a2 2 0 01-2 2H9a2 2 0 01-2-2L6 6"/></svg>
          </button>
        </div>
      </div>
    `).join('') + renderPager(data, 'exhibits', zoneId);
    applyRoleVisibility();
  } catch (err) {
    if (!daBaoLoi(err)) box.innerHTML = '<span class="err">Không thể kết nối tới server.</span>';
  }
}

// Thanh chuyển trang. Chỉ hiện khi thật sự có nhiều hơn 1 trang.
function renderPager(data, kind, zoneId) {
  if (data.pageCount <= 1) return '';
  const attr = kind === 'zones' ? 'data-zone-page' : `data-exhibit-page="${escapeHtml(zoneId)}" data-page`;
  const btn = (p, label, disabled, currentPage) => `
    <button type="button" class="pager-btn${currentPage ? ' current' : ''}" ${disabled ? 'disabled' : ''}
            ${kind === 'zones' ? `data-zone-page="${p}"` : `data-exhibit-zone="${escapeHtml(zoneId)}" data-exhibit-page="${p}"`}>${label}</button>`;
  const pages = [];
  const total = data.pageCount;
  const cur = data.page;
  const push = (p) => pages.push(btn(p, String(p), false, p === cur));
  push(1);
  if (cur > 3) pages.push('<span class="pager-gap">…</span>');
  for (let p = Math.max(2, cur - 1); p <= Math.min(total - 1, cur + 1); p++) push(p);
  if (cur < total - 2) pages.push('<span class="pager-gap">…</span>');
  if (total > 1) push(total);
  return `
    <div class="pager">
      ${btn(cur - 1, '‹ Trước', cur === 1, false)}
      ${pages.join('')}
      ${btn(cur + 1, 'Sau ›', cur === total, false)}
    </div>`;
}

// Bắt sự kiện bằng ủy quyền: danh sách được vẽ lại liên tục nên gắn trực tiếp
// vào từng nút sẽ mất sau mỗi lần vẽ.
zonesListEl.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle-zone]');
  if (toggle) {
    const id = toggle.dataset.toggleZone;
    if (expandedZones.has(id)) {
      expandedZones.delete(id);
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      const box = document.getElementById(`zone-exhibits-${id}`);
      if (box) { box.hidden = true; box.innerHTML = ''; }
    } else {
      expandedZones.set(id, { page: 1, q: '' });
      toggle.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      loadExhibitsPage(id, 1);
    }
    return;
  }
  const zonePage = e.target.closest('[data-zone-page]');
  if (zonePage && !zonePage.disabled) { loadZonesPage(Number(zonePage.dataset.zonePage)); return; }
  const exPage = e.target.closest('[data-exhibit-page]');
  if (exPage && !exPage.disabled) loadExhibitsPage(exPage.dataset.exhibitZone, Number(exPage.dataset.exhibitPage));
});

/* ---------- Điều phối hành động dùng data-act (thay cho onclick nội tuyến) ----------
 * Mỗi nút chỉ mang data-act + tham số, và DUY NHẤT hàm này gọi hàm thực sự.
 * Lý do:
 *   - onclick nội tuyến buộc CSP bật 'unsafe-inline' cho script — bật cái đó
 *     thì CSP gần như không còn chặn được gì (xem server.js).
 *   - onclick nhận tham số qua NỐI CHUỖI, nên tên có dấu nháy (vd O'Brien) làm
 *     hỏng cú pháp JS. Đọc qua dataset thì không còn chuyện đó.
 */

/* ---------- Mô hình 3D ---------- */
//
// Mô hình KHÔNG nằm trong bundle: bundle tải nguyên khối, nhét vài chục MB .glb
// vào đó thì mỗi lần sửa chính tả trong manifest thành một đợt tải lại hàng
// trăm MB cho cả đội máy. Chúng đi đường riêng (`/models.json` + `/models/...`)
// và tải LÚC KHÁCH MỞ hiện vật. Xem models3d.js và beacon-client/docs/3d-handover.md.

let m3dBudget = null;

function mb(n) {
  return (n / 1024 / 1024).toFixed(1);
}

function veSoLieuMoHinh(sl) {
  if (!sl) return '';
  const b = m3dBudget || {};
  // Đánh dấu từng chỉ tiêu vượt trần ngay trên số — để người tải lên biết phải
  // sửa CÁI GÌ, không chỉ biết là "không đạt".
  const o = (giaTri, tran) => (tran && giaTri > tran ? ' style="color:var(--danger);font-weight:600"' : '');
  return `<div class="form-hint" style="display:flex;gap:14px;flex-wrap:wrap;padding-top:4px;">
    <span${o(sl.vramBytes, b.vramBytes)}>VRAM ~${mb(sl.vramBytes)} MB</span>
    <span${o(sl.triangles, b.triangles)}>${(sl.triangles || 0).toLocaleString('vi-VN')} tam giác</span>
    <span${o(sl.materials, b.materials)}>${sl.materials} material</span>
    <span${o(sl.drawCalls, b.drawCalls)}>${sl.drawCalls} lệnh vẽ</span>
  </div>`
    // Cảnh báo KHÔNG chặn tải lên nhưng phải nhìn thấy được — quan trọng nhất là
    // "cần Internet để giải nén": mô hình chạy tốt ở văn phòng có mạng, rồi không
    // hiện ra đúng ở góc sóng yếu của bảo tàng.
    + (Array.isArray(sl.canhBao) && sl.canhBao.length
      ? '<ul class="form-hint" style="margin:4px 0 0 18px;color:#b7791f;">'
        + sl.canhBao.map((c) => `<li>${escapeHtml(c)}</li>`).join('') + '</ul>'
      : '');
}

// ---- Khung xem mô hình 3D ----
//
// Dùng CHÍNH `<model-viewer>` mà ứng dụng dùng (`model_viewer_plus` chỉ là lớp
// bọc quanh nó). Nhờ vậy cái người quản trị thấy ở đây LÀ cái khách sẽ thấy.
//
// Thư viện tự host ở /vendor/model-viewer/ — xem README trong thư mục đó để
// biết vì sao không dùng CDN.

const M3D_VENDOR = '/vendor/model-viewer/';
let m3dNapThuVien = null;   // giữ Promise, không giữ cờ: 2 lần bấm liên tiếp
                            // phải dùng chung MỘT lần nạp, không phải hai.

// Nạp lười. Thư viện nặng ~1 MB, mà tab Mô hình 3D vài tháng mới dùng một lần —
// bắt mọi lần mở trang quản trị trả cái giá đó là sai.
function napThuVien3D() {
  if (m3dNapThuVien) return m3dNapThuVien;
  m3dNapThuVien = new Promise((ok, loi) => {
    // LƯU Ý: PHẢI ĐẶT TRƯỚC KHI CHÈN SCRIPT. Trong model-viewer.min.js có dòng:
    //     const e = self.ModelViewerElement || {},
    //           h = e.dracoDecoderLocation || "https://www.gstatic.com/draco/...";
    //     DA.setDRACODecoderLocation(h);
    // Tức là thư viện đọc một object cấu hình TOÀN CỤC rồi GHI ĐÈ hai đường giải
    // nén. Gán `MV.dracoDecoderLocation = ...` sau khi nạp trông như chạy được,
    // nhưng giá trị bị dòng trên đặt lại về gstatic mà không báo lỗi nào.
    self.ModelViewerElement = Object.assign(self.ModelViewerElement || {}, {
      dracoDecoderLocation: M3D_VENDOR + 'draco/',
      ktx2TranscoderLocation: M3D_VENDOR + 'basis/',
    });

    const s = document.createElement('script');
    s.type = 'module';
    s.src = M3D_VENDOR + 'model-viewer.min.js';
    s.onload = async () => {
      // LƯU Ý: PHẢI đợi whenDefined — `onload` của script type=module chỉ báo module
      // đã chạy xong, KHÔNG báo custom element đã đăng ký. Đọc customElements.get()
      // ngay ở đây có lúc trả undefined.
      await customElements.whenDefined('model-viewer');
      ok();
    };
    s.onerror = () => loi(new Error('Không nạp được bộ dựng 3D'));
    document.head.appendChild(s);
  });
  return m3dNapThuVien;
}

// Trỏ hai bộ giải nén về bản tự host.
//
// LƯU Ý: chỗ dễ hỏng im lặng nhất của tính năng này. model-viewer KHÔNG đóng
// gói sẵn bộ giải nén; mặc định nó tải từ www.gstatic.com LÚC CHẠY, và chỉ khi
// gặp mô hình thực sự cần. CSP chặn gstatic, nên nếu không trỏ lại thì mô hình
// thường vẫn hiện, còn mô hình nén DRACO hoặc texture KTX2 KHÔNG hiện mà không
// báo gì. Mà bảng ngân sách trong models3d.js lại KHUYÊN DÙNG KTX2.
//
// Đường chính để đặt hai đường này là object cấu hình toàn cục
// `self.ModelViewerElement`, gán TRƯỚC khi chèn script (xem napThuVien3D). Hàm
// này là lớp thứ hai: gán lại qua thuộc tính tĩnh và ĐỌC LẠI để xác nhận, vì
// một bản nâng cấp đổi tên hoặc đổi thứ tự khởi tạo sẽ làm đường chính im lặng
// mất tác dụng. Gọi lại nhiều lần không tốn gì.
function datDuongGiaiNen() {
  const MV = customElements.get('model-viewer');
  if (!MV) return;
  MV.dracoDecoderLocation = M3D_VENDOR + 'draco/';
  MV.ktx2TranscoderLocation = M3D_VENDOR + 'basis/';
  // Đọc lại để chắc nó đã ăn: bản nâng cấp đổi tên thuộc tính sẽ làm phép gán
  // trên im lặng không làm gì, và triệu chứng chỉ lộ ra ở một mô hình KTX2 nào
  // đó vài tháng sau.
  if (!String(MV.dracoDecoderLocation).startsWith(M3D_VENDOR)) {
    console.error('[3D] Không đặt được đường giải nén DRACO/KTX2 tự host — mô hình '
      + 'nén DRACO hoặc texture KTX2 sẽ không hiện ra. Kiểm lại tên thuộc tính '
      + 'sau khi nâng model-viewer (xem public/vendor/model-viewer/README.md).');
  }
}

const m3dViewOverlay = document.getElementById('m3d-view-overlay');
let m3dBlobUrl = null;   // URL tạm của file đang xem thử (chưa tải lên)
let m3dSoLieuThu = null; // số liệu của lần khám thử gần nhất

function dongKhungXem() {
  m3dViewOverlay.classList.remove('active');
  // Gỡ hẳn thẻ <model-viewer>: để nó sống trong DOM là giữ một ngữ cảnh WebGL +
  // vài chục MB texture cho tới khi trình duyệt thấy cần dọn. Mở liên tiếp vài
  // mô hình là đủ để tab ăn hết bộ nhớ.
  document.getElementById('m3d-view-stage').innerHTML = '';
  if (m3dBlobUrl) { URL.revokeObjectURL(m3dBlobUrl); m3dBlobUrl = null; }
  syncBodyScrollLock();
}

/**
 * Mở khung xem. `src` là đường dẫn trên máy chủ, hoặc một blob: URL của file
 * người dùng vừa chọn nhưng CHƯA tải lên.
 */
async function moKhungXem(ten, src, soLieu) {
  const stage = document.getElementById('m3d-view-stage');
  document.getElementById('m3d-view-title').textContent = 'Xem mô hình' + (ten ? ` — ${ten}` : '');
  document.getElementById('m3d-view-sub').textContent =
    'Kéo để xoay, cuộn để phóng to. Mô hình tự xoay như trên máy tablet.';
  document.getElementById('m3d-view-so-lieu').innerHTML = soLieu ? veSoLieuMoHinh(soLieu) : '';
  stage.textContent = 'Đang nạp bộ dựng 3D...';
  m3dViewOverlay.classList.add('active');
  syncBodyScrollLock();

  try {
    await napThuVien3D();
  } catch (err) {
    stage.textContent = err.message;
    return;
  }

  datDuongGiaiNen();

  const mv = document.createElement('model-viewer');
  mv.setAttribute('src', src);
  mv.setAttribute('camera-controls', '');
  mv.setAttribute('auto-rotate', '');
  mv.setAttribute('shadow-intensity', '1');
  mv.setAttribute('environment-image', 'neutral');
  mv.style.width = '100%';
  mv.style.height = '420px';
  mv.style.background = 'transparent';
  // Báo lỗi RA MÀN HÌNH. Để im thì mô hình hỏng trông y hệt mô hình đang tải, và
  // người kiểm duyệt sẽ chờ mãi.
  mv.addEventListener('error', (e) => {
    stage.innerHTML = '<div style="color:var(--danger);padding:20px;text-align:center;">'
      + 'Không dựng được mô hình này. '
      + escapeHtml((e.detail && e.detail.sourceError && e.detail.sourceError.message) || 'File có thể hỏng hoặc dùng phần mở rộng glTF chưa hỗ trợ.')
      + '</div>';
  });
  stage.innerHTML = '';
  stage.appendChild(mv);
}

document.getElementById('m3d-view-close').addEventListener('click', dongKhungXem);
m3dViewOverlay.addEventListener('click', (e) => {
  if (e.target === m3dViewOverlay) dongKhungXem();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && m3dViewOverlay.classList.contains('active')) dongKhungXem();
});

// Xem file đang chọn trong ô "File .glb" mà KHÔNG tải lên máy chủ.
function xemThuMoHinh() {
  const f = fileMoHinh();
  if (!f) { pushNotification('error', 'File đã bị bỏ chọn, hãy chọn lại'); return; }
  if (m3dBlobUrl) URL.revokeObjectURL(m3dBlobUrl);
  m3dBlobUrl = URL.createObjectURL(f);
  moKhungXem(f.name, m3dBlobUrl, m3dSoLieuThu);
}

// ---- Mô hình 3D NGAY TRONG biểu mẫu hiện vật ----
//
// Không còn trang "Mô hình 3D" riêng (bỏ 2026-10-04): mỗi hiện vật tự mang mô hình của
// nó. Chọn file .glb là máy chủ kiểm ngân sách ngay; file chỉ được lưu khi bấm nút lưu
// của cả biểu mẫu, và SAU KHI hiện vật đã lưu xong — máy chủ đòi hiện vật đã tồn tại và
// đã có ảnh mới gắn được mô hình (PUT .../model). Kho mô hình phía máy chủ
// (routes/adminModels.js) giữ nguyên; mã mô hình tự đặt theo mã hiện vật.

// Lần gỡ mô hình ĐANG CHẠY (Promise) hoặc null. Biểu mẫu hiện vật CHỜ nó trước khi
// đóng gói `rev` — xem chú thích trong hàm submit.
let m3dGanDangChay = null;
let glbLuot = 0;        // tăng mỗi lần vẽ lại, để kết quả về trễ của hiện vật cũ bị bỏ qua
let glbHienVat = null;  // { id, model3dId } của hiện vật đang sửa; null = đang thêm mới
let glbKham = null;     // { file, promise, dat, soLieu, viPham, loi } của file vừa chọn

async function napDanhSachMoHinh() {
  const res = await authFetch('/api/v1/admin/models');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không tải được kho mô hình');
  if (data.budget) m3dBudget = data.budget;
  return { models: data.models || [], mayDung: data.mayDung };
}

function fileMoHinh() {
  const el = document.getElementById('content-exhibit-glb');
  return el.files && el.files[0] ? el.files[0] : null;
}

/** Vẽ phần "mô hình đang có". `exhibit` = null khi đang THÊM hiện vật mới. */
async function veMoHinhHienVat(exhibit) {
  const luot = ++glbLuot;
  const hop = document.getElementById('content-exhibit-glb-hien-tai');
  const tieuDe = document.getElementById('content-exhibit-glb-title');
  clearTimeout(m3dHenGio);
  glbHienVat = exhibit ? { id: exhibit.id, model3dId: exhibit.model3dId || null } : null;
  tieuDe.textContent = 'Kéo thả file .glb vào đây, hoặc bấm để chọn file';
  hop.innerHTML = '';
  if (!exhibit || !exhibit.model3dId) return;

  hop.innerHTML = '<div class="form-hint">Đang tải mô hình hiện tại...</div>';
  let ds;
  try {
    ds = await napDanhSachMoHinh();
  } catch (err) {
    if (luot === glbLuot && !daBaoLoi(err)) {
      hop.innerHTML = `<div class="form-hint" style="color:var(--danger);">${escapeHtml(err.message)}</div>`;
    }
    return;
  }
  if (luot !== glbLuot) return;   // biểu mẫu đã chuyển sang hiện vật khác trong lúc chờ

  const m = ds.models.find((x) => x.id === exhibit.model3dId);
  if (!m) {
    // Manifest trỏ tới một mã không còn trên đĩa: phải nói ra, không giả vờ "chưa có".
    hop.innerHTML = `<div class="threshold-warn" style="margin-bottom:8px;">{Muc} đang trỏ tới mô hình
      "${escapeHtml(exhibit.model3dId)}" nhưng file không còn trên máy chủ. Chọn file .glb mới bên dưới để thay,
      hoặc <button type="button" class="btn btn-danger btn-tiny" data-act="glb-go">Gỡ mô hình 3D</button></div>`;
    return;
  }
  tieuDe.textContent = 'Chọn file .glb khác để THAY mô hình đang có';
  hop.innerHTML = `<div class="list-row" style="margin-bottom:8px;">
      <div style="flex:1;min-width:0;">
        <div><strong>Đang có mô hình 3D</strong> · ${mb(m.bytes)} MB</div>
        ${veSoLieuMoHinh(m.soLieu)}
        ${veDungAnh(m, ds.mayDung)}
      </div>
      <button type="button" class="btn btn-outline btn-tiny" data-act="m3d-xem" data-id="${escapeHtml(m.label || m.id)}" data-url="${escapeHtml(m.url)}">Xem</button>
      <button type="button" class="btn btn-danger btn-tiny" data-act="glb-go">Gỡ</button>
    </div>`;
  // Đang chờ/đang dựng dải ảnh xoay -> tự làm mới để thấy tiến độ, chỉ khi biểu mẫu còn mở.
  if (['cho', 'dang'].includes(m.dungAnh && m.dungAnh.trangThai)) {
    m3dHenGio = setTimeout(() => {
      if (luot === glbLuot && exhibitModalOverlay.classList.contains('active')) veMoHinhHienVat(glbHienVat);
    }, 2000);
  }
}

// Kiểm ngân sách ngay khi chọn file, KHÔNG lưu gì. Báo "vượt trần" lúc bấm Lưu nghĩa là
// người ta đã điền xong cả biểu mẫu rồi mới biết phải làm lại.
async function khamFileMoHinh() {
  const f = fileMoHinh();
  const hop = document.getElementById('content-exhibit-glb-kham');
  m3dSoLieuThu = null;
  if (!f) { glbKham = null; hop.innerHTML = ''; return; }
  const k = { file: f };
  glbKham = k;
  if (!/\.glb$/i.test(f.name)) {
    k.loi = `"${f.name}" không phải file .glb.`;
    k.promise = Promise.resolve();
  } else {
    hop.innerHTML = '<div class="form-hint">Đang kiểm mô hình...</div>';
    k.promise = (async () => {
      try {
        const fd = new FormData();
        fd.append('file', f);
        const res = await authFetch('/api/v1/admin/models/kham-thu', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { k.loi = data.error || 'Không đọc được file'; return; }
        Object.assign(k, { dat: data.dat, soLieu: data.soLieu, viPham: data.viPham || [] });
      } catch (err) {
        k.loi = daBaoLoi(err) ? 'Phiên đăng nhập hết hạn.' : err.message;
      }
    })();
  }
  await k.promise;
  if (glbKham !== k) return;   // người dùng đã chọn file khác trong lúc chờ
  m3dSoLieuThu = k.soLieu || null;
  const nutBo = '<button type="button" class="btn btn-outline btn-tiny" data-act="glb-bo-chon">Bỏ chọn file</button>';
  if (k.loi) {
    hop.innerHTML = `<div style="color:var(--danger);">${escapeHtml(k.loi)}</div><div style="margin-top:6px;">${nutBo}</div>`;
    return;
  }
  const nutLuu = document.getElementById('content-exhibit-edit-id').value ? 'Lưu' : 'Thêm {muc}';
  hop.innerHTML = (k.dat
    ? `<div style="color:var(--ok,#1f9d6b);font-weight:600;">✓ Hợp lệ — mô hình sẽ được lưu khi bấm "${nutLuu}".</div>`
    : '<div style="color:var(--danger);font-weight:600;">✗ Chưa hợp lệ:</div>'
      + '<ul style="margin:6px 0 0 18px;">' + k.viPham.map((v) => `<li>${escapeHtml(v)}</li>`).join('') + '</ul>')
    + veSoLieuMoHinh(k.soLieu)
    // Xem được TRƯỚC khi lưu, kể cả file vượt ngân sách: chỉ nhìn mới biết có đúng hiện
    // vật không, có bị lộn ngược hay mất texture không.
    + `<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
         <button type="button" class="btn btn-outline btn-tiny" data-act="m3d-xem-thu">Xem thử mô hình này</button>${nutBo}
       </div>`;
}

function boChonFileMoHinh() {
  document.getElementById('content-exhibit-glb').value = '';
  khamFileMoHinh();
}

document.getElementById('content-exhibit-glb').addEventListener('change', khamFileMoHinh);
initDropzone('content-exhibit-glb');

// Mã mô hình đặt theo mã hiện vật; trùng thì thêm hậu tố -2, -3...
function taoMaMoHinh(exhibitId, daCo) {
  const goc = String(exhibitId).replace(/[^A-Za-z0-9_-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 56) || 'mo-hinh';
  let id = goc;
  for (let n = 2; daCo.includes(id); n += 1) id = `${goc}-${n}`;
  return id;
}

/**
 * Gọi SAU KHI hiện vật đã lưu xong. Trả null nếu thành công, ngược lại là câu lỗi.
 * `exhibit` là bản hiện vật máy chủ vừa trả về (có id và model3dId).
 */
async function guiMoHinhSauKhiLuu(zoneId, exhibit, file) {
  const { models } = await napDanhSachMoHinh();
  const cu = exhibit.model3dId ? models.find((m) => m.id === exhibit.model3dId) : null;
  // Chỉ THAY TẠI CHỖ khi mô hình cũ thuộc riêng hiện vật này. Mô hình dùng chung với
  // hiện vật khác (gán từ hồi còn trang "Mô hình 3D") thì tạo mô hình mới — thay tại chỗ
  // là âm thầm đổi luôn mô hình của hiện vật kia.
  const thayCu = Boolean(cu) && (cu.dungO || []).every((h) => h.exhibitId === exhibit.id);
  const id = thayCu ? cu.id : taoMaMoHinh(exhibit.id, models.map((m) => m.id));

  const fd = new FormData();
  fd.append('file', file);
  fd.append('id', id);
  fd.append('label', dispName(exhibit.name) || exhibit.id);
  if (thayCu) fd.append('replace', '1');
  const res = await authFetch('/api/v1/admin/models', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return [data.error || 'Không tải được mô hình lên.', ...(data.viPham || [])].join(' ');

  if (!thayCu) {
    const r2 = await authFetch(`${CONTENT_API_BASE}/zones/${zoneId}/exhibits/${exhibit.id}/model`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: id }),
    });
    const d2 = await r2.json().catch(() => ({}));
    if (!r2.ok) return d2.error || 'Không gắn được mô hình vào {muc}.';
  }
  return null;
}

// Gỡ thì LƯU NGAY (giống xóa ảnh phụ / audio phụ), không đợi nút Lưu. File .glb vẫn nằm
// trên máy chủ: hoàn tác thao tác gỡ ở tab Nhật ký sẽ trỏ lại đúng mô hình đó.
async function goMoHinhHienVat() {
  const zoneId = document.getElementById('content-exhibit-zone-id').value;
  const exhibitId = document.getElementById('content-exhibit-edit-id').value;
  if (!zoneId || !exhibitId) return;
  const ok = await confirmDialog('Gỡ mô hình 3D khỏi {muc} này?\n\nMáy tablet sẽ chỉ hiện ảnh tĩnh. Có thể hoàn tác ở tab "Nhật ký".',
    { title: 'Gỡ mô hình 3D', confirmLabel: 'Gỡ mô hình' });
  if (!ok) return;
  const p = (async () => {
    try {
      const res = await authFetch(`${CONTENT_API_BASE}/zones/${zoneId}/exhibits/${exhibitId}/model`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { pushNotification('error', data.error || 'Không gỡ được mô hình'); return; }
      // LƯU Ý: BẮT BUỘC cập nhật rev. `rev` băm cả model3dId, nên chính thao tác gỡ vừa
      // làm rev cũ lệch — bấm "Lưu" biểu mẫu sau đó sẽ ăn 409 "người khác vừa sửa",
      // trong khi người "khác" đó là chính họ.
      if (data.rev) editingExhibitRev = data.rev;
      pushNotification('success', 'Đã gỡ mô hình 3D khỏi {muc}');
      veMoHinhHienVat({ id: exhibitId, model3dId: null });
      refreshContentViews();
    } catch (err) {
      if (!daBaoLoi(err)) pushNotification('error', err.message);
    }
  })();
  m3dGanDangChay = p;
  p.finally(() => { if (m3dGanDangChay === p) m3dGanDangChay = null; });
}

/** Mở khung xem theo MÃ (popup chi tiết hiện vật). */
async function xemMoHinhTheoId(id) {
  if (!id) return;
  try {
    const m = (await napDanhSachMoHinh()).models.find((x) => x.id === id);
    if (!m) { pushNotification('error', `Mô hình "${id}" không còn trên máy chủ`); return; }
    moKhungXem(m.label || m.id, '/' + m.url, m.soLieu);
  } catch (err) {
    if (!daBaoLoi(err)) pushNotification('error', err.message);
  }
}

// ---- Dải ảnh xoay 360 + poster/thumb (turntableRenderer.js ở máy chủ) ----
let m3dHenGio = null;

function veDungAnh(m, may) {
  const d = m.dungAnh || { trangThai: 'chua' };
  const coChrome = !may || may.coChrome;
  const nut = (chu) => coChrome
    ? `<button type="button" class="btn btn-outline btn-tiny" data-need-level="editor" data-act="m3d-dung-anh" data-id="${escapeHtml(m.id)}">${chu}</button>`
    : '';
  const thanh = (n, t) => `<span style="display:inline-block;width:120px;height:6px;border-radius:3px;background:var(--line,#ddd);overflow:hidden;vertical-align:middle;">`
    + `<span style="display:block;height:100%;width:${Math.round(100 * n / (t || 1))}%;background:var(--accent,#c8973a);"></span></span>`;
  let noiDung;
  switch (d.trangThai) {
    case 'xong':
      noiDung = (m.stills ? `<img src="${escapeHtml(m.stills.thumb)}" alt="" style="width:40px;height:40px;object-fit:contain;border-radius:6px;background:#f2f2f4;vertical-align:middle;">` : '')
        + ` Dải ảnh xoay: ${d.tong || 24} khung — tablet xoay được ngay khi mở {muc}. ${nut('Dựng lại')}`;
      break;
    case 'cho':
      noiDung = 'Đang chờ dựng dải ảnh xoay…';
      break;
    case 'dang':
      noiDung = `Đang dựng dải ảnh xoay ${thanh(d.tien, d.tong)} ${d.tien || 0}/${d.tong || 24}`;
      break;
    case 'loi':
      noiDung = `<span style="color:var(--danger);">Dựng dải ảnh lỗi: ${escapeHtml(d.loi || 'không rõ')}</span> ${nut('Dựng lại')}`;
      break;
    default:
      noiDung = `Chưa có dải ảnh xoay — tablet sẽ hiện ảnh tĩnh cho tới khi khách chạm mở 3D. ${nut('Dựng dải ảnh')}`;
  }
  return `<div class="form-hint" style="padding-top:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">${noiDung}</div>`;
}

async function dungAnhMoHinh(id) {
  try {
    const res = await authFetch(`/api/v1/admin/models/${encodeURIComponent(id)}/dung-anh`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { pushNotification('error', data.error || 'Không xếp hàng dựng được'); return; }
    pushNotification('success', 'Đã xếp hàng dựng lại dải ảnh xoay');
    if (glbHienVat) veMoHinhHienVat(glbHienVat);
  } catch (err) {
    if (!daBaoLoi(err)) pushNotification('error', err.message);
  }
}

const ACTIONS = {
  'zone-detail': (d) => openZoneDetail(d.zone),
  'zone-edit': (d) => startEditContentZone(d.zone),
  'zone-delete': (d) => deleteContentZone(d.zone, Number(d.count || 0)),
  'exhibit-add': (d) => startAddExhibit(d.zone),
  'exhibit-detail': (d) => openExhibitDetail(d.zone, d.exhibit),
  'exhibit-edit': (d) => startEditExhibit(d.zone, d.exhibit),
  'exhibit-delete': (d) => deleteContentExhibit(d.zone, d.exhibit, d.name),
  'spec-remove': (d) => removeSpecRow(Number(d.index)),
  'lang-remove': (d) => removeLanguageRow(d.lang),
  'm3d-xem': (d) => moKhungXem(d.id, '/' + d.url),
  'm3d-xem-thu': () => xemThuMoHinh(),
  'm3d-dung-anh': (d) => dungAnhMoHinh(d.id),
  'm3d-xem-id': (d) => xemMoHinhTheoId(d.id),
  'glb-go': () => goMoHinhHienVat(),
  'glb-bo-chon': () => boChonFileMoHinh(),
  'view': (d) => switchView(d.view),
  'exhibit-copy': (d) => nhanBanHienVat(d.zone, d.exhibit),
  'exhibit-move': (d) => moChuyenKhuVuc(d.zone, d.exhibit),
  'sap-xep-khu-vuc': () => moSapXep('zone'),
  'sap-xep-hien-vat': (d) => moSapXep('exhibit', d.zone),
  'do-day-du-tai': () => loadDoDayDu(),
  'dich-sua': (d) => moSuaDeDich(d),
  'viec-dich-xem': (d) => moBangViecDich(d.lang),
  'ops-tai-lai': () => loadVanHanh(),
  'ph-tam-giu': () => tamGiuPhatHanh(),
  'ph-phat-hanh': () => phatHanhNgay(),
  'dev-dat-ten': (d) => suaTenMay(d.id),
  'dev-xoa': (d) => xoaMay(d.id, d.ten),
};

// Cấp tối thiểu cho từng hành động — lớp phòng vệ THỨ HAI, sau data-need-level.
// Nút nào sau này quên gắn thuộc tính thì vẫn không mở được hộp xác nhận, thay vì
// để người dùng bấm "Xóa khu vực", đọc câu cảnh báo, bấm Đồng ý rồi mới nhận 403.
const ACTION_MIN_LEVEL = {
  'zone-edit': 'editor', 'zone-delete': 'editor', 'exhibit-add': 'editor',
  'exhibit-edit': 'editor', 'exhibit-delete': 'editor', 'spec-remove': 'editor', 'dich-sua': 'editor',
  'glb-go': 'editor', 'm3d-dung-anh': 'editor', 'lang-remove': 'owner',
  'exhibit-copy': 'editor', 'exhibit-move': 'editor', 'sap-xep-khu-vuc': 'editor',
  'sap-xep-hien-vat': 'editor', 'chuyen-luu': 'editor', 'sx-luu': 'editor',
  'ph-tam-giu': 'editor', 'ph-phat-hanh': 'editor', 'dev-dat-ten': 'editor', 'dev-xoa': 'editor',
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const can = ACTION_MIN_LEVEL[el.dataset.act];
  if (can && myLevel() < ROLE_LEVEL[can]) {
    pushNotification('error', `Tài khoản của bạn (${currentUser?.roleLabel || 'hiện tại'}) không làm được việc này. Nếu bạn cần quyền, hãy liên hệ quản lý`);
    return;
  }
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el.dataset);
});

// Ảnh hỏng (file đã bị xóa trên đĩa) thì ẩn đi thay vì hiện icon vỡ. Sự kiện
// "error" của <img> KHÔNG nổi bọt lên, nên phải bắt ở pha capture.
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el && el.tagName === 'IMG' && el.hasAttribute('data-hide-on-error')) {
    el.style.display = 'none';
  }
}, true);

/* ---------- Helper đa ngôn ngữ động (đọc từ contentManifest.languages) ---------- */
function getLangs() {
  // Ưu tiên contentMeta (tải riêng, nhẹ) rồi mới đến contentManifest — tab quản
  // lý không còn tải cả manifest nên không thể phụ thuộc vào nó.
  const src = contentMeta || contentManifest;
  const languages = (src && src.languages && src.languages.length) ? src.languages : ['vi'];
  const fallbackLanguage = (src && src.fallbackLanguage && languages.includes(src.fallbackLanguage))
    ? src.fallbackLanguage
    : languages[0];
  const otherLanguages = languages.filter((l) => l !== fallbackLanguage);
  return { languages, fallbackLanguage, otherLanguages };
}

function langLabel(lang) {
  const src = contentMeta || contentManifest;
  return (src && src.languageNames && src.languageNames[lang]) || lang;
}

// Chữ hiển thị cho một trường đa ngôn ngữ (vd zone.name) — ưu tiên ngôn ngữ mặc định.
function dispName(obj) {
  if (!obj) return '';
  const { fallbackLanguage } = getLangs();
  return obj[fallbackLanguage] || Object.values(obj)[0] || '';
}

// force=false: bỏ qua nếu container đã có nội dung (vd người dùng đang gõ dở
// form "Thêm khu vực" thì loadContentManifest() chạy ngầm do thao tác khác
// KHÔNG được ghi đè mất dữ liệu đang gõ). force=true khi thực sự cần vẽ lại từ
// đầu (mở form sửa một khu vực, hoặc bấm Hủy/lưu xong reset form).
function renderZoneOtherLangFields(force = false) {
  const container = document.getElementById('content-zone-other-langs');
  if (!force && container.children.length) return;
  const { otherLanguages } = getLangs();
  container.innerHTML = otherLanguages.map((lang) => `
    <details class="lang-section" data-lang="${lang}">
      <summary class="lang-section-summary">Nội dung (${escapeHtml(langLabel(lang))}, tuỳ chọn)</summary>
      <div class="lang-section-body">
        <div class="form-group">
          <label>Tên {nhom} (${escapeHtml(langLabel(lang))})</label>
          <input class="form-control" type="text" id="content-zone-name_${lang}">
        </div>
        <div class="form-group">
          <label>Giới thiệu {nhom} (${escapeHtml(langLabel(lang))})</label>
          <textarea class="form-control form-control-lg" id="content-zone-welcome_${lang}"></textarea>
        </div>
        <div class="form-group">
          <label>Audio giới thiệu {nhom} (${escapeHtml(langLabel(lang))})</label>
          ${dropzoneMarkup(`content-zone-intro-audio_${lang}`, { accept: 'audio/*', title: 'Kéo thả file audio vào đây, hoặc bấm để chọn file', hint: 'Chỉ nhận file .mp3' })}
          <small id="content-zone-intro-audio_${lang}-note" class="media-preview-note"></small>
          <audio id="content-zone-intro-audio_${lang}-preview" controls preload="metadata" class="media-preview-audio"></audio>
        </div>
        <div class="form-group">
          <label>Lời thoại audio giới thiệu (${escapeHtml(langLabel(lang))} transcript)</label>
          <textarea class="form-control form-control-lg" id="content-zone-transcript_${lang}"></textarea>
        </div>
        <div class="form-hint">Bỏ trống cả 4 ô trên nếu chưa có nội dung ${escapeHtml(langLabel(lang))} — app sẽ tự dùng ngôn ngữ mặc định.</div>
      </div>
    </details>
  `).join('');
  for (const lang of otherLanguages) initDropzone(`content-zone-intro-audio_${lang}`);
}

// Dấu vân tay của đối tượng LÚC MỞ BIỂU MẪU. Gửi kèm lúc lưu để server từ chối
// nếu người khác đã sửa trong lúc đó (xem assertRev trong adminContent.js).
// null = thêm mới, không cần kiểm tra.
let editingZoneRev = null;
let editingExhibitRev = null;

function resetContentZoneForm() {
  editingContentZoneId = null;
  editingZoneRev = null;
  zoneForm2.reset();
  renderZoneOtherLangFields(true);
  document.getElementById('content-zone-hero-image-note').textContent = '';
  document.getElementById('content-zone-intro-audio-note').textContent = '';
  hideMediaPreview('content-zone-hero-image-preview');
  hideMediaPreview('content-zone-intro-audio-preview');
  zoneForm2Title.textContent = 'Thêm {nhom} mới';
  zoneForm2Submit.textContent = 'Thêm {nhom}';
  zoneForm2Cancel.style.display = 'none';
  zoneForm2Msg.textContent = '';
  zoneForm2Msg.className = 'form-msg';
  document.getElementById('content-zone-hero-image').required = true;
  document.getElementById('content-zone-intro-audio').required = true;
  document.getElementById('content-zone-modal-sub').textContent = '';
  renderImagePanel('zone', null, []);
  renderAudioPanel('zone', null, []);
  renderVideoPanel('zone', null, []);
  datLaiNhap('zone');
  closeZoneModal();
}

// Form khu vực dùng popup như form hiện vật, để bấm "Sửa" ở cuối danh sách
// không phải cuộn ngược lên đầu trang mới thấy form.
// Cờ "đã gõ gì chưa". Đặt lại mốc SẠCH trong openZoneModal vì cả hai luồng (thêm
// mới và sửa) đều điền form bằng mã TRƯỚC rồi mới mở — gán .value bằng mã không
// sinh sự kiện input nên không bị tính là bẩn.
let zoneFormDirty = false;
document.getElementById('content-zone-form').addEventListener('input', () => { zoneFormDirty = true; });
document.getElementById('content-zone-form').addEventListener('change', () => { zoneFormDirty = true; });

function openZoneModal() {
  zoneModalOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  zoneFormDirty = false;
}

// Esc / × / bấm nền TRƯỚC ĐÂY gọi thẳng resetContentZoneForm() nên mọi thứ vừa gõ
// biến mất không một lời hỏi. Nút "Hủy" thì vẫn đóng thẳng — đó là ý định rõ ràng.
async function dongFormKhuVuc() {
  if (zoneFormDirty) {
    const ok = await confirmDialog('Bỏ các thay đổi chưa lưu ở {nhom} này?',
      { title: 'Thoát mà không lưu', confirmLabel: 'Bỏ thay đổi' });
    if (!ok) return;
    xoaNhap('zone');
  }
  resetContentZoneForm();
}

function closeZoneModal() {
  zoneModalOverlay.classList.remove('active');
  syncBodyScrollLock();
}

// Chỉ mở khóa cuộn trang khi KHÔNG còn popup nào đang mở — 2 popup có thể nối
// tiếp nhau (đang sửa khu vực thì bấm thêm hiện vật), đóng cái này mà mở khóa
// ngay thì trang nền cuộn được trong khi popup kia vẫn che.
// Đọc thẳng từ DOM thay vì giữ tham chiếu sẵn: các biến overlay khai báo bằng
// `const` rải rác trong file, tham chiếu chéo dễ dính lỗi "chưa khởi tạo".
function syncBodyScrollLock() {
  const stillOpen = document.querySelector('.modal-overlay.active');
  document.body.style.overflow = stillOpen ? 'hidden' : '';
}

document.getElementById('content-zone-modal-close').addEventListener('click', dongFormKhuVuc);
zoneModalOverlay.addEventListener('click', (e) => {
  if (e.target === zoneModalOverlay) dongFormKhuVuc();
});
document.getElementById('content-zone-add-btn').addEventListener('click', async () => {
  resetContentZoneForm();
  openZoneModal();
  await chuanBiSo('zone');
  batDauNhap('zone');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && zoneModalOverlay.classList.contains('active')) dongFormKhuVuc();
});

async function startEditContentZone(zoneId) {
  // Lấy riêng một khu vực thay vì tìm trong cả manifest: tab này không tải toàn
  // bộ kho về (xem loadZonesPage).
  const z = await fetchJson(`${CONTENT_API_BASE}/zones/${zoneId}`, 'Không tải được {nhom}');
  if (!z) return;
  resetContentZoneForm();
  editingZoneRev = z.rev || null;   // đặt SAU reset vì reset xóa về null
  const { fallbackLanguage, otherLanguages } = getLangs();
  document.getElementById('content-zone-major').value = z.major;
  document.getElementById('content-zone-name').value = z.name?.[fallbackLanguage] || '';
  document.getElementById('content-zone-welcome').value = z.welcomeText?.[fallbackLanguage] || '';
  document.getElementById('content-zone-transcript').value = z.introAudio?.tracks?.[fallbackLanguage]?.transcript || '';
  document.getElementById('content-zone-hero-image-note').textContent = `Ảnh hiện tại: ${z.heroImage} (để trống nếu không đổi)`;
  document.getElementById('content-zone-intro-audio-note').textContent =
    `Audio hiện tại: ${z.introAudio?.tracks?.[fallbackLanguage]?.file} (để trống nếu không đổi)`;
  setMediaPreview('content-zone-hero-image-preview', z.heroImage, `Ảnh nền {nhom} ${dispName(z.name) || z.id}`);
  setMediaPreview('content-zone-intro-audio-preview', z.introAudio?.tracks?.[fallbackLanguage]?.file);
  document.getElementById('content-zone-hero-image').required = false;
  document.getElementById('content-zone-intro-audio').required = false;
  otherLanguages.forEach((lang) => {
    const nameEl = document.getElementById(`content-zone-name_${lang}`);
    const welcomeEl = document.getElementById(`content-zone-welcome_${lang}`);
    const transcriptEl = document.getElementById(`content-zone-transcript_${lang}`);
    const noteEl = document.getElementById(`content-zone-intro-audio_${lang}-note`);
    if (nameEl) nameEl.value = z.name?.[lang] || '';
    if (welcomeEl) welcomeEl.value = z.welcomeText?.[lang] || '';
    if (transcriptEl) transcriptEl.value = z.introAudio?.tracks?.[lang]?.transcript || '';
    if (noteEl) {
      noteEl.textContent = z.introAudio?.tracks?.[lang]?.file
        ? `Audio (${langLabel(lang)}) hiện tại: ${z.introAudio.tracks[lang].file} (để trống nếu không đổi)`
        : `Chưa có audio ${langLabel(lang)}.`;
    }
    setMediaPreview(`content-zone-intro-audio_${lang}-preview`, z.introAudio?.tracks?.[lang]?.file);
  });
  renderImagePanel('zone', { zoneId }, z.images, z.imagesMeta);
  renderAudioPanel('zone', { zoneId }, z.audios);
  renderVideoPanel('zone', { zoneId }, z.videos);
  editingContentZoneId = zoneId;
  zoneForm2Title.textContent = 'Sửa {nhom}';
  document.getElementById('content-zone-modal-sub').textContent = `{Nhom}: ${dispName(z.name)}`;
  zoneForm2Submit.textContent = 'Lưu';
  zoneForm2Cancel.style.display = 'inline-block';
  zoneForm2Msg.textContent = '';
  switchView('videos');
  openZoneModal();
  batDauNhap('zone');
  chuanBiSo('zone');
}

async function deleteContentZone(zoneId, exhibitCount = 0) {
  const z = await fetchJson(`${CONTENT_API_BASE}/zones/${zoneId}`, 'Không tải được {nhom}');
  if (!z) return;
  const ok = await confirmDialog(
    `Xóa {nhom} "${dispName(z.name)}" và toàn bộ ${exhibitCount} {muc} bên trong?\n\nCó thể hoàn tác ở tab "Nhật ký".`,
    { title: 'Xóa {nhom}', confirmLabel: 'Xóa {nhom}' }
  );
  if (!ok) return;
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/zones/${zoneId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const data = await res.json().catch(() => ({}));
      pushNotification('error', `Không thể xóa {nhom}: ${data.error || 'lỗi không xác định'}.`);
      return;
    }
    pushNotification('success', `Đã xóa {nhom} "${dispName(z.name)}".`);
    await refreshContentViews();
    await loadStaticContentStatus();
  } catch (err) {
    if (!daBaoLoi(err)) pushNotification('error', 'Không thể kết nối tới server.');
  }
}

zoneForm2Cancel.addEventListener('click', () => { xoaNhap('zone'); resetContentZoneForm(); });

zoneForm2.addEventListener('submit', async (e) => {
  e.preventDefault();
  const { otherLanguages } = getLangs();
  const fd = new FormData();
  if (editingContentZoneId && editingZoneRev) fd.append('rev', editingZoneRev);
  fd.append('major', document.getElementById('content-zone-major').value);
  fd.append('name', document.getElementById('content-zone-name').value.trim());
  fd.append('welcomeText', document.getElementById('content-zone-welcome').value.trim());
  fd.append('introTranscript', document.getElementById('content-zone-transcript').value.trim());
  const heroFile = document.getElementById('content-zone-hero-image').files[0];
  const audioFile = document.getElementById('content-zone-intro-audio').files[0];
  if (heroFile) fd.append('heroImage', heroFile);
  if (audioFile) fd.append('introAudio', audioFile);
  otherLanguages.forEach((lang) => {
    const nameEl = document.getElementById(`content-zone-name_${lang}`);
    const welcomeEl = document.getElementById(`content-zone-welcome_${lang}`);
    const transcriptEl = document.getElementById(`content-zone-transcript_${lang}`);
    const audioEl = document.getElementById(`content-zone-intro-audio_${lang}`);
    if (nameEl) fd.append(`name_${lang}`, nameEl.value.trim());
    if (welcomeEl) fd.append(`welcomeText_${lang}`, welcomeEl.value.trim());
    if (transcriptEl) fd.append(`introTranscript_${lang}`, transcriptEl.value.trim());
    if (audioEl && audioEl.files[0]) fd.append(`introAudio_${lang}`, audioEl.files[0]);
  });

  zoneForm2Submit.disabled = true;
  try {
    const url = editingContentZoneId ? `${CONTENT_API_BASE}/zones/${editingContentZoneId}` : `${CONTENT_API_BASE}/zones`;
    const method = editingContentZoneId ? 'PUT' : 'POST';
    const res = await authFetch(url, { method, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      zoneForm2Msg.textContent = data.error || 'Không thể lưu {nhom}';
      zoneForm2Msg.className = 'form-msg err';
      pushNotification('error', `Không thể lưu {nhom}: ${data.error || 'lỗi không xác định'}.`);
      return;
    }
    pushNotification('success', editingContentZoneId ? 'Đã cập nhật {nhom}.' : `Đã thêm {nhom} "${dispName(data.name)}".`);
    xoaNhap('zone');
    resetContentZoneForm();
    await refreshContentViews();
    await loadStaticContentStatus();
  } catch (err) {
    if (!daBaoLoi(err)) {
      zoneForm2Msg.textContent = 'Lỗi kết nối server.';
      zoneForm2Msg.className = 'form-msg err';
    }
  } finally {
    zoneForm2Submit.disabled = false;
  }
});

/* ---------- Bảng thông số kỹ thuật (specs[], tùy chọn) cho form hiện vật ----------
 * pendingSpecs: [{ [lang]: { label, value } }, ...] — mỗi dòng một object khóa
 * trực tiếp bằng mã ngôn ngữ, đúng định dạng backend parseSpecs() mong đợi (gửi
 * thẳng JSON.stringify(pendingSpecs) lên, không cần biến đổi gì thêm). */
let pendingSpecs = [];

function renderSpecsList() {
  const container = document.getElementById('content-exhibit-specs-list');
  const { languages, fallbackLanguage } = getLangs();
  if (!pendingSpecs.length) {
    container.innerHTML = '<div style="color:var(--muted);">Chưa có thông số nào.</div>';
    return;
  }
  container.innerHTML = pendingSpecs.map((s, i) => `
    <div style="border:1px solid var(--border,#333); border-radius:8px; padding:8px; display:flex; flex-direction:column; gap:6px;" data-spec-row="${i}">
      ${languages.map((lang) => `
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          <span class="mono" style="width:28px; flex-shrink:0; color:var(--gold2); font-size:12px;">${escapeHtml(lang)}</span>
          <input class="form-control spec-input" style="flex:1; min-width:100px;" data-lang="${lang}" data-field="label" placeholder="Nhãn${lang === fallbackLanguage ? '' : ' (tuỳ chọn)'}">
          <input class="form-control spec-input" style="flex:1; min-width:100px;" data-lang="${lang}" data-field="value" placeholder="Giá trị${lang === fallbackLanguage ? '' : ' (tuỳ chọn)'}">
        </div>
      `).join('')}
      <button type="button" class="btn btn-outline" style="align-self:flex-end; padding:3px 10px; font-size:12px;" data-act="spec-remove" data-index="${i}">Xóa dòng</button>
    </div>
  `).join('');
  container.querySelectorAll('[data-spec-row]').forEach((row) => {
    const i = Number(row.dataset.specRow);
    row.querySelectorAll('.spec-input').forEach((input) => {
      const lang = input.dataset.lang;
      const field = input.dataset.field;
      input.value = (pendingSpecs[i][lang] && pendingSpecs[i][lang][field]) || '';
      input.addEventListener('input', () => {
        pendingSpecs[i][lang] = pendingSpecs[i][lang] || {};
        pendingSpecs[i][lang][field] = input.value;
      });
    });
  });
}

function removeSpecRow(i) {
  pendingSpecs.splice(i, 1);
  renderSpecsList();
}

document.getElementById('content-exhibit-spec-add-btn').addEventListener('click', () => {
  pendingSpecs.push({});
  renderSpecsList();
});

/* ---------- CRUD hiện vật (nằm trong một khu vực) ---------- */
initDropzone('content-exhibit-image');
initDropzone('content-exhibit-audio');

const exhibitModalOverlay = document.getElementById('content-exhibit-modal-overlay');
const exhibitForm = document.getElementById('content-exhibit-form');
const exhibitFormTitle = document.getElementById('content-exhibit-form-title');
const exhibitSubmitBtn = document.getElementById('content-exhibit-submit-btn');
const exhibitCancelBtn = document.getElementById('content-exhibit-cancel-btn');
const exhibitFormMsg = document.getElementById('content-exhibit-form-msg');

function renderExhibitOtherLangFields() {
  const container = document.getElementById('content-exhibit-other-langs');
  const { otherLanguages } = getLangs();
  container.innerHTML = otherLanguages.map((lang) => `
    <details class="lang-section" data-lang="${lang}">
      <summary class="lang-section-summary">Nội dung (${escapeHtml(langLabel(lang))}, tuỳ chọn)</summary>
      <div class="lang-section-body">
        <div class="form-group">
          <label>Tên {muc} (${escapeHtml(langLabel(lang))})</label>
          <input class="form-control" type="text" id="content-exhibit-name_${lang}">
        </div>
        <div class="form-group">
          <label>Tóm tắt (${escapeHtml(langLabel(lang))})</label>
          <textarea class="form-control form-control-lg" id="content-exhibit-summary_${lang}"></textarea>
        </div>
        <div class="form-group">
          <label>Ý nghĩa (${escapeHtml(langLabel(lang))}, tuỳ chọn)</label>
          <textarea class="form-control form-control-lg" id="content-exhibit-meaning_${lang}"></textarea>
        </div>
        <div class="form-group">
          <label>Audio {thuyetMinh} (${escapeHtml(langLabel(lang))})</label>
          ${dropzoneMarkup(`content-exhibit-audio_${lang}`, { accept: 'audio/*', title: 'Kéo thả file audio vào đây, hoặc bấm để chọn file', hint: 'Chỉ nhận file .mp3' })}
          <small id="content-exhibit-audio_${lang}-note" class="media-preview-note"></small>
          <audio id="content-exhibit-audio_${lang}-preview" controls preload="metadata" class="media-preview-audio"></audio>
        </div>
        <div class="form-group">
          <label>Lời {thuyetMinh} (${escapeHtml(langLabel(lang))} transcript)</label>
          <textarea class="form-control form-control-lg" id="content-exhibit-transcript_${lang}"></textarea>
        </div>
        <div class="form-hint">Bỏ trống cả 4 ô trên nếu chưa có nội dung ${escapeHtml(langLabel(lang))} — app sẽ tự dùng ngôn ngữ mặc định.</div>
      </div>
    </details>
  `).join('');
  for (const lang of otherLanguages) initDropzone(`content-exhibit-audio_${lang}`);
}

function resetExhibitForm() {
  exhibitForm.reset();
  editingExhibitRev = null;
  document.getElementById('content-exhibit-zone-id').value = '';
  document.getElementById('content-exhibit-edit-id').value = '';
  document.getElementById('content-exhibit-image-note').textContent = '';
  document.getElementById('content-exhibit-audio-note').textContent = '';
  document.getElementById('content-exhibit-zone-banner').textContent = '';
  hideMediaPreview('content-exhibit-image-preview');
  hideMediaPreview('content-exhibit-audio-preview');
  renderExhibitOtherLangFields();
  pendingSpecs = [];
  renderSpecsList();
  document.getElementById('content-exhibit-image').required = true;
  document.getElementById('content-exhibit-audio').required = true;
  renderImagePanel('exhibit', null, []);
  renderAudioPanel('exhibit', null, []);
  renderVideoPanel('exhibit', null, []);
  dienListing(null);
  veTruongForm(null);
  glbKham = null;
  document.getElementById('content-exhibit-glb-kham').innerHTML = '';
  veMoHinhHienVat(null);
  datLaiNhap('exhibit');
  closeExhibitModal();
  exhibitFormMsg.textContent = '';
}

// Form thêm/sửa hiện vật hiện dạng popup (modal) thay vì một khối nối dài dưới
// trang, để không phải cuộn qua lại giữa form và danh sách.
function openExhibitModal() {
  exhibitFormDirty = false;   // mốc sạch, xem chú thích ở openZoneModal
  ganThanhDinhDang();         // ô ngôn ngữ khác được vẽ lại mỗi lần reset
  exhibitModalOverlay.classList.add('active');
  // Khóa cuộn trang để con lăn chuột chỉ cuộn trong popup.
  document.body.style.overflow = 'hidden';
}

function closeExhibitModal() {
  exhibitModalOverlay.classList.remove('active');
  syncBodyScrollLock();
}

let exhibitFormDirty = false;
document.getElementById('content-exhibit-form').addEventListener('input', () => { exhibitFormDirty = true; });
document.getElementById('content-exhibit-form').addEventListener('change', () => { exhibitFormDirty = true; });

async function dongFormHienVat() {
  if (exhibitFormDirty) {
    const ok = await confirmDialog('Bỏ các thay đổi chưa lưu ở {muc} này?',
      { title: 'Thoát mà không lưu', confirmLabel: 'Bỏ thay đổi' });
    if (!ok) return;
    xoaNhap('exhibit');   // chủ động bỏ thì bỏ luôn bản nháp
  }
  resetExhibitForm();
}

document.getElementById('content-exhibit-modal-close').addEventListener('click', dongFormHienVat);
exhibitModalOverlay.addEventListener('click', (e) => {
  if (e.target === exhibitModalOverlay) dongFormHienVat();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && exhibitModalOverlay.classList.contains('active')) dongFormHienVat();
});

async function startAddExhibit(zoneId) {
  const z = await fetchJson(`${CONTENT_API_BASE}/zones/${zoneId}`, 'Không tải được {nhom}');
  if (!z) return;
  resetExhibitForm();
  document.getElementById('content-exhibit-zone-id').value = zoneId;
  exhibitFormTitle.textContent = 'Thêm {muc}';
  document.getElementById('content-exhibit-zone-banner').textContent =
    `{Nhom}: ${z ? dispName(z.name) : zoneId}`;
  exhibitSubmitBtn.textContent = 'Thêm {muc}';
  openExhibitModal();
  await chuanBiSo('exhibit');
  batDauNhap('exhibit');
}

// Lấy một đối tượng qua API, trả về null và báo lỗi nếu thất bại. Dùng cho các
// form sửa/xem chi tiết.
async function fetchJson(url, errLabel) {
  try {
    const res = await authFetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushNotification('error', data.error || errLabel);
      return null;
    }
    return data;
  } catch (err) {
    if (!daBaoLoi(err)) pushNotification('error', 'Không thể kết nối tới server.');
    return null;
  }
}

async function startEditExhibit(zoneId, exhibitId) {
  const [z, ex] = await Promise.all([
    fetchJson(`${CONTENT_API_BASE}/zones/${zoneId}`, 'Không tải được {nhom}'),
    fetchJson(`${CONTENT_API_BASE}/zones/${zoneId}/exhibits/${exhibitId}`, 'Không tải được {muc}'),
  ]);
  if (!z || !ex) return;
  resetExhibitForm();
  editingExhibitRev = ex.rev || null;   // đặt SAU reset vì reset xóa về null
  veMoHinhHienVat(ex);                  // cũng SAU reset, vì reset vẽ về trạng thái "thêm mới"
  const { fallbackLanguage, otherLanguages } = getLangs();
  document.getElementById('content-exhibit-zone-id').value = zoneId;
  document.getElementById('content-exhibit-edit-id').value = exhibitId;
  document.getElementById('content-exhibit-minor').value = ex.minor;
  dienListing(ex.listing);
  veTruongForm(ex);
  document.getElementById('content-exhibit-name').value = ex.name?.[fallbackLanguage] || '';
  document.getElementById('content-exhibit-summary').value = ex.summary?.[fallbackLanguage] || '';
  document.getElementById('content-exhibit-meaning').value = ex.meaning?.[fallbackLanguage] || '';
  document.getElementById('content-exhibit-transcript').value = ex.audio?.tracks?.[fallbackLanguage]?.transcript || '';
  document.getElementById('content-exhibit-image-note').textContent = `Ảnh hiện tại: ${ex.image} (để trống nếu không đổi)`;
  document.getElementById('content-exhibit-audio-note').textContent =
    `Audio hiện tại: ${ex.audio?.tracks?.[fallbackLanguage]?.file} (để trống nếu không đổi)`;
  setMediaPreview('content-exhibit-image-preview', ex.image, `Ảnh {muc} ${dispName(ex.name) || ex.id}`);
  setMediaPreview('content-exhibit-audio-preview', ex.audio?.tracks?.[fallbackLanguage]?.file);
  otherLanguages.forEach((lang) => {
    const nameEl = document.getElementById(`content-exhibit-name_${lang}`);
    const summaryEl = document.getElementById(`content-exhibit-summary_${lang}`);
    const meaningEl = document.getElementById(`content-exhibit-meaning_${lang}`);
    const transcriptEl = document.getElementById(`content-exhibit-transcript_${lang}`);
    const noteEl = document.getElementById(`content-exhibit-audio_${lang}-note`);
    if (nameEl) nameEl.value = ex.name?.[lang] || '';
    if (summaryEl) summaryEl.value = ex.summary?.[lang] || '';
    if (meaningEl) meaningEl.value = ex.meaning?.[lang] || '';
    if (transcriptEl) transcriptEl.value = ex.audio?.tracks?.[lang]?.transcript || '';
    if (noteEl) {
      noteEl.textContent = ex.audio?.tracks?.[lang]?.file
        ? `Audio (${langLabel(lang)}) hiện tại: ${ex.audio.tracks[lang].file} (để trống nếu không đổi)`
        : `Chưa có audio ${langLabel(lang)}.`;
    }
    setMediaPreview(`content-exhibit-audio_${lang}-preview`, ex.audio?.tracks?.[lang]?.file);
  });
  pendingSpecs = specsTuGoThanhHang(ex);
  renderSpecsList();
  document.getElementById('content-exhibit-image').required = false;
  document.getElementById('content-exhibit-audio').required = false;
  renderImagePanel('exhibit', { zoneId, exhibitId }, ex.images, ex.imagesMeta);
  renderAudioPanel('exhibit', { zoneId, exhibitId }, ex.audios);
  renderVideoPanel('exhibit', { zoneId, exhibitId }, ex.videos);
  exhibitFormTitle.textContent = 'Sửa {muc}';
  document.getElementById('content-exhibit-zone-banner').textContent =
    `{Nhom}: ${dispName(z.name)}`;
  exhibitSubmitBtn.textContent = 'Lưu';
  openExhibitModal();
  batDauNhap('exhibit');
  chuanBiSo('exhibit');
}

async function deleteContentExhibit(zoneId, exhibitId, exhibitName) {
  const ok = await confirmDialog(
    `Xóa {muc} "${exhibitName || exhibitId}"?\n\nẢnh và audio {thuyetMinh} của {muc} này cũng bị xóa. Có thể hoàn tác ở tab "Nhật ký".`,
    { title: 'Xóa {muc}', confirmLabel: 'Xóa {muc}' }
  );
  if (!ok) return;
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/zones/${zoneId}/exhibits/${exhibitId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const data = await res.json().catch(() => ({}));
      pushNotification('error', `Không thể xóa {muc}: ${data.error || 'lỗi không xác định'}.`);
      return;
    }
    pushNotification('success', 'Đã xóa {muc}.');
    await refreshContentViews();
    await loadStaticContentStatus();
  } catch (err) {
    if (!daBaoLoi(err)) pushNotification('error', 'Không thể kết nối tới server.');
  }
}

exhibitCancelBtn.addEventListener('click', () => { xoaNhap('exhibit'); resetExhibitForm(); });

exhibitForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  // LƯU Ý: cuộc đua có thật (đo được) — bấm "Gỡ" mô hình rồi bấm Lưu ngay thì hai
  // request cách nhau ~33 ms. Lệnh gỡ đổi `rev`; nếu biểu mẫu đóng gói `rev` TRƯỚC khi
  // phản hồi kịp về thì máy chủ thấy rev cũ và trả 409 "người khác vừa sửa" — người
  // khác đó chính là họ. Chờ lần gỡ xong là hết đua, mà không chặn ai.
  if (m3dGanDangChay) await m3dGanDangChay.catch(() => {});
  const zoneId = document.getElementById('content-exhibit-zone-id').value;
  const editId = document.getElementById('content-exhibit-edit-id').value;
  const { fallbackLanguage, otherLanguages } = getLangs();

  // Mô hình 3D phải ĐẠT ngân sách trước khi lưu bất cứ thứ gì: lưu hiện vật rồi mới
  // báo mô hình hỏng thì người dùng không biết cái gì đã lưu, cái gì chưa.
  const glbFile = fileMoHinh();
  if (glbFile) {
    if (!glbKham || glbKham.file !== glbFile) khamFileMoHinh();
    await glbKham.promise;
    if (!glbKham.dat) {
      const msg = glbKham.loi || 'Mô hình 3D chưa hợp lệ.';
      exhibitFormMsg.textContent = `${msg} Bỏ chọn file .glb hoặc chọn file khác rồi lưu lại.`;
      exhibitFormMsg.className = 'form-msg err';
      pushNotification('error', `Chưa lưu: ${msg}`);
      document.getElementById('content-exhibit-model-group').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }

  const fd = new FormData();
  if (editId && editingExhibitRev) fd.append('rev', editingExhibitRev);
  fd.append('minor', document.getElementById('content-exhibit-minor').value);
  themListingVaoForm(fd);
  fd.append('name', document.getElementById('content-exhibit-name').value.trim());
  fd.append('summary', document.getElementById('content-exhibit-summary').value.trim());
  fd.append('meaning', document.getElementById('content-exhibit-meaning').value.trim());
  fd.append('transcript', document.getElementById('content-exhibit-transcript').value.trim());
  fd.append('specs', JSON.stringify(pendingSpecs.filter((s) =>
    ((s[fallbackLanguage] && s[fallbackLanguage].label) || '').trim() || ((s[fallbackLanguage] && s[fallbackLanguage].value) || '').trim()
  )));
  const imgFile = document.getElementById('content-exhibit-image').files[0];
  const audFile = document.getElementById('content-exhibit-audio').files[0];
  if (imgFile) fd.append('image', imgFile);
  if (audFile) fd.append('audio', audFile);
  otherLanguages.forEach((lang) => {
    const nameEl = document.getElementById(`content-exhibit-name_${lang}`);
    const summaryEl = document.getElementById(`content-exhibit-summary_${lang}`);
    const meaningEl = document.getElementById(`content-exhibit-meaning_${lang}`);
    const transcriptEl = document.getElementById(`content-exhibit-transcript_${lang}`);
    const audioEl = document.getElementById(`content-exhibit-audio_${lang}`);
    if (nameEl) fd.append(`name_${lang}`, nameEl.value.trim());
    if (summaryEl) fd.append(`summary_${lang}`, summaryEl.value.trim());
    if (meaningEl) fd.append(`meaning_${lang}`, meaningEl.value.trim());
    if (transcriptEl) fd.append(`transcript_${lang}`, transcriptEl.value.trim());
    if (audioEl && audioEl.files[0]) fd.append(`audio_${lang}`, audioEl.files[0]);
  });

  exhibitSubmitBtn.disabled = true;
  try {
    const url = editId
      ? `${CONTENT_API_BASE}/zones/${zoneId}/exhibits/${editId}`
      : `${CONTENT_API_BASE}/zones/${zoneId}/exhibits`;
    const method = editId ? 'PUT' : 'POST';
    const res = await authFetch(url, { method, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      exhibitFormMsg.textContent = data.error || 'Không thể lưu {muc}';
      exhibitFormMsg.className = 'form-msg err';
      pushNotification('error', `Không thể lưu {muc}: ${data.error || 'lỗi không xác định'}.`);
      return;
    }
    pushNotification('success', editId ? 'Đã cập nhật {muc}.' : `Đã thêm {muc} "${dispName(data.name)}".`);
    if (glbFile) {
      exhibitSubmitBtn.textContent = 'Đang tải mô hình 3D...';
      let loi;
      try {
        loi = await guiMoHinhSauKhiLuu(zoneId, data, glbFile);
      } catch (err) {
        loi = daBaoLoi(err) ? 'Phiên đăng nhập hết hạn.' : err.message;
      }
      // Hiện vật đã lưu rồi — chỉ phần mô hình hỏng. Nói rõ như vậy, để không ai nhập
      // lại cả hiện vật và tạo ra bản trùng.
      if (loi) pushNotification('error', `Đã lưu {muc}, nhưng chưa gắn được mô hình 3D: ${loi} Mở "Sửa" để thử lại.`);
      else pushNotification('success', 'Đã tải mô hình 3D lên. Máy chủ đang dựng dải ảnh xoay.');
    }
    xoaNhap('exhibit');
    resetExhibitForm();
    await refreshContentViews();
    await loadStaticContentStatus();
  } catch (err) {
    if (!daBaoLoi(err)) {
      exhibitFormMsg.textContent = 'Lỗi kết nối server.';
      exhibitFormMsg.className = 'form-msg err';
    }
  } finally {
    exhibitSubmitBtn.disabled = false;
  }
});


/* ---------- Chuỗi giao diện app (trường "ui" trong manifest.json) ----------
 * Danh sách khóa + chữ tiếng Việt mặc định này CHÉP LẠI y hệt từ beacon-client
 * (lib/presentation/ui_strings.dart, UiKeys + kUiDefaults) để làm placeholder —
 * chỉ để admin biết đang dịch/đổi câu nào, KHÔNG ảnh hưởng logic app (client có
 * bản mặc định riêng). Để trống ô nào thì app dùng đúng câu mặc định đó. */
const UI_STRING_GROUPS = [
  {
    title: 'Ngôn ngữ / bộ chọn ngôn ngữ',
    keys: [
      { key: 'language.label', vi: 'Ngôn ngữ' },
      { key: 'language.picker.title', vi: 'Chọn ngôn ngữ' },
    ],
  },
  {
    title: 'Phản hồi phát audio (snackbar)',
    keys: [
      { key: 'audio.feedback.noHeadphones', vi: 'Cắm tai nghe để nghe {thuyetMinh}.' },
      { key: 'audio.feedback.notFound', vi: 'Chưa có bản {thuyetMinh} cho {muc} này.' },
    ],
  },
  {
    title: 'Giữ phiên tham quan (thông báo nền)',
    keys: [
      { key: 'keepAlive.channelName', vi: 'Giữ phiên tham quan' },
      { key: 'keepAlive.channelDesc', vi: 'Giữ ứng dụng chạy để bắt beacon khi màn hình tắt.' },
      { key: 'keepAlive.title', vi: 'Đang tham quan' },
      { key: 'keepAlive.text', vi: 'Giữ kết nối beacon khi màn hình tắt' },
    ],
  },
  {
    title: 'Màn chào (khách)',
    keys: [
      { key: 'gate.welcome.title', vi: 'Chào mừng' },
      { key: 'gate.welcome.subtitle', vi: 'quý khách' },
      { key: 'gate.welcome.guidance', vi: 'Ứng dụng tự nhận biết khu trưng bày quanh bạn. Đeo tai nghe để bắt đầu nghe {thuyetMinh}.' },
      { key: 'gate.start', vi: 'Bắt đầu tham quan' },
      { key: 'gate.museum.fallback', vi: '{DonVi}' },
      { key: 'gate.settingsHint', vi: 'Mở cài đặt (dành cho nhân viên)' },
    ],
  },
  {
    title: 'Đồng bộ nội dung (nhân viên)',
    keys: [
      { key: 'gate.sync.updated', vi: 'Đã tải nội dung {version}. Nhấn để khởi động lại và bắt đầu.' },
      { key: 'gate.sync.upToDate', vi: 'Nội dung đã là bản mới nhất ({version}). Nhấn để khởi động lại.' },
      { key: 'gate.sync.noConnectivity', vi: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.' },
      { key: 'gate.sync.failed', vi: 'Đồng bộ thất bại: {error}' },
      { key: 'gate.sync.mockMode', vi: 'Chế độ mock — không có server.' },
      { key: 'gate.sync.doneTitle', vi: 'Đã tải xong' },
      { key: 'gate.sync.notReadyTitle', vi: 'Chưa sẵn sàng' },
      { key: 'gate.sync.freshBody', vi: 'Thiết bị chưa có nội dung tham quan. Nhấn Đồng bộ để tải dữ liệu trước khi bàn giao cho khách.' },
      { key: 'gate.sync.restartCta', vi: 'Khởi động lại ứng dụng' },
      { key: 'gate.sync.syncCta', vi: 'Đồng bộ nội dung' },
    ],
  },
  {
    title: 'Bluetooth (nhân viên)',
    keys: [
      { key: 'gate.ble.permTitle', vi: 'Cần quyền Bluetooth' },
      { key: 'gate.ble.permBody', vi: 'Ứng dụng cần quyền Bluetooth để nhận diện khu trưng bày. Nhấn để cấp quyền.' },
      { key: 'gate.ble.permCta', vi: 'Cấp quyền' },
      { key: 'gate.ble.deniedTitle', vi: 'Quyền bị từ chối' },
      { key: 'gate.ble.deniedBody', vi: 'Quyền Bluetooth đã bị tắt. Mở Cài đặt để bật, rồi quay lại — ứng dụng sẽ tự nhận.' },
      { key: 'gate.ble.deniedCta', vi: 'Mở cài đặt' },
      { key: 'gate.ble.offTitle', vi: 'Bluetooth đang tắt' },
      { key: 'gate.ble.offBody', vi: 'Vui lòng bật Bluetooth để tiếp tục.' },
      { key: 'gate.ble.unsupportedTitle', vi: 'Thiết bị không hỗ trợ' },
      { key: 'gate.ble.unsupportedBody', vi: 'Thiết bị này không hỗ trợ Bluetooth Low Energy.' },
      { key: 'gate.ble.checkingTitle', vi: 'Đang kiểm tra' },
      { key: 'gate.ble.checkingBody', vi: 'Đang kiểm tra Bluetooth…' },
      { key: 'gate.ble.retryCta', vi: 'Thử lại' },
    ],
  },
  {
    title: '{Nhom} (màn 2)',
    keys: [
      { key: 'zone.nearbyTitle', vi: '{Nhom} quanh bạn' },
      { key: 'zone.nearbyGuidance', vi: 'Ứng dụng nhận diện các khu trưng bày gần bạn qua sóng beacon.' },
      { key: 'zone.identifying', vi: 'Đang xác định' },
      { key: 'zone.scanning', vi: 'Đang quét không gian' },
      { key: 'zone.enterPromptA', vi: 'Hãy tiến vào một khu trưng bày để bắt đầu nghe {thuyetMinh}.' },
      { key: 'zone.enterPromptB', vi: 'Hãy tiến vào khu trưng bày để bắt đầu nghe {thuyetMinh}.' },
      { key: 'zone.hereBadge', vi: 'Đang ở đây' },
      { key: 'zone.exhibitCount', vi: '{count} {muc}' },
      { key: 'zone.distanceSuffix', vi: ' · ~{d} m' },
      { key: 'zone.rowSemantics', vi: 'Khu {zone}, {count} {muc}' },
      { key: 'zone.currentSemantics', vi: 'Bạn đang ở khu {zone}, {count} {muc}' },
      { key: 'zone.identifyingSemantics', vi: 'Đang xác định khu trưng bày quanh bạn' },
    ],
  },
  {
    title: 'Chi tiết {muc} (màn 4)',
    keys: [
      { key: 'exhibit.notFound', vi: 'Không tìm thấy {muc}' },
      { key: 'exhibit.back', vi: 'Quay lại' },
      { key: 'exhibit.restart', vi: 'Về đầu' },
      { key: 'exhibit.next', vi: 'Tiếp' },
      { key: 'exhibit.play', vi: 'Phát' },
      { key: 'exhibit.pause', vi: 'Tạm dừng' },
      { key: 'exhibit.section.intro', vi: 'Giới thiệu' },
      { key: 'exhibit.section.meaning', vi: 'Ý nghĩa' },
      { key: 'exhibit.section.specs', vi: 'Thông số' },
      { key: 'exhibit.progress.label', vi: 'Tiến trình {thuyetMinh}' },
      { key: 'exhibit.duration.spoken', vi: '{m} phút {s} giây' },
    ],
  },
  {
    title: 'Danh sách {muc} (màn 3)',
    keys: [
      { key: 'exhibitList.emptyTitle', vi: 'Khu này chưa có {muc}' },
      { key: 'exhibitList.emptyBody', vi: 'Khu trưng bày này hiện chưa có {muc} nào trong nội dung. Vui lòng quay lại sau khi nội dung được cập nhật.' },
      { key: 'exhibitList.zoneNotFound', vi: 'Không tìm thấy khu trưng bày' },
      { key: 'exhibitList.heroKicker', vi: 'Khu trưng bày' },
      { key: 'exhibitList.heroSubtitle', vi: 'Chọn một {muc} để nghe {thuyetMinh}' },
      { key: 'exhibitList.introPlay', vi: 'Nghe giới thiệu khu trưng bày' },
      { key: 'exhibitList.introPause', vi: 'Tạm dừng giới thiệu khu trưng bày' },
      { key: 'exhibitList.nowPlayingSuffix', vi: ', đang phát' },
      { key: 'exhibitList.nowPlayingMeta', vi: 'Đang phát {thuyetMinh}' },
    ],
  },
  {
    title: 'Banner đổi {nhom}',
    keys: [
      { key: 'banner.title', vi: 'Bạn đã sang {nhom} mới' },
      { key: 'banner.stay', vi: 'Ở lại' },
      { key: 'banner.switch', vi: 'Chuyển' },
    ],
  },
  {
    title: 'Cài đặt (nhân viên)',
    keys: [
      { key: 'settings.title', vi: 'Cài đặt' },
      { key: 'settings.language', vi: 'Ngôn ngữ' },
      { key: 'settings.themeHeader', vi: 'Giao diện' },
      { key: 'settings.themeDesc', vi: 'Giao diện được lưu trên thiết bị và giữ nguyên cho khách tiếp theo.' },
      { key: 'settings.theme.dark', vi: 'Tối' },
      { key: 'settings.theme.light', vi: 'Sáng' },
      { key: 'settings.theme.highContrast', vi: 'Tương phản cao' },
      { key: 'settings.caveat.light', vi: 'Màn hình sáng gây chói trong phòng trưng bày tối và có thể làm phiền khách đứng cạnh.' },
      { key: 'settings.caveat.highContrast', vi: 'Tăng độ tương phản cho khách lớn tuổi hoặc thị lực kém.' },
      { key: 'settings.diagnosticsHeader', vi: 'Chẩn đoán' },
      { key: 'settings.distanceToggle', vi: 'Hiện khoảng cách ước lượng' },
      { key: 'settings.distanceDesc', vi: 'Chỉ dùng khi tinh chỉnh khoảng cách tại hiện trường. Hiện số mét ước lượng trên màn {nhom}. Tắt trước khi giao máy cho khách.' },
      { key: 'settings.serverHeader', vi: 'Máy chủ nội dung' },
      { key: 'settings.serverUrlLabel', vi: 'Địa chỉ máy chủ' },
      { key: 'settings.serverUrlDesc', vi: 'Để trống để dùng địa chỉ mặc định của bản cài. Đổi tại đây có hiệu lực ngay lần đồng bộ kế tiếp, không cần cài lại app.' },
      { key: 'settings.syncNowBtn', vi: 'Đồng bộ ngay' },
      { key: 'settings.sync.running', vi: 'Đang đồng bộ…' },
      { key: 'settings.sync.updated', vi: 'Đã cập nhật nội dung mới' },
      { key: 'settings.sync.upToDate', vi: 'Đã là bản mới nhất' },
      { key: 'settings.sync.noServer', vi: 'Không gọi được máy chủ' },
      { key: 'settings.sync.failed', vi: 'Đồng bộ thất bại' },
      { key: 'settings.sync.mock', vi: 'Chế độ thử — không có máy chủ' },
      { key: 'settings.lastSync', vi: 'Lần đồng bộ gần nhất: {time}' },
    ],
  },
];

/* ---------- Quản lý ngôn ngữ (languages / fallbackLanguage / languageNames) ---------- */
let pendingLanguages = { languages: ['vi'], fallbackLanguage: 'vi', languageNames: {} };

function renderLanguagesList() {
  const container = document.getElementById('languages-list');
  container.innerHTML = pendingLanguages.languages.map((lang) => `
    <div style="display:flex; gap:8px; align-items:center;" data-lang-row="${lang}">
      <span class="mono" style="width:32px; color:var(--gold2);">${escapeHtml(lang)}</span>
      <input class="form-control" style="flex:1;" data-lang-name-input="${lang}" placeholder="Tên hiển thị (vd Tiếng Việt)">
      <label style="display:flex; align-items:center; gap:4px; white-space:nowrap; font-size:12.5px; color:var(--muted);">
        <input type="radio" name="lang-fallback" value="${lang}" ${lang === pendingLanguages.fallbackLanguage ? 'checked' : ''}> mặc định
      </label>
      <button type="button" class="icon-action danger" title="Xóa ngôn ngữ" data-act="lang-remove" data-need-role="owner" hidden data-lang="${escapeHtml(lang)}" ${pendingLanguages.languages.length <= 1 ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0-1 14a2 2 0 01-2 2H9a2 2 0 01-2-2L6 6"/></svg>
      </button>
    </div>
  `).join('');
  container.querySelectorAll('[data-lang-name-input]').forEach((input) => {
    const lang = input.dataset.langNameInput;
    input.value = pendingLanguages.languageNames[lang] || '';
    input.addEventListener('input', () => { pendingLanguages.languageNames[lang] = input.value; });
  });
  container.querySelectorAll('input[name="lang-fallback"]').forEach((radio) => {
    radio.addEventListener('change', () => { pendingLanguages.fallbackLanguage = radio.value; });
  });
  // Nút xóa ngôn ngữ được vẽ lại mỗi lần -> phải áp lại quy tắc vai trò, nếu
  // không `data-need-role` trong chuỗi HTML trên sẽ không bao giờ được xử lý.
  applyRoleVisibility();
}

function removeLanguageRow(lang) {
  if (pendingLanguages.languages.length <= 1) return;
  const label = langLabel(lang) !== lang ? `${langLabel(lang)} (${lang})` : lang;
  if (!confirm(`Xóa ngôn ngữ "${label}" khỏi danh sách?\n\nSẽ xóa VĨNH VIỄN toàn bộ nội dung ngôn ngữ này: chuỗi giao diện, tên/mô tả {nhom} & {muc}, thông số, và cả file audio đã tải lên. Không thể hoàn tác qua giao diện — server sẽ tự sao lưu một bản trước khi xóa (thư mục content/.language-backups/) để khôi phục thủ công nếu cần.\n\nBấm "Lưu danh sách ngôn ngữ" bên dưới thì mới thực sự xóa.`)) return;
  pendingLanguages.languages = pendingLanguages.languages.filter((l) => l !== lang);
  delete pendingLanguages.languageNames[lang];
  if (pendingLanguages.fallbackLanguage === lang) pendingLanguages.fallbackLanguage = pendingLanguages.languages[0];
  renderLanguagesList();
}

async function loadLanguagesPanel() {
  const msgEl = document.getElementById('languages-msg');
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/languages`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.textContent = data.error || 'Không tải được danh sách ngôn ngữ.';
      msgEl.className = 'form-msg err';
      return;
    }
    pendingLanguages = {
      languages: data.languages && data.languages.length ? data.languages : ['vi'],
      fallbackLanguage: data.fallbackLanguage || (data.languages && data.languages[0]) || 'vi',
      languageNames: data.languageNames || {},
    };
    renderLanguagesList();
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Không thể kết nối tới server.';
      msgEl.className = 'form-msg err';
    }
  }
}

document.getElementById('lang-add-btn').addEventListener('click', () => {
  const codeEl = document.getElementById('lang-add-code');
  const nameEl = document.getElementById('lang-add-name');
  const code = codeEl.value.trim().toLowerCase();
  const msgEl = document.getElementById('languages-msg');
  if (!/^[a-z]{2,3}$/.test(code)) {
    msgEl.textContent = 'Mã ngôn ngữ chỉ nhận 2-3 chữ cái (vd vi, en, zh).';
    msgEl.className = 'form-msg err';
    return;
  }
  if (pendingLanguages.languages.includes(code)) {
    msgEl.textContent = `Ngôn ngữ "${code}" đã có trong danh sách.`;
    msgEl.className = 'form-msg err';
    return;
  }
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  pendingLanguages.languages.push(code);
  if (nameEl.value.trim()) pendingLanguages.languageNames[code] = nameEl.value.trim();
  codeEl.value = '';
  nameEl.value = '';
  renderLanguagesList();
});

document.getElementById('lang-save-btn').addEventListener('click', async () => {
  const btn = document.getElementById('lang-save-btn');
  const msgEl = document.getElementById('languages-msg');
  btn.disabled = true;
  btn.textContent = 'Đang lưu...';
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/languages`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingLanguages),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const problemsHtml = Array.isArray(data.problems) && data.problems.length
        ? `<ul style="margin:6px 0 0 18px;">${data.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
        : '';
      msgEl.innerHTML = `${escapeHtml(data.error || 'Không thể lưu danh sách ngôn ngữ.')}${problemsHtml}`;
      msgEl.className = 'form-msg err';
      pushNotification('error', data.error || 'Không thể lưu danh sách ngôn ngữ.');
      return;
    }
    pendingLanguages = data;
    renderLanguagesList();
    if (data.removedLanguages && data.removedLanguages.length) {
      const savedMsg = `Đã xóa ngôn ngữ ${data.removedLanguages.join(', ')} — bản sao lưu tại content/${data.backupPath}`;
      flashSaved(btn, msgEl, savedMsg);
      pushNotification('success', savedMsg);
    } else {
      flashSaved(btn, msgEl, 'Đã lưu danh sách ngôn ngữ.');
      pushNotification('success', 'Đã lưu danh sách ngôn ngữ.');
    }
    // Cập nhật lại form khu vực/hiện vật và bảng chuỗi giao diện ngay, không cần tải lại trang.
    await refreshContentViews();
    await loadUiStrings();
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Lỗi kết nối server.';
      msgEl.className = 'form-msg err';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lưu danh sách ngôn ngữ';
  }
});

// ---- Tên bảo tàng (museum.name) — một ô cho mỗi ngôn ngữ đang khai báo ----
// Cũng là tên của cả hệ thống quản trị (tiêu đề trang, tên người gửi thư) — xem
// tenBaoTang.js. Một bộ mã nguồn dùng cho nhiều bảo tàng nhờ chỗ này.
async function loadMuseumName() {
  const box = document.getElementById('museum-name-fields');
  const msgEl = document.getElementById('museum-name-msg');
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/museum`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.textContent = data.error || 'Không tải được tên {donVi}.';
      msgEl.className = 'form-msg err';
      return;
    }
    const { languages, fallbackLanguage } = getLangs();
    box.innerHTML = languages.map((lang) => `
      <div class="form-group">
        <label>${escapeHtml(langLabel(lang))}${lang === fallbackLanguage ? ' — bắt buộc' : ''}</label>
        <input class="form-control" type="text" maxlength="120" data-museum-lang="${escapeHtml(lang)}"
          value="${escapeHtml(data.name?.[lang] || '')}">
      </div>`).join('');
    // Ô vừa tạo không đi qua lần khóa lúc khởi động — Chỉ xem phải thấy ô bị khóa.
    applyRoleVisibility();
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Không thể kết nối tới server.';
      msgEl.className = 'form-msg err';
    }
  }
}

document.getElementById('museum-name-save-btn').addEventListener('click', async () => {
  const btn = document.getElementById('museum-name-save-btn');
  const msgEl = document.getElementById('museum-name-msg');
  const name = {};
  document.querySelectorAll('[data-museum-lang]').forEach((el) => { name[el.dataset.museumLang] = el.value.trim(); });
  btn.disabled = true;
  btn.textContent = 'Đang lưu...';
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/museum`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.textContent = data.error || 'Không lưu được tên {donVi}.';
      msgEl.className = 'form-msg err';
      pushNotification('error', `Không lưu được tên {donVi}: ${data.error || 'lỗi không xác định'}`);
      return;
    }
    const ten = data.name[getLangs().fallbackLanguage] || '';
    const sub = document.querySelector('.brand-sub');
    if (sub) { sub.textContent = ten; sub.title = ten; }
    document.title = document.title.replace(/[^·]*$/, ` ${ten}`);
    msgEl.textContent = 'Đã lưu. Máy tablet sẽ thấy tên mới ở lần đồng bộ kế tiếp.';
    msgEl.className = 'form-msg ok';
    pushNotification('success', 'Đã lưu tên {donVi}');
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Không thể kết nối tới server.';
      msgEl.className = 'form-msg err';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lưu tên {donVi}';
  }
});

async function loadBeaconConfig() {
  const msgEl = document.getElementById('beacon-config-msg');
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/beacon-config`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.textContent = data.error || 'Không tải được cấu hình nâng cao.';
      msgEl.className = 'form-msg err';
      return;
    }
    document.getElementById('beacon-zoneChangeConfirmSeconds').value = data.zoneChangeConfirmSeconds ?? '';
    document.getElementById('beacon-uuid').value = data.uuid ?? '';
    document.getElementById('beacon-deskMajor').value = data.deskMajor ?? '';
    document.getElementById('beacon-minDeltaDb').value = data.minDeltaDb ?? '';
    document.getElementById('beacon-dwellSeconds').value = data.dwellSeconds ?? '';
    document.getElementById('beacon-lockoutSeconds').value = data.lockoutSeconds ?? '';
    document.getElementById('beacon-zoneSilenceSeconds').value = data.zoneSilenceSeconds ?? '';
    document.getElementById('beacon-deskDwellSeconds').value = data.deskDwellSeconds ?? '';
    document.getElementById('beacon-sessionSilenceMinutes').value = data.sessionSilenceMinutes ?? '';
    document.getElementById('beacon-engageAtMeters').value = data.engageAtMeters ?? '';
    document.getElementById('beacon-releaseAtMeters').value = data.releaseAtMeters ?? '';
    document.getElementById('beacon-pathLossExponent').value = data.pathLossExponent ?? '';
    document.getElementById('beacon-kalmanProcessNoise').value = data.kalmanProcessNoise ?? '';
    document.getElementById('beacon-kalmanMeasurementNoise').value = data.kalmanMeasurementNoise ?? '';
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Không thể kết nối tới server.';
      msgEl.className = 'form-msg err';
    }
  }
}

document.getElementById('beacon-config-save-btn').addEventListener('click', async () => {
  const btn = document.getElementById('beacon-config-save-btn');
  const msgEl = document.getElementById('beacon-config-msg');
  btn.disabled = true;
  btn.textContent = 'Đang lưu...';
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/beacon-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zoneChangeConfirmSeconds: document.getElementById('beacon-zoneChangeConfirmSeconds').value.trim(),
        uuid: document.getElementById('beacon-uuid').value.trim(),
        deskMajor: document.getElementById('beacon-deskMajor').value.trim(),
        minDeltaDb: document.getElementById('beacon-minDeltaDb').value.trim(),
        dwellSeconds: document.getElementById('beacon-dwellSeconds').value.trim(),
        lockoutSeconds: document.getElementById('beacon-lockoutSeconds').value.trim(),
        zoneSilenceSeconds: document.getElementById('beacon-zoneSilenceSeconds').value.trim(),
        deskDwellSeconds: document.getElementById('beacon-deskDwellSeconds').value.trim(),
        sessionSilenceMinutes: document.getElementById('beacon-sessionSilenceMinutes').value.trim(),
        engageAtMeters: document.getElementById('beacon-engageAtMeters').value.trim(),
        releaseAtMeters: document.getElementById('beacon-releaseAtMeters').value.trim(),
        pathLossExponent: document.getElementById('beacon-pathLossExponent').value.trim(),
        kalmanProcessNoise: document.getElementById('beacon-kalmanProcessNoise').value.trim(),
        kalmanMeasurementNoise: document.getElementById('beacon-kalmanMeasurementNoise').value.trim(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.textContent = data.error || 'Không thể lưu cấu hình nâng cao.';
      msgEl.className = 'form-msg err';
      pushNotification('error', `Không thể lưu cấu hình nâng cao: ${data.error || 'lỗi không xác định'}.`);
      return;
    }
    document.getElementById('beacon-zoneChangeConfirmSeconds').value = data.zoneChangeConfirmSeconds ?? '';
    document.getElementById('beacon-uuid').value = data.uuid ?? '';
    document.getElementById('beacon-deskMajor').value = data.deskMajor ?? '';
    document.getElementById('beacon-minDeltaDb').value = data.minDeltaDb ?? '';
    document.getElementById('beacon-dwellSeconds').value = data.dwellSeconds ?? '';
    document.getElementById('beacon-lockoutSeconds').value = data.lockoutSeconds ?? '';
    document.getElementById('beacon-zoneSilenceSeconds').value = data.zoneSilenceSeconds ?? '';
    document.getElementById('beacon-deskDwellSeconds').value = data.deskDwellSeconds ?? '';
    document.getElementById('beacon-sessionSilenceMinutes').value = data.sessionSilenceMinutes ?? '';
    document.getElementById('beacon-engageAtMeters').value = data.engageAtMeters ?? '';
    document.getElementById('beacon-releaseAtMeters').value = data.releaseAtMeters ?? '';
    document.getElementById('beacon-pathLossExponent').value = data.pathLossExponent ?? '';
    document.getElementById('beacon-kalmanProcessNoise').value = data.kalmanProcessNoise ?? '';
    document.getElementById('beacon-kalmanMeasurementNoise').value = data.kalmanMeasurementNoise ?? '';
    flashSaved(btn, msgEl, 'Đã lưu cấu hình nâng cao.');
    pushNotification('success', 'Đã lưu cấu hình nâng cao.');
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Lỗi kết nối server.';
      msgEl.className = 'form-msg err';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lưu cấu hình nâng cao';
  }
});

/* ---------- Bản sao lưu ngôn ngữ ---------- */
function formatBackupTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN');
}

function renderLanguageBackupsList(backups, maxKeep = 0) {
  const selectEl = document.getElementById('language-backups-select');
  const warnEl = document.getElementById('language-backups-warn');
  if (warnEl) {
    // Cảnh báo khi sắp chạm ngưỡng — quá mức đó bản CŨ NHẤT bị xóa hẳn.
    const warnAt = Math.ceil(maxKeep * 0.8);
    warnEl.innerHTML = (maxKeep && backups.length >= warnAt)
      ? `<div class="threshold-warn">
           <strong>Đang giữ ${backups.length}/${maxKeep} bản sao lưu.</strong>
           Tạo thêm bản mới sẽ <strong>xóa hẳn bản cũ nhất</strong>.
           Nếu còn cần bản cũ, hãy tải nó về máy trước.
         </div>`
      : '';
  }
  if (!backups.length) {
    selectEl.innerHTML = '<option value="">Chưa có bản sao lưu nào</option>';
    selectEl.disabled = true;
    return;
  }
  selectEl.disabled = false;
  // Dòng trống này là CỐ Ý: không có nó thì <select> luôn có sẵn một bản được
  // chọn ngay khi mở tab, và bấm "Áp dụng" là ghi đè toàn bộ nội dung mà không hề
  // chọn gì (chốt "chưa chọn thì không cho áp dụng" ở restoreLanguageBackup chỉ
  // có tác dụng khi danh sách rỗng).
  selectEl.innerHTML = '<option value="">— Chọn bản sao lưu —</option>' + backups.map((b) => {
    const codes = (b.languages && b.languages.length) ? b.languages : (b.removedLanguages || []);
    const langsLabel = codes.length
      ? codes.map((code) => (langLabel(code) !== code ? `${langLabel(code)} (${code})` : code)).join(', ')
      : (b.note || 'Bản sao lưu');
    const timeLabel = formatBackupTime(b.createdAt);
    const kindLabel = b.type === 'manual' ? 'Thủ công' : b.type === 'language-add' ? 'Thêm ngôn ngữ' : 'Xóa ngôn ngữ';
    return `<option value="${escapeHtml(b.backupId)}">[${kindLabel}] ${escapeHtml(langsLabel)} — ${escapeHtml(timeLabel)}</option>`;
  }).join('');
}

async function loadLanguageBackups() {
  const msgEl = document.getElementById('language-backups-msg');
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/language-backups`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.textContent = data.error || 'Không tải được danh sách sao lưu.';
      msgEl.className = 'form-msg err';
      return;
    }
    renderLanguageBackupsList(data.backups || [], data.maxKeep || 0);
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Không thể kết nối tới server.';
      msgEl.className = 'form-msg err';
    }
  }
}

async function restoreLanguageBackup(backupId, btn) {
  if (!confirm(`Áp dụng lại bản sao lưu này? Toàn bộ nội dung hiện tại ({nhom}, {muc}, chuỗi giao diện...) sẽ bị GHI ĐÈ về đúng lúc sao lưu này và KHÔNG thể hoàn tác.`)) return;
  const msgEl = document.getElementById('language-backups-msg');
  btn.disabled = true;
  btn.textContent = 'Đang áp dụng...';
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/language-backups/${encodeURIComponent(backupId)}/restore`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.textContent = data.error || 'Không thể áp dụng bản sao lưu.';
      msgEl.className = 'form-msg err';
      pushNotification('error', `Không thể áp dụng bản sao lưu: ${data.error || 'lỗi không xác định'}.`);
      return;
    }
    flashSaved(btn, msgEl, 'Đã áp dụng bản sao lưu.');
    pushNotification('success', 'Đã áp dụng bản sao lưu ngôn ngữ.');
    await loadLanguagesPanel();
    await loadLanguageBackups();
    await refreshContentViews();
    await loadUiStrings();
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Lỗi kết nối server.';
      msgEl.className = 'form-msg err';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Áp dụng bản đã chọn';
  }
}

async function deleteLanguageBackup(backupId, btn) {
  if (!confirm('Xóa bản sao lưu này? Không thể hoàn tác.')) return;
  const msgEl = document.getElementById('language-backups-msg');
  btn.disabled = true;
  btn.textContent = 'Đang xóa...';
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/language-backups/${encodeURIComponent(backupId)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const data = await res.json().catch(() => ({}));
      msgEl.textContent = data.error || 'Không thể xóa bản sao lưu.';
      msgEl.className = 'form-msg err';
      pushNotification('error', `Không thể xóa bản sao lưu: ${data.error || 'lỗi không xác định'}.`);
      return;
    }
    pushNotification('success', 'Đã xóa bản sao lưu.');
    await loadLanguageBackups();
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Lỗi kết nối server.';
      msgEl.className = 'form-msg err';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Xóa bản đã chọn';
  }
}

document.getElementById('language-backup-delete-btn').addEventListener('click', (e) => {
  const selectEl = document.getElementById('language-backups-select');
  const msgEl = document.getElementById('language-backups-msg');
  if (!selectEl.value) {
    msgEl.textContent = 'Chọn 1 bản sao lưu trước đã.';
    msgEl.className = 'form-msg err';
    return;
  }
  deleteLanguageBackup(selectEl.value, e.currentTarget);
});

document.getElementById('language-backup-apply-btn').addEventListener('click', (e) => {
  const selectEl = document.getElementById('language-backups-select');
  const msgEl = document.getElementById('language-backups-msg');
  if (!selectEl.value) {
    msgEl.textContent = 'Chọn 1 bản sao lưu trước đã.';
    msgEl.className = 'form-msg err';
    return;
  }
  restoreLanguageBackup(selectEl.value, e.currentTarget);
});

document.getElementById('data-backup-now-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const msgEl = document.getElementById('language-backups-msg');
  if (!confirm('Tạo bản sao lưu toàn bộ dữ liệu hiện tại ({nhom}, {muc}, ảnh, audio)?')) return;
  btn.disabled = true;
  btn.textContent = 'Đang sao lưu...';
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/language-backups`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.textContent = data.error || 'Không thể tạo bản sao lưu.';
      msgEl.className = 'form-msg err';
      pushNotification('error', `Không thể tạo bản sao lưu: ${data.error || 'lỗi không xác định'}.`);
      return;
    }
    pushNotification('success', 'Đã tạo bản sao lưu dữ liệu mới.');
    await loadLanguageBackups();
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Lỗi kết nối server.';
      msgEl.className = 'form-msg err';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sao lưu ngay';
  }
});

let uiStringsData = { languages: ['vi'], ui: {} };

function uiFieldId(lang, key) {
  return `ui-str__${lang}__${key.replace(/[.[\]]/g, '_')}`;
}

function renderUiStringsForm() {
  const container = document.getElementById('ui-strings-groups');
  const langs = uiStringsData.languages.length ? uiStringsData.languages : ['vi'];
  container.innerHTML = UI_STRING_GROUPS.map((group, gi) => `
    <details class="card panel" style="margin-bottom: 12px; padding: 0;" ${gi === 0 ? 'open' : ''}>
      <summary style="cursor: pointer; padding: 14px 18px; font-weight: 600; color: var(--text);">${escapeHtml(group.title)} <span style="color:var(--muted); font-weight:400; font-size:12px;">(${group.keys.length} chuỗi)</span></summary>
      <div style="padding: 4px 18px 16px; display:flex; flex-direction:column; gap:14px;">
        ${group.keys.map((item) => `
          <div>
            <div class="mono" style="font-size:11.5px; color:var(--muted); margin-bottom:4px;">${escapeHtml(item.key)}</div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${langs.map((lang) => `
                <div style="display:flex; gap:8px; align-items:flex-start;">
                  <span class="mono" style="width:28px; flex-shrink:0; padding-top:9px; color:var(--gold2); font-size:12px;">${escapeHtml(lang)}</span>
                  <input class="form-control" id="${uiFieldId(lang, item.key)}" placeholder="${escapeHtml(lang === 'vi' ? item.vi : '(để trống dùng mặc định tiếng Việt)')}">
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </details>
  `).join('');

  langs.forEach((lang) => {
    UI_STRING_GROUPS.forEach((group) => {
      group.keys.forEach((item) => {
        const el = document.getElementById(uiFieldId(lang, item.key));
        el.value = (uiStringsData.ui[lang] && uiStringsData.ui[lang][item.key]) || '';
      });
    });
  });
  // ~300 ô nhập vừa được tạo mới -> khóa lại nếu người đang xem chỉ có quyền đọc.
  applyRoleVisibility();
}

async function loadUiStrings() {
  const msgEl = document.getElementById('ui-strings-msg');
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/ui-strings`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.textContent = data.error || 'Không tải được chuỗi giao diện.';
      msgEl.className = 'form-msg err';
      return;
    }
    uiStringsData = { languages: data.languages && data.languages.length ? data.languages : ['vi'], ui: data.ui || {} };
    renderUiStringsForm();
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Không thể kết nối tới server.';
      msgEl.className = 'form-msg err';
    }
  }
}

document.getElementById('ui-strings-save-btn').addEventListener('click', async () => {
  const btn = document.getElementById('ui-strings-save-btn');
  const msgEl = document.getElementById('ui-strings-msg');
  const langs = uiStringsData.languages.length ? uiStringsData.languages : ['vi'];

  const payload = {};
  langs.forEach((lang) => {
    payload[lang] = {};
    UI_STRING_GROUPS.forEach((group) => {
      group.keys.forEach((item) => {
        const el = document.getElementById(uiFieldId(lang, item.key));
        payload[lang][item.key] = el.value;
      });
    });
  });

  btn.disabled = true;
  btn.textContent = 'Đang lưu...';
  msgEl.textContent = '';
  msgEl.className = 'form-msg';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/ui-strings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ui: payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msgEl.textContent = data.error || 'Không thể lưu.';
      msgEl.className = 'form-msg err';
      pushNotification('error', `Không thể lưu chuỗi giao diện: ${data.error || 'lỗi không xác định'}.`);
      return;
    }
    uiStringsData.ui = data.ui || {};
    flashSaved(btn, msgEl, 'Đã lưu chuỗi giao diện thành công.');
    pushNotification('success', 'Đã lưu chuỗi giao diện thành công.');
  } catch (err) {
    if (!daBaoLoi(err)) {
      msgEl.textContent = 'Lỗi kết nối server.';
      msgEl.className = 'form-msg err';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lưu chuỗi giao diện';
  }
});

/* ---------- Thống kê hành vi khách tham quan (content/.analytics/events.ndjson) ---------- */
const ANALYTICS_API_BASE = '/api/v1/admin/analytics';
let currentAnalyticsRange = 'all';

function formatMinutes(ms) {
  return Math.round((ms || 0) / 60000);
}

function formatSeconds(ms) {
  return Math.round((ms || 0) / 1000);
}

const ANALYTICS_END_REASON_LABELS = {
  completed: 'Hoàn thành', abandoned: 'Bỏ giữa chừng', timeout: 'Hết thời gian', unknown: 'Không rõ',
};

function renderAnalyticsBarList(elId, items, labelFn, valueFn, countFn) {
  const el = document.getElementById(elId);
  if (!items.length) {
    el.innerHTML = '<div class="empty-state">Chưa có dữ liệu.</div>';
    return;
  }
  const max = Math.max(...items.map(valueFn), 1);
  el.innerHTML = items.map((item) => `
    <div class="lang-coverage-row">
      <div class="lang-name">${escapeHtml(labelFn(item))}</div>
      <div class="lang-bar-track"><div class="lang-bar-fill" style="width:${Math.round((valueFn(item) / max) * 100)}%"></div></div>
      <div class="lang-count">${escapeHtml(countFn(item))}</div>
    </div>
  `).join('');
}

function renderAnalyticsExhibitsTable(elId, exhibits) {
  const el = document.getElementById(elId);
  if (!exhibits.length) {
    el.innerHTML = `<tr><td colspan="5"><div class="empty-state">Chưa có dữ liệu</div></td></tr>`;
    return;
  }
  el.innerHTML = exhibits.map((e) => `
    <tr>
      <td>${escapeHtml(e.exhibitName)}</td>
      <td>${escapeHtml(e.zoneName)}</td>
      <td class="mono">${e.playCount}</td>
      <td class="mono">${formatSeconds(e.avgListenedMs)}s</td>
      <td class="mono">${Math.round((e.completionRate || 0) * 100)}%</td>
    </tr>
  `).join('');
}

function renderAnalytics(data) {
  animateCounter(document.getElementById('analytics-stat-tours'), data.tours.count);
  document.getElementById('analytics-stat-duration').textContent = formatMinutes(data.tours.avgDurationMs);
  document.getElementById('analytics-stat-headphone').textContent = Math.round((data.tours.headphoneRate || 0) * 100) + '%';
  animateCounter(document.getElementById('analytics-stat-events'), data.eventCount);

  renderAnalyticsBarList(
    'analytics-zones-list', data.zones,
    (z) => z.zoneName, (z) => z.totalDwellMs, (z) => `${formatSeconds(z.totalDwellMs)}s`
  );
  renderAnalyticsBarList(
    'analytics-language-list', data.tours.languageBreakdown,
    (l) => `${langLabel(l.lang)} (${l.lang})`, (l) => l.count, (l) => String(l.count)
  );
  renderAnalyticsBarList(
    'analytics-end-reason-list', data.tours.endReasonBreakdown,
    (r) => ANALYTICS_END_REASON_LABELS[r.reason] || r.reason, (r) => r.count, (r) => String(r.count)
  );

  renderAnalyticsExhibitsTable('analytics-top-exhibits-body', data.exhibits.slice(0, 10));
  renderAnalyticsExhibitsTable('analytics-bottom-exhibits-body', [...data.exhibits].reverse().slice(0, 10));
}

// range = 'today' | '7d' | '30d' | 'all' | 'month'. Với 'month', tháng lấy từ
// ô chọn tháng (YYYY-MM) và gửi `?month=` — server lọc theo giờ bảo tàng.
let currentAnalyticsMonth = '';
const analyticsMonthInput = document.getElementById('analytics-month');

async function loadAnalytics(range, month) {
  if (range === 'month' && month) currentAnalyticsMonth = month;
  if (range === 'month' && !currentAnalyticsMonth) range = 'all';
  currentAnalyticsRange = range;
  document.querySelectorAll('#analytics-range-selector .range-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.range === range);
  });
  analyticsMonthInput.closest('.range-month').classList.toggle('active', range === 'month');
  if (range !== 'month') analyticsMonthInput.value = '';
  const query = range === 'month'
    ? `month=${encodeURIComponent(currentAnalyticsMonth)}`
    : `range=${encodeURIComponent(range)}`;
  try {
    const res = await authFetch(`${ANALYTICS_API_BASE}/summary?${query}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushNotification('error', data.error || 'Không thể tải thống kê.');
      return;
    }
    renderAnalytics(data);
  } catch (err) {
    if (!daBaoLoi(err)) {
      pushNotification('error', 'Không thể kết nối tới server.');
    }
  }
}

document.querySelectorAll('#analytics-range-selector .range-btn').forEach((btn) => {
  btn.addEventListener('click', () => loadAnalytics(btn.dataset.range));
});
{
  const d = new Date();
  analyticsMonthInput.max = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
analyticsMonthInput.addEventListener('change', () => {
  if (/^\d{4}-\d{2}$/.test(analyticsMonthInput.value)) loadAnalytics('month', analyticsMonthInput.value);
  else loadAnalytics('all');
});

/* ---------- Khởi động: tải dữ liệu thật từ server rồi mới vẽ ---------- */
(async function bootstrap() {
  try {
    await refreshContentViews();
  } catch (err) {
    if (!daBaoLoi(err)) {
      pushNotification('error', 'Không thể tải nội dung {nhom}/{muc} từ server.');
    }
  }
  // Trang chủ tính số liệu trên TOÀN kho nên cần manifest đầy đủ. Thiếu dòng này
  // thì màn hình đầu tiên mỗi ngày luôn báo 0 khu vực / 0 hiện vật:
  // refreshContentViews() chỉ tải lại khi ĐÃ tải, mà lúc khởi động biến đó còn null.
  await loadContentManifest();
  renderHome();
})();

/* ---------- Nhật ký thao tác + hoàn tác ---------- */
const HISTORY_ACTION_LABEL = {
  'zone.create': 'Thêm {nhom}',
  'zone.update': 'Sửa {nhom}',
  'zone.delete': 'Xóa {nhom}',
  'exhibit.create': 'Thêm {muc}',
  'exhibit.update': 'Sửa {muc}',
  'exhibit.delete': 'Xóa {muc}',
  'video.add': 'Thêm video',
  'video.delete': 'Xóa video',
  'languages.update': 'Đổi danh sách ngôn ngữ',
  'ui-strings.update': 'Sửa chữ trong ứng dụng',
  'beacon.update': 'Đổi cấu hình beacon',
  'content.import': 'Nhập gói nội dung',
  'backup.create': 'Tạo bản sao lưu',
  'backup.restore': 'Áp dụng bản sao lưu',
  'exhibit.move': 'Chuyển {nhom}',
  'zone.order': 'Sắp xếp {nhom}',
  'exhibit.order': 'Sắp xếp {muc}',
  'exhibit.model': 'Mô hình 3D',
};

async function loadHistoryLog() {
  const el = document.getElementById('history-list');
  el.innerHTML = '<div style="color:var(--muted); padding:10px 0;">Đang tải...</div>';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/history`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      el.innerHTML = `<span class="err">${escapeHtml(data.error || 'Không đọc được nhật ký.')}</span>`;
      return;
    }
    const entries = data.entries || [];
    if (!entries.length) {
      el.innerHTML = '<div class="empty-state">Chưa có thao tác nào được ghi lại.</div>';
      return;
    }
    // Cảnh báo khi sắp chạm ngưỡng: quá mức đó thao tác cũ nhất bị XÓA HẲN (cả bản
    // chụp manifest lẫn file media trong thùng rác của nó), không còn hoàn tác về
    // xa hơn được nữa. Báo trước để người dùng kịp sao lưu.
    const keep = data.keepActions || 0;
    const warnAt = Math.ceil(keep * 0.8);
    const banner = (keep && entries.length >= warnAt)
      ? `<div class="threshold-warn">
           <strong>Nhật ký đã dùng ${entries.length}/${keep} chỗ.</strong>
           Nhật ký chỉ giữ ${keep} thao tác gần nhất — thêm thao tác mới sẽ đẩy thao tác cũ nhất ra
           và <strong>không hoàn tác về xa hơn được nữa</strong>.
           Nếu sắp làm nhiều thay đổi lớn, hãy bấm “Sao lưu ngay” ở tab Quản lý nội dung trước.
         </div>`
      : '';
    // entries[0] là mới nhất -> số thao tác bị hoàn tác kéo theo = vị trí trong mảng
    el.innerHTML = banner + entries.map((e, i) => `
      <div class="history-row">
        <div class="history-main">
          <div class="history-title">
            <span class="history-badge">${escapeHtml(HISTORY_ACTION_LABEL[e.action] || e.action)}</span>
            ${escapeHtml(e.summary || '')}
          </div>
          <div class="history-meta">
            ${escapeHtml(formatBackupTime(e.at))} · ${escapeHtml(e.user || 'admin')}
            ${e.fileCount ? ` · ${e.fileCount} tệp được giữ lại để hoàn tác` : ''}
            ${i === 0 ? '<span class="history-latest">mới nhất</span>' : ''}
          </div>
        </div>
        <button type="button" class="btn btn-outline history-undo-btn"
                data-seq="${e.seq}" data-after="${i}" ${e.canUndo ? '' : 'disabled title="Bản chụp không còn"'}>
          ${i === 0 ? 'Hoàn tác' : `Hoàn tác về đây`}
        </button>
      </div>
    `).join('');
    el.querySelectorAll('.history-undo-btn').forEach((btn) => {
      btn.addEventListener('click', () => undoHistory(Number(btn.dataset.seq), Number(btn.dataset.after), btn));
    });
  } catch (err) {
    if (!daBaoLoi(err)) el.innerHTML = '<span class="err">Không thể kết nối tới server.</span>';
  }
}

async function undoHistory(seq, laterCount, btn) {
  const msg = laterCount > 0
    ? `Hoàn tác về trạng thái ngay trước thao tác này?\n\nVì các thao tác chồng lên nhau, ${laterCount} thao tác thực hiện sau đó cũng sẽ bị hoàn tác theo.`
    : 'Hoàn tác thao tác vừa rồi? Nội dung sẽ trở lại đúng như trước khi thực hiện.';
  if (!(await confirmDialog(msg, { title: 'Hoàn tác', confirmLabel: 'Hoàn tác' }))) return;
  btn.disabled = true;
  btn.textContent = 'Đang hoàn tác...';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/history/${seq}/undo`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      pushNotification('error', data.error || 'Không hoàn tác được.');
      loadHistoryLog();
      return;
    }
    pushNotification('success', data.undoneCount > 1
      ? `Đã hoàn tác ${data.undoneCount} thao tác.`
      : 'Đã hoàn tác thao tác vừa rồi.');
    loadHistoryLog();
    refreshContentViews();
    loadStaticContentStatus();
  } catch (err) {
    if (!daBaoLoi(err)) pushNotification('error', 'Không thể kết nối tới server.');
    loadHistoryLog();
  }
}

document.getElementById('history-reload-btn').addEventListener('click', loadHistoryLog);

/* =====================================================================================
 * TIỆN ÍCH NHẬP LIỆU (2026-10-04, CLAUDE.md §5.27)
 *   - Tự lưu nháp biểu mẫu khu vực/hiện vật (localStorage), hỏi khôi phục khi mở lại
 *   - Gợi ý số Major/Minor còn trống + báo trùng ngay khi gõ
 *   - Nhân bản hiện vật (mở biểu mẫu Thêm đã điền sẵn phần chữ)
 *   - Chuyển hiện vật sang khu vực khác
 *   - Sắp xếp thứ tự khu vực / hiện vật (lưu MỘT lần — một mục nhật ký)
 *   - Ctrl+S để lưu biểu mẫu đang mở
 *   - Bảng độ đầy đủ theo ngôn ngữ
 *   - Xóa mô hình 3D không còn dùng (trong Kiểm tra toàn vẹn)
 * ===================================================================================== */

// ---------- Số beacon đã dùng (GET /numbers) ----------
async function taiSoBeacon() {
  const res = await authFetch(`${CONTENT_API_BASE}/numbers`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Không tải được danh sách số beacon');
  return data;
}

function soTrongNhoNhat(daDung, tranh = []) {
  const bo = new Set([...daDung, ...tranh].filter((n) => Number.isInteger(n)));
  for (let n = 1; n <= 65535; n += 1) if (!bo.has(n)) return n;
  return null;
}

// Ô gợi ý ngay dưới ô số. Tạo một lần, dùng lại.
function oGoiYSo(inputId) {
  const id = `${inputId}-goi-y`;
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'form-hint so-goi-y';
    document.getElementById(inputId).insertAdjacentElement('afterend', el);
  }
  return el;
}

// LƯU Ý: `var`, không `let/const` — bootstrap() ở phía trên file có thể gọi vào các hàm
// dưới đây trước khi dòng khai báo này chạy tới (lỗi "chưa khởi tạo").
var soBeacon = null;   // bản đọc lúc mở biểu mẫu

function kiemSoMinor() {
  const el = oGoiYSo('content-exhibit-minor');
  const zoneId = document.getElementById('content-exhibit-zone-id').value;
  const editId = document.getElementById('content-exhibit-edit-id').value;
  const z = soBeacon && soBeacon.zones.find((x) => x.id === zoneId);
  const raw = document.getElementById('content-exhibit-minor').value;
  if (!z || raw === '') { el.textContent = ''; el.className = 'form-hint so-goi-y'; return; }
  const so = Number(raw);
  const khac = z.exhibits.filter((e) => e.id !== editId);
  const trung = khac.find((e) => e.minor === so);
  const goiY = soTrongNhoNhat(khac.map((e) => e.minor));
  if (!Number.isInteger(so) || so < 1 || so > 65535) {
    el.textContent = 'Minor phải là số nguyên từ 1 đến 65535.';
    el.className = 'form-hint so-goi-y so-loi';
  } else if (trung) {
    el.textContent = `⚠ Số ${so} đã dùng cho "${trung.name}" trong {nhom} này. Số trống gần nhất: ${goiY}.`;
    el.className = 'form-hint so-goi-y so-loi';
  } else {
    el.textContent = `✓ Số ${so} còn trống trong {nhom} này.`;
    el.className = 'form-hint so-goi-y so-ok';
  }
}

function kiemSoMajor() {
  const el = oGoiYSo('content-zone-major');
  const raw = document.getElementById('content-zone-major').value;
  if (!soBeacon || raw === '') { el.textContent = ''; el.className = 'form-hint so-goi-y'; return; }
  const so = Number(raw);
  const khac = soBeacon.zones.filter((z) => z.id !== editingContentZoneId);
  const trung = khac.find((z) => z.major === so);
  const goiY = soTrongNhoNhat(khac.map((z) => z.major), [soBeacon.deskMajor]);
  if (!Number.isInteger(so) || so < 1 || so > 65535) {
    el.textContent = 'Major phải là số nguyên từ 1 đến 65535.';
    el.className = 'form-hint so-goi-y so-loi';
  } else if (so === soBeacon.deskMajor) {
    el.textContent = `⚠ Số ${so} là số của quầy đón khách (deskMajor), không dùng cho {nhom}. Số trống gần nhất: ${goiY}.`;
    el.className = 'form-hint so-goi-y so-loi';
  } else if (trung) {
    el.textContent = `⚠ Số ${so} đã dùng cho {nhom} "${trung.name}". Số trống gần nhất: ${goiY}.`;
    el.className = 'form-hint so-goi-y so-loi';
  } else {
    el.textContent = `✓ Số ${so} còn trống.`;
    el.className = 'form-hint so-goi-y so-ok';
  }
}

document.getElementById('content-exhibit-minor').addEventListener('input', kiemSoMinor);
document.getElementById('content-zone-major').addEventListener('input', kiemSoMajor);

// Gọi SAU khi biểu mẫu đã điền xong. Đang THÊM mới mà ô số còn trống thì điền sẵn số
// trống nhỏ nhất; đang SỬA thì chỉ kiểm.
async function chuanBiSo(loai) {
  try {
    soBeacon = await taiSoBeacon();
  } catch (err) {
    soBeacon = null;
    if (!daBaoLoi(err)) console.error('[so-beacon]', err.message);
    return;
  }
  if (loai === 'exhibit') {
    const o = document.getElementById('content-exhibit-minor');
    const zoneId = document.getElementById('content-exhibit-zone-id').value;
    const z = soBeacon.zones.find((x) => x.id === zoneId);
    if (!document.getElementById('content-exhibit-edit-id').value && !o.value && z) {
      o.value = soTrongNhoNhat(z.exhibits.map((e) => e.minor));
    }
    kiemSoMinor();
  } else {
    const o = document.getElementById('content-zone-major');
    if (!editingContentZoneId && !o.value) {
      o.value = soTrongNhoNhat(soBeacon.zones.map((z) => z.major), [soBeacon.deskMajor]);
    }
    kiemSoMajor();
  }
}

// ---------- Tự lưu nháp biểu mẫu ----------
// Phiên đăng nhập hết sau 8 giờ, mất mạng, lỡ đóng tab... là mất trắng lời thuyết minh
// dài đang gõ. Nháp nằm trong trình duyệt (localStorage) của chính máy đó — không lên máy
// chủ, nên không ai khác thấy. File (ảnh, audio, mô hình) KHÔNG lưu được vào nháp.
var NHAP_HAN_MS = 7 * 24 * 3600 * 1000;
var nhapKhoa = { exhibit: null, zone: null };
var nhapHen = { exhibit: null, zone: null };

function formNhap(loai) {
  return loai === 'exhibit' ? exhibitForm : zoneForm2;
}

function khoaNhap(loai) {
  const ai = (currentUser && (currentUser.id || currentUser.login)) || 'x';
  if (loai === 'exhibit') {
    const editId = document.getElementById('content-exhibit-edit-id').value;
    const zoneId = document.getElementById('content-exhibit-zone-id').value;
    return `beacon_nhap:${ai}:hv:${editId || `moi:${zoneId}`}`;
  }
  return `beacon_nhap:${ai}:kv:${editingContentZoneId || 'moi'}`;
}

function docGiaTriForm(form) {
  const v = {};
  form.querySelectorAll('input[id], textarea[id]').forEach((el) => {
    if (['file', 'hidden', 'checkbox', 'radio'].includes(el.type) || el.classList.contains('spec-input')) return;
    v[el.id] = el.value;
  });
  return v;
}

function hopThongBaoForm(loai) {
  const form = formNhap(loai);
  let el = form.querySelector(':scope > .form-thong-bao');
  if (!el) {
    el = document.createElement('div');
    el.className = 'form-thong-bao';
    el.hidden = true;
    form.prepend(el);
  }
  return el;
}

function anThongBaoForm(loai) {
  const el = hopThongBaoForm(loai);
  el.hidden = true;
  el.innerHTML = '';
}

function luuNhap(loai) {
  const key = nhapKhoa[loai];
  if (!key) return;
  const data = { t: Date.now(), v: docGiaTriForm(formNhap(loai)) };
  if (loai === 'exhibit') data.specs = pendingSpecs;
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* bộ nhớ trình duyệt bị chặn — bỏ qua */ }
}

function xoaNhap(loai) {
  const key = nhapKhoa[loai];
  if (!key) return;
  try { localStorage.removeItem(key); } catch { /* như trên */ }
}

['exhibit', 'zone'].forEach((loai) => {
  formNhap(loai).addEventListener('input', () => {
    clearTimeout(nhapHen[loai]);
    nhapHen[loai] = setTimeout(() => luuNhap(loai), 600);
  });
});

// Gọi SAU khi biểu mẫu đã điền và mở. Có nháp KHÁC với nội dung đang hiện thì hỏi.
function batDauNhap(loai) {
  clearTimeout(nhapHen[loai]);
  nhapKhoa[loai] = khoaNhap(loai);
  let nhap = null;
  try { nhap = JSON.parse(localStorage.getItem(nhapKhoa[loai]) || 'null'); } catch { nhap = null; }
  if (!nhap || !nhap.v) return;
  if (Date.now() - nhap.t > NHAP_HAN_MS) { xoaNhap(loai); return; }
  const hienTai = docGiaTriForm(formNhap(loai));
  const khac = Object.keys(nhap.v).some((id) => id in hienTai && (nhap.v[id] || '') !== (hienTai[id] || ''))
    || (loai === 'exhibit' && JSON.stringify(nhap.specs || []) !== JSON.stringify(pendingSpecs));
  if (!khac) return;
  const luc = new Date(nhap.t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  const el = hopThongBaoForm(loai);
  el.innerHTML = `<div><strong>Có bản nháp chưa lưu</strong> lúc ${escapeHtml(luc)}. Khôi phục để gõ tiếp
      (ảnh, audio và mô hình 3D phải chọn lại).</div>
    <div class="form-thong-bao-nut">
      <button type="button" class="btn btn-primary btn-tiny" data-act="nhap-khoi-phuc" data-loai="${loai}">Khôi phục</button>
      <button type="button" class="btn btn-outline btn-tiny" data-act="nhap-bo" data-loai="${loai}">Bỏ bản nháp</button>
    </div>`;
  el.hidden = false;
}

function khoiPhucNhap(loai) {
  let nhap = null;
  try { nhap = JSON.parse(localStorage.getItem(nhapKhoa[loai]) || 'null'); } catch { nhap = null; }
  anThongBaoForm(loai);
  if (!nhap) return;
  for (const [id, val] of Object.entries(nhap.v || {})) {
    const el = document.getElementById(id);
    if (el && formNhap(loai).contains(el)) el.value = val;
  }
  if (loai === 'exhibit') {
    pendingSpecs = Array.isArray(nhap.specs) ? nhap.specs : [];
    renderSpecsList();
    exhibitFormDirty = true;
    kiemSoMinor();
  } else {
    zoneFormDirty = true;
    kiemSoMajor();
  }
  pushNotification('success', 'Đã khôi phục bản nháp. Nhớ chọn lại ảnh và audio nếu cần.');
}

function boNhap(loai) {
  xoaNhap(loai);
  anThongBaoForm(loai);
}

// ---------- Nhân bản hiện vật ----------
// Mở biểu mẫu THÊM đã điền sẵn phần chữ. Không chép file: ảnh/audio là của hiện vật kia.
// Lời thuyết minh ngôn ngữ khác cũng không chép — máy chủ bắt nó đi cùng file audio của
// chính ngôn ngữ đó, chép riêng chữ thì bấm Lưu sẽ bị từ chối.
async function nhanBanHienVat(zoneId, exhibitId) {
  const ex = await fetchJson(`${CONTENT_API_BASE}/zones/${zoneId}/exhibits/${exhibitId}`, 'Không tải được {muc}');
  if (!ex) return;
  await startAddExhibit(zoneId);
  const { fallbackLanguage, otherLanguages } = getLangs();
  const dat = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  dat('content-exhibit-name', `${ex.name?.[fallbackLanguage] || ''} (bản sao)`);
  dat('content-exhibit-summary', ex.summary?.[fallbackLanguage]);
  dat('content-exhibit-meaning', ex.meaning?.[fallbackLanguage]);
  dat('content-exhibit-transcript', ex.audio?.tracks?.[fallbackLanguage]?.transcript);
  otherLanguages.forEach((lang) => {
    dat(`content-exhibit-name_${lang}`, ex.name?.[lang]);
    dat(`content-exhibit-summary_${lang}`, ex.summary?.[lang]);
    dat(`content-exhibit-meaning_${lang}`, ex.meaning?.[lang]);
  });
  pendingSpecs = specsTuGoThanhHang(ex);
  renderSpecsList();
  veTruongForm(ex);
  napOTrangThai(ex.listing?.status || '');
  exhibitFormTitle.textContent = `Thêm {muc} — nhân bản từ "${dispName(ex.name) || ex.id}"`;
  const el = hopThongBaoForm('exhibit');
  el.innerHTML = `<div><strong>Đã chép phần chữ</strong> từ "${escapeHtml(dispName(ex.name) || ex.id)}". Còn phải chọn
    ảnh, audio {thuyetMinh} (và mô hình 3D nếu có). Lời {thuyetMinh} các ngôn ngữ khác nhập cùng lúc với audio của ngôn ngữ đó.</div>`;
  el.hidden = false;
  exhibitFormDirty = true;
  luuNhap('exhibit');
}

// ---------- Hộp thoại dùng chung ----------
const tienIchOverlay = document.getElementById('tien-ich-overlay');

function moTienIch(html) {
  document.getElementById('tien-ich-card').innerHTML =
    `<button type="button" class="modal-close" data-act="tien-ich-dong" aria-label="Đóng">&times;</button>${html}`;
  tienIchOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function dongTienIch() {
  tienIchOverlay.classList.remove('active');
  document.getElementById('tien-ich-card').innerHTML = '';
  syncBodyScrollLock();
}

tienIchOverlay.addEventListener('click', (e) => { if (e.target === tienIchOverlay) dongTienIch(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && tienIchOverlay.classList.contains('active')) dongTienIch();
});

// ---------- Chuyển hiện vật sang khu vực khác ----------
var chuyenDangMo = null;   // { zoneId, exhibitId, ex, tu, so }

async function moChuyenKhuVuc(zoneId, exhibitId) {
  let so;
  try { so = await taiSoBeacon(); } catch (err) { if (!daBaoLoi(err)) pushNotification('error', err.message); return; }
  const tu = so.zones.find((z) => z.id === zoneId);
  const ex = tu && tu.exhibits.find((e) => e.id === exhibitId);
  if (!ex) { pushNotification('error', 'Không tìm thấy {muc}, hãy tải lại trang.'); return; }
  const dich = so.zones.filter((z) => z.id !== zoneId);
  if (!dich.length) { pushNotification('error', '{DonVi} mới có một {nhom}, chưa có chỗ nào để chuyển tới.'); return; }
  if (tu.exhibits.length === 1) {
    pushNotification('error', `"${ex.name}" là {muc} duy nhất của {nhom} "${tu.name}" — chuyển đi thì {nhom} đó trống. Thêm {muc} khác cho {nhom} đó trước.`);
    return;
  }
  chuyenDangMo = { zoneId, exhibitId, ex, tu, so };
  moTienIch(`
    <div class="modal-head"><h2 class="modal-title" style="font-size:20px;">Chuyển sang {nhom} khác</h2></div>
    <div class="form-hint" style="margin-bottom:14px;">"${escapeHtml(ex.name)}" — đang ở {nhom} "${escapeHtml(tu.name)}" (major ${tu.major}, minor ${ex.minor}).
      Ảnh, audio, mô hình 3D và nội dung giữ nguyên.</div>
    <div class="form-group">
      <label for="chuyen-den">Chuyển tới {nhom}</label>
      <select class="form-control" id="chuyen-den">${dich.map((z) => `<option value="${escapeHtml(z.id)}">${escapeHtml(z.name)} (major ${z.major})</option>`).join('')}</select>
    </div>
    <div class="form-group">
      <label for="chuyen-minor">Số Minor ở {nhom} mới</label>
      <input class="form-control" type="number" id="chuyen-minor" min="1" max="65535">
      <div class="form-hint so-goi-y" id="chuyen-minor-goi-y"></div>
    </div>
    <div class="threshold-warn" id="chuyen-canh-bao" style="margin-bottom:16px;"></div>
    <div class="form-actions">
      <button type="button" class="btn btn-primary" data-act="chuyen-luu">Chuyển</button>
      <button type="button" class="btn btn-outline" data-act="tien-ich-dong">Hủy</button>
    </div>`);
  document.getElementById('chuyen-den').addEventListener('change', () => capNhatChuyen(true));
  document.getElementById('chuyen-minor').addEventListener('input', () => capNhatChuyen(false));
  capNhatChuyen(true);
}

function capNhatChuyen(doiKhuVuc) {
  const c = chuyenDangMo;
  if (!c) return;
  const den = c.so.zones.find((z) => z.id === document.getElementById('chuyen-den').value);
  const oMinor = document.getElementById('chuyen-minor');
  const daDung = den.exhibits.map((e) => e.minor);
  // Đổi khu vực đích: giữ số cũ nếu còn trống ở đó, không thì lấy số trống nhỏ nhất.
  if (doiKhuVuc) oMinor.value = daDung.includes(c.ex.minor) ? soTrongNhoNhat(daDung) : c.ex.minor;
  const so = Number(oMinor.value);
  const trung = den.exhibits.find((e) => e.minor === so);
  const goiY = document.getElementById('chuyen-minor-goi-y');
  if (!Number.isInteger(so) || so < 1 || so > 65535) {
    goiY.textContent = 'Minor phải là số nguyên từ 1 đến 65535.'; goiY.className = 'form-hint so-goi-y so-loi';
  } else if (trung) {
    goiY.textContent = `⚠ Số ${so} đã dùng cho "${trung.name}". Số trống gần nhất: ${soTrongNhoNhat(daDung)}.`; goiY.className = 'form-hint so-goi-y so-loi';
  } else {
    goiY.textContent = `✓ Số ${so} còn trống ở {nhom} này.`; goiY.className = 'form-hint so-goi-y so-ok';
  }
  // Cái giá ngoài đời thật: beacon của hiện vật mang đúng cặp số major/minor. Đổi trong
  // CMS mà không đổi beacon thì máy tablet nhận nhầm hoặc không nhận ra hiện vật.
  document.getElementById('chuyen-canh-bao').innerHTML = `<strong>Nhớ đổi beacon ngoài thực tế.</strong> Sau khi chuyển,
    {muc} mang số <strong>major ${den.major} / minor ${Number.isInteger(so) ? so : '?'}</strong> (trước đây major ${c.tu.major} / minor ${c.ex.minor}).
    Beacon gắn ở {muc} phải được cài lại đúng cặp số này, nếu không máy tablet sẽ không nhận ra {muc}.`;
}

async function luuChuyenKhuVuc(btn) {
  const c = chuyenDangMo;
  if (!c) return;
  const toZoneId = document.getElementById('chuyen-den').value;
  const minor = document.getElementById('chuyen-minor').value;
  btn.disabled = true;
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/zones/${c.zoneId}/exhibits/${c.exhibitId}/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toZoneId, minor }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { pushNotification('error', data.error || 'Không chuyển được {muc}.'); btn.disabled = false; return; }
    const den = c.so.zones.find((z) => z.id === toZoneId);
    dongTienIch();
    chuyenDangMo = null;
    pushNotification('success', `Đã chuyển "${c.ex.name}" sang "${den ? den.name : toZoneId}" (major ${data.major}, minor ${data.minor}).`);
    expandedZones.set(toZoneId, expandedZones.get(toZoneId) || { page: 1, q: '' });
    await refreshContentViews();
    await loadStaticContentStatus();
  } catch (err) {
    btn.disabled = false;
    if (!daBaoLoi(err)) pushNotification('error', 'Không thể kết nối tới server.');
  }
}

// ---------- Sắp xếp thứ tự ----------
// Kéo thả hoặc bấm ↑↓ thoải mái, chỉ ghi khi bấm "Lưu thứ tự": cả lần sắp xếp là MỘT mục
// nhật ký. Lưu từng bước thì vài lần kéo là đẩy hết 30 mục hoàn tác cũ ra ngoài.
var sapXepDangMo = null;   // { loai, zoneId, banDau: [id...] }

async function moSapXep(loai, zoneId) {
  let so;
  try { so = await taiSoBeacon(); } catch (err) { if (!daBaoLoi(err)) pushNotification('error', err.message); return; }
  let items;
  let tieuDe;
  if (loai === 'zone') {
    items = so.zones.map((z) => ({ id: z.id, ten: z.name, so: `major ${z.major}` }));
    tieuDe = 'Sắp xếp {nhom}';
  } else {
    const z = so.zones.find((x) => x.id === zoneId);
    if (!z) { pushNotification('error', 'Không tìm thấy {nhom}.'); return; }
    items = z.exhibits.map((e) => ({ id: e.id, ten: e.name, so: `minor ${e.minor}` }));
    tieuDe = `Sắp xếp {muc} — ${z.name}`;
  }
  if (items.length < 2) { pushNotification('error', 'Cần ít nhất 2 mục mới có gì để sắp xếp.'); return; }
  sapXepDangMo = { loai, zoneId, banDau: items.map((x) => x.id) };
  moTienIch(`
    <div class="modal-head"><h2 class="modal-title" style="font-size:20px;">${escapeHtml(tieuDe)}</h2></div>
    <div class="form-hint" style="margin-bottom:12px;">Máy tablet hiện ${loai === 'zone' ? '{nhom}' : '{muc}'} theo đúng thứ tự này.
      Kéo thả, hoặc bấm ↑ ↓, rồi bấm <strong>Lưu thứ tự</strong>. Số beacon không đổi.</div>
    <ol class="sx-list" id="sx-list">${items.map((x) => `
      <li class="sx-item" draggable="true" data-id="${escapeHtml(x.id)}">
        <span class="sx-tay" aria-hidden="true">⋮⋮</span>
        <span class="sx-stt"></span>
        <span class="sx-ten" title="${escapeHtml(x.ten)}">${escapeHtml(x.ten)}</span>
        <span class="sx-so mono">${escapeHtml(x.so)}</span>
        <button type="button" class="icon-action" data-act="sx-len" title="Lên">↑</button>
        <button type="button" class="icon-action" data-act="sx-xuong" title="Xuống">↓</button>
      </li>`).join('')}</ol>
    <div class="form-actions" style="margin-top:16px;">
      <button type="button" class="btn btn-primary" data-act="sx-luu">Lưu thứ tự</button>
      <button type="button" class="btn btn-outline" data-act="tien-ich-dong">Hủy</button>
    </div>`);
  const ol = document.getElementById('sx-list');
  let keo = null;
  ol.addEventListener('dragstart', (e) => {
    keo = e.target.closest('.sx-item');
    if (!keo) return;
    keo.classList.add('sx-dang-keo');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', keo.dataset.id);
  });
  ol.addEventListener('dragover', (e) => {
    if (!keo) return;
    e.preventDefault();
    const duoi = e.target.closest('.sx-item');
    if (!duoi || duoi === keo) return;
    const r = duoi.getBoundingClientRect();
    duoi.parentNode.insertBefore(keo, e.clientY < r.top + r.height / 2 ? duoi : duoi.nextSibling);
    danhSoSapXep();
  });
  ol.addEventListener('dragend', () => { if (keo) keo.classList.remove('sx-dang-keo'); keo = null; });
  danhSoSapXep();
}

function danhSoSapXep() {
  document.querySelectorAll('#sx-list .sx-item').forEach((li, i) => { li.querySelector('.sx-stt').textContent = `${i + 1}.`; });
}

function diChuyenSapXep(nut, buoc) {
  const li = nut.closest('.sx-item');
  if (!li) return;
  if (buoc < 0 && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
  if (buoc > 0 && li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
  danhSoSapXep();
  nut.focus();
}

async function luuSapXep(btn) {
  const s = sapXepDangMo;
  if (!s) return;
  const ids = [...document.querySelectorAll('#sx-list .sx-item')].map((li) => li.dataset.id);
  if (ids.join('|') === s.banDau.join('|')) { dongTienIch(); return; }
  btn.disabled = true;
  const url = s.loai === 'zone' ? `${CONTENT_API_BASE}/zones-order` : `${CONTENT_API_BASE}/zones/${s.zoneId}/exhibits-order`;
  try {
    const res = await authFetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { pushNotification('error', data.error || 'Không lưu được thứ tự.'); btn.disabled = false; return; }
    dongTienIch();
    sapXepDangMo = null;
    pushNotification('success', 'Đã lưu thứ tự mới.');
    await refreshContentViews();
    await loadStaticContentStatus();
  } catch (err) {
    btn.disabled = false;
    if (!daBaoLoi(err)) pushNotification('error', 'Không thể kết nối tới server.');
  }
}

// ---------- Ctrl+S / ⌘S: lưu biểu mẫu đang mở ----------
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || String(e.key).toLowerCase() !== 's') return;
  if (document.getElementById('confirm-modal-overlay').classList.contains('active')) return;
  if (exhibitModalOverlay.classList.contains('active')) {
    e.preventDefault();
    if (!exhibitSubmitBtn.disabled) exhibitForm.requestSubmit(exhibitSubmitBtn);
  } else if (zoneModalOverlay.classList.contains('active')) {
    e.preventDefault();
    if (!zoneForm2Submit.disabled) zoneForm2.requestSubmit(zoneForm2Submit);
  }
});

// ---------- Độ đầy đủ theo ngôn ngữ ----------
var doDayDu = null;

async function loadDoDayDu() {
  const hop = document.getElementById('do-day-du-noi-dung');
  if (!hop) return;
  hop.innerHTML = '<div style="color:var(--muted); padding:8px 4px;">Đang tải...</div>';
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/language-coverage`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { hop.innerHTML = `<span class="err">${escapeHtml(data.error || 'Không tải được.')}</span>`; return; }
    doDayDu = data;
    veDoDayDu();
  } catch (err) {
    if (!daBaoLoi(err)) hop.innerHTML = '<span class="err">Không thể kết nối tới server.</span>';
  }
}

function veDoDayDu() {
  const hop = document.getElementById('do-day-du-noi-dung');
  const d = doDayDu;
  if (!hop || !d) return;
  if (!d.languages.length) {
    hop.innerHTML = '<div class="empty-state">{DonVi} mới dùng một ngôn ngữ — không có gì để so.</div>';
    return;
  }
  const chiThieu = document.getElementById('do-day-du-chi-thieu').checked;
  // Bộ lọc ngôn ngữ: người dịch tiếng Anh chỉ cần thấy việc tiếng Anh của mình.
  const sel = document.getElementById('do-day-du-ngon-ngu');
  const daChon = sel.value;
  sel.innerHTML = '<option value="">Tất cả</option>' + d.languages
    .map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(langLabel(l))}</option>`).join('');
  sel.value = d.languages.includes(daChon) ? daChon : '';
  const L = sel.value ? [sel.value] : d.languages;
  const tongQuan = L.map((l) => {
    const t = d.tong[l];
    const pt = t.tong ? Math.round((100 * t.du) / t.tong) : 100;
    return `<div class="ddd-tong">
      <div><strong>${escapeHtml(langLabel(l))}</strong> <span class="mono" style="color:var(--muted);">${escapeHtml(l)}</span></div>
      <div class="ddd-thanh"><span style="width:${pt}%"></span></div>
      <div class="form-hint">Đủ chữ: <strong>${t.du}/${t.tong}</strong> (${pt}%) · Có audio: ${t.audio}/${t.tong}</div>
    </div>`;
  }).join('');
  const rows = d.rows.filter((r) => !chiThieu || L.some((l) => r.lang[l].thieu.length));
  const bang = rows.length
    ? `<div style="overflow-x:auto;"><table class="ddd-bang">
        <thead><tr><th>{Nhom} / {muc}</th>${L.map((l) => `<th>${escapeHtml(langLabel(l))}</th>`).join('')}<th></th></tr></thead>
        <tbody>${rows.map((r) => {
          // Nút Sửa mở thẳng phần ngôn ngữ đầu tiên còn thiếu và đặt con trỏ vào ô thiếu.
          const lThieu = L.find((l) => r.lang[l].thieu.length) || '';
          const truong = lThieu ? r.lang[lThieu].thieu[0] : '';
          return `<tr class="${r.loai === 'zone' ? 'ddd-zone' : ''}">
          <td>${r.loai === 'zone'
            ? `<strong>${escapeHtml(r.ten)}</strong> <span class="mono" style="color:var(--muted);">major=${r.major}</span>`
            : `<span style="padding-left:16px;">${escapeHtml(r.ten)}</span> <span class="mono" style="color:var(--muted);">minor=${r.minor}</span>`}</td>
          ${L.map((l) => {
            const c = r.lang[l];
            const audio = `<span class="ddd-audio" title="${c.audio ? 'Có audio' : 'Chưa có audio (máy tablet phát audio ngôn ngữ mặc định)'}">${c.audio ? '🔊' : '—'}</span>`;
            return c.thieu.length
              ? `<td class="ddd-thieu">Thiếu: ${escapeHtml(c.thieu.join(', '))} ${audio}</td>`
              : `<td class="ddd-du">✓ ${audio}</td>`;
          }).join('')}
          <td><button type="button" class="btn btn-outline btn-tiny" data-need-level="editor" hidden
            data-act="dich-sua" data-loai="${r.loai}" data-zone="${escapeHtml(r.zoneId)}"${r.exhibitId ? ` data-exhibit="${escapeHtml(r.exhibitId)}"` : ''}
            data-lang="${escapeHtml(lThieu)}" data-truong="${escapeHtml(truong)}">${lThieu ? 'Dịch' : 'Sửa'}</button></td>
        </tr>`;
        }).join('')}</tbody></table></div>`
    : '<div class="empty-state">Mọi {nhom} và {muc} đã đủ chữ ở tất cả ngôn ngữ.</div>';
  hop.innerHTML = `<div class="ddd-tong-wrap">${tongQuan}</div>${bang}
    <div class="form-hint" style="margin-top:8px;">Chỉ tính phần chữ. Cột 🔊 cho biết đã có audio ngôn ngữ đó chưa — chưa có thì máy tablet phát audio ngôn ngữ mặc định.</div>`;
  applyRoleVisibility();
}

document.getElementById('do-day-du-chi-thieu').addEventListener('change', veDoDayDu);
document.getElementById('do-day-du-ngon-ngu').addEventListener('change', veDoDayDu);

// ---------- Mô hình 3D không còn dùng (Kiểm tra toàn vẹn) ----------
async function xoaMoHinhMoCoi(id, btn) {
  const ok = await confirmDialog(`Xóa mô hình 3D "${id}"?\n\nKhông hoàn tác được. Nếu sau này dùng Nhật ký để hoàn tác về lúc một {muc} còn gắn mô hình này, {muc} đó sẽ báo lỗi thiếu mô hình.`,
    { title: 'Xóa mô hình 3D không còn dùng', confirmLabel: 'Xóa mô hình' });
  if (!ok) return;
  btn.disabled = true;
  try {
    const res = await authFetch(`/api/v1/admin/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { pushNotification('error', data.error || 'Không xóa được mô hình.'); btn.disabled = false; return; }
    pushNotification('success', `Đã xóa mô hình 3D "${id}".`);
    document.getElementById('integrity-check-btn').click();
  } catch (err) {
    btn.disabled = false;
    if (!daBaoLoi(err)) pushNotification('error', 'Không thể kết nối tới server.');
  }
}

// Nút cần CHÍNH phần tử được bấm (bộ điều phối ACTIONS chỉ truyền dataset).
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  switch (el.dataset.act) {
    case 'tien-ich-dong': dongTienIch(); break;
    case 'sx-len': diChuyenSapXep(el, -1); break;
    case 'sx-xuong': diChuyenSapXep(el, 1); break;
    case 'sx-luu': luuSapXep(el); break;
    case 'chuyen-luu': luuChuyenKhuVuc(el); break;
    case 'nhap-khoi-phuc': khoiPhucNhap(el.dataset.loai); break;
    case 'nhap-bo': boNhap(el.dataset.loai); break;
    default: break;
  }
});

// Gọi khi biểu mẫu đóng/đặt lại: thôi ghi nháp vào khóa cũ, xóa gợi ý số.
function datLaiNhap(loai) {
  if (!nhapKhoa) return;
  clearTimeout(nhapHen[loai]);
  nhapKhoa[loai] = null;
  anThongBaoForm(loai);
  const g = document.getElementById(loai === 'exhibit' ? 'content-exhibit-minor-goi-y' : 'content-zone-major-goi-y');
  if (g) { g.textContent = ''; g.className = 'form-hint so-goi-y'; }
}

/* ==================== VẬN HÀNH: sao lưu, ổ đĩa, máy tham quan, tạm giữ phát hành ====================
   CLAUDE.md §5.28. Dùng `var` cho trạng thái vì cùng lý do với khối tiện ích nhập
   liệu phía trên: switchView()/bootstrap() có thể gọi vào đây trước khi dòng này chạy. */
var VAN_HANH_API = '/api/v1/admin/van-hanh';
var vhPhatHanh = null;
var vhDangTai = false;

function thoiGianTuongDoi(iso) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return 'chưa có';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

function datTheOps(id, muc, main, sub, actionsHtml) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('ops-xanh', 'ops-vang', 'ops-do');
  if (muc) el.classList.add(`ops-${muc}`);
  el.querySelector('.ops-main').textContent = main;
  el.querySelector('.ops-sub').textContent = sub || '';
  const act = el.querySelector('.ops-actions');
  if (act) act.innerHTML = actionsHtml || '';
}

function nutPhatHanhHtml(ph) {
  return ph.dangGiu
    ? '<button type="button" class="btn btn-primary" data-act="ph-phat-hanh" data-need-level="editor" hidden>Phát hành ngay</button>'
    : '<button type="button" class="btn btn-outline" data-act="ph-tam-giu" data-need-level="editor" hidden>Tạm giữ phát hành</button>';
}

function veTrangThaiPhatHanh(ph) {
  vhPhatHanh = ph;
  let main, sub, muc;
  if (ph.dangGiu) {
    muc = 'vang';
    main = `Đang tạm giữ ở bản ${ph.banDangPhat}`;
    sub = `Từ ${formatBackupTime(ph.luc)}${ph.boi ? ` (${ph.boi})` : ''}. `
      + (ph.coThayDoiChoPhatHanh ? 'Có thay đổi trên CMS mà {thietBi} chưa nhận.' : 'Chưa có thay đổi nào mới.');
  } else {
    muc = 'xanh';
    main = 'Tự động — sửa xong là {thietBi} nhận';
    sub = ph.banTrenCms ? `Bản hiện tại: ${ph.banTrenCms}` : '';
  }
  datTheOps('ops-publish', muc, main, sub, nutPhatHanhHtml(ph));

  const box = document.getElementById('publish-hold-box');
  if (box) {
    box.classList.toggle('dang-giu', !!ph.dangGiu);
    box.innerHTML = ph.dangGiu
      ? `<div><strong>Đang tạm giữ phát hành.</strong> {ThietBi} vẫn nhận bản <span class="mono">${escapeHtml(ph.banDangPhat)}</span>
         ${ph.coThayDoiChoPhatHanh ? '; các thay đổi từ lúc đó sẽ chỉ tới máy khi bấm "Phát hành ngay".' : '.'}</div>${nutPhatHanhHtml(ph)}`
      : `<div>Phát hành tự động: mỗi lần lưu, {thietBi} nhận bản mới ở lần kiểm tra kế tiếp.
         Định sửa nhiều chỗ trong giờ mở cửa thì bấm <strong>Tạm giữ</strong> trước, sửa xong mới phát hành.</div>${nutPhatHanhHtml(ph)}`;
  }
  applyRoleVisibility();
}

function veBangMay(list) {
  const body = document.getElementById('devices-body');
  if (!body) return;
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="6"><div class="empty-state">Chưa máy nào gửi số liệu về. Máy sẽ hiện ở đây sau chuyến tham quan đầu tiên.</div></td></tr>';
    return;
  }
  const nhan = { xanh: 'Bình thường', vang: 'Im lặng hơn 1 ngày', do: 'Im lặng hơn 3 ngày' };
  body.innerHTML = list.map((m) => `
    <tr data-device-id="${escapeHtml(m.id)}">
      <td><span class="dev-dot ${m.trangThai}"></span>${nhan[m.trangThai] || ''}</td>
      <td class="dev-ten-cell">${m.ten ? escapeHtml(m.ten) : '<span class="dev-chua-ten">Chưa đặt tên</span>'}<span class="dev-ma">${escapeHtml(m.id.slice(0, 12))}</span></td>
      <td title="${escapeHtml(formatBackupTime(m.lanGuiCuoi))}">${escapeHtml(thoiGianTuongDoi(m.lanGuiCuoi))}</td>
      <td title="${escapeHtml(formatBackupTime(m.suKienCuoi))}">${escapeHtml(thoiGianTuongDoi(m.suKienCuoi))}</td>
      <td class="mono">${Number(m.soLanGui) || 0}</td>
      <td><div class="dev-nut">
        <button type="button" class="btn btn-outline" data-act="dev-dat-ten" data-id="${escapeHtml(m.id)}" data-need-level="editor" hidden>Đặt tên</button>
        <button type="button" class="btn btn-outline" data-act="dev-xoa" data-id="${escapeHtml(m.id)}" data-ten="${escapeHtml(m.ten || m.id.slice(0, 12))}" data-need-level="editor" hidden>Bỏ khỏi danh sách</button>
      </div></td>
    </tr>`).join('');
  applyRoleVisibility();
}

async function loadVanHanh() {
  if (vhDangTai) return;
  vhDangTai = true;
  try {
    const [r1, r2] = await Promise.all([authFetch(VAN_HANH_API), authFetch(`${VAN_HANH_API}/thiet-bi`)]);
    const d = await r1.json().catch(() => ({}));
    const t = await r2.json().catch(() => ({}));
    if (!r1.ok) {
      datTheOps('ops-backup', 'vang', d.error || 'Không tải được tình trạng', '');
      return;
    }
    const sl = d.saoLuu;
    datTheOps('ops-backup', sl.muc, sl.tomTat,
      [sl.lanThanhCongCuoi ? `Bản gần nhất: ${thoiGianTuongDoi(sl.lanThanhCongCuoi)}${sl.bytes ? ` (${formatBytes(sl.bytes)})` : ''}.` : '', sl.chiTiet]
        .filter(Boolean).join(' '));

    const od = d.oDia;
    datTheOps('ops-disk', od.muc, od.trong != null ? `Còn trống ${formatBytes(od.trong)}` : od.tomTat,
      od.tong ? `${od.tomTat} · tổng ${formatBytes(od.tong)} (${Math.round((od.trong / od.tong) * 100)}% trống)` : '');

    const tb = d.thietBi;
    const mucMay = tb.do ? 'do' : tb.vang ? 'vang' : tb.tong ? 'xanh' : null;
    datTheOps('ops-devices', mucMay,
      tb.tong ? (tb.do || tb.vang ? `${tb.do + tb.vang}/${tb.tong} máy đang im lặng` : `Cả ${tb.tong} máy hoạt động`) : 'Chưa có máy nào',
      tb.tong ? `${tb.xanh} bình thường · ${tb.vang} quá 1 ngày · ${tb.do} quá 3 ngày` : 'Máy hiện ra sau chuyến tham quan đầu tiên.');

    veTrangThaiPhatHanh(d.phatHanh);
    if (r2.ok) veBangMay(t.thietBi || []);
  } catch (err) {
    if (!daBaoLoi(err)) datTheOps('ops-backup', 'vang', 'Không thể kết nối tới server', '');
  } finally {
    vhDangTai = false;
  }
}

async function tamGiuPhatHanh() {
  if (!(await confirmDialog(
    '{ThietBi} sẽ giữ nguyên bản nội dung đang có. Bạn cứ sửa bình thường; khi xong, bấm "Phát hành ngay" để máy nhận bản mới.',
    { title: 'Tạm giữ phát hành', confirmLabel: 'Tạm giữ' }))) return;
  try {
    const res = await authFetch(`${VAN_HANH_API}/phat-hanh/tam-giu`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { pushNotification('error', data.error || 'Không tạm giữ được'); return; }
    veTrangThaiPhatHanh(data);
    pushNotification('success', `Đang tạm giữ phát hành ở bản ${data.banDangPhat}`);
  } catch (err) {
    if (!daBaoLoi(err)) pushNotification('error', 'Không thể kết nối tới server');
  }
}

async function phatHanhNgay() {
  if (!(await confirmDialog(
    '{ThietBi} sẽ nhận bản nội dung hiện tại trên CMS ở lần kiểm tra kế tiếp.',
    { title: 'Phát hành ngay', confirmLabel: 'Phát hành' }))) return;
  try {
    const res = await authFetch(`${VAN_HANH_API}/phat-hanh/phat-hanh`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { pushNotification('error', data.error || 'Không phát hành được'); return; }
    veTrangThaiPhatHanh(data);
    if (Array.isArray(data.problems) && data.problems.length) {
      // Bỏ giữ rồi, nhưng nội dung đang lỗi nên /version.json trả 503 — máy vẫn giữ bản cũ.
      pushNotification('error', `Đã bỏ tạm giữ, nhưng nội dung đang có ${data.problems.length} lỗi nên {thietBi} chưa nhận được. Vào "Kiểm tra tính toàn vẹn dữ liệu" để xem`);
    } else {
      pushNotification('success', `Đã phát hành bản ${data.banTrenCms || ''}`.trim());
    }
  } catch (err) {
    if (!daBaoLoi(err)) pushNotification('error', 'Không thể kết nối tới server');
  }
}

// Sửa tên ngay trong ô của bảng: Enter lưu, Esc hủy.
function suaTenMay(id) {
  const row = [...document.querySelectorAll('#devices-body tr[data-device-id]')].find((r) => r.dataset.deviceId === id);
  if (!row) return;
  const cell = row.querySelector('.dev-ten-cell');
  if (cell.querySelector('input')) return;
  const cu = cell.firstChild && cell.firstChild.nodeType === Node.TEXT_NODE ? cell.firstChild.textContent : '';
  const goc = cell.innerHTML;
  cell.innerHTML = '';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 60;
  input.value = cu;
  input.placeholder = 'vd: Máy số 3 – tầng 2';
  input.className = 'form-control';
  input.setAttribute('aria-label', 'Tên {thietBi}');
  cell.appendChild(input);
  input.focus();
  let xong = false;
  const luu = async () => {
    if (xong) return;
    xong = true;
    try {
      const res = await authFetch(`${VAN_HANH_API}/thiet-bi/${encodeURIComponent(id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ten: input.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { pushNotification('error', data.error || 'Không lưu được tên máy'); cell.innerHTML = goc; return; }
      pushNotification('success', 'Đã lưu tên máy');
      loadVanHanh();
    } catch (err) {
      cell.innerHTML = goc;
      if (!daBaoLoi(err)) pushNotification('error', 'Không thể kết nối tới server');
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); luu(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); xong = true; cell.innerHTML = goc; }
  });
  input.addEventListener('blur', () => { if (!xong) luu(); });
}

async function xoaMay(id, ten) {
  if (!(await confirmDialog(
    `Bỏ "${ten}" khỏi danh sách? Dùng khi máy đã thanh lý hoặc cài lại ứng dụng. Nếu máy này gửi số liệu về lần nữa, nó sẽ hiện lại như một máy mới chưa có tên.`,
    { title: 'Bỏ máy khỏi danh sách', confirmLabel: 'Bỏ khỏi danh sách' }))) return;
  try {
    const res = await authFetch(`${VAN_HANH_API}/thiet-bi/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { pushNotification('error', data.error || 'Không bỏ được máy'); return; }
    pushNotification('success', 'Đã bỏ máy khỏi danh sách');
    loadVanHanh();
  } catch (err) {
    if (!daBaoLoi(err)) pushNotification('error', 'Không thể kết nối tới server');
  }
}

// Trang chủ là màn hình mở đầu: tải tình trạng ngay, không đợi người dùng bấm tab.
loadVanHanh();

/* =====================================================================
 * ĐỊNH DẠNG CHỮ + XEM TRƯỚC TRÊN MÁY + VIỆC DỊCH (2026-11-05)
 *
 * Định dạng chữ là markdown RÚT GỌN, chỉ dùng cho tóm tắt + ý nghĩa của hiện vật:
 *   **đậm**   *nghiêng*   dòng bắt đầu "- " = gạch đầu dòng   dòng trống = sang đoạn
 * ⚠ HỢP ĐỒNG VỚI APP: quy tắc phải khớp từng chữ với
 *   beacon-client/lib/presentation/widgets/rich_body_text.dart
 * Sửa một bên mà quên bên kia thì xem trước trên CMS nói dối. Nội dung cũ không có
 * dấu * nên hiển thị y nguyên ở cả app cũ lẫn app mới; app CŨ gặp nội dung mới thì
 * hiện nguyên dấu ** (xấu nhưng không hỏng).
 * ===================================================================== */

// Dấu * phải ôm sát chữ (không có khoảng trắng ngay bên trong) — để "5 * 3 * 2" không
// thành chữ nghiêng. Cùng một biểu thức với RichBodyText._inline bên app.
const MD_INLINE_RE = /\*\*([^\s*](?:[^*\n]*?[^\s*])?)\*\*|\*([^\s*](?:[^*\n]*?[^\s*])?)\*/g;
const MD_LIST_RE = /^\s*[-•]\s+/;

function dinhDangDong(dong) {
  return escapeHtml(dong).replace(MD_INLINE_RE, (m, dam, nghieng) =>
    dam !== undefined ? `<strong>${dam}</strong>` : `<em>${nghieng}</em>`);
}

// Văn bản → HTML. Đoạn tách ở dòng trống; trong một đoạn, các dòng "- " liền nhau
// gom thành một danh sách, dòng thường xuống dòng bằng <br>.
function vanBanDinhDangHtml(text) {
  return String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => {
    let html = ''; let ds = []; let chu = [];
    const xa = () => {
      if (chu.length) { html += `<p>${chu.join('<br>')}</p>`; chu = []; }
      if (ds.length) { html += `<ul>${ds.map((d) => `<li>${d}</li>`).join('')}</ul>`; ds = []; }
    };
    for (const dong of p.split('\n')) {
      if (MD_LIST_RE.test(dong)) { if (chu.length) xa(); ds.push(dinhDangDong(dong.replace(MD_LIST_RE, ''))); }
      else { if (ds.length) xa(); chu.push(dinhDangDong(dong.trim())); }
    }
    xa();
    return html;
  }).join('');
}

/* ---------- Thanh công cụ định dạng trên các ô tóm tắt / ý nghĩa ---------- */
const O_DINH_DANG_RE = /^content-exhibit-(summary|meaning)(_[A-Za-z0-9-]+)?$/;

function ganThanhDinhDang() {
  document.querySelectorAll('#content-exhibit-form textarea').forEach((ta) => {
    if (!O_DINH_DANG_RE.test(ta.id)) return;
    if (ta.previousElementSibling?.classList.contains('md-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'md-bar';
    bar.dataset.for = ta.id;
    bar.innerHTML = `
      <button type="button" data-md="b" title="In đậm (Ctrl+B)"><strong>B</strong></button>
      <button type="button" data-md="i" title="In nghiêng (Ctrl+I)"><em>I</em></button>
      <button type="button" data-md="ul" title="Gạch đầu dòng cho các dòng đang chọn">• Danh sách</button>
      <span class="md-hint">Bỏ trống một dòng để sang đoạn mới</span>`;
    ta.before(bar);
  });
}

function apDinhDang(ta, kieu) {
  const a = ta.selectionStart; const b = ta.selectionEnd; const v = ta.value;
  if (kieu === 'ul') {
    // Áp cho trọn các dòng chạm vào vùng chọn. Mọi dòng đã có "- " thì bỏ (bật/tắt).
    const dau = v.lastIndexOf('\n', a - 1) + 1;
    let cuoi = v.indexOf('\n', b > a && v[b - 1] === '\n' ? b - 1 : b);
    if (cuoi < 0) cuoi = v.length;
    const dong = v.slice(dau, cuoi).split('\n');
    const daCo = dong.every((d) => MD_LIST_RE.test(d) || !d.trim());
    const moi = dong.map((d) => (!d.trim() ? d : daCo ? d.replace(MD_LIST_RE, '') : (MD_LIST_RE.test(d) ? d : `- ${d}`))).join('\n');
    ta.setRangeText(moi, dau, cuoi, 'select');
  } else {
    const m = kieu === 'b' ? '**' : '*';
    const chon = v.slice(a, b);
    if (!chon.trim()) {
      ta.setRangeText(`${m}chữ${m}`, a, b, 'end');
      ta.setSelectionRange(a + m.length, a + m.length + 3);
    } else if (chon.length > 2 * m.length && chon.startsWith(m) && chon.endsWith(m)) {
      ta.setRangeText(chon.slice(m.length, -m.length), a, b, 'select');   // bỏ định dạng
    } else {
      // Đẩy khoảng trắng ra ngoài dấu *, nếu không quy tắc "ôm sát chữ" sẽ không nhận.
      const t = chon.trim(); const l = chon.indexOf(t);
      ta.setRangeText(chon.slice(0, l) + m + t + m + chon.slice(l + t.length), a, b, 'select');
    }
  }
  ta.focus();
  // Báo như người dùng gõ: bật cờ "form đã sửa" và lưu nháp (§5.25, §5.27).
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

document.addEventListener('mousedown', (e) => {
  // Giữ vùng chọn trong ô chữ khi bấm nút trên thanh công cụ.
  if (e.target.closest('.md-bar button')) e.preventDefault();
});
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-md]');
  if (!btn) return;
  const ta = document.getElementById(btn.closest('.md-bar').dataset.for);
  if (ta && !ta.readOnly && !ta.disabled) apDinhDang(ta, btn.dataset.md);
});
document.addEventListener('keydown', (e) => {
  const ta = e.target;
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
  if (!ta || ta.tagName !== 'TEXTAREA' || !O_DINH_DANG_RE.test(ta.id)) return;
  const k = e.key.toLowerCase();
  if (k === 'b' || k === 'i') { e.preventDefault(); apDinhDang(ta, k); }
});

/* ---------- Xem trước hiện vật như trên máy tablet ---------- */
const xtOverlay = document.getElementById('xt-overlay');
let xtNgonNgu = null;

function giaTriO(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function chuoiGiaoDien(lang, khoa, macDinh) {
  const { fallbackLanguage: fb } = getLangs();
  const ui = contentManifest?.ui || {};
  return ui[lang]?.[khoa] || ui[fb]?.[khoa] || macDinh;
}

function veXemTruoc() {
  const { languages, fallbackLanguage: fb } = getLangs();
  const lang = languages.includes(xtNgonNgu) ? xtNgonNgu : fb;
  const suf = lang === fb ? '' : `_${lang}`;
  let soLui = 0;
  // Một trường: có ở ngôn ngữ đang xem thì dùng; không có thì app lùi về ngôn ngữ mặc định.
  const truong = (ten) => {
    const v = giaTriO(`content-exhibit-${ten}${suf}`);
    if (v || lang === fb) return { v, lui: false };
    const f = giaTriO(`content-exhibit-${ten}`);
    if (f) soLui += 1;
    return { v: f, lui: Boolean(f) };
  };
  const nhanLui = `<span class="xt-lui-tag">Chưa dịch — máy hiện bản ${escapeHtml(langLabel(fb))}</span>`;
  const khoiChu = (t) => `${t.lui ? nhanLui : ''}<div class="xt-text${t.lui ? ' xt-lui' : ''}">${vanBanDinhDangHtml(t.v)}</div>`;

  const ten = truong('name'); const tomTat = truong('summary'); const yNghia = truong('meaning');
  const img = document.getElementById('content-exhibit-image-preview');
  const anh = img && img.getAttribute('src') && img.style.display !== 'none' ? img.src : '';

  const sinhRa = dongTruongXemTruoc(lang);
  soLui += sinhRa.filter((d) => d.lui).length;
  const specs = [...sinhRa, ...(pendingSpecs || []).map((s) => {
    const o = s[lang]?.label?.trim() ? s[lang] : s[fb];
    const lui = o !== s[lang];
    if (lui && o?.label) soLui += 1;
    return o?.label ? { ...o, lui } : null;
  }).filter(Boolean)];

  document.getElementById('xt-langs').innerHTML = languages.map((l) =>
    `<button type="button" class="xt-lang${l === lang ? ' active' : ''}" data-xt-lang="${escapeHtml(l)}">${escapeHtml(langLabel(l))}</button>`).join('');

  document.getElementById('xt-screen').innerHTML = `
    <div class="xt-hero">${anh ? `<img src="${escapeHtml(anh)}" alt="">` : '<div class="xt-no-img">Chưa có ảnh {muc}</div>'}</div>
    <div class="xt-body">
      ${ten.lui ? nhanLui : ''}
      <h3 class="xt-name${ten.lui ? ' xt-lui' : ''}">${escapeHtml(ten.v) || '<span class="xt-thieu">Chưa có tên</span>'}</h3>
      <div class="xt-kicker">${escapeHtml(chuoiGiaoDien(lang, 'exhibit.section.intro', 'Giới thiệu').toUpperCase())}</div>
      ${tomTat.v ? khoiChu(tomTat) : '<div class="xt-thieu">Chưa có tóm tắt — ngôn ngữ mặc định bắt buộc phải có, không lưu được.</div>'}
      ${yNghia.v ? `<div class="xt-kicker">${escapeHtml(chuoiGiaoDien(lang, 'exhibit.section.meaning', 'Ý nghĩa').toUpperCase())}</div>${khoiChu(yNghia)}` : ''}
      ${specs.length ? `<table class="xt-specs">${specs.map((s) =>
        `<tr${s.lui ? ' class="xt-lui"' : ''}><th>${escapeHtml(s.label)}</th><td>${escapeHtml(s.value || '')}</td></tr>`).join('')}</table>` : ''}
    </div>`;

  document.getElementById('xt-note').innerHTML = lang === fb
    ? `Đang xem ngôn ngữ mặc định (${escapeHtml(langLabel(fb))}).`
    : soLui
      ? `<strong>${soLui}</strong> phần chưa dịch sang ${escapeHtml(langLabel(lang))} — khách chọn ngôn ngữ này sẽ đọc bản ${escapeHtml(langLabel(fb))} ở những chỗ viền đứt.`
      : `Đã dịch đủ phần chữ sang ${escapeHtml(langLabel(lang))}.`;
}

function moXemTruoc() {
  xtNgonNgu = xtNgonNgu || getLangs().fallbackLanguage;
  veXemTruoc();
  xtOverlay.classList.add('active');
}
function dongXemTruoc() { xtOverlay.classList.remove('active'); }

document.getElementById('content-exhibit-preview-btn').addEventListener('click', moXemTruoc);
document.getElementById('xt-close').addEventListener('click', dongXemTruoc);
xtOverlay.addEventListener('click', (e) => {
  const nut = e.target.closest('[data-xt-lang]');
  if (nut) { xtNgonNgu = nut.dataset.xtLang; veXemTruoc(); return; }
  if (e.target === xtOverlay) dongXemTruoc();
});
// Pha CAPTURE trên window: Esc chỉ đóng khung xem trước, không lan xuống bộ bắt Esc
// của biểu mẫu hiện vật nằm bên dưới (sẽ hỏi "thoát mà không lưu?").
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && xtOverlay.classList.contains('active')) {
    e.stopImmediatePropagation(); e.preventDefault(); dongXemTruoc();
  }
}, true);

/* ---------- Việc dịch: nhảy thẳng tới ô còn thiếu ---------- */
const O_THIEU = {
  zone: { 'tên': 'content-zone-name', 'giới thiệu': 'content-zone-welcome' },
  exhibit: { 'tên': 'content-exhibit-name', 'tóm tắt': 'content-exhibit-summary', 'ý nghĩa': 'content-exhibit-meaning' },
};

async function moSuaDeDich(d) {
  if (d.loai === 'zone') await startEditContentZone(d.zone);
  else await startEditExhibit(d.zone, d.exhibit);
  if (!d.lang) return;
  const hop = document.getElementById(d.loai === 'zone' ? 'content-zone-other-langs' : 'content-exhibit-other-langs');
  const phan = hop && hop.querySelector(`details[data-lang="${CSS.escape(d.lang)}"]`);
  if (phan) phan.open = true;
  let o = null;
  const tienTo = O_THIEU[d.loai]?.[d.truong];
  if (tienTo) o = document.getElementById(`${tienTo}_${d.lang}`);
  else if (d.truong.startsWith('thông số')) {
    o = [...document.querySelectorAll(`#content-exhibit-specs-list .spec-input[data-lang="${CSS.escape(d.lang)}"]`)]
      .find((el) => !el.value.trim()) || null;
  }
  const dich = o || phan;
  if (!dich) return;
  // Đợi modal hiện xong rồi mới cuộn, nếu không trình duyệt cuộn trang nền.
  setTimeout(() => {
    dich.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (o) { o.focus({ preventScroll: true }); o.classList.add('o-can-dich'); setTimeout(() => o.classList.remove('o-can-dich'), 2500); }
  }, 80);
}

function moBangViecDich(lang) {
  switchView('ui-strings');
  const sel = document.getElementById('do-day-du-ngon-ngu');
  // veDoDayDu() vẽ lại danh sách lựa chọn nhưng giữ giá trị đang chọn nếu còn hợp lệ.
  sel.innerHTML = `<option value="${escapeHtml(lang || '')}"></option>`;
  sel.value = lang || '';
  setTimeout(() => document.getElementById('do-day-du-panel')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150);
}

async function veViecDichTrangChu() {
  const the = document.getElementById('viec-dich-card');
  const hop = document.getElementById('viec-dich-noi-dung');
  if (!the || !hop) return;
  try {
    const res = await authFetch(`${CONTENT_API_BASE}/language-coverage`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.languages?.length) { the.hidden = true; return; }
    the.hidden = false;
    hop.innerHTML = `<div class="viec-dich-list">${d.languages.map((l) => {
      const thieu = d.rows.filter((r) => r.lang[l].thieu.length);
      const truong = thieu.reduce((n, r) => n + r.lang[l].thieu.length, 0);
      const pt = d.tong[l].tong ? Math.round((100 * d.tong[l].du) / d.tong[l].tong) : 100;
      return `<div class="viec-dich-row">
        <div class="lang-name">${escapeHtml(langLabel(l))}</div>
        <div class="lang-bar-track"><div class="lang-bar-fill" style="width:${pt}%"></div></div>
        <div class="viec-dich-so">${thieu.length
          ? `<strong>${thieu.length}</strong> mục · ${truong} ô chưa dịch`
          : '<span style="color:var(--green2);">✓ Đã dịch đủ</span>'}</div>
        ${thieu.length ? `<button type="button" class="btn btn-outline btn-tiny" data-act="viec-dich-xem" data-lang="${escapeHtml(l)}">Xem danh sách</button>` : '<span></span>'}
      </div>`;
    }).join('')}</div>`;
  } catch (err) {
    if (!daBaoLoi(err)) the.hidden = true;
  }
}

veViecDichTrangChu();


/* =====================================================================
   TRẠNG THÁI (exhibit.listing.status) + TRƯỜNG THÔNG TIN TỰ ĐỊNH NGHĨA (exhibit.fields)
   Danh sách trạng thái + bộ trường lấy từ CMS.settings (thuatNgu.js ← cmsSettings.js).
   Trường bật "hiện cho khách" được MÁY CHỦ sinh thành N dòng đầu của exhibit.specs
   (exhibit.fieldSpecs = id các dòng đó) — biểu mẫu chỉ sửa phần thông số tự gõ phía sau.
   Xem customFields.js và CLAUDE.md §5.33.
   ===================================================================== */
function cmsCfg() { return (window.CMS && CMS.settings) || { statuses: [], fields: [] }; }
function truongCfg() { return Array.isArray(cmsCfg().fields) ? cmsCfg().fields : []; }

function trangThaiBadgeHtml(id) {
  if (!id) return '';
  const st = window.CMS && CMS.statusById(id);
  const label = st ? st.label : id;
  const color = st ? st.color : 'gray';
  return `<span class="status-badge status-${escapeHtml(color)}">${escapeHtml(label)}</span>`;
}

// Một giá trị trường → chữ ngắn để hiện trong CMS (ngôn ngữ mặc định).
function giaTriTruongChu(f, v) {
  if (v === undefined || v === null || v === '') return '';
  if (f.type === 'number') return `${CMS.soVN(v)}${f.unit ? ` ${f.unit}` : ''}`;
  if (f.type === 'year') return String(v);
  if (f.type === 'text') return typeof v === 'object' ? (v[getLangs().fallbackLanguage] || Object.values(v)[0] || '') : String(v);
  return String(v);
}

// Huy hiệu trạng thái + các trường bật "hiện trong danh sách".
function listingTomTatHtml(l, vals) {
  const phan = [];
  for (const f of truongCfg()) {
    if (!f.inList || !vals) continue;
    const t = giaTriTruongChu(f, vals[f.id]);
    if (t) phan.push(`<span title="${escapeHtml(f.label)}">${escapeHtml(t)}</span>`);
  }
  return trangThaiBadgeHtml(l?.status)
    + (phan.length ? ` <span class="listing-meta">${phan.join(' · ')}</span>` : '');
}

function boLocTrangThaiHtml(zoneId, chon) {
  const ds = cmsCfg().statuses || [];
  if (!ds.length) return '';
  const opt = (v, t) => `<option value="${escapeHtml(v)}"${v === (chon || '') ? ' selected' : ''}>${escapeHtml(t)}</option>`;
  return `<div class="status-filter">
    <label>Lọc theo trạng thái
      <select class="form-control" data-loc-trang-thai="${escapeHtml(zoneId)}">
        ${opt('', 'Tất cả')}${ds.map((s) => opt(s.id, s.label)).join('')}${opt('__none', 'Chưa đặt trạng thái')}
      </select>
    </label>
  </div>`;
}

document.addEventListener('change', (ev) => {
  const sel = ev.target.closest && ev.target.closest('[data-loc-trang-thai]');
  if (!sel) return;
  const zoneId = sel.dataset.locTrangThai;
  const state = expandedZones.get(zoneId) || { page: 1, q: '' };
  state.status = sel.value;
  expandedZones.set(zoneId, state);
  loadExhibitsPage(zoneId, 1);
});

// Đổ danh sách trạng thái + đơn vị vào biểu mẫu. Gọi lại khi cài đặt đổi.
function napOTrangThai(giuGiaTri) {
  const sel = document.getElementById('content-exhibit-status');
  if (!sel) return;
  const c = cmsCfg();
  const cu = giuGiaTri !== undefined ? giuGiaTri : sel.value;
  sel.innerHTML = '<option value="">— Chưa đặt —</option>'
    + (c.statuses || []).map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)}</option>`).join('');
  // Trạng thái cũ đã bị xóa khỏi danh sách: vẫn hiện để không âm thầm mất khi lưu.
  if (cu && !(c.statuses || []).some((s) => s.id === cu)) {
    sel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(cu)}">${escapeHtml(cu)} (đã bỏ khỏi danh sách)</option>`);
  }
  sel.value = cu || '';
}
napOTrangThai('');
document.addEventListener('cms-settings', () => napOTrangThai());

function dienListing(l) {
  napOTrangThai(l?.status || '');
}

// "2.500.000.000" / "2 500 000 000" / "2,500,000" → 2500000000 (dấu phân nhóm nghìn);
// "75,5" / "75.5" / "1,5" → số thập phân. Bản cũ bỏ HẾT dấu chấm/phẩy nên "1.5" thành 15.
function chuanHoaSo(raw) {
  const v = String(raw || '').trim().replace(/\s/g, '');
  if (!v) return '';
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(v) && !/^-?\d{1,3}[.,]\d{3}$/.test(v)) return v.replace(/[.,]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(v)) return v.replace(/\./g, '').replace(',', '.'); // 1.234,5
  if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(v)) return v.replace(/,/g, '');                  // 1,234.5
  return v.replace(',', '.');
}

// Giá trị đang có (đọc cả dữ liệu kiểu cũ listing.price/area — §5.31).
function giaTriTruong(ex, id) {
  const v = ex?.fields?.[id];
  if (v !== undefined) return v;
  if ((id === 'price' || id === 'area') && ex?.listing?.[id] != null) return ex.listing[id];
  return undefined;
}

const idTruong = (id, lang) => `content-exhibit-field-${id}${lang ? `_${lang}` : ''}`;

// Vẽ khối "Thông tin chi tiết" trong biểu mẫu theo bộ trường đã cài. ex = null khi thêm mới.
function veTruongForm(ex) {
  const box = document.getElementById('content-exhibit-fields');
  if (!box) return;
  const ds = truongCfg();
  box.hidden = !ds.length;
  if (!ds.length) { box.innerHTML = ''; return; }
  const { fallbackLanguage, otherLanguages } = getLangs();
  const nhanKhach = '<span class="truong-tag" title="Hiện trong bảng Thông số trên máy của {khach}">hiện cho {khach}</span>';
  box.innerHTML = `
    <div class="truong-head">
      <span class="truong-title">Thông tin chi tiết</span>
      <span class="form-hint">Bộ trường do tài khoản Chủ đặt ở trang Quản lý tài khoản.</span>
    </div>
    <div class="truong-grid">${ds.map((f) => {
      const v = giaTriTruong(ex, f.id);
      const id = idTruong(f.id);
      const nhan = `<div class="truong-nhan"><label for="${id}">${escapeHtml(f.label)}${f.type === 'number' && f.unit ? ` <span class="truong-unit">(${escapeHtml(f.unit)})</span>` : ''}</label>${f.onDevice ? nhanKhach : ''}</div>`;
      let o = '';
      if (f.type === 'select') {
        const opts = [...f.options];
        if (v && !opts.includes(v)) opts.push(v); // lựa chọn cũ đã bị bỏ: vẫn giữ được
        o = `<select class="form-control" id="${id}" data-truong="${escapeHtml(f.id)}">
          <option value="">— Chưa chọn —</option>
          ${opts.map((x) => `<option value="${escapeHtml(x)}"${x === v ? ' selected' : ''}>${escapeHtml(x)}${f.options.includes(x) ? '' : ' (đã bỏ khỏi danh sách)'}</option>`).join('')}
        </select>`;
      } else if (f.type === 'text') {
        const obj = v && typeof v === 'object' ? v : (v ? { [fallbackLanguage]: String(v) } : {});
        o = `<input class="form-control" type="text" maxlength="500" id="${id}" data-truong="${escapeHtml(f.id)}" data-lang="${escapeHtml(fallbackLanguage)}" value="${escapeHtml(obj[fallbackLanguage] || '')}">`;
        if (otherLanguages.length) {
          const coDich = otherLanguages.some((l) => obj[l]);
          o += `<details class="truong-dich"${coDich ? ' open' : ''}><summary>Bản dịch</summary>
            ${otherLanguages.map((l) => `<div class="truong-dich-row"><span class="mono">${escapeHtml(l)}</span>
              <input class="form-control" type="text" maxlength="500" id="${idTruong(f.id, l)}" data-truong="${escapeHtml(f.id)}" data-lang="${escapeHtml(l)}"
                     value="${escapeHtml(obj[l] || '')}" aria-label="${escapeHtml(f.label)} (${escapeHtml(langLabel(l))})"></div>`).join('')}
          </details>`;
        }
      } else {
        const ph = f.type === 'year' ? 'VD: 1945' : 'VD: 2 500 000';
        o = `<input class="form-control" type="text" inputmode="${f.type === 'year' ? 'numeric' : 'decimal'}" id="${id}" data-truong="${escapeHtml(f.id)}"
               placeholder="${ph}" value="${v === undefined || v === null ? '' : escapeHtml(String(v))}">`;
      }
      return `<div class="form-group truong-o">${nhan}${o}</div>`;
    }).join('')}</div>`;
}

// Đọc khối trường → { id: giá trị } để gửi lên (body.fields). Trường rỗng gửi '' = xóa.
function docTruongForm() {
  const out = {};
  for (const f of truongCfg()) {
    if (f.type === 'text') {
      const obj = {};
      document.querySelectorAll(`#content-exhibit-fields [data-truong="${CSS.escape(f.id)}"]`).forEach((el) => {
        if (el.value.trim()) obj[el.dataset.lang] = el.value.trim();
      });
      out[f.id] = Object.keys(obj).length ? obj : '';
    } else {
      const el = document.getElementById(idTruong(f.id));
      if (!el) continue;
      out[f.id] = f.type === 'select' ? el.value : chuanHoaSo(el.value);
    }
  }
  return out;
}

// Các dòng "Thông số" sẽ sinh từ trường (để xem trước trên máy) — cùng quy tắc với
// customFields.dongSpec phía máy chủ.
function dongTruongXemTruoc(lang) {
  const { fallbackLanguage } = getLangs();
  const vals = docTruongForm();
  const out = [];
  for (const f of truongCfg()) {
    if (!f.onDevice) continue;
    const v = vals[f.id];
    if (v === '' || v === undefined) continue;
    const nhanDich = lang !== fallbackLanguage ? f.labelI18n?.[lang] : '';
    let gt = ''; let luiGt = false;
    if (f.type === 'number' || f.type === 'year') {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      let so = String(n);
      if (f.type === 'number') { try { so = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(n); } catch { /* giữ nguyên */ } }
      gt = f.unit ? `${so} ${f.unit}` : so;
    } else if (f.type === 'select') {
      gt = v; luiGt = lang !== fallbackLanguage;
    } else {
      if (!v[fallbackLanguage]) continue;
      gt = v[lang] || v[fallbackLanguage]; luiGt = !v[lang];
    }
    out.push({ label: nhanDich || f.label, value: gt, lui: (lang !== fallbackLanguage && !nhanDich) || luiGt });
  }
  return out;
}

function themListingVaoForm(fd) {
  fd.append('listing_status', document.getElementById('content-exhibit-status').value);
  // Chưa cài trường nào: KHÔNG gửi fields (máy chủ hiểu là giữ nguyên dữ liệu cũ).
  if (truongCfg().length) fd.append('fields', JSON.stringify(docTruongForm()));
}

// exhibit.specs → dạng hàng của bảng thông số tự gõ, BỎ N dòng đầu do trường sinh ra.
function specsTuGoThanhHang(ex) {
  const n = Array.isArray(ex?.fieldSpecs) ? ex.fieldSpecs.length : 0;
  return (ex?.specs || []).slice(n).map((s) => {
    const row = {};
    Object.keys(s.label || {}).forEach((lang) => { row[lang] = row[lang] || {}; row[lang].label = s.label[lang]; });
    Object.keys(s.value || {}).forEach((lang) => { row[lang] = row[lang] || {}; row[lang].value = s.value[lang]; });
    return row;
  });
}

document.addEventListener('cms-settings', () => {
  // Bộ trường vừa đổi khi biểu mẫu đang mở: vẽ lại, giữ giá trị đang gõ.
  const box = document.getElementById('content-exhibit-fields');
  if (box && !box.closest('[hidden]')) {
    const vals = docTruongForm();
    veTruongForm({ fields: vals });
  }
});


/* Liên kết trong dải "hành trình" ở Trang chủ: chuyển tab bằng đúng nút trên thanh bên,
   để mọi việc nút đó làm khi mở tab (tải dữ liệu, đổi tiêu đề) vẫn chạy. */
document.addEventListener('click', (ev) => {
  const link = ev.target.closest && ev.target.closest('[data-di-toi]');
  if (!link) return;
  const nav = document.querySelector(`.nav-item[data-view="${CSS.escape(link.dataset.diToi)}"]`);
  if (nav) nav.click();
});
