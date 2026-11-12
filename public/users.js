// Trang Quản lý tài khoản (chỉ vai trò Chủ). Tách khỏi admin.js vì đây là việc vài
// tháng một lần — lỗi ở đây không được làm hỏng trang nhập liệu hằng ngày.
//
// LƯU Ý: việc ẩn/hiện ở đây chỉ để dễ dùng. Ranh giới bảo mật thật nằm ở máy chủ
// (requireLevel(LEVEL.owner) trong routes/adminUsers.js).
const API = '/api/v1/admin/users';
const TOKEN_KEY = 'beacon_admin_token';

const ROLE_DESC = {
  owner: { label: 'Chủ', desc: 'Làm được mọi thứ, kể cả tạo và khóa tài khoản người khác.', no: '' },
  editor: {
    label: 'Biên tập', common: true,
    desc: 'Thêm, sửa, xóa {muc} và {nhom}. Đóng gói dữ liệu. Xem thống kê.',
    no: 'Không nhập được gói ZIP đè cả kho, không xóa được bản sao lưu.',
  },
  viewer: { label: 'Chỉ xem', desc: 'Xem nội dung và thống kê.', no: 'Không sửa được gì cả.' },
};

const $ = (sel) => document.querySelector(sel);
const token = () => sessionStorage.getItem(TOKEN_KEY);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function goLogin() {
  sessionStorage.removeItem(TOKEN_KEY);
  window.location.replace('login.html');
}

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token()}` },
  });
  if (res.status === 401 || res.status === 403) {
    const data = await res.json().catch(() => ({}));
    // 401 = hết phiên; 403 ở trang này nghĩa là không phải Chủ → về trang chính thay vì
    // để người dùng nhìn một trang trống.
    if (res.status === 401) { goLogin(); throw new Error('het phien'); }
    alert(data.error || 'Bạn không có quyền mở trang này.');
    window.location.replace('admin.html');
    throw new Error('khong co quyen');
  }
  return res;
}

/* ---------- Thông báo nổi (dùng lại .toast của admin.css) ---------- */
function toast(type, message) {
  message = window.CMS ? CMS.ttCu(CMS.tt(String(message ?? ''))) : message;
  const wrap = $('#toast-container');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${type === 'success' ? '✓' : '!'}</span>
    <span class="toast-msg">${escapeHtml(message)}</span>
    <button type="button" class="toast-close" aria-label="Đóng">×</button>`;
  wrap.appendChild(el);
  const kill = () => el.remove();
  el.querySelector('.toast-close').addEventListener('click', kill);
  setTimeout(kill, 5000);
}

/* ---------- Ảnh đại diện tròn, màu trung tính với hình người mặc định ---------- */
function avatarSvg() {
  return `<span class="user-avatar" aria-hidden="true">
    <svg viewBox="0 0 40 40"><circle cx="20" cy="15" r="6.4"/><path d="M7.5 34c0-6.4 5.6-11 12.5-11s12.5 4.6 12.5 11z"/></svg>
  </span>`;
}

/* ---------- Thời gian dễ đọc ---------- */
function relTime(iso) {
  if (!iso) return 'chưa đăng nhập bao giờ';
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return 'chưa đăng nhập bao giờ';
  const phut = Math.floor(diff / 60000);
  if (phut < 2) return 'vừa xong';
  if (phut < 60) return `${phut} phút trước`;
  const gio = Math.floor(phut / 60);
  if (gio < 24) return `${gio} giờ trước`;
  const ngay = Math.floor(gio / 24);
  if (ngay === 1) return 'hôm qua';
  if (ngay < 30) return `${ngay} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN');
}

/* ---------- Vẽ danh sách ---------- */
let state = { users: [], me: null, activeOwnerCount: 0 };

async function loadUsers() {
  try {
    const res = await api('/');
    const data = await res.json();
    state = data;
    render();
    // Mọi thao tác trên tài khoản đều đi qua loadUsers() sau khi xong, nên nạp lại nhật ký
    // ở đây là đủ để nó luôn cập nhật — không phải nhớ gọi ở từng nút.
    loadAudit();
  } catch (err) {
    if (err.message !== 'het phien' && err.message !== 'khong co quyen') {
      $('#user-list').innerHTML = '<span class="err">Không thể kết nối tới server.</span>';
    }
  }
}

function render() {
  const { users, me, activeOwnerCount } = state;
  const daKhoa = users.filter((u) => u.locked).length;

  $('#count-line').textContent =
    `${users.length} tài khoản · ${activeOwnerCount} Chủ` + (daKhoa ? ` · ${daKhoa} đã khóa` : '');

  // Cảnh báo khi chỉ còn 1 tài khoản Chủ — dùng lại .threshold-warn của admin.css.
  $('#owner-warn').innerHTML = activeOwnerCount === 1
    ? `<div class="threshold-warn">
         <strong>Chỉ có 1 tài khoản Chủ.</strong>
         Nếu người này quên mật khẩu thì không ai đặt lại giúp được, phải nhờ kỹ thuật viên
         can thiệp trực tiếp vào máy chủ. Nên tạo thêm một tài khoản Chủ nữa.
       </div>`
    : '';

  $('#user-list').innerHTML = users.map((u) => {
    const laToi = u.id === me;
    const chuCuoiCung = u.role === 'owner' && !u.locked && activeOwnerCount === 1;
    const canTro = laToi
      ? 'Không thao tác được lên tài khoản của chính bạn.'
      : (chuCuoiCung ? 'Đây là tài khoản Chủ duy nhất. Hãy tạo thêm một Chủ nữa trước đã.' : '');

    const nut = (act, nhan, lop) => (canTro
      ? `<span class="hint-wrap"><button type="button" class="btn ${lop} btn-tiny" disabled>${nhan}</button>
           <span class="hint">${escapeHtml(canTro)}</span></span>`
      : `<button type="button" class="btn ${lop} btn-tiny" data-act="${act}" data-id="${escapeHtml(u.id)}">${nhan}</button>`);

    return `
      <div class="user-row${u.locked ? ' locked' : ''}">
        ${avatarSvg()}
        <div class="user-main">
          <div class="user-name">
            ${escapeHtml(u.name)}
            <span class="user-login" title="Tên đăng nhập">@${escapeHtml(u.login)}</span>
            ${laToi ? '<span class="chip chip-you">bạn</span>' : ''}
            ${u.locked ? '<span class="chip chip-locked">ĐÃ KHÓA</span>' : ''}
          </div>
          <div class="user-meta">
            <span class="chip${u.role === 'owner' ? ' chip-owner' : ''}">${escapeHtml(u.roleLabel)}</span>
            <span class="dot">·</span>
            ${u.locked ? 'Đã khóa' : '<span class="status-on">Đang hoạt động</span>'}
            <span class="dot">·</span>
            ${escapeHtml(relTime(u.lastLoginAt))}
            ${u.role === 'owner'
              ? `<span class="dot">·</span><span class="${u.totpEnabled ? 'status-on' : ''}">${u.totpEnabled ? '2 lớp' : 'chưa bật 2 lớp'}</span>`
              : ''}
          </div>
        </div>
        <div class="user-actions">
          <button type="button" class="btn btn-outline btn-tiny" data-act="rename" data-id="${escapeHtml(u.id)}">Đổi tên</button>
          ${nut('role', 'Đổi vai trò', 'btn-outline')}
          <button type="button" class="btn btn-outline btn-tiny" data-act="pw" data-id="${escapeHtml(u.id)}">Đặt lại mật khẩu</button>
          ${u.role === 'owner' && u.totpEnabled && !laToi
            ? `<button type="button" class="btn btn-outline btn-tiny" data-act="totp-reset" data-id="${escapeHtml(u.id)}">Đặt lại mã</button>`
            : ''}
          ${u.locked
            ? `<button type="button" class="btn btn-outline btn-tiny" data-act="unlock" data-id="${escapeHtml(u.id)}">Mở khóa</button>
               ${nut('del', 'Xóa', 'btn-danger')}`
            : nut('lock', 'Khóa', 'btn-danger')}
        </div>
      </div>`;
  }).join('');
}

/* ---------- Email khôi phục ----------
 * Chỉ hiện cho chính người đang đăng nhập. Không hiện email của người khác ở danh
 * sách phía trên — Chủ không cần biết hộp thư riêng của từng người. */
let me = null;

// Các route này nằm ở /api/v1/auth (không phải /api/v1/admin/users) nên không dùng
// được api() ở trên.
async function authApi(path, options = {}) {
  const res = await fetch('/api/v1/auth' + path, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token()}` },
  });
  if (res.status === 401 && !options.boQuaHetPhien) {
    const data = await res.json().catch(() => ({}));
    // 401 ở đây có thể là "sai mật khẩu hiện tại" chứ chưa chắc là hết phiên — chỉ về
    // trang đăng nhập khi máy chủ nói rõ token hỏng.
    if (/phiên|token|tồn tại/i.test(data.error || '')) { goLogin(); throw new Error('het phien'); }
    return { ok: false, data };
  }
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

function renderRecovery() {
  const el = $('#recovery-panel');
  if (!me) return;

  if (!me.mailConfigured) {
    // Cài trong .env thì trang này không sửa được — chỉ còn cách báo lý do.
    if (mail?.trangThai?.nguon === 'env') {
      el.innerHTML = `<div class="threshold-warn">
        <strong>Máy chủ chưa gửi thư được.</strong> ${escapeHtml(me.mailHint || '')}
        Trong lúc chờ, hãy đảm bảo luôn có <strong>hai tài khoản Chủ</strong> để đặt lại mật khẩu cho nhau.
      </div>`;
      return;
    }
    // Đặt email khôi phục cần gửi được thư. Lần đầu thì làm gộp: cài gửi thư và nhận mã
    // về chính email của mình — nhập đúng mã là xong cả hai (routes/adminMail.js).
    el.innerHTML = `
      <div class="recovery-row">
        <span class="chip">Chưa đặt</span>
        <span class="recovery-mail" style="color:var(--muted);">Chưa có email khôi phục</span>
        <span class="recovery-btns">
          <button type="button" class="btn btn-primary btn-tiny" data-act="mail-set-dau">Đặt email khôi phục</button>
        </span>
      </div>
      <div class="form-hint" style="margin-top:10px;">
        Máy chủ chưa gửi thư được, nên lần đầu sẽ làm <strong>hai việc trong một lần</strong>: cài
        <strong>Gửi thư của hệ thống</strong>, rồi nhận mã 6 số về email của bạn. Nhập đúng mã là bật gửi thư
        và đặt email khôi phục cùng lúc.
      </div>`;
    return;
  }

  if (me.recoveryEmail) {
    el.innerHTML = `
      <div class="recovery-row">
        <span class="chip chip-ok">Đã bật</span>
        <span class="recovery-mail">${escapeHtml(me.recoveryEmail)}</span>
        <span class="recovery-btns">
          <button type="button" class="btn btn-outline btn-tiny" data-act="mail-set">Đổi email</button>
          <button type="button" class="btn btn-danger btn-tiny" data-act="mail-del">Gỡ</button>
        </span>
      </div>
      <div class="form-hint" style="margin-top:10px;">
        Quên mật khẩu thì vào trang đăng nhập, bấm <strong>Quên mật khẩu?</strong> — mã 6 số sẽ gửi về hộp thư này.
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="recovery-row">
      <span class="chip">Chưa đặt</span>
      <span class="recovery-mail" style="color:var(--muted);">Chưa có email khôi phục</span>
      <span class="recovery-btns">
        <button type="button" class="btn btn-primary btn-tiny" data-act="mail-set">Đặt email khôi phục</button>
      </span>
    </div>
    <div class="form-hint" style="margin-top:10px;">
      Dùng <strong>hộp thư riêng của bạn</strong>, đừng dùng hộp thư chung của cơ quan — ai mở được hộp thư chung
      là vào được cả hệ thống. Khi bạn nghỉ hoặc chuyển việc, hãy tạo tài khoản Chủ mới cho người kế nhiệm
      thay vì bàn giao lại tài khoản này.
    </div>`;
}

function modalMailSet() {
  openModal(`
    <div class="modal-title">${me.recoveryEmail ? 'Đổi email khôi phục' : 'Đặt email khôi phục'}</div>
    <div class="modal-sub">Chúng tôi sẽ gửi một mã 6 số tới địa chỉ này để xác nhận bạn mở được hộp thư đó.</div>
    <div class="form-group">
      <label for="f-mail">Địa chỉ email</label>
      <input class="form-control" id="f-mail" type="email" placeholder="tenban@gmail.com" autocomplete="email"
        value="${escapeHtml(me.recoveryEmail || '')}">
      <div class="form-hint">Nên bật xác minh 2 bước cho hộp thư này — nó là đường vào dự phòng của cả hệ thống.</div>
    </div>
    <div class="form-group">
      <label for="f-cur-pw">Mật khẩu hiện tại của bạn</label>
      <input class="form-control" id="f-cur-pw" type="password" autocomplete="current-password">
      <div class="form-hint">Hỏi lại để người khác ngồi vào máy bạn đang mở sẵn không đổi được đường khôi phục.</div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-primary" data-act="do-mail-set">Gửi mã xác minh</button>
    </div>`);
  $('#f-mail').focus();
}

async function doMailSet(btn) {
  const email = $('#f-mail').value.trim();
  const currentPassword = $('#f-cur-pw').value;
  if (!email) { toast('error', 'Chưa nhập địa chỉ email.'); return; }
  if (!currentPassword) { toast('error', 'Chưa nhập mật khẩu hiện tại.'); return; }

  btn.disabled = true;
  btn.textContent = 'Đang gửi...';
  const { ok, data } = await authApi('/recovery-email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, currentPassword }),
  });
  if (!ok) {
    toast('error', data.error || 'Không gửi được mã.');
    btn.disabled = false; btn.textContent = 'Gửi mã xác minh';
    return;
  }
  modalMailCode(email);
}

function modalMailCode(email) {
  openModal(`
    <div class="modal-title">Nhập mã vừa gửi</div>
    <div class="modal-sub">Đã gửi mã 6 số tới <strong>${escapeHtml(email)}</strong>. Mã có hiệu lực 10 phút.</div>
    <div class="form-group">
      <label for="f-code">Mã xác minh</label>
      <input class="form-control code-input" id="f-code" inputmode="numeric" maxlength="6"
        autocomplete="one-time-code" placeholder="123456">
      <div class="form-hint">Không thấy thư? Kiểm tra mục <strong>Spam</strong>.</div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="mail-set">Đổi địa chỉ khác</button>
      <button type="button" class="btn btn-primary" data-act="do-mail-code">Xác nhận</button>
    </div>`);
  $('#f-code').focus();
}

async function doMailCode(btn) {
  const code = $('#f-code').value.trim();
  if (!code) { toast('error', 'Chưa nhập mã.'); return; }
  btn.disabled = true;
  const { ok, data } = await authApi('/recovery-email/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  });
  if (!ok) { toast('error', data.error || 'Mã không đúng.'); btn.disabled = false; return; }
  await loadMe();
  closeModal();
  toast('success', 'Đã bật email khôi phục');
}

function modalMailDel() {
  openModal(`
    <div class="modal-title">Gỡ email khôi phục?</div>
    <div class="modal-sub">
      Sau khi gỡ, nếu bạn quên mật khẩu thì <strong>chỉ còn cách nhờ một tài khoản Chủ khác đặt lại giúp</strong>.
    </div>
    <div class="form-group">
      <label for="f-cur-pw2">Mật khẩu hiện tại của bạn</label>
      <input class="form-control" id="f-cur-pw2" type="password" autocomplete="current-password">
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-danger" data-act="do-mail-del">Gỡ email</button>
    </div>`);
  $('#f-cur-pw2').focus();
}

async function doMailDel(btn) {
  btn.disabled = true;
  const { ok, data } = await authApi('/recovery-email', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: $('#f-cur-pw2').value }),
  });
  if (!ok) { toast('error', data.error || 'Không gỡ được.'); btn.disabled = false; return; }
  await loadMe();
  closeModal();
  toast('success', 'Đã gỡ email khôi phục');
}

async function loadMe() {
  const { ok, data } = await authApi('/me');
  if (ok) { me = data; renderRecovery(); renderTotp(); }
  return ok;
}

/* ---------- Gửi thư của hệ thống ----------
 * Cài một lần cho cả bảo tàng, CHỈ bằng Gmail (một Gmail riêng cho hệ thống + mật khẩu
 * ứng dụng). Cài đặt chỉ được bật sau khi mã 6 số gửi bằng CHÍNH nó tới được hộp thư.
 * Máy chủ giữ cài đặt chưa xác minh trong bộ nhớ, không ghi xuống đĩa (routes/adminMail.js). */
let mail = null;

async function mailApi(path, options = {}) {
  const res = await fetch('/api/v1/admin/mail' + path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token()}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  // 401 ở đây có thể là "sai mật khẩu hiện tại" — chỉ về trang đăng nhập khi token hỏng.
  if (res.status === 401 && /phiên|token|tồn tại/i.test(data.error || '')) { goLogin(); throw new Error('het phien'); }
  return { ok: res.ok, data };
}

async function loadMail() {
  const { ok, data } = await mailApi('/');
  if (ok) { mail = data; renderMail(); renderRecovery(); }
}

function renderMail() {
  const el = $('#mail-panel');
  const t = mail?.trangThai;
  if (!t) return;
  const nutThu = '<button type="button" class="btn btn-outline btn-tiny" data-act="gt-thu">Gửi thư thử</button>';

  if (t.nguon === 'env') {
    el.innerHTML = `
      <div class="recovery-row">
        <span class="chip${t.daBat ? ' chip-ok">Đang dùng' : '">Thiếu'}</span>
        <span class="recovery-mail">${escapeHtml(t.from || '(chưa có địa chỉ gửi)')} · qua ${escapeHtml(t.nhan)}</span>
        <span class="recovery-btns">${t.daBat ? nutThu : ''}</span>
      </div>
      <div class="form-hint" style="margin-top:10px;">
        Cài đặt này nằm trong tệp <code>.env</code> của máy chủ nên không sửa được ở đây. Muốn cài Gmail ngay trên
        trang này, nhờ kỹ thuật viên xóa <code>MAIL_API_KEY</code> và <code>MAIL_FROM</code> khỏi <code>.env</code>
        rồi khởi động lại máy chủ.
      </div>`;
    return;
  }

  if (t.daBat) {
    el.innerHTML = `
      <div class="recovery-row">
        <span class="chip chip-ok">Đã xác minh</span>
        <span class="recovery-mail">${escapeHtml(t.from)} · qua ${escapeHtml(t.nhan)}</span>
        <span class="recovery-btns">
          ${nutThu}
          <button type="button" class="btn btn-outline btn-tiny" data-act="gt-cai">Đổi cài đặt</button>
          <button type="button" class="btn btn-danger btn-tiny" data-act="gt-tat">Tắt</button>
        </span>
      </div>
      <div class="form-hint" style="margin-top:10px;">
        Tên người gửi: <strong>${escapeHtml(t.fromName || t.tenMacDinh)}</strong>.
        Xác minh lúc ${escapeHtml(new Date(t.verifiedAt).toLocaleString('vi-VN'))} bởi ${escapeHtml(t.verifiedBy || '')}
        — mã thử đã tới ${escapeHtml(t.verifiedTo || '')}.
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="recovery-row">
      <span class="chip">Chưa cài</span>
      <span class="recovery-mail" style="color:var(--muted);">Máy chủ chưa gửi được thư</span>
      <span class="recovery-btns">
        ${mail.dangCho ? '<button type="button" class="btn btn-outline btn-tiny" data-act="gt-nhap-ma">Nhập mã đã gửi</button>' : ''}
        <button type="button" class="btn btn-primary btn-tiny" data-act="gt-cai">Cài đặt gửi thư</button>
      </span>
    </div>
    <div class="form-hint" style="margin-top:10px;">
      Cần cho hai việc: <strong>quên mật khẩu bằng email</strong>, và thư báo cho các tài khoản Chủ khi có ai đổi cài
      đặt bảo mật. Cài một lần là mọi tài khoản Chủ dùng chung.
    </div>`;
}

function oNhap(id, nhan, { type = 'text', value = '', placeholder = '', goiY = '', auto = 'off' } = {}) {
  return `<div class="form-group">
    <label for="${id}">${nhan}</label>
    <input class="form-control" id="${id}" type="${type}" value="${escapeHtml(value)}"
      placeholder="${escapeHtml(placeholder)}" autocomplete="${auto}">
    ${goiY ? `<div class="form-hint">${goiY}</div>` : ''}
  </div>`;
}

// Ô mật khẩu để trống = giữ mật khẩu đang dùng, nhưng máy chủ chỉ chấp nhận khi vẫn là
// đúng địa chỉ Gmail đó (mailer.chuanHoa).
function oGmail() {
  const t = mail?.trangThai || {};
  const cung = t.nguon === 'file' && t.provider === 'gmail';
  return oNhap('m-from', 'Địa chỉ Gmail dùng để gửi', {
    type: 'email', value: cung ? t.from : '', placeholder: 'baotang.hethong@gmail.com',
    goiY: 'Nên tạo một Gmail <strong>riêng cho hệ thống</strong>, đừng dùng hộp thư cá nhân.',
  }) + oNhap('m-pass', 'Mật khẩu ứng dụng (16 ký tự)', {
    type: 'password', placeholder: cung ? 'Để trống = giữ mật khẩu đang dùng' : 'abcd efgh ijkl mnop', auto: 'new-password',
    goiY: `<ol class="gt-buoc">
      <li>Đăng nhập Gmail đó, bật <strong>Xác minh 2 bước</strong> cho tài khoản Google.</li>
      <li>Mở <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a>, tạo một mật khẩu ứng dụng.</li>
      <li>Dán 16 ký tự vào đây (có dấu cách cũng được). <strong>Không</strong> dùng mật khẩu Gmail thường.</li>
    </ol>`,
  }) + oNhap('m-fromname', 'Tên người gửi (không bắt buộc)', {
    value: cung ? t.fromName : '', placeholder: t.tenMacDinh || '',
    goiY: 'Tên hiện trong hộp thư người nhận. Để trống = tên {donVi}.',
  });
}

// khoiPhuc = true: mở từ ô "Email khôi phục của bạn" khi máy chủ chưa gửi được thư.
function modalMailCfg({ khoiPhuc = false } = {}) {
  // Chưa có email khôi phục thì mặc định dùng luôn hộp thư nhận mã — người cài lần đầu
  // gần như luôn cần cả hai.
  const choKhoiPhuc = !me?.recoveryEmail;
  openModal(`
    <div class="modal-title">${khoiPhuc ? 'Đặt email khôi phục' : 'Cài đặt gửi thư bằng Gmail'}</div>
    <div class="modal-sub">${khoiPhuc
      ? 'Bước 1: nhập Gmail của hệ thống. Bước 2: nhập email riêng của bạn. Máy chủ gửi mã 6 số bằng chính Gmail đó — nhập đúng mã là bật gửi thư và đặt email khôi phục cùng lúc.'
      : 'Máy chủ sẽ gửi thử một mã 6 số bằng chính Gmail này. Nhập đúng mã thì cài đặt mới được bật — sai ở đâu sẽ biết ngay, không phải đợi tới hôm có người quên mật khẩu.'}</div>
    ${oGmail()}
    ${oNhap('m-to', khoiPhuc ? 'Email riêng của bạn (nhận mã)' : 'Gửi mã xác minh tới', {
      type: 'email', value: mail?.goiYGuiToi || '',
      placeholder: khoiPhuc ? 'tenban@gmail.com' : 'để trống = gửi tới chính địa chỉ gửi',
      goiY: khoiPhuc
        ? 'Hộp thư <strong>riêng của bạn</strong>, không phải hộp thư chung của cơ quan hay Gmail hệ thống ở trên.'
        : 'Một hộp thư bạn mở được ngay bây giờ.',
    })}
    ${choKhoiPhuc ? `<label class="check-row">
      <input type="checkbox" id="m-lam-kp" checked>
      <span>Dùng luôn địa chỉ này làm <strong>email khôi phục</strong> của tôi</span>
    </label>` : ''}
    ${oNhap('m-cur-pw', 'Mật khẩu hiện tại của bạn', {
      type: 'password', auto: 'current-password',
      goiY: 'Hỏi lại vì mã quên mật khẩu của mọi tài khoản Chủ đều đi qua cài đặt này.',
    })}
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-primary" data-act="gt-do-gui">Gửi mã xác minh</button>
    </div>`);
  $('#m-from').focus();
}

async function doMailCfg(btn) {
  const gt = (id) => $(`#${id}`)?.value.trim() ?? '';
  const provider = 'gmail';
  const body = {
    provider, from: gt('m-from'), fromName: gt('m-fromname'),
    pass: $('#m-pass')?.value ?? '',
    guiToi: gt('m-to'), currentPassword: $('#m-cur-pw').value,
    lamEmailKhoiPhuc: $('#m-lam-kp')?.checked === true,
  };
  if (!body.from) { toast('error', 'Chưa nhập địa chỉ Gmail dùng để gửi.'); return; }
  if (!body.pass && !(mail?.trangThai?.nguon === 'file' && mail.trangThai.provider === 'gmail')) {
    toast('error', 'Chưa nhập mật khẩu ứng dụng 16 ký tự.');
    return;
  }
  if (body.lamEmailKhoiPhuc && !body.guiToi) {
    toast('error', 'Nhập email riêng của bạn để nhận mã và dùng làm email khôi phục.');
    return;
  }
  if (!body.currentPassword) { toast('error', 'Chưa nhập mật khẩu hiện tại.'); return; }

  btn.disabled = true;
  btn.textContent = 'Đang gửi thử...';
  const { ok, data } = await mailApi('/xac-minh/gui', { method: 'POST', body: JSON.stringify(body) });
  if (!ok) {
    toast('error', data.error || 'Không gửi được thư thử.');
    btn.disabled = false; btn.textContent = 'Gửi mã xác minh';
    return;
  }
  if (mail) mail.dangCho = { guiToi: data.guiToi, provider, lamEmailKhoiPhuc: body.lamEmailKhoiPhuc };
  modalMailCfgCode(data.guiToi, body.lamEmailKhoiPhuc);
}

function modalMailCfgCode(guiToi, lamEmailKhoiPhuc) {
  openModal(`
    <div class="modal-title">Nhập mã vừa gửi</div>
    <div class="modal-sub">Thư đã đi được — mã 6 số vừa gửi tới <strong>${escapeHtml(guiToi)}</strong>. Mã có hiệu lực 10 phút.
      ${lamEmailKhoiPhuc ? '<br>Nhập đúng mã thì địa chỉ này cũng thành <strong>email khôi phục</strong> của bạn.' : ''}</div>
    <div class="form-group">
      <label for="m-code">Mã xác minh</label>
      <input class="form-control code-input" id="m-code" inputmode="numeric" maxlength="6"
        autocomplete="one-time-code" placeholder="123456">
      <div class="form-hint">Không thấy thư? Kiểm tra mục <strong>Spam</strong>.</div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="gt-cai">Sửa lại cài đặt</button>
      <button type="button" class="btn btn-primary" data-act="gt-do-ma">Bật gửi thư</button>
    </div>`);
  $('#m-code').focus();
}

async function doMailCfgCode(btn) {
  const code = $('#m-code').value.trim();
  if (!code) { toast('error', 'Chưa nhập mã.'); return; }
  btn.disabled = true;
  const { ok, data } = await mailApi('/xac-minh', { method: 'POST', body: JSON.stringify({ code }) });
  if (!ok) { toast('error', data.error || 'Mã không đúng.'); btn.disabled = false; return; }
  await loadMail();
  await loadMe();
  closeModal();
  toast('success', data.recoveryEmail
    ? `Đã bật gửi thư và đặt email khôi phục ${data.recoveryEmail}`
    : 'Đã bật gửi thư của hệ thống');
}

function modalMailTest() {
  openModal(`
    <div class="modal-title">Gửi thư thử</div>
    <div class="modal-sub">Dùng để kiểm tra máy chủ vẫn gửi được thư, vd sau khi đổi mật khẩu Gmail.</div>
    ${oNhap('m-test-to', 'Gửi tới', { type: 'email', value: me?.recoveryEmail || mail?.trangThai?.from || '' })}
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-primary" data-act="gt-do-thu">Gửi</button>
    </div>`);
}

async function doMailTest(btn) {
  const to = $('#m-test-to').value.trim();
  btn.disabled = true;
  btn.textContent = 'Đang gửi...';
  const { ok, data } = await mailApi('/thu', { method: 'POST', body: JSON.stringify({ to }) });
  if (!ok) { toast('error', data.error || 'Không gửi được.'); btn.disabled = false; btn.textContent = 'Gửi'; return; }
  closeModal();
  toast('success', `Đã gửi thư thử tới ${data.to}. Kiểm tra cả mục Spam.`);
}

function modalMailOff() {
  openModal(`
    <div class="modal-title">Tắt gửi thư của hệ thống?</div>
    <div class="modal-sub">
      <strong>"Quên mật khẩu" bằng email sẽ ngừng hoạt động với mọi tài khoản Chủ.</strong>
      Quên mật khẩu thì chỉ còn cách nhờ một tài khoản Chủ khác đặt lại.
    </div>
    ${oNhap('m-off-pw', 'Mật khẩu hiện tại của bạn', { type: 'password', auto: 'current-password' })}
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-danger" data-act="gt-do-tat">Tắt gửi thư</button>
    </div>`);
  $('#m-off-pw').focus();
}

async function doMailOff(btn) {
  btn.disabled = true;
  const { ok, data } = await mailApi('/', {
    method: 'DELETE', body: JSON.stringify({ currentPassword: $('#m-off-pw').value }),
  });
  if (!ok) { toast('error', data.error || 'Không tắt được.'); btn.disabled = false; return; }
  await loadMail();
  await loadMe();
  closeModal();
  toast('success', 'Đã tắt gửi thư của hệ thống');
}

/* ---------- Mã xác thực 2 lớp (TOTP) ----------
 * Nguyên tắc "mỗi kênh chỉ mở được một khóa": email khôi phục cấp lại MẬT KHẨU,
 * còn mã xác thực thì chỉ tài khoản Chủ KIA đặt lại được. Không có đường nào để
 * email cấp lại được cả hai - nếu có thì ai chiếm hộp thư là qua sạch hai lớp. */
function renderTotp() {
  const el = $('#totp-panel');
  if (!me) return;

  if (!me.recoveryEmail) {
    el.innerHTML = `<div class="threshold-warn">
      <strong>Hãy đặt email khôi phục ở ô bên trên trước.</strong>
      Bật mã xác thực khi chưa có email nghĩa là quên mật khẩu sẽ không còn đường nào tự lấy lại.
    </div>`;
    return;
  }

  if (me.totpEnabled) {
    el.innerHTML = `
      <div class="recovery-row">
        <span class="chip chip-ok">Đã bật</span>
        <span class="recovery-mail">Đăng nhập cần cả mật khẩu và điện thoại</span>
        <span class="recovery-btns">
          <button type="button" class="btn btn-danger btn-tiny" data-act="totp-off">Tắt</button>
        </span>
      </div>
      <div class="form-hint" style="margin-top:10px;">
        <strong>Mất điện thoại?</strong> Nhờ tài khoản Chủ còn lại bấm <strong>Đặt lại mã</strong> ở dòng của bạn
        trong danh sách trên — email khôi phục cố ý <em>không</em> làm được việc này.
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="recovery-row">
      <span class="chip">Chưa bật</span>
      <span class="recovery-mail" style="color:var(--muted);">Hiện chỉ cần mật khẩu là vào được</span>
      <span class="recovery-btns">
        <button type="button" class="btn btn-primary btn-tiny" data-act="totp-on">Bật mã xác thực</button>
      </span>
    </div>
    <div class="form-hint" style="margin-top:10px;">
      Cần một ứng dụng xác thực trên điện thoại — <strong>Google Authenticator</strong>, Microsoft Authenticator
      hay bất kỳ ứng dụng nào tương tự đều dùng được.
    </div>`;
}

function modalTotpOn() {
  openModal(`
    <div class="modal-title">Bật mã xác thực 2 lớp</div>
    <div class="modal-sub">Nhập mật khẩu để lấy mã QR.</div>
    <div class="form-group">
      <label for="f-totp-pw">Mật khẩu hiện tại của bạn</label>
      <input class="form-control" id="f-totp-pw" type="password" autocomplete="current-password">
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-primary" data-act="do-totp-setup">Tiếp tục</button>
    </div>`);
  $('#f-totp-pw').focus();
}

async function doTotpSetup(btn) {
  const currentPassword = $('#f-totp-pw').value;
  if (!currentPassword) { toast('error', 'Chưa nhập mật khẩu.'); return; }
  btn.disabled = true;
  btn.textContent = 'Đang tạo...';
  const { ok, data } = await authApi('/totp/setup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword }),
  });
  if (!ok) {
    toast('error', data.error || 'Không tạo được mã QR.');
    btn.disabled = false; btn.textContent = 'Tiếp tục';
    return;
  }
  modalTotpQr(data);
}

function modalTotpQr(data) {
  openModal(`
    <div class="modal-title">Quét mã này bằng điện thoại</div>
    <div class="modal-sub">Mở ứng dụng xác thực, chọn thêm tài khoản, rồi quét mã QR bên dưới.</div>
    <div class="qr-wrap">${data.qrSvg}</div>
    <div class="form-hint" style="text-align:center; margin-bottom:6px;">Không quét được? Chọn "Nhập khóa thiết lập" rồi gõ tay:</div>
    <div class="qr-secret" id="totp-secret">${escapeHtml(data.secretText)}</div>
    <div class="form-group" style="margin-top:16px;">
      <label for="f-totp-code">Nhập mã 6 số đang hiện trong ứng dụng</label>
      <input class="form-control code-input" id="f-totp-code" inputmode="numeric" maxlength="6"
        autocomplete="one-time-code" placeholder="123456">
      <div class="form-hint">Bước này để chắc chắn điện thoại đã quét đúng và giờ không bị lệch.</div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-primary" data-act="do-totp-enable">Bật</button>
    </div>`);
  $('#f-totp-code').focus();
}

async function doTotpEnable(btn) {
  const code = $('#f-totp-code').value.trim();
  if (!code) { toast('error', 'Chưa nhập mã.'); return; }
  btn.disabled = true;
  const { ok, data } = await authApi('/totp/enable', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  });
  if (!ok) { toast('error', data.error || 'Mã không đúng.'); btn.disabled = false; return; }
  await loadMe();
  await loadUsers();
  closeModal();
  toast('success', 'Đã bật mã xác thực 2 lớp');
}

function modalTotpOff() {
  openModal(`
    <div class="modal-title">Tắt mã xác thực 2 lớp?</div>
    <div class="modal-sub">
      Sau khi tắt, chỉ cần mật khẩu là đăng nhập được — mất mật khẩu là mất tài khoản.
    </div>
    <div class="form-group">
      <label for="f-off-pw">Mật khẩu hiện tại</label>
      <input class="form-control" id="f-off-pw" type="password" autocomplete="current-password">
    </div>
    <div class="form-group">
      <label for="f-off-code">Mã 6 số đang hiện trong ứng dụng</label>
      <input class="form-control code-input" id="f-off-code" inputmode="numeric" maxlength="6" placeholder="123456">
      <div class="form-hint">Hỏi cả hai để người chỉ trộm được mật khẩu không tự tắt lớp bảo vệ này đi.</div>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-danger" data-act="do-totp-off">Tắt</button>
    </div>`);
  $('#f-off-pw').focus();
}

async function doTotpOff(btn) {
  btn.disabled = true;
  const { ok, data } = await authApi('/totp', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword: $('#f-off-pw').value, code: $('#f-off-code').value.trim() }),
  });
  if (!ok) { toast('error', data.error || 'Không tắt được.'); btn.disabled = false; return; }
  await loadMe();
  await loadUsers();
  closeModal();
  toast('success', 'Đã tắt mã xác thực 2 lớp');
}

function modalTotpReset(u) {
  openModal(`
    <div class="modal-title">Đặt lại mã xác thực cho ${escapeHtml(u.name)}?</div>
    <div class="modal-sub">
      Dùng khi họ mất điện thoại. Sau khi đặt lại, họ đăng nhập <strong>chỉ bằng mật khẩu</strong>
      cho tới khi đăng ký lại bằng máy mới — hãy nhắc họ làm ngay.
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-danger" data-act="do-totp-reset" data-id="${escapeHtml(u.id)}">Đặt lại</button>
    </div>`);
}

/* ---------- Popup ---------- */
function openModal(html) {
  $('#user-modal-card').innerHTML =
    `<button type="button" class="modal-close" data-act="close" aria-label="Đóng">×</button>${html}`;
  $('#user-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('#user-modal').classList.remove('active');
  document.body.style.overflow = '';
}

// Thẻ chọn vai trò có mô tả, không dùng danh sách thả xuống: chỉ ba chữ
// "Chủ/Biên tập/Chỉ xem" thì người mới không biết chọn gì.
function roleCards(dangChon, nhom) {
  return `<div class="role-cards">` + Object.entries(ROLE_DESC).map(([key, r]) => `
    <label class="role-card${key === dangChon ? ' sel' : ''}" data-role-card="${key}">
      <input type="radio" name="${nhom}" value="${key}"${key === dangChon ? ' checked' : ''}>
      <span>
        <span class="rc-name">${r.label}${r.common ? '<span class="tag-common">Phổ biến</span>' : ''}</span>
        <span class="rc-desc">${r.desc}${r.no ? ` <span class="rc-no">${r.no}</span>` : ''}</span>
      </span>
    </label>`).join('') + `</div>`;
}

// Mật khẩu chỉ hiện ĐÚNG MỘT LẦN. Câu "Nếu mất, bạn vẫn đặt lại được bất cứ lúc nào"
// là cố ý: trả lời trước nỗi lo lớn nhất của người không rành kỹ thuật.
/* navigator.clipboard CHỈ tồn tại ở ngữ cảnh an toàn (HTTPS hoặc localhost). Vào
   CMS qua IP LAN kiểu http://192.168.1.18:8000 thì nó là undefined — bản cũ gọi
   thẳng .writeText() nên ném lỗi, rồi khối catch RỖNG nuốt mất: bấm nút không có
   gì xảy ra và cũng không báo gì. Nay có bản dự phòng và luôn nói rõ kết quả. */
async function chepVaoClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* rơi xuống cách dự phòng bên dưới */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function passwordPanel(login, password, ghiChu) {
  return `<div class="pw-panel">
    ${login ? `<div class="pw-line"><span class="pw-label">Tên đăng nhập</span><span class="pw-val">${escapeHtml(login)}</span></div>` : ''}
    <div class="pw-line">
      <span class="pw-label">Mật khẩu</span>
      <span class="pw-val" id="pw-val">${escapeHtml(password)}</span>
      <button type="button" class="btn btn-outline btn-tiny" data-act="copy">Sao chép</button>
    </div>
    <div class="pw-warn"><strong>Ghi lại ngay.</strong> ${ghiChu}</div>
  </div>`;
}

function modalCreate() {
  openModal(`
    <div class="modal-title">Tạo tài khoản</div>
    <div class="modal-sub">Người mới sẽ đăng nhập bằng tên và mật khẩu bạn tạo ở đây.</div>
    <div class="form-group">
      <label for="f-name">Tên hiển thị</label>
      <input class="form-control" id="f-name" placeholder="Nguyễn Thị Lan" autocomplete="off">
      <div class="form-hint">Tên này hiện trong nhật ký thao tác, nên ghi đầy đủ.</div>
    </div>
    <div class="form-group">
      <label for="f-login">Tên đăng nhập</label>
      <input class="form-control" id="f-login" placeholder="lan" autocomplete="off">
      <div class="form-hint">Chữ thường, số, dấu chấm hoặc gạch — 3 đến 32 ký tự.</div>
    </div>
    <div class="form-group">
      <label>Vai trò</label>
      ${roleCards('editor', 'new-role')}
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-primary" data-act="do-create">Tạo tài khoản</button>
    </div>`);

  // Tự gợi ý tên đăng nhập từ tên hiển thị (bỏ dấu), nhưng dừng ngay khi người dùng tự
  // gõ — không giành quyền điều khiển ô đó.
  const nameEl = $('#f-name');
  const loginEl = $('#f-login');
  let daGoTay = false;
  loginEl.addEventListener('input', () => { daGoTay = true; });
  nameEl.addEventListener('input', () => {
    if (daGoTay) return;
    const cuoi = nameEl.value.trim().split(/\s+/).pop() || '';
    loginEl.value = cuoi.normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9._-]/g, '');
  });
  nameEl.focus();
}

async function doCreate(btn) {
  const name = $('#f-name').value.trim();
  const login = $('#f-login').value.trim().toLowerCase();
  const role = $('#user-modal-card input[name="new-role"]:checked')?.value;
  if (!name) { toast('error', 'Chưa nhập tên hiển thị.'); return; }
  if (!login) { toast('error', 'Chưa nhập tên đăng nhập.'); return; }

  btn.disabled = true;
  try {
    const res = await api('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, login, role }),
    });
    const data = await res.json();
    if (!res.ok) { toast('error', data.error || 'Không tạo được tài khoản.'); btn.disabled = false; return; }

    await loadUsers();
    openModal(`
      <div class="modal-title">Đã tạo tài khoản cho ${escapeHtml(name)}</div>
      <div class="modal-sub">Vai trò: ${escapeHtml(data.user.roleLabel)}</div>
      ${passwordPanel(data.user.login, data.password,
        'Mật khẩu này không hiện lại lần nào nữa. Nếu mất, bạn vẫn đặt lại được bất cứ lúc nào.')}
      <div class="form-actions">
        <button type="button" class="btn btn-primary" data-act="close">Xong</button>
      </div>`);
  } catch (err) {
    btn.disabled = false;
  }
}

function modalRole(u) {
  openModal(`
    <div class="modal-title">Đổi vai trò</div>
    <div class="modal-sub">${escapeHtml(u.name)} · hiện đang là ${escapeHtml(u.roleLabel)}</div>
    ${roleCards(u.role, 'edit-role')}
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-primary" data-act="do-role" data-id="${escapeHtml(u.id)}">Lưu vai trò</button>
    </div>`);
}

function modalRename(u) {
  const laToi = u.id === state.me;
  openModal(`
    <div class="modal-title">Đổi tên tài khoản</div>
    <div class="modal-sub">${escapeHtml(u.name)} · ${escapeHtml(u.roleLabel)}</div>
    <div class="form-group">
      <label for="f-rn-name">Tên hiển thị</label>
      <input class="form-control" id="f-rn-name" value="${escapeHtml(u.name)}" autocomplete="off">
      <div class="form-hint">Hiện trong nhật ký thao tác và ở góc trên màn hình.</div>
    </div>
    <div class="form-group">
      <label for="f-rn-login">Tên đăng nhập</label>
      <input class="form-control" id="f-rn-login" value="${escapeHtml(u.login)}" autocomplete="off">
      <div class="form-hint">Chữ thường, số, dấu chấm hoặc gạch — 3 đến 32 ký tự. Mật khẩu giữ nguyên.
        ${laToi
          ? 'Bạn vẫn đăng nhập tiếp, lần sau dùng tên mới.'
          : '<strong>Người này sẽ KHÔNG đăng nhập được bằng tên cũ</strong> — hãy báo tên mới cho họ. Nếu họ đang mở sẵn trang quản trị, lần tải trang tới sẽ thấy thông báo ai đã đổi.'}</div>
    </div>
    <!-- Cách dùng sai hay gặp nhất: nhân viên nghỉ, đổi tên tài khoản của họ cho người mới.
         Làm vậy thì toàn bộ lịch sử chỉnh sửa của người cũ hiện dưới tên người mới. Áp dụng cả
         khi tự đổi tên mình — cùng nguyên tắc "gắn với con người, không gắn với cái ghế" §5.17. -->
    <div class="threshold-warn">
      <strong>Chỉ dùng để sửa tên gõ sai.</strong> Nếu một <strong>người khác</strong> tiếp quản công việc,
      đừng đổi tên tài khoản này — toàn bộ lịch sử chỉnh sửa của người cũ sẽ hiện dưới tên người mới.
      Hãy <strong>tạo tài khoản mới</strong> cho người đó và <strong>khóa</strong> tài khoản cũ.
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-primary" data-act="do-rename" data-id="${escapeHtml(u.id)}">Lưu</button>
    </div>`);
  $('#f-rn-name').focus();
}

// Mỗi hộp xác nhận phải nói rõ HẬU QUẢ, không dùng "Bạn có chắc không?". Câu in đậm ở
// cuối trả lời trước nỗi lo lớn nhất (khóa tài khoản thì dữ liệu có mất không?).
function modalLock(u) {
  const ten = u.name.trim().split(/\s+/).pop();
  openModal(`
    <div class="modal-title">Khóa tài khoản của ${escapeHtml(u.name)}?</div>
    <div class="modal-body-text">
      ${escapeHtml(ten)} sẽ không đăng nhập lại được cho tới khi bạn mở khóa.<br><br>
      <strong>Toàn bộ {muc} đã nhập vẫn giữ nguyên</strong>, không mất gì.
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-danger" data-act="do-lock" data-id="${escapeHtml(u.id)}">Khóa tài khoản</button>
    </div>`);
}

function modalDelete(u) {
  openModal(`
    <div class="modal-title">Xóa hẳn tài khoản ${escapeHtml(u.name)}?</div>
    <div class="modal-body-text">
      Tài khoản biến mất khỏi danh sách và không khôi phục được.<br><br>
      <strong>Nhật ký vẫn giữ tên họ</strong> ở những thao tác đã làm, nên lịch sử không bị mất dấu.
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-danger" data-act="do-del" data-id="${escapeHtml(u.id)}">Xóa hẳn</button>
    </div>`);
}

function modalPw(u) {
  openModal(`
    <div class="modal-title">Đặt lại mật khẩu</div>
    <div class="modal-body-text">
      Hệ thống sẽ sinh một mật khẩu mới cho <strong>${escapeHtml(u.name)}</strong>.
      Mật khẩu cũ ngừng hoạt động ngay lập tức.
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" data-act="close">Hủy</button>
      <button type="button" class="btn btn-primary" data-act="do-pw" data-id="${escapeHtml(u.id)}">Đặt lại mật khẩu</button>
    </div>`);
}

/* ---------- Gọi API ---------- */
async function callAndReload(path, options, thanhCong, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await api(path, options);
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) {
      toast('error', data.error || 'Thao tác không thành công.');
      if (btn) btn.disabled = false;
      return null;
    }
    await loadUsers();
    if (thanhCong) toast('success', thanhCong);
    return data;
  } catch (err) {
    if (btn) btn.disabled = false;
    return null;
  }
}

/* ---------- Điều phối sự kiện (data-act, không dùng onclick nội tuyến — CSP đặt
   script-src-attr 'none' nên onclick bị chặn im lặng) ---------- */
document.addEventListener('click', async (e) => {
  const card = e.target.closest('[data-role-card]');
  if (card) {
    card.closest('.role-cards').querySelectorAll('.role-card').forEach((c) => c.classList.remove('sel'));
    card.classList.add('sel');
  }

  if (e.target === $('#user-modal')) { closeModal(); return; }

  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const u = state.users.find((x) => x.id === el.dataset.id);

  if (act === 'close') { closeModal(); return; }
  if (act === 'copy') {
    const val = $('#pw-val')?.textContent || '';
    const ok = await chepVaoClipboard(val);
    el.textContent = ok ? 'Đã chép' : 'Không chép được';
    if (!ok) toast('error', 'Trình duyệt không cho chép tự động (thường do vào bằng địa chỉ IP thay vì HTTPS). Hãy bôi đen mật khẩu rồi nhấn Ctrl+C.');
    setTimeout(() => { el.textContent = 'Sao chép'; }, 1600);
    return;
  }
  if (act === 'do-create') { doCreate(el); return; }
  if (act === 'totp-on') { modalTotpOn(); return; }
  if (act === 'do-totp-setup') { doTotpSetup(el); return; }
  if (act === 'do-totp-enable') { doTotpEnable(el); return; }
  if (act === 'totp-off') { modalTotpOff(); return; }
  if (act === 'do-totp-off') { doTotpOff(el); return; }
  if (act === 'do-totp-reset') {
    callAndReload(`/${el.dataset.id}/totp/reset`, { method: 'PUT' }, 'Đã đặt lại mã xác thực.', el)
      .then((ok) => { if (ok) closeModal(); });
    return;
  }
  if (act === 'mail-set') { modalMailSet(); return; }
  if (act === 'mail-set-dau') { modalMailCfg({ khoiPhuc: true }); return; }
  if (act === 'do-mail-set') { doMailSet(el); return; }
  if (act === 'do-mail-code') { doMailCode(el); return; }
  if (act === 'mail-del') { modalMailDel(); return; }
  if (act === 'do-mail-del') { doMailDel(el); return; }
  if (act === 'gt-cai') { modalMailCfg(); return; }
  if (act === 'gt-do-gui') { doMailCfg(el); return; }
  if (act === 'gt-nhap-ma') { modalMailCfgCode(mail.dangCho.guiToi, mail.dangCho.lamEmailKhoiPhuc); return; }
  if (act === 'gt-do-ma') { doMailCfgCode(el); return; }
  if (act === 'gt-thu') { modalMailTest(); return; }
  if (act === 'gt-do-thu') { doMailTest(el); return; }
  if (act === 'gt-tat') { modalMailOff(); return; }
  if (act === 'gt-do-tat') { doMailOff(el); return; }
  if (!u) return;

  if (act === 'totp-reset') { modalTotpReset(u); return; }
  if (act === 'rename') { modalRename(u); return; }
  if (act === 'do-rename') {
    const name = $('#f-rn-name').value.trim();
    const login = $('#f-rn-login').value.trim().toLowerCase();
    if (!name) { toast('error', 'Chưa nhập tên hiển thị.'); return; }
    if (!login) { toast('error', 'Chưa nhập tên đăng nhập.'); return; }
    const data = await callAndReload(`/${u.id}/identity`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, login }),
    }, login !== u.login ? `${name} từ giờ đăng nhập bằng "${login}".` : 'Đã đổi tên hiển thị.', el);
    if (!data) return;
    closeModal();
    if (u.id === state.me) {
      me = { ...me, name: data.user.name, login: data.user.login };
      $('#me-name').textContent = data.user.name;
    }
    return;
  }
  if (act === 'role') modalRole(u);
  else if (act === 'do-role') {
    const role = $('#user-modal-card input[name="edit-role"]:checked')?.value;
    const ok = await callAndReload(`/${u.id}/role`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
    }, `${u.name} giờ là ${ROLE_DESC[role]?.label || role}.`, el);
    if (ok) closeModal();
  }
  else if (act === 'lock') modalLock(u);
  else if (act === 'do-lock') {
    const ok = await callAndReload(`/${u.id}/locked`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locked: true }),
    }, `Đã khóa tài khoản của ${u.name}.`, el);
    if (ok) closeModal();
  }
  else if (act === 'unlock') {
    await callAndReload(`/${u.id}/locked`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locked: false }),
    }, `Đã mở khóa tài khoản của ${u.name}.`, el);
  }
  else if (act === 'del') modalDelete(u);
  else if (act === 'do-del') {
    const ok = await callAndReload(`/${u.id}`, { method: 'DELETE' }, `Đã xóa tài khoản ${u.name}.`, el);
    if (ok) closeModal();
  }
  else if (act === 'pw') modalPw(u);
  else if (act === 'do-pw') {
    el.disabled = true;
    const res = await api(`/${u.id}/password`, { method: 'PUT' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast('error', data.error || 'Không đặt lại được mật khẩu.'); el.disabled = false; return; }
    await loadUsers();
    openModal(`
      <div class="modal-title">Mật khẩu mới cho ${escapeHtml(u.name)}</div>
      ${passwordPanel(u.login, data.password,
        'Mật khẩu cũ đã ngừng hoạt động. Mật khẩu mới không hiện lại lần nào nữa, nhưng bạn vẫn đặt lại được bất cứ lúc nào.')}
      <div class="form-actions">
        <button type="button" class="btn btn-primary" data-act="close">Xong</button>
      </div>`);
  }
});

$('#btn-create').addEventListener('click', modalCreate);
$('#btn-audit-reload').addEventListener('click', loadAudit);

/* ---------- Nhật ký tài khoản ----------
   ⚠ Tên và tên đăng nhập trong nhật ký là dữ liệu người dùng gõ vào — MỌI giá trị phải đi qua
   escapeHtml(), vì chuỗi này được chèn bằng innerHTML. */
const NHAY_CAM = new Set(['password.reset-by-owner', 'password.reset-email', 'totp.reset-by-owner', 'user.delete', 'user.lock']);

function tenVaiTro(r) { return ROLE_DESC[r]?.label || r || ''; }
function taiKhoanHtml(p) {
  if (!p) return 'không rõ';
  return `<strong>${escapeHtml(p.name || '?')}</strong> <span class="user-login">@${escapeHtml(p.login || '?')}</span>`;
}

function moTaNhatKy(e) {
  const t = taiKhoanHtml(e.target);
  const d = e.detail || {};
  switch (e.action) {
    case 'user.create': return `tạo tài khoản ${t} — vai trò ${escapeHtml(tenVaiTro(d.role))}`;
    case 'user.role': return `đổi vai trò của ${t}: ${escapeHtml(tenVaiTro(d.from))} → <strong>${escapeHtml(tenVaiTro(d.to))}</strong>`;
    case 'user.identity': {
      const phan = [];
      if (d.loginFrom !== undefined) phan.push(`tên đăng nhập @${escapeHtml(d.loginFrom)} → <strong>@${escapeHtml(d.loginTo)}</strong>`);
      if (d.nameFrom !== undefined) phan.push(`tên hiển thị "${escapeHtml(d.nameFrom)}" → <strong>"${escapeHtml(d.nameTo)}"</strong>`);
      return `đổi tên tài khoản ${t}: ${phan.join('; ') || 'không đổi gì'}`;
    }
    case 'user.lock': return `khóa tài khoản ${t}`;
    case 'user.unlock': return `mở khóa tài khoản ${t}`;
    case 'password.reset-by-owner': return `đặt lại mật khẩu cho ${t}`;
    case 'totp.reset-by-owner': return `gỡ mã xác thực 2 lớp của ${t}`;
    case 'user.delete': return `xóa hẳn tài khoản ${t}`;
    case 'password.self-change': return 'tự đổi mật khẩu của mình';
    case 'password.reset-email': return 'đặt lại mật khẩu bằng mã gửi qua email khôi phục';
    default: return escapeHtml(e.action || 'thao tác không rõ');
  }
}

async function loadAudit() {
  const box = $('#audit-list');
  if (!box) return;
  try {
    const res = await api('/audit');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      box.innerHTML = `<span class="err">${escapeHtml(data.error || 'Không tải được nhật ký.')}</span>`;
      return;
    }
    const items = data.items || [];
    if (!items.length) {
      box.innerHTML = '<div class="empty-state">Chưa có thao tác nào trên tài khoản kể từ khi bật nhật ký.</div>';
      return;
    }
    box.innerHTML = items.map((e) => `
      <div class="audit-row${NHAY_CAM.has(e.action) ? ' nhay-cam' : ''}">
        <div class="audit-time" title="${escapeHtml(e.t)}">${escapeHtml(new Date(e.t).toLocaleString('vi-VN'))}</div>
        <div class="audit-text">${taiKhoanHtml(e.actor)} ${moTaNhatKy(e)}</div>
        <div class="audit-ip">${escapeHtml(e.ip || '')}</div>
      </div>`).join('');
  } catch (err) {
    if (err.message !== 'het phien' && err.message !== 'khong co quyen') {
      box.innerHTML = '<span class="err">Không thể kết nối tới server.</span>';
    }
  }
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ---------- Menu tài khoản ----------
   Đóng/mở do appearance.js lo; ở đây chỉ còn đăng xuất. */
$('#logout-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  goLogin();
});

/* ---------- Khởi động ---------- */
(async () => {
  if (!token()) { goLogin(); return; }
  // Kiểm tra vai trò TRƯỚC khi vẽ gì: Biên tập gõ thẳng địa chỉ trang này thì phải báo
  // rõ và đưa về trang chính.
  try {
    const res = await fetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token()}` } });
    if (res.status === 401) { goLogin(); return; }
    me = await res.json();
    if (me.role !== 'owner') {
      alert('Chỉ tài khoản Chủ mới mở được trang Quản lý tài khoản.');
      window.location.replace('admin.html');
      return;
    }
    $('#me-name').textContent = me.name;
    $('#me-role').textContent = me.roleLabel;
    renderRecovery();
    renderTotp();
    loadMail();
  } catch {
    $('#user-list').innerHTML = '<span class="err">Không thể kết nối tới server.</span>';
    return;
  }
  loadUsers();
})();

/* =====================================================================
   CÁCH GỌI TÊN & TRẠNG THÁI (cmsSettings.js). Chỉ Chủ vào được trang này.
   ===================================================================== */
const CMS_API = '/api/v1/admin/cms-settings';
const TERM_FIELDS = [
  ['donVi', 'Tên gọi đơn vị của bạn', 'VD: công ty, trường, bảo tàng'],
  ['nhom', 'Không gian có đặt beacon', 'VD: khu vực, phòng, khu trưng bày'],
  ['muc', 'Từng điểm được thuyết minh', 'VD: nội dung, sản phẩm, hiện vật'],
  ['thietBi', 'Thiết bị khách mang theo', 'VD: thiết bị thuyết minh, máy tham quan'],
  ['khach', 'Người dùng thiết bị', 'VD: khách, học viên, khách tham quan'],
  ['thuyetMinh', 'Phần âm thanh', 'VD: thuyết minh, giới thiệu'],
];
const MAU_TEN = { 'chung': 'Dùng chung', 'bao-tang': 'Bảo tàng', 'showroom': 'Showroom', 'nha-dat': 'Nhà đất' };
let cmsDangSua = null;

async function cmsFetch(options = {}) {
  const res = await fetch(CMS_API, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}), Authorization: `Bearer ${token()}` },
  });
  if (res.status === 401) { goLogin(); throw new Error('het phien'); }
  return res;
}

async function loadCmsSettings() {
  const box = document.getElementById('cms-settings-panel');
  if (!box) return;
  try {
    const r = await fetch('/api/v1/admin/content/languages', { headers: { Authorization: `Bearer ${token()}` } });
    if (r.ok) cmsNgonNgu = await r.json();
  } catch { /* không có danh sách ngôn ngữ thì chỉ nhập tên tiếng mặc định */ }
  try {
    const res = await cmsFetch();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { box.innerHTML = `<span class="err">${escapeHtml(data.error || 'Không tải được cài đặt.')}</span>`; return; }
    cmsDangSua = data;
    veCmsSettings();
  } catch (err) {
    if (err.message !== 'het phien') box.innerHTML = '<span class="err">Không thể kết nối tới server.</span>';
  }
}

function veCmsSettings() {
  const d = cmsDangSua;
  const box = document.getElementById('cms-settings-panel');
  const mau = Object.keys(d.mau || {}).map((k) =>
    `<button type="button" class="btn btn-ghost" data-cms-mau="${escapeHtml(k)}">${escapeHtml(MAU_TEN[k] || k)}</button>`).join(' ');
  const colorOpt = (c) => (d.colors || []).map((x) =>
    `<option value="${x}"${x === c ? ' selected' : ''}>${{ green: 'Xanh lá', amber: 'Vàng', red: 'Đỏ', gray: 'Xám', blue: 'Xanh dương' }[x] || x}</option>`).join('');
  box.innerHTML = `
    <div class="cms-mau-row"><span class="form-hint">Điền nhanh theo mẫu:</span> ${mau}</div>
    <div class="cms-term-grid">
      ${TERM_FIELDS.map(([k, label, ph]) => `
        <div class="form-group">
          <label for="cms-term-${k}">${escapeHtml(label)}</label>
          <input class="form-control" id="cms-term-${k}" data-cms-term="${k}" maxlength="40"
                 value="${escapeHtml(d.terms[k])}" placeholder="${escapeHtml(ph)}">
        </div>`).join('')}
      <div class="form-group"><label for="cms-brand">Tên hiển thị trên logo</label>
        <input class="form-control" id="cms-brand" maxlength="30" value="${escapeHtml(d.brand || '')}" placeholder="VD: tên công ty"></div>
    </div>

    <div class="panel-title cms-sub-title">Trạng thái biên tập</div>
    <div class="form-hint" style="margin-bottom:6px;">Gắn cho từng ${escapeHtml(d.terms.muc || 'nội dung')} để theo dõi việc soạn và lọc nhanh. Chỉ hiện trong trang quản trị — máy của khách không bị ảnh hưởng. Mã là chữ không dấu, không đổi sau khi đã dùng.</div>
    <div id="cms-status-list">
      ${(d.statuses || []).map((s, i) => `
        <div class="cms-status-row">
          <input class="form-control mono" data-st="id" data-i="${i}" value="${escapeHtml(s.id)}" placeholder="ma-trang-thai" aria-label="Mã trạng thái" maxlength="32">
          <input class="form-control" data-st="label" data-i="${i}" value="${escapeHtml(s.label)}" placeholder="Tên hiển thị" aria-label="Tên trạng thái" maxlength="40">
          <select class="form-control" data-st="color" data-i="${i}" aria-label="Màu">${colorOpt(s.color)}</select>
          <button type="button" class="btn btn-ghost" data-st-xoa="${i}" title="Bỏ trạng thái này" aria-label="Bỏ trạng thái này">✕</button>
        </div>`).join('')}
    </div>
    <button type="button" class="btn btn-ghost" id="cms-status-add" style="margin-top:6px;">+ Thêm trạng thái</button>

    <div class="panel-title cms-sub-title">Trường thông tin</div>
    <div class="form-hint" style="margin-bottom:8px;">Các ô thông tin có trên mọi ${escapeHtml(d.terms.muc || 'nội dung')} — VD nhà đất: giá, diện tích, hướng; bảo tàng: niên đại, chất liệu. Bật <strong>Hiện cho khách</strong> thì trường đó nằm trong bảng Thông số trên máy của ${escapeHtml(d.terms.khach || 'khách')}.</div>
    <div id="cms-field-list">${(d.fields || []).map((f, i) => veDongTruong(f, i, (d.fields || []).length)).join('') || '<div class="form-hint">Chưa có trường nào.</div>'}</div>
    <button type="button" class="btn btn-ghost" id="cms-field-add" style="margin-top:6px;">+ Thêm trường</button>
    <div style="margin-top:16px;"><button type="button" class="btn btn-primary" id="cms-save">Lưu cài đặt</button></div>`;
}

const KIEU_TRUONG = { text: 'Chữ', number: 'Số', year: 'Năm', select: 'Chọn từ danh sách' };
// Ngôn ngữ của nội dung (để nhập tên trường ở ngôn ngữ khác). Tải một lần.
let cmsNgonNgu = { languages: [], fallbackLanguage: 'vi', languageNames: {} };

function veDongTruong(f, i, n) {
  const khac = (cmsNgonNgu.languages || []).filter((l) => l !== cmsNgonNgu.fallbackLanguage);
  const coDich = khac.some((l) => f.labelI18n?.[l]);
  return `
    <div class="cms-field-row" data-fi="${i}">
      <div class="cms-field-main">
        <div class="form-group"><label for="cms-f-label-${i}">Tên trường</label>
          <input class="form-control" id="cms-f-label-${i}" data-f="label" data-i="${i}" maxlength="40" value="${escapeHtml(f.label || '')}" placeholder="VD: Diện tích, Niên đại"></div>
        <div class="form-group"><label for="cms-f-type-${i}">Kiểu</label>
          <select class="form-control" id="cms-f-type-${i}" data-f="type" data-i="${i}">
            ${Object.entries(KIEU_TRUONG).map(([k, t]) => `<option value="${k}"${k === f.type ? ' selected' : ''}>${t}</option>`).join('')}
          </select></div>
        ${f.type === 'number' ? `<div class="form-group"><label for="cms-f-unit-${i}">Đơn vị</label>
          <input class="form-control" id="cms-f-unit-${i}" data-f="unit" data-i="${i}" maxlength="12" value="${escapeHtml(f.unit || '')}" placeholder="VD: m², VNĐ, kg"></div>` : ''}
        ${f.type === 'select' ? `<div class="form-group cms-field-opts"><label for="cms-f-opts-${i}">Các lựa chọn (mỗi dòng một)</label>
          <textarea class="form-control" id="cms-f-opts-${i}" data-f="options" data-i="${i}" rows="3" placeholder="Đông&#10;Tây&#10;Nam">${escapeHtml((f.options || []).join('\n'))}</textarea></div>` : ''}
      </div>
      <div class="cms-field-flags">
        <label class="cms-toggle"><input type="checkbox" data-f="onDevice" data-i="${i}"${f.onDevice ? ' checked' : ''}> Hiện cho khách</label>
        <label class="cms-toggle"><input type="checkbox" data-f="inList" data-i="${i}"${f.inList ? ' checked' : ''}> Hiện trong danh sách</label>
        <span class="cms-field-id mono" title="Mã lưu trong dữ liệu — không đổi sau khi đã lưu">${f._moi ? 'mã tự đặt khi lưu' : `mã: ${escapeHtml(f.id)}`}</span>
        <span class="cms-field-btns">
          <button type="button" class="btn btn-ghost btn-tiny" data-f-len="${i}"${i === 0 ? ' disabled' : ''} aria-label="Đưa lên">↑</button>
          <button type="button" class="btn btn-ghost btn-tiny" data-f-xuong="${i}"${i === n - 1 ? ' disabled' : ''} aria-label="Đưa xuống">↓</button>
          <button type="button" class="btn btn-ghost btn-tiny" data-f-xoa="${i}" aria-label="Bỏ trường này" title="Bỏ trường (giá trị đã nhập vẫn giữ trong dữ liệu)">✕</button>
        </span>
      </div>
      ${khac.length ? `<details class="cms-field-i18n"${coDich ? '' : ''}><summary>Tên trường ở ngôn ngữ khác${coDich ? '' : ' (chưa dịch — khách nước ngoài sẽ thấy tên tiếng mặc định)'}</summary>
        <div class="cms-term-grid">${khac.map((l) => `<div class="form-group"><label for="cms-f-i18n-${i}-${l}">${escapeHtml(cmsNgonNgu.languageNames?.[l] || l)}</label>
          <input class="form-control" id="cms-f-i18n-${i}-${l}" data-f="i18n" data-lang="${escapeHtml(l)}" data-i="${i}" maxlength="40" value="${escapeHtml(f.labelI18n?.[l] || '')}"></div>`).join('')}</div>
      </details>` : ''}
    </div>`;
}

// Mã trường cho trường mới: từ tên, bỏ dấu, gạch dưới; trùng thì thêm _2, _3...
function maTruongTuTen(ten, daCo) {
  let goc = String(ten || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28);
  if (!/^[a-z]/.test(goc)) goc = `truong_${goc}`.replace(/_+$/, '');
  let id = goc; let k = 2;
  while (daCo.has(id)) id = `${goc}_${k++}`;
  return id;
}

// Đọc lại toàn bộ ô vào cmsDangSua trước mỗi thao tác vẽ lại, để không mất chữ đang gõ.
function docCmsTuForm() {
  const d = cmsDangSua;
  document.querySelectorAll('[data-cms-term]').forEach((el) => { d.terms[el.dataset.cmsTerm] = el.value; });
  d.brand = document.getElementById('cms-brand').value;
  document.querySelectorAll('[data-f]').forEach((el) => {
    const f = d.fields[Number(el.dataset.i)];
    if (!f) return;
    const k = el.dataset.f;
    if (k === 'onDevice' || k === 'inList') f[k] = el.checked;
    else if (k === 'options') f.options = el.value.split('\n').map((x) => x.trim()).filter(Boolean);
    else if (k === 'i18n') { f.labelI18n = f.labelI18n || {}; f.labelI18n[el.dataset.lang] = el.value.trim(); }
    else f[k] = el.value;
  });
  document.querySelectorAll('[data-st]').forEach((el) => { d.statuses[Number(el.dataset.i)][el.dataset.st] = el.value; });
}

document.addEventListener('click', async (ev) => {
  const t = ev.target;
  if (!cmsDangSua || !t.closest || !t.closest('#cms-settings-panel')) return;
  if (t.dataset.cmsMau) {
    docCmsTuForm();
    // Mẫu là một bộ cài đặt đầy đủ (tên gọi + trạng thái + ô số liệu); tên logo giữ nguyên.
    const m = cmsDangSua.mau[t.dataset.cmsMau] || {};
    if (m.terms) cmsDangSua.terms = { ...m.terms };
    if (m.statuses) cmsDangSua.statuses = m.statuses.map((x) => ({ ...x }));
    if (Array.isArray(m.fields)) cmsDangSua.fields = structuredClone(m.fields);
    veCmsSettings();
  } else if (t.id === 'cms-field-add') {
    docCmsTuForm();
    cmsDangSua.fields = cmsDangSua.fields || [];
    cmsDangSua.fields.push({ _moi: true, id: '', label: '', type: 'text', onDevice: true, inList: false });
    veCmsSettings();
    const i = cmsDangSua.fields.length - 1;
    document.getElementById(`cms-f-label-${i}`)?.focus();
  } else if (t.dataset.fLen !== undefined || t.dataset.fXuong !== undefined) {
    docCmsTuForm();
    const i = Number(t.dataset.fLen ?? t.dataset.fXuong);
    const j = t.dataset.fLen !== undefined ? i - 1 : i + 1;
    const ds = cmsDangSua.fields;
    if (j >= 0 && j < ds.length) [ds[i], ds[j]] = [ds[j], ds[i]];
    veCmsSettings();
  } else if (t.dataset.fXoa !== undefined) {
    docCmsTuForm();
    cmsDangSua.fields.splice(Number(t.dataset.fXoa), 1);
    veCmsSettings();
  } else if (t.id === 'cms-status-add') {
    docCmsTuForm();
    cmsDangSua.statuses.push({ id: '', label: '', color: 'gray' });
    veCmsSettings();
  } else if (t.dataset.stXoa !== undefined) {
    docCmsTuForm();
    cmsDangSua.statuses.splice(Number(t.dataset.stXoa), 1);
    veCmsSettings();
  } else if (t.id === 'cms-save') {
    docCmsTuForm();
    const { terms, statuses, brand } = cmsDangSua;
    const daCo = new Set((cmsDangSua.fields || []).filter((f) => !f._moi).map((f) => f.id));
    const fields = (cmsDangSua.fields || []).map((f) => {
      const { _moi, ...rest } = f;
      if (_moi) { rest.id = maTruongTuTen(f.label, daCo); daCo.add(rest.id); }
      return rest;
    });
    t.disabled = true;
    try {
      const res = await cmsFetch({ method: 'PUT', body: JSON.stringify({ terms, statuses, fields, brand }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast('error', data.error || 'Không lưu được cài đặt'); return; }
      cmsDangSua = { ...cmsDangSua, ...data };
      veCmsSettings();
      toast('success', data.capNhat
        ? `Đã lưu. Đã cập nhật bảng Thông số của ${data.capNhat} ${cmsDangSua.terms.muc || 'nội dung'} — máy khách nhận ở lần đồng bộ tới`
        : 'Đã lưu cài đặt');
      if (window.CMS) CMS.apDung(data); // tự tải lại trang nếu tên gọi đổi
    } catch (err) {
      if (err.message !== 'het phien') toast('error', 'Không thể kết nối tới server');
    } finally {
      t.disabled = false;
    }
  }
});

document.addEventListener('change', (ev) => {
  // Đổi kiểu trường → vẽ lại dòng đó (hiện/ẩn ô Đơn vị, ô Các lựa chọn).
  if (cmsDangSua && ev.target && ev.target.dataset && ev.target.dataset.f === 'type') {
    docCmsTuForm();
    veCmsSettings();
    document.getElementById(ev.target.id)?.focus();
  }
});

loadCmsSettings();
