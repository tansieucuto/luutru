// Nút "?" giải thích — dùng chung cho admin.html và users.html.
//
// Các dòng chữ nhỏ giải thích chức năng (dưới tiêu đề khung, dòng phụ của ô Vận hành)
// được ẩn đi và thay bằng một nút "?" cạnh tiêu đề. Rê chuột hoặc bấm vào thì hiện
// popup; bấm ra ngoài / Esc thì đóng. Phần tử gốc VẪN nằm trong DOM (chỉ bị ẩn), nên
// code nào đang ghi vào nó (vd ops-sub do admin.js điền) vẫn chạy như cũ — popup
// luôn đọc nội dung mới nhất lúc mở.
//
// KHÔNG áp cho gợi ý nằm cạnh ô nhập trong biểu mẫu: người nhập cần thấy ngay lúc gõ.
// Muốn một dòng giải thích KHÔNG bị thu vào "?": thêm thuộc tính data-giu-hien.
(function () {
  // [chọn dòng giải thích, tìm chỗ đặt nút "?" tính từ dòng đó]
  const QUY_TAC = [
    // Dòng giải thích đứng ngay sau đầu khung: <div class="panel-head">…</div><div class="form-hint">
    ['.panel-head + .form-hint', (el) => el.previousElementSibling.querySelector('.panel-title')],
    // Dòng giải thích nằm dưới tiêu đề, bên trong đầu khung
    ['.panel-head .panel-title + .form-hint', (el) => el.previousElementSibling],
    // Dòng phụ của các ô Sao lưu / Ổ đĩa / Thiết bị / Phát hành trên Trang chủ
    ['.ops-card .ops-sub', (el) => el.closest('.ops-card').querySelector('.ops-head')],
  ];

  let popup = null;
  let nutDangMo = null;
  let ghim = false;      // mở bằng bấm → giữ tới khi bấm ra ngoài
  let henDong = null;

  function taoPopup() {
    popup = document.createElement('div');
    popup.className = 'ht-popup';
    popup.setAttribute('role', 'tooltip');
    popup.id = 'ht-popup';
    popup.hidden = true;
    popup.addEventListener('mouseenter', () => clearTimeout(henDong));
    popup.addEventListener('mouseleave', () => { if (!ghim) hen(); });
    document.body.appendChild(popup);
  }

  function mo(nut, doBam) {
    if (!popup) taoPopup();
    clearTimeout(henDong);
    if (nutDangMo && nutDangMo !== nut) nutDangMo.setAttribute('aria-expanded', 'false');
    nutDangMo = nut;
    ghim = doBam || (ghim && nutDangMo === nut);
    // Chép NÚT con (không dùng innerHTML): nguồn là markup của chính trang hoặc chữ
    // do admin.js gán bằng textContent, nên không đưa thêm gì nguy hiểm vào.
    const nguon = nut._htNguon;
    popup.replaceChildren(...Array.from(nguon.cloneNode(true).childNodes));
    popup.hidden = false;
    nut.setAttribute('aria-expanded', 'true');
    datViTri(nut);
  }

  function dong() {
    clearTimeout(henDong);
    if (popup) popup.hidden = true;
    if (nutDangMo) nutDangMo.setAttribute('aria-expanded', 'false');
    nutDangMo = null;
    ghim = false;
  }
  function hen() { clearTimeout(henDong); henDong = setTimeout(dong, 180); }

  function datViTri(nut) {
    const r = nut.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 16);
    popup.style.width = `${w}px`;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    popup.style.left = `${left + window.scrollX}px`;
    const h = popup.offsetHeight;
    // Ưu tiên hiện bên dưới; sát đáy màn hình thì lật lên trên.
    const duoi = r.bottom + 8;
    const top = duoi + h > window.innerHeight - 8 && r.top - h - 8 > 8 ? r.top - h - 8 : duoi;
    popup.style.top = `${top + window.scrollY}px`;
  }

  function capNhatNut(nut) {
    // Ô Vận hành có lúc không có dòng phụ: khi đó không hiện "?".
    nut.hidden = !nut._htNguon.textContent.trim();
  }

  function gan(el, cho) {
    if (!el || el.dataset.htDaGan || el.hasAttribute('data-giu-hien') || !cho) return;
    el.dataset.htDaGan = '1';
    el.hidden = true;
    const nut = document.createElement('button');
    nut.type = 'button';
    nut.className = 'ht-btn';
    nut.textContent = '?';
    nut.setAttribute('aria-label', 'Giải thích');
    nut.setAttribute('aria-expanded', 'false');
    nut.setAttribute('aria-describedby', 'ht-popup');
    nut._htNguon = el;
    nut.addEventListener('mouseenter', () => mo(nut, false));
    nut.addEventListener('mouseleave', () => { if (!ghim) hen(); });
    nut.addEventListener('focus', () => mo(nut, false));
    nut.addEventListener('blur', () => { if (!ghim) hen(); });
    nut.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ghim && nutDangMo === nut) dong(); else mo(nut, true);
    });
    cho.appendChild(nut);
    capNhatNut(nut);
    // Theo dõi chữ trong nguồn (admin.js điền ops-sub sau khi tải số liệu).
    new MutationObserver(() => {
      capNhatNut(nut);
      if (nutDangMo === nut) mo(nut, ghim);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  }

  function quet(root) {
    if (!root || !root.querySelectorAll) return;
    for (const [sel, tim] of QUY_TAC) {
      const ds = root.matches && root.matches(sel) ? [root] : [];
      ds.push(...root.querySelectorAll(sel));
      for (const el of ds) { try { gan(el, tim(el)); } catch { /* cấu trúc lạ: bỏ qua */ } }
    }
  }

  document.addEventListener('click', (e) => {
    if (popup && !popup.hidden && !popup.contains(e.target)) dong();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popup && !popup.hidden) { dong(); e.stopPropagation(); }
  }, true);
  window.addEventListener('resize', () => { if (nutDangMo) datViTri(nutDangMo); });
  window.addEventListener('scroll', () => { if (nutDangMo) datViTri(nutDangMo); }, true);

  function batDau() {
    quet(document.body);
    // Khung vẽ bằng JS về sau cũng được gắn "?".
    new MutationObserver((ds) => {
      for (const d of ds) d.addedNodes.forEach((n) => { if (n.nodeType === 1) quet(n); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) batDau(); else document.addEventListener('DOMContentLoaded', batDau);
})();
