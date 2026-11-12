// Từ điển thuật ngữ cho MỌI trang CMS (admin.html, users.html, login.html).
//
// Chữ giao diện không viết cứng "hiện vật"/"khu vực" nữa mà viết mã {muc}/{nhom}
// ({Muc}/{Nhom} = viết hoa chữ đầu). File này thay mã bằng tên Chủ hệ thống đã cài
// (cmsSettings.js phía máy chủ) — cả trong HTML tĩnh lẫn phần tử JS vẽ ra sau.
//
// CHỈ thay trong text node và vài thuộc tính hiển thị, KHÔNG đụng .value của ô nhập:
// dữ liệu người dùng gõ vào không bao giờ bị đổi chữ.
//
// ⚠ Nạp file này TRƯỚC admin.js / users.js / login.js (đồng bộ, không defer).
(function () {
  // Phải khớp MAC_DINH trong cmsSettings.js (máy chủ) — dùng khi chưa tải được cài đặt.
  const MAC_DINH = {
    terms: {
      donVi: 'đơn vị', nhom: 'khu vực', muc: 'nội dung',
      thietBi: 'thiết bị thuyết minh', khach: 'khách', thuyetMinh: 'thuyết minh',
    },
    statuses: [],
    fields: [],
    brand: 'Thuyết minh',
  };
  // Khóa '-v2': bản cũ lưu tên gọi nhà đất trong máy — đổi khóa để không nháy chữ cũ.
  const LS_KEY = 'beacon_cms_settings_v2';

  let cfg = MAC_DINH;
  try {
    const luu = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (luu && luu.terms) cfg = luu; // vẽ ngay bằng bản lần trước, khỏi nháy chữ
  } catch { /* localStorage bị chặn: dùng mặc định */ }

  const hoa = (s) => (s ? s.charAt(0).toLocaleUpperCase('vi') + s.slice(1) : s);
  let bang = {};
  function dungBang() {
    bang = {};
    for (const [k, v] of Object.entries(cfg.terms || {})) {
      bang[k] = v;
      bang[hoa(k)] = hoa(v);
      bang[k.toUpperCase()] = v.toLocaleUpperCase('vi');
    }
    // Tên thương hiệu (thay "Beacon"): {thuongHieu} giữ nguyên hoa thường, {thuongHieuChu} = chữ đầu cho logo.
    const brand = cfg.brand || MAC_DINH.brand;
    bang.thuongHieu = brand;
    bang.THUONGHIEU = brand.toLocaleUpperCase('vi');
    bang.thuongHieuChu = brand.charAt(0).toLocaleUpperCase('vi');
  }
  dungBang();

  const TOKEN_RE = /\{([A-Za-z]+)\}/g;
  function tt(s) {
    if (typeof s !== 'string' || s.indexOf('{') === -1) return s;
    return s.replace(TOKEN_RE, (m, k) => (k in bang ? bang[k] : m));
  }

  // Câu lỗi do MÁY CHỦ trả về vẫn viết bằng từ cũ (routes/*.js) — đổi sang tên đã cài
  // trước khi hiện. Chỉ dùng cho thông báo hệ thống, không dùng cho dữ liệu.
  const CU = [
    ['máy tham quan', 'thietBi'], ['khách tham quan', 'khach'], ['bảo tàng', 'donVi'],
    ['khu vực', 'nhom'], ['hiện vật', 'muc'], ['thuyết minh', 'thuyetMinh'],
  ];
  // MỘT lượt thay bằng regex: thay lần lượt từng cụm thì chữ vừa thay có thể bị thay
  // tiếp (VD "máy tham quan" → "thiết bị thuyết minh" → "thiết bị giới thiệu").
  const CU_RE = new RegExp(CU.map(([cu]) => `${cu}|${hoa(cu)}`).join('|'), 'g');
  function ttCu(s) {
    if (typeof s !== 'string') return s;
    return s.replace(CU_RE, (m) => {
      const found = CU.find(([cu]) => cu === m || hoa(cu) === m);
      if (!found) return m;
      const k = found[1];
      return m === found[0] ? bang[k] : bang[hoa(k)];
    });
  }

  const ATTRS = ['placeholder', 'title', 'aria-label', 'data-tip', 'data-confirm', 'alt'];
  function dichNut(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      if (root.nodeValue.indexOf('{') !== -1) {
        const v = tt(root.nodeValue);
        if (v !== root.nodeValue) root.nodeValue = v;
      }
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) dichThuocTinh(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) {
        if (n.nodeValue.indexOf('{') !== -1) {
          const p = n.parentNode;
          if (p && (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE' || p.nodeName === 'TEXTAREA')) continue;
          const v = tt(n.nodeValue);
          if (v !== n.nodeValue) n.nodeValue = v;
        }
      } else {
        dichThuocTinh(n);
      }
    }
  }
  function dichThuocTinh(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && v.indexOf('{') !== -1) {
        const m = tt(v);
        if (m !== v) el.setAttribute(a, m);
      }
    }
  }

  let quanSat = null;
  function batQuanSat() {
    if (quanSat) return;
    quanSat = new MutationObserver((ds) => {
      for (const d of ds) {
        if (d.type === 'childList') d.addedNodes.forEach(dichNut);
        else if (d.type === 'characterData') dichNut(d.target);
        else if (d.type === 'attributes') dichThuocTinh(d.target);
      }
    });
    quanSat.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS,
    });
  }

  function apDung(moi) {
    if (!moi || !moi.terms) return;
    const doiTen = JSON.stringify(moi.terms) !== JSON.stringify(cfg.terms) || (moi.brand || '') !== (cfg.brand || '');
    cfg = moi;
    dungBang();
    try { localStorage.setItem(LS_KEY, JSON.stringify(moi)); } catch { /* bỏ qua */ }
    // Tên vừa đổi so với bản lưu trong máy: mã đã bị thay mất trong DOM, cách duy nhất
    // vẽ lại đúng là tải lại trang (chỉ xảy ra một lần sau khi Chủ đổi cài đặt).
    if (doiTen && document.readyState !== 'loading' && window.__thuatNguDaVe) location.reload();
    document.dispatchEvent(new CustomEvent('cms-settings', { detail: moi }));
  }

  // Dịch phần tĩnh ngay khi DOM sẵn sàng, trước khi script trang chạy xong.
  function ve() {
    dichNut(document.documentElement);
    if (document.title) document.title = tt(document.title);
    batQuanSat();
    window.__thuatNguDaVe = true;
  }
  if (document.body) ve(); // thẻ script đặt cuối <body>: DOM đã có sẵn
  else document.addEventListener('DOMContentLoaded', ve);

  fetch('/api/v1/site').then((r) => (r.ok ? r.json() : null)).then(apDung).catch(() => {});

  const statusById = (id) => (cfg.statuses || []).find((s) => s.id === id) || null;
  const soVN = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('vi-VN'));

  window.CMS = {
    tt, ttCu,
    get settings() { return cfg; },
    term: (k) => bang[k] || k,
    statusById,
    soVN,
    // Cập nhật ngay sau khi Chủ lưu cài đặt (users.js gọi).
    apDung,
  };
  window.tt = tt;

  // Hộp thoại gốc của trình duyệt không đi qua DOM nên MutationObserver không thấy.
  for (const ten of ['alert', 'confirm', 'prompt']) {
    const goc = window[ten];
    window[ten] = function (msg, ...rest) { return goc.call(window, tt(msg), ...rest); };
  }
})();
