// Hai khung trong tab "Giao diện ứng dụng" cho những thứ app ĐỌC từ máy chủ nhưng trước đây
// CMS không có chỗ sửa (CLAUDE.md §5.34):
//   1. "Cài đặt app trên điện thoại" — âm thanh/loa, màn kết thúc + mã QR, góp ý, menu, tự đồng bộ
//      → GET/PUT /api/v1/admin/content/app-settings
//   2. "Chữ hiển thị trên app (bổ sung)" — 88 khóa chữ app dùng mà form "Chuỗi giao diện" chưa có
//      → GET/PUT /api/v1/admin/content/ui-strings (chỉ gửi đúng các khóa của khung này)
// Danh sách khóa + chữ mặc định chép từ beacon-client/lib/presentation/ui_strings.dart (bản 14/10/2026).
(function () {
  const BASE = '/api/v1/admin/content';
  const view = document.getElementById('view-ui-strings');
  if (!view) return;
  const token = () => sessionStorage.getItem('beacon_admin_token');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GIONG_CU = /bảo tàng|hiện vật|trưng bày|tham quan|chứng tích|lễ tân/i;
  const KHOA = [
 [
  "Màn đầu (khi mở app)",
  [
   [
    "poster.kicker",
    "Dòng chữ nhỏ phía trên tên đơn vị",
    "Bảo tàng"
   ],
   [
    "poster.enter",
    "Nút chính ở màn đầu",
    "Tham quan"
   ],
   [
    "poster.about",
    "Hàng \"Giới thiệu\" (chỉ hiện khi có bài giới thiệu)",
    "Giới thiệu bảo tàng"
   ],
   [
    "poster.faq",
    "Hàng \"Câu hỏi thường gặp\" (chỉ hiện khi có bài)",
    "Câu hỏi thường gặp"
   ]
  ]
 ],
 [
  "Màn Menu",
  [
   [
    "menu.title",
    "Tiêu đề lớn của màn Menu",
    "Chứng tích của một thời"
   ],
   [
    "menu.subtitle",
    "Dòng mô tả dưới tiêu đề Menu",
    "Bảy khu trưng bày theo trình tự của bảo tàng."
   ],
   [
    "menu.bar.title",
    "Tiêu đề thanh trên khi đang trong chuyến",
    "Tham quan"
   ],
   [
    "menu.hero.resume",
    "Nút tiếp tục chuyến đang dở",
    "Tiếp tục"
   ],
   [
    "menu.hero.progress",
    "Dòng tiến độ — giữ nguyên {zone} {done} {total}",
    "Đang ở khu {zone} · đã đi {done} trong {total} khu."
   ],
   [
    "menu.item.start",
    "Mục \"Bắt đầu\"",
    "Bắt đầu tham quan"
   ],
   [
    "menu.item.start.desc",
    "Mô tả mục \"Bắt đầu\"",
    "Ứng dụng tự nhận biết khu trưng bày quanh bạn và phát thuyết minh."
   ],
   [
    "menu.item.guide",
    "Mục \"Hướng dẫn sử dụng\"",
    "Hướng dẫn sử dụng"
   ],
   [
    "menu.item.guide.desc",
    "Mô tả mục \"Hướng dẫn sử dụng\"",
    "Cách đeo tai nghe, chỉnh âm lượng và đi tham quan."
   ],
   [
    "menu.item.catalog",
    "Mục Danh mục (app chưa có màn này)",
    "Danh mục hiện vật"
   ],
   [
    "menu.item.catalog.desc",
    "Mô tả mục Danh mục (app chưa có màn này)",
    "Xem toàn bộ khu trưng bày và hiện vật."
   ],
   [
    "menu.item.map",
    "Mục Sơ đồ (app chưa có màn này)",
    "Sơ đồ bảo tàng"
   ],
   [
    "menu.item.map.desc",
    "Mô tả mục Sơ đồ (app chưa có màn này)",
    "Xem vị trí các khu trưng bày."
   ],
   [
    "menu.item.tours",
    "Mục Chọn lộ trình (app chưa có màn này)",
    "Chọn tuyến tham quan"
   ],
   [
    "menu.item.tours.desc",
    "Mô tả mục Chọn lộ trình (app chưa có màn này)",
    "Các tuyến gợi ý theo thời gian bạn có."
   ],
   [
    "menu.topics.title",
    "Tiêu đề phần chủ đề (chỉ hiện khi có chủ đề)",
    "Tham quan theo chủ đề"
   ],
   [
    "menu.topic.meta",
    "Dòng phụ mỗi chủ đề — giữ nguyên {count} {floor} {minutes}",
    "{count} hiện vật · {floor} · {minutes} phút"
   ],
   [
    "menu.sheetTitle",
    "Tiêu đề ngăn kéo menu",
    "Menu"
   ],
   [
    "menu.open",
    "Nhãn đọc cho nút mở menu",
    "Mở menu"
   ],
   [
    "menu.close",
    "Nhãn đọc cho nút đóng menu",
    "Đóng menu"
   ],
   [
    "menu.back",
    "Nút quay lại",
    "Quay lại"
   ],
   [
    "coming.soon.title",
    "Tiêu đề khi mở phần chưa có",
    "Sắp có"
   ],
   [
    "coming.soon.body",
    "Nội dung khi mở phần chưa có",
    "Phần này đang được bảo tàng chuẩn bị. Bạn có thể quay lại sau."
   ]
  ]
 ],
 [
  "Thanh tab dưới cùng",
  [
   [
    "tab.home",
    "Tab trang chính",
    "Trang chính"
   ],
   [
    "tab.tour",
    "Tab chuyến đi",
    "Tham quan"
   ],
   [
    "tab.map",
    "Tab sơ đồ",
    "Sơ đồ"
   ],
   [
    "tab.foryou",
    "Tab gợi ý",
    "Gợi ý"
   ],
   [
    "tab.guide",
    "Tab hướng dẫn",
    "Hướng dẫn"
   ]
  ]
 ],
 [
  "Trang nội dung",
  [
   [
    "exhibit.prev",
    "Nút về nội dung trước",
    "Hiện vật trước"
   ],
   [
    "exhibit.image.open",
    "Nhãn mở ảnh lớn",
    "Xem ảnh lớn"
   ],
   [
    "exhibit.image.close",
    "Nhãn đóng ảnh lớn",
    "Đóng ảnh"
   ],
   [
    "exhibit.gallery.label",
    "Nhãn dải ảnh",
    "Dải ảnh hiện vật"
   ],
   [
    "exhibit.gallery.position",
    "Vị trí ảnh — giữ nguyên {i} {n}",
    "Ảnh {i} trên {n}"
   ],
   [
    "exhibitList.heardSemantics",
    "Đọc cho người khiếm thị khi đã nghe — giữ nguyên {name}",
    "{name}. Đã nghe"
   ]
  ]
 ],
 [
  "Trong chuyến đi",
  [
   [
    "tour.menuCta",
    "Nút Menu",
    "Menu"
   ],
   [
    "tour.endCta",
    "Nút Kết thúc",
    "Kết thúc"
   ],
   [
    "tour.complete.title",
    "Thông báo đi hết các khu — giữ nguyên {n}",
    "Bạn đã đi hết {n} khu trưng bày"
   ],
   [
    "tour.complete.body",
    "Nội dung thông báo đi hết các khu",
    "Bạn có thể xem lại chuyến đi, hoặc tiếp tục dạo thêm tuỳ thích."
   ],
   [
    "tour.complete.cta",
    "Nút xem tổng kết",
    "Xem tổng kết"
   ],
   [
    "tour.complete.dismiss",
    "Nút để sau",
    "Để sau"
   ],
   [
    "tour.bleLost.title",
    "Tiêu đề khi khách tắt Bluetooth",
    "Đã tắt Bluetooth"
   ],
   [
    "tour.bleLost.body",
    "Nội dung khi khách tắt Bluetooth",
    "Máy cần Bluetooth để biết bạn đang đứng trước hiện vật nào. Thuyết minh đã tạm dừng. Vui lòng bật lại Bluetooth — màn hình này sẽ tự tắt và chuyến tham quan tiếp tục."
   ],
   [
    "tour.bleBlocked.title",
    "Tiêu đề khi máy không dùng được Bluetooth",
    "Không dùng được Bluetooth"
   ],
   [
    "tour.bleBlocked.body",
    "Nội dung khi máy không dùng được Bluetooth",
    "Thuyết minh đã tạm dừng vì máy không truy cập được Bluetooth. Vui lòng mang máy tới quầy để nhân viên hỗ trợ."
   ],
   [
    "keepAlive.endButton",
    "Nút tắt trên thông báo chạy nền",
    "Kết thúc tham quan"
   ]
  ]
 ],
 [
  "Màn tổng kết",
  [
   [
    "summary.title",
    "Tiêu đề màn tổng kết",
    "Chuyến tham quan của bạn"
   ],
   [
    "summary.stat.zones",
    "Nhãn số khu đã ghé",
    "Khu đã ghé"
   ],
   [
    "summary.stat.exhibits",
    "Nhãn số nội dung đã nghe",
    "Hiện vật đã nghe"
   ],
   [
    "summary.stat.duration",
    "Nhãn thời gian",
    "Thời gian tham quan"
   ],
   [
    "summary.stat.semantics",
    "Đọc cho người khiếm thị — giữ nguyên {label} {value}",
    "{label}: {value}"
   ],
   [
    "summary.zonesMissed",
    "Số khu chưa ghé — giữ nguyên {n}",
    "{n} khu chưa ghé"
   ],
   [
    "summary.emptyTitle",
    "Tiêu đề khi chưa ghé khu nào",
    "Chuyến đi vừa mới bắt đầu"
   ],
   [
    "summary.emptyBody",
    "Nội dung khi chưa ghé khu nào",
    "Bạn chưa ghé khu trưng bày nào. Quay lại tham quan để bắt đầu, hoặc kết thúc nếu bạn cần rời đi."
   ],
   [
    "summary.closingFallback",
    "Lời cảm ơn dự phòng (khi chưa đặt lời cảm ơn ở khung Cài đặt app)",
    "Cảm ơn quý khách đã dành thời gian cho chúng tôi."
   ],
   [
    "summary.endCta",
    "Nút kết thúc chuyến",
    "Kết thúc chuyến đi"
   ],
   [
    "summary.qrTitle",
    "Tiêu đề phần mã QR",
    "Mang chuyến đi về nhà"
   ],
   [
    "summary.qrBody",
    "Mô tả phần mã QR",
    "Quét mã này để xem lại những hiện vật bạn đã nghe hôm nay."
   ]
  ]
 ],
 [
  "Góp ý",
  [
   [
    "feedback.question",
    "Câu hỏi dự phòng (khi chưa đặt câu hỏi ở khung Cài đặt app)",
    "Chuyến tham quan hôm nay thế nào?"
   ],
   [
    "feedback.thanks",
    "Lời cảm ơn sau khi gửi",
    "Cảm ơn bạn đã góp ý."
   ],
   [
    "feedback.tagsHint",
    "Gợi ý chọn lý do",
    "Điều gì khiến bạn thấy vậy? (có thể chọn nhiều)"
   ],
   [
    "feedback.submit",
    "Nút gửi",
    "Gửi góp ý"
   ],
   [
    "feedback.skip",
    "Nút bỏ qua",
    "Bỏ qua"
   ],
   [
    "feedback.starSemantics",
    "Đọc số sao — giữ nguyên {i} {n}",
    "{i} trên {n} sao"
   ],
   [
    "feedback.npsSemantics",
    "Đọc điểm — giữ nguyên {i}",
    "Chấm {i} điểm"
   ],
   [
    "feedback.emoji.bad",
    "Mặt cười: chưa hài lòng",
    "Chưa hài lòng"
   ],
   [
    "feedback.emoji.ok",
    "Mặt cười: bình thường",
    "Bình thường"
   ],
   [
    "feedback.emoji.good",
    "Mặt cười: rất hài lòng",
    "Rất hài lòng"
   ]
  ]
 ],
 [
  "Màn cảm ơn cuối cùng",
  [
   [
    "farewell.kicker",
    "Dòng nhỏ phía trên",
    "Cảm ơn"
   ],
   [
    "farewell.title",
    "Dòng lớn",
    "quý khách"
   ],
   [
    "farewell.body",
    "Nội dung",
    "Chuyến tham quan đã kết thúc. Xin vui lòng gửi lại thiết bị tại quầy lễ tân. Chúc quý khách một ngày tốt lành."
   ],
   [
    "farewell.cta",
    "Nút xong",
    "Xong"
   ]
  ]
 ],
 [
  "Hướng dẫn sử dụng (dự phòng khi chưa có nội dung hướng dẫn)",
  [
   [
    "guide.title",
    "Tiêu đề màn hướng dẫn",
    "Hướng dẫn sử dụng"
   ],
   [
    "guide.default.headphones.title",
    "Bước 1 — tiêu đề",
    "Đeo tai nghe"
   ],
   [
    "guide.default.headphones.body",
    "Bước 1 — nội dung",
    "Thuyết minh chỉ phát khi có tai nghe, để không làm phiền khách bên cạnh. Chỉnh âm lượng bằng phím cạnh máy."
   ],
   [
    "guide.default.walk.title",
    "Bước 2 — tiêu đề",
    "Cứ đi tự nhiên"
   ],
   [
    "guide.default.walk.body",
    "Bước 2 — nội dung",
    "Máy tự nhận ra bạn đang ở khu nào và bắt đầu kể. Bạn không cần bấm gì. Muốn nghe lại một hiện vật, chạm vào ảnh của hiện vật đó."
   ],
   [
    "guide.default.help.title",
    "Bước 3 — tiêu đề",
    "Khi cần trợ giúp"
   ],
   [
    "guide.default.help.body",
    "Bước 3 — nội dung",
    "Không nghe thấy gì? Kiểm tra tai nghe đã cắm chặt chưa và thử bước hẳn vào giữa khu trưng bày. Nếu vẫn không được, mang máy tới quầy."
   ]
  ]
 ],
 [
  "Cài đặt máy (nhân viên xem)",
  [
   [
    "settings.deviceHeader",
    "Tiêu đề nhóm thiết lập máy",
    "Thiết lập máy"
   ],
   [
    "settings.battery.checking",
    "Đang kiểm tra pin",
    "Đang kiểm tra tối ưu hoá pin…"
   ],
   [
    "settings.battery.ok",
    "Đã tắt tối ưu pin",
    "Đã tắt tối ưu hoá pin cho ứng dụng"
   ],
   [
    "settings.battery.needed",
    "Cần tắt tối ưu pin",
    "Cần tắt tối ưu hoá pin cho ứng dụng"
   ],
   [
    "settings.battery.desc",
    "Giải thích về tối ưu pin",
    "Không tắt, hệ điều hành có thể đóng băng ứng dụng khi màn hình tắt và khách sẽ không nghe thuyết minh khi bước vào khu. Trên máy Xiaomi cần bật thêm \"Tự khởi động\" và đặt Tiết kiệm pin thành \"Không hạn chế\"."
   ],
   [
    "settings.battery.action",
    "Nút tắt tối ưu pin",
    "Tắt tối ưu hoá pin"
   ]
  ]
 ]
];

  async function api(path, opts = {}) {
    const r = await fetch(BASE + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), Authorization: `Bearer ${token()}` },
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { location.href = 'login.html'; throw new Error('Phiên đăng nhập đã hết'); }
    if (!r.ok) throw new Error(d.error || `Lỗi ${r.status}`);
    return d;
  }
  const tenNN = (cfg, l) => (cfg.languageNames && cfg.languageNames[l]) || l;

  const st = document.createElement('style');
  st.textContent = `
    .cda { margin-bottom: 20px; }
    .cda fieldset { border: 1px solid var(--border); border-radius: var(--r, 8px); padding: 12px 16px 6px; margin: 0 0 14px; }
    .cda legend { font-weight: 600; padding: 0 6px; font-size: 14.5px; }
    .cda-chk { display: flex; gap: 10px; align-items: flex-start; margin: 4px 0 10px; cursor: pointer; }
    .cda-chk input { width: 17px; height: 17px; margin-top: 2px; accent-color: var(--gold); flex-shrink: 0; }
    .cda-chk b { font-weight: 600; }
    .cda-chk small { display: block; color: var(--muted); font-size: 12.5px; margin-top: 2px; }
    .cda-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px 16px; }
    .cda-grid .form-group { margin-bottom: 4px; }
    .cda-tag { display: grid; grid-template-columns: 150px 1fr auto; gap: 8px; align-items: start; margin-bottom: 8px; }
    .cda-tag .mono { font-size: 12.5px; }
    .cda-foot { display: flex; align-items: center; gap: 12px; margin-top: 6px; flex-wrap: wrap; }
    .cda-group { border: 1px solid var(--border); border-radius: var(--r, 8px); margin-bottom: 10px; }
    .cda-group > summary { cursor: pointer; padding: 10px 14px; font-weight: 600; }
    .cda-group > div { padding: 0 14px 6px; }
    .cda-row { padding: 10px 0; border-top: 1px solid var(--border); }
    .cda-row-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; margin-bottom: 6px; }
    .cda-row-head .mono { font-size: 11.5px; color: var(--muted); }
    .cda-cu { font-size: 11.5px; font-weight: 600; color: #8a4b00; background: #fbecc8; border-radius: 4px; padding: 1px 6px; }
    .cda-lang { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
    .cda-lang .mono { width: 26px; font-size: 12px; color: var(--accent-text); flex-shrink: 0; }
    .cda-loc { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; margin: 4px 0 12px; font-size: 13.5px; }
    .cda-them-row { display: grid; grid-template-columns: 1fr 2fr; gap: 8px; margin-top: 6px; }
    @media (max-width: 640px) { .cda-tag, .cda-them-row { grid-template-columns: 1fr; } }`;
  document.head.appendChild(st);

  /* ===================== 1. CÀI ĐẶT APP ===================== */
  const p1 = document.createElement('section');
  p1.className = 'card panel cda';
  p1.innerHTML = `
    <div class="panel-head"><div>
      <div class="panel-title">Cài đặt app trên điện thoại</div>
      <div class="form-hint" data-giu-hien style="padding-top:3px;">Những thiết lập app đọc từ máy chủ nhưng trước đây phải sửa tay trong file. Lưu xong, máy khách nhận ở lần đồng bộ tới (sau khi đồng bộ nhớ khởi động lại app).</div>
    </div></div>
    <div id="cda-app-body">Đang tải…</div>
    <div class="cda-foot"><button type="button" class="btn btn-primary" id="cda-app-luu">Lưu cài đặt app</button><span class="form-hint" id="cda-app-tb"></span></div>`;

  /* ===================== 2. CHỮ BỔ SUNG ===================== */
  const p2 = document.createElement('section');
  p2.className = 'card panel cda';
  p2.innerHTML = `
    <div class="panel-head"><div>
      <div class="panel-title">Chữ hiển thị trên app (bổ sung)</div>
      <div class="form-hint" data-giu-hien style="padding-top:3px;">Các dòng chữ app dùng nhưng form "Chuỗi giao diện" bên dưới chưa có. Ô để trống thì app dùng chữ mặc định có sẵn (chữ mờ trong ô) — nhiều chữ mặc định mang giọng bảo tàng, ô nào còn giọng đó được đánh dấu. Giữ nguyên các chữ trong ngoặc nhọn như {count}, {n}.</div>
    </div></div>
    <div class="cda-loc">
      <label class="cda-chk" style="margin:0;"><input type="checkbox" id="cda-chi-cu"><span>Chỉ hiện ô còn giọng bảo tàng</span></label>
      <span id="cda-dem" class="form-hint"></span>
    </div>
    <div id="cda-chu-body">Đang tải…</div>
    <details class="cda-group" id="cda-them">
      <summary>Thêm khóa khác (khi bản app mới có chữ chưa nằm trong danh sách)</summary>
      <div><div class="form-hint" style="margin:4px 0;">Nhập đúng tên khóa (VD: <span class="mono">poster.kicker</span>) và chữ muốn hiện, ngôn ngữ mặc định.</div>
        <div id="cda-them-ds"></div>
        <button type="button" class="btn btn-ghost btn-tiny" id="cda-them-dong" style="margin:6px 0 8px;">+ Thêm dòng</button></div>
    </details>
    <div class="cda-foot"><button type="button" class="btn btn-primary" id="cda-chu-luu">Lưu chữ hiển thị</button><span class="form-hint" id="cda-chu-tb"></span></div>`;

  // Đặt ngay dưới khung "Ảnh chào mừng" nếu có, không thì lên đầu tab.
  const acm = view.querySelector('#acm-luu');
  const moc = acm ? acm.closest('section') : null;
  if (moc && moc.nextSibling) { view.insertBefore(p2, moc.nextSibling); view.insertBefore(p1, p2); } else { view.insertBefore(p2, view.firstChild); view.insertBefore(p1, p2); }

  let app = null;      // dữ liệu GET /app-settings
  let tags = [];       // [{id, label:{lang:..}, moi}]

  function maTuTen(ten, daCo) {
    let goc = String(ten || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
      .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'ly_do';
    let id = goc; let k = 2;
    while (daCo.has(id)) id = `${goc}_${k++}`;
    return id;
  }

  function oDaNgu(prefix, obj, multi) {
    return app.languages.map((l) => `
      <div class="form-group"><label for="${prefix}-${l}">${esc(tenNN(app, l))}${l === app.fallbackLanguage ? ' (mặc định)' : ''}</label>
        ${multi
          ? `<textarea class="form-control" rows="2" id="${prefix}-${l}" data-lang="${esc(l)}">${esc(obj?.[l] || '')}</textarea>`
          : `<input class="form-control" id="${prefix}-${l}" data-lang="${esc(l)}" value="${esc(obj?.[l] || '')}">`}
      </div>`).join('');
  }
  const docDaNgu = (prefix) => {
    const o = {};
    app.languages.forEach((l) => { const el = document.getElementById(`${prefix}-${l}`); if (el && el.value.trim()) o[l] = el.value.trim(); });
    return o;
  };

  function veTags() {
    const box = document.getElementById('cda-tags');
    box.innerHTML = tags.length ? tags.map((t, i) => `
      <div class="cda-tag" data-ti="${i}">
        <div><input class="form-control mono" value="${esc(t.moi ? 'tự đặt khi lưu' : t.id)}" disabled title="Mã lý do — không đổi sau khi đã lưu"></div>
        <div>${app.languages.map((l) => `<div class="cda-lang"><span class="mono">${esc(l)}</span>
          <input class="form-control" data-tag-i="${i}" data-lang="${esc(l)}" value="${esc(t.label?.[l] || '')}" placeholder="${l === app.fallbackLanguage ? 'Tên lý do' : '(tuỳ chọn)'}"></div>`).join('')}</div>
        <button type="button" class="btn btn-ghost btn-tiny" data-tag-xoa="${i}" aria-label="Bỏ lý do này">✕</button>
      </div>`).join('') : '<div class="form-hint">Chưa có lý do nào — khách chỉ chấm điểm.</div>';
    document.getElementById('cda-tag-them').disabled = tags.length >= 8;
  }
  function docTags() {
    document.querySelectorAll('[data-tag-i]').forEach((el) => {
      const t = tags[Number(el.dataset.tagI)];
      if (!t) return;
      t.label = t.label || {};
      t.label[el.dataset.lang] = el.value;
    });
  }

  function veApp() {
    const p = app.policies || { allowLoudspeaker: false, autoplayRequiresHeadphones: true, revisitPlaysWelcome: false };
    const s = app.summary || {};
    const f = app.feedback || {};
    const guideOn = !(app.menu && Array.isArray(app.menu.entries) && app.menu.entries.some((e) => e && e.id === 'guide' && e.enabled === false));
    const chk = (id, on, tieuDe, giai) => `<label class="cda-chk"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span><b>${tieuDe}</b><small>${giai}</small></span></label>`;
    document.getElementById('cda-app-body').innerHTML = `
      <fieldset><legend>Âm thanh</legend>
        ${chk('cda-loa', p.allowLoudspeaker, 'Cho phát qua loa ngoài khi không cắm tai nghe', 'Tắt: máy không có tai nghe sẽ KHÔNG phát tiếng nào, kể cả khi khách bấm — chỉ hiện chữ. Demo bằng loa điện thoại thì phải bật.')}
        ${chk('cda-tainghe', p.autoplayRequiresHeadphones, 'Chỉ tự phát khi có cắm tai nghe', 'Bật: không tai nghe thì đến khu mới app không tự đọc, khách phải tự bấm Phát.')}
        ${chk('cda-nghelai', p.revisitPlaysWelcome, 'Quay lại khu đã ghé thì thuyết minh lại', 'Tắt: quay lại khu cũ chỉ kêu một tiếng chuông, khách tự bấm nếu muốn nghe lại.')}
      </fieldset>
      <fieldset><legend>Màn kết thúc chuyến</legend>
        <div class="cda-grid">${oDaNgu('cda-camon', s.closing, true)}</div>
        <div class="form-hint" style="margin:-2px 0 8px;">Lời cảm ơn hiện ở màn tổng kết. Để trống thì app dùng câu dự phòng.</div>
        ${chk('cda-gopy-hien', s.showFeedback !== false, 'Hiện phần góp ý (chấm điểm)', 'Khách chấm điểm và chọn lý do ở cuối chuyến.')}
        ${chk('cda-qr', s.showQr === true, 'Hiện mã QR', 'Mã QR để khách mở lại nội dung trên điện thoại của họ. Chỉ bật khi đã có trang web nhận link.')}
        <div class="form-group"><label for="cda-qr-link">Link cho mã QR (http:// hoặc https://)</label>
          <input class="form-control" id="cda-qr-link" value="${esc(s.qrBaseUrl || '')}" placeholder="https://..."></div>
      </fieldset>
      <fieldset><legend>Góp ý</legend>
        <div class="form-group" style="max-width:320px;"><label for="cda-thang">Kiểu chấm điểm</label>
          <select class="form-control" id="cda-thang">
            ${[['stars5', '5 sao'], ['emoji3', '3 mặt cười'], ['nps', 'Thang điểm 0–10']].map(([v, t]) => `<option value="${v}"${(f.scale || 'stars5') === v ? ' selected' : ''}>${t}</option>`).join('')}
          </select></div>
        <div class="cda-grid">${oDaNgu('cda-cauhoi', f.question, false)}</div>
        <div class="form-hint" style="margin:-2px 0 8px;">Câu hỏi góp ý. Để trống thì app dùng câu dự phòng.</div>
        <div style="font-weight:500; margin:6px 0;">Lý do để khách chọn (tối đa 8)</div>
        <div id="cda-tags"></div>
        <button type="button" class="btn btn-ghost btn-tiny" id="cda-tag-them">+ Thêm lý do</button>
      </fieldset>
      <fieldset><legend>Khác</legend>
        ${chk('cda-huongdan', guideOn, 'Hiện mục "Hướng dẫn sử dụng" trong menu', 'Các mục Danh mục, Sơ đồ, Chọn lộ trình app chưa có màn hình nên chưa bật được.')}
        <div class="cda-grid">
          <div class="form-group"><label for="cda-quayve">Màn cảm ơn tự quay về màn đầu sau (giây)</label>
            <input class="form-control" type="number" min="0" max="300" step="1" id="cda-quayve" value="${esc(app.farewell?.autoReturnSeconds ?? 0)}">
            <div class="form-hint">0 = không tự quay về. Tối đa 300.</div></div>
          <div class="form-group"><label for="cda-dongbo">Máy tự đồng bộ mỗi (giờ)</label>
            <input class="form-control" type="number" min="0.5" max="72" step="0.5" id="cda-dongbo" value="${esc(app.autoSyncHours ?? '')}" placeholder="6">
            <div class="form-hint">Để trống = 6 giờ. Từ 0,5 đến 72.</div></div>
        </div>
      </fieldset>`;
    tags = (f.tags || []).map((t) => ({ id: t.id, label: { ...(t.label || {}) } }));
    veTags();
  }

  async function taiApp() {
    try {
      app = await api('/app-settings');
      veApp();
    } catch (e) {
      document.getElementById('cda-app-body').textContent = e.message;
    }
  }

  p1.addEventListener('click', async (ev) => {
    const t = ev.target;
    if (t.id === 'cda-tag-them') {
      docTags();
      if (tags.length < 8) tags.push({ moi: true, id: '', label: {} });
      veTags();
    } else if (t.dataset && t.dataset.tagXoa !== undefined) {
      docTags();
      tags.splice(Number(t.dataset.tagXoa), 1);
      veTags();
    } else if (t.id === 'cda-app-luu') {
      if (!app) return;
      docTags();
      const tb = document.getElementById('cda-app-tb');
      const daCo = new Set(tags.filter((x) => !x.moi).map((x) => x.id));
      const fb = app.fallbackLanguage;
      const body = {
        policies: {
          allowLoudspeaker: document.getElementById('cda-loa').checked,
          autoplayRequiresHeadphones: document.getElementById('cda-tainghe').checked,
          revisitPlaysWelcome: document.getElementById('cda-nghelai').checked,
        },
        summary: {
          closing: docDaNgu('cda-camon'),
          showFeedback: document.getElementById('cda-gopy-hien').checked,
          showQr: document.getElementById('cda-qr').checked,
          qrBaseUrl: document.getElementById('cda-qr-link').value.trim(),
        },
        feedback: {
          scale: document.getElementById('cda-thang').value,
          question: docDaNgu('cda-cauhoi'),
          tags: tags.filter((x) => String(x.label?.[fb] || '').trim()).map((x) => {
            const id = x.moi ? maTuTen(x.label[fb], daCo) : x.id;
            daCo.add(id);
            return { id, label: x.label };
          }),
        },
        menu: { guide: document.getElementById('cda-huongdan').checked },
        farewellAutoReturnSeconds: document.getElementById('cda-quayve').value,
        autoSyncHours: document.getElementById('cda-dongbo').value.trim(),
      };
      t.disabled = true;
      tb.textContent = 'Đang lưu…';
      try {
        const d = await api('/app-settings', { method: 'PUT', body: JSON.stringify(body) });
        tb.textContent = `Đã lưu (phiên bản ${d.bundleVersion}). Máy khách nhận ở lần đồng bộ tới.`;
        taiApp();
      } catch (e) {
        tb.textContent = e.message;
      } finally {
        t.disabled = false;
      }
    }
  });

  /* ----- khung chữ bổ sung ----- */
  let ui = null; // { languages, fallbackLanguage, ui }

  function giaTriHienThi(key, lang, macDinh) {
    const t = ui.ui || {};
    return (t[lang] && t[lang][key]) || (t[ui.fallbackLanguage] && t[ui.fallbackLanguage][key]) || macDinh;
  }

  function veChu() {
    const langs = ui.languages && ui.languages.length ? ui.languages : ['vi'];
    const fb = ui.fallbackLanguage || langs[0];
    const t = ui.ui || {};
    document.getElementById('cda-chu-body').innerHTML = KHOA.map(([nhom, ds]) => `
      <details class="cda-group" open><summary>${esc(nhom)}</summary><div>
        ${ds.map(([key, moTa, macDinh]) => `
          <div class="cda-row" data-key="${esc(key)}">
            <div class="cda-row-head"><span>${esc(moTa)}</span><span class="mono">${esc(key)}</span><span class="cda-cu" hidden>còn giọng bảo tàng</span></div>
            ${langs.map((l) => {
              const v = (t[l] && t[l][key]) || '';
              const goiY = l === fb ? macDinh : giaTriHienThi(key, fb, macDinh);
              const dai = (macDinh || '').length > 70;
              return `<div class="cda-lang"><span class="mono">${esc(l)}</span>${dai
                ? `<textarea class="form-control" rows="2" data-chu="${esc(key)}" data-lang="${esc(l)}" placeholder="${esc(goiY)}">${esc(v)}</textarea>`
                : `<input class="form-control" data-chu="${esc(key)}" data-lang="${esc(l)}" placeholder="${esc(goiY)}" value="${esc(v)}">`}</div>`;
            }).join('')}
          </div>`).join('')}
      </div></details>`).join('');
    danhDau();
  }

  // Đánh dấu ô mà chữ app THẬT SỰ hiện (giá trị đã nhập, không thì chữ mặc định) còn giọng bảo tàng.
  function danhDau() {
    const fb = ui.fallbackLanguage || 'vi';
    let dem = 0;
    const chiCu = document.getElementById('cda-chi-cu').checked;
    document.querySelectorAll('#cda-chu-body .cda-row').forEach((row) => {
      const o = row.querySelector(`[data-lang="${CSS.escape(fb)}"]`);
      const hien = (o && o.value.trim()) || (o && o.placeholder) || '';
      const cu = GIONG_CU.test(hien);
      row.querySelector('.cda-cu').hidden = !cu;
      row.hidden = chiCu && !cu;
      if (cu) dem += 1;
    });
    document.querySelectorAll('#cda-chu-body .cda-group').forEach((g) => {
      g.hidden = chiCu && !g.querySelector('.cda-row:not([hidden])');
    });
    document.getElementById('cda-dem').textContent = dem ? `Còn ${dem} dòng mang giọng bảo tàng.` : 'Không còn dòng nào mang giọng bảo tàng.';
  }

  async function taiChu() {
    try {
      ui = await api('/ui-strings');
      if (!ui.fallbackLanguage) ui.fallbackLanguage = (ui.languages && ui.languages[0]) || 'vi';
      veChu();
    } catch (e) {
      document.getElementById('cda-chu-body').textContent = e.message;
    }
  }

  p2.addEventListener('input', (ev) => { if (ev.target.dataset && ev.target.dataset.chu) danhDau(); });
  p2.addEventListener('change', (ev) => { if (ev.target.id === 'cda-chi-cu') danhDau(); });
  p2.addEventListener('click', async (ev) => {
    const t = ev.target;
    if (t.id === 'cda-them-dong') {
      const d = document.createElement('div');
      d.className = 'cda-them-row';
      d.innerHTML = '<input class="form-control mono" data-them="key" placeholder="ten.khoa"><input class="form-control" data-them="val" placeholder="Chữ hiển thị">';
      document.getElementById('cda-them-ds').appendChild(d);
    } else if (t.id === 'cda-chu-luu') {
      if (!ui) return;
      const tb = document.getElementById('cda-chu-tb');
      const payload = {};
      document.querySelectorAll('#cda-chu-body [data-chu]').forEach((el) => {
        const l = el.dataset.lang;
        payload[l] = payload[l] || {};
        payload[l][el.dataset.chu] = el.value.trim();
      });
      const fb = ui.fallbackLanguage;
      for (const row of document.querySelectorAll('#cda-them-ds .cda-them-row')) {
        const k = row.querySelector('[data-them="key"]').value.trim();
        const v = row.querySelector('[data-them="val"]').value.trim();
        if (!k && !v) continue;
        if (!/^[A-Za-z0-9._-]{1,80}$/.test(k)) { tb.textContent = `Tên khóa "${k}" không hợp lệ`; return; }
        payload[fb] = payload[fb] || {};
        payload[fb][k] = v;
      }
      t.disabled = true;
      tb.textContent = 'Đang lưu…';
      try {
        await api('/ui-strings', { method: 'PUT', body: JSON.stringify({ ui: payload }) });
        tb.textContent = 'Đã lưu. Máy khách nhận ở lần đồng bộ tới.';
        document.getElementById('cda-them-ds').innerHTML = '';
        taiChu();
      } catch (e) {
        tb.textContent = e.message;
      } finally {
        t.disabled = false;
      }
    }
  });

  // Tải khi mở trang và mỗi lần mở lại tab "Giao diện ứng dụng".
  document.addEventListener('click', (ev) => {
    if (ev.target.closest && ev.target.closest('.nav-item[data-view="ui-strings"]')) { taiApp(); taiChu(); }
  });
  taiApp();
  taiChu();
})();
