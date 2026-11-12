// Khung "Ảnh chào mừng" ở tab Giao diện ứng dụng — màn hình đầu tiên khi mở app.
// Gọi GET/POST /api/v1/admin/content/welcome-images (routes/adminContent.js).
(function () {
  const API = '/api/v1/admin/content/welcome-images';
  const view = document.getElementById('view-ui-strings');
  if (!view) return;
  const token = () => sessionStorage.getItem('beacon_admin_token');

  const box = document.createElement('section');
  box.className = 'card panel';
  box.style.marginBottom = '20px';
  box.innerHTML = `
    <div class="panel-head"><div>
      <div class="panel-title">Ảnh chào mừng</div>
      <div class="form-hint" data-giu-hien style="padding-top:3px;">Màn hình đầu tiên khi khách mở app. Bắt buộc phải có — thiếu ảnh thì máy khách không đồng bộ được. Nên dùng ảnh ngang 16:9, dưới 500 KB.</div>
    </div></div>
    <div class="acm-grid">
      <div class="acm-o">
        <label for="acm-main">Ảnh chính</label>
        <div class="acm-xem" id="acm-xem-main">Đang tải…</div>
        <input type="file" id="acm-main" class="form-control" accept="image/*">
      </div>
      <div class="acm-o">
        <label for="acm-accent">Ảnh phụ <span class="form-hint">(bỏ trống = dùng ảnh chính)</span></label>
        <div class="acm-xem" id="acm-xem-accent">Đang tải…</div>
        <input type="file" id="acm-accent" class="form-control" accept="image/*">
      </div>
    </div>
    <div style="margin-top:12px;"><button type="button" class="btn btn-primary" id="acm-luu">Lưu ảnh chào mừng</button>
      <span class="form-hint" id="acm-tb" style="margin-left:10px;"></span></div>`;
  view.insertBefore(box, view.firstChild);

  const st = document.createElement('style');
  st.textContent = `
    .acm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    .acm-o label { display: block; margin-bottom: 6px; font-weight: 500; }
    .acm-xem { aspect-ratio: 16 / 9; border: 1px dashed var(--border); border-radius: var(--r, 8px); margin-bottom: 8px;
      display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 13px; overflow: hidden; background: var(--bg); }
    .acm-xem img { width: 100%; height: 100%; object-fit: cover; }
    .acm-thieu { color: var(--red2); font-weight: 600; }`;
  document.head.appendChild(st);

  const xem = (id, url, coFile) => {
    const el = document.getElementById(id);
    el.innerHTML = coFile && url
      ? `<img alt="" src="/content-media/${url}?t=${Date.now()}">`
      : '<span class="acm-thieu">Chưa có ảnh — máy khách sẽ không đồng bộ được</span>';
  };

  async function tai() {
    try {
      const r = await fetch(API, { headers: { Authorization: `Bearer ${token()}` } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Không tải được');
      xem('acm-xem-main', d.main, d.mainExists);
      xem('acm-xem-accent', d.accent, d.accentExists);
    } catch (e) {
      document.getElementById('acm-tb').textContent = e.message;
    }
  }

  ['main', 'accent'].forEach((k) => {
    document.getElementById(`acm-${k}`).addEventListener('change', (ev) => {
      const f = ev.target.files[0];
      if (f) document.getElementById(`acm-xem-${k}`).innerHTML = `<img alt="" src="${URL.createObjectURL(f)}">`;
    });
  });

  document.getElementById('acm-luu').addEventListener('click', async (ev) => {
    const tb = document.getElementById('acm-tb');
    const fd = new FormData();
    const main = document.getElementById('acm-main').files[0];
    const accent = document.getElementById('acm-accent').files[0];
    if (!main && !accent) { tb.textContent = 'Chọn ít nhất một ảnh.'; return; }
    if (main) fd.append('main', main);
    if (accent) fd.append('accent', accent);
    ev.target.disabled = true;
    tb.textContent = 'Đang tải lên…';
    try {
      const r = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Lỗi ${r.status}`);
      tb.textContent = 'Đã lưu. Máy khách sẽ nhận ở lần đồng bộ tới.';
      document.getElementById('acm-main').value = '';
      document.getElementById('acm-accent').value = '';
      tai();
    } catch (e) {
      tb.textContent = e.message;
    } finally {
      ev.target.disabled = false;
    }
  });

  tai();
})();
