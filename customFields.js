// TRƯỜNG THÔNG TIN TỰ ĐỊNH NGHĨA cho từng nội dung (exhibit) — CLAUDE.md §5.33.
//
// Mỗi đơn vị tự đặt bộ trường của mình trong cài đặt CMS (cmsSettings.fields):
// nhà đất có Giá / Diện tích / Hướng…, bảo tàng có Niên đại / Chất liệu…, showroom có
// Giá / Bảo hành… Giá trị lưu ở exhibit.fields = { <id trường>: <giá trị> }.
//
// HIỆN CHO KHÁCH MÀ KHÔNG PHẢI SỬA APP: trường bật `onDevice` được máy chủ SINH thành các
// dòng đầu của exhibit.specs[] (bảng "Thông số" mà app vốn đã hiển thị). exhibit.fieldSpecs
// ghi id các trường đã sinh, theo đúng thứ tự, để lần lưu sau biết N dòng đầu là dòng sinh
// tự động (bỏ đi, sinh lại) và phần còn lại là thông số người dùng tự gõ.
//   ⚠ Mọi chỗ ghi exhibit.specs phải đi qua ghepSpecs() — ghi thẳng sẽ làm lệch fieldSpecs.
//
// Kiểu trường:
//   text   — chữ, nhập được theo TỪNG ngôn ngữ ({ vi: '…', en: '…' })
//   number — số; hiện cho khách theo cách viết số của từng ngôn ngữ (2.500.000 / 2,500,000)
//   year   — năm (số nguyên, không phân nhóm nghìn: 1945 chứ không phải 1.945)
//   select — chọn một trong danh sách cho sẵn (options)

const TYPES = ['text', 'number', 'year', 'select'];
const ID_RE = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_FIELDS = 24;
const MAX_OPTIONS = 40;
const MAX_TEXT = 500;

const loi = (m) => Object.assign(new Error(m), { status: 400 });
const sach = (v, n) => String(v ?? '').trim().replace(/[\r\n<>{}]/g, ' ').replace(/\s+/g, ' ').slice(0, n);

/** Kiểm tra + làm sạch danh sách trường trong cài đặt. Ném lỗi 400 nếu sai. */
function kiemTraTruong(ds) {
  if (ds === undefined || ds === null) return [];
  if (!Array.isArray(ds)) throw loi('Danh sách trường thông tin không hợp lệ');
  if (ds.length > MAX_FIELDS) throw loi(`Tối đa ${MAX_FIELDS} trường thông tin`);
  const seen = new Set();
  return ds.map((f, i) => {
    const id = String(f?.id || '').trim();
    const label = sach(f?.label, 40);
    if (!label) throw loi(`Trường thông tin thứ ${i + 1} chưa có tên`);
    if (!ID_RE.test(id)) throw loi(`Mã trường "${id}" không hợp lệ (chữ thường không dấu, số, gạch dưới; bắt đầu bằng chữ)`);
    if (seen.has(id)) throw loi(`Mã trường "${id}" bị trùng`);
    seen.add(id);
    const type = TYPES.includes(f?.type) ? f.type : 'text';
    const out = { id, label, type };
    const labelI18n = {};
    for (const [lang, v] of Object.entries(f?.labelI18n || {})) {
      if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang) && sach(v, 40)) labelI18n[lang] = sach(v, 40);
    }
    if (Object.keys(labelI18n).length) out.labelI18n = labelI18n;
    if (type === 'number') {
      const unit = sach(f?.unit, 12);
      if (unit) out.unit = unit;
    }
    if (type === 'select') {
      const opts = [...new Set((Array.isArray(f?.options) ? f.options : []).map((o) => sach(o, 60)).filter(Boolean))];
      if (!opts.length) throw loi(`Trường "${label}" kiểu "chọn từ danh sách" cần ít nhất một lựa chọn`);
      if (opts.length > MAX_OPTIONS) throw loi(`Trường "${label}" có quá ${MAX_OPTIONS} lựa chọn`);
      out.options = opts;
    }
    out.onDevice = f?.onDevice === true;
    out.inList = f?.inList === true;
    return out;
  });
}

/** Giá trị đang có của một trường; đọc cả dữ liệu cũ listing.price/area (§5.31). */
function giaTri(exhibit, id) {
  const v = exhibit?.fields?.[id];
  if (v !== undefined) return v;
  if ((id === 'price' || id === 'area') && exhibit?.listing?.[id] != null) return exhibit.listing[id];
  return undefined;
}

function docSo(raw, field, laNam) {
  const s = String(raw).trim().replace(/\s/g, '');
  const n = Number(s);
  if (!Number.isFinite(n) || Math.abs(n) > 1e15) throw loi(`"${field.label}" phải là số`);
  if (laNam && !Number.isInteger(n)) throw loi(`"${field.label}" phải là năm (số nguyên)`);
  return n;
}

/**
 * Áp giá trị trường gửi từ biểu mẫu (body.fields = chuỗi JSON { id: giá trị }) vào exhibit.
 * Không gửi body.fields → giữ nguyên. Trường có trong body nhưng rỗng → xóa giá trị.
 * Trường đã bị bỏ khỏi cài đặt → KHÔNG đụng (dữ liệu cũ không bị mất âm thầm).
 */
function apGiaTri(body, exhibit, fields, langs) {
  if (body.fields === undefined) return;
  let input;
  try {
    input = typeof body.fields === 'string' ? JSON.parse(body.fields || '{}') : body.fields;
  } catch {
    throw loi('Dữ liệu trường thông tin không hợp lệ');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw loi('Dữ liệu trường thông tin không hợp lệ');
  const { fallbackLanguage, languages } = langs;
  const next = { ...(exhibit.fields || {}) };
  for (const f of fields) {
    if (!(f.id in input)) continue;
    const raw = input[f.id];
    delete next[f.id];
    if (raw === null || raw === undefined || raw === '') continue;
    if (f.type === 'number' || f.type === 'year') {
      next[f.id] = docSo(raw, f, f.type === 'year');
    } else if (f.type === 'select') {
      const v = sach(raw, 60);
      // Giữ được lựa chọn CŨ đã bị bỏ khỏi danh sách (cùng lý do với trạng thái, §5.32).
      if (v && !f.options.includes(v) && v !== giaTri(exhibit, f.id)) {
        throw loi(`"${v}" không có trong danh sách lựa chọn của "${f.label}"`);
      }
      if (v) next[f.id] = v;
    } else {
      const obj = typeof raw === 'object' ? raw : { [fallbackLanguage]: raw };
      const val = {};
      for (const lang of languages) {
        const t = String(obj?.[lang] ?? '').trim().slice(0, MAX_TEXT);
        if (t) val[lang] = t;
      }
      if (Object.keys(val).length && !val[fallbackLanguage]) {
        throw loi(`"${f.label}": cần nhập bản ${fallbackLanguage} (ngôn ngữ mặc định) trước bản dịch`);
      }
      if (Object.keys(val).length) next[f.id] = val;
    }
  }
  if (Object.keys(next).length) exhibit.fields = next; else delete exhibit.fields;
  // Dữ liệu kiểu cũ (listing.price/area) đã chuyển sang fields thì bỏ bản cũ đi.
  if (exhibit.listing) {
    for (const k of ['price', 'area']) {
      if (fields.some((f) => f.id === k) && k in input) delete exhibit.listing[k];
    }
    if (!Object.keys(exhibit.listing).length) delete exhibit.listing;
  }
}

function dinhDangSo(n, lang) {
  try {
    return new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(n);
  } catch {
    return String(n);
  }
}

/** Dòng specs sinh từ MỘT trường, hoặc null nếu trường chưa có giá trị ở ngôn ngữ mặc định. */
function dongSpec(field, value, langs) {
  const { fallbackLanguage, languages } = langs;
  if (value === undefined || value === null || value === '') return null;
  const label = { [fallbackLanguage]: field.label };
  for (const lang of languages) {
    if (lang !== fallbackLanguage && field.labelI18n?.[lang]) label[lang] = field.labelI18n[lang];
  }
  const out = {};
  if (field.type === 'number' || field.type === 'year') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    for (const lang of languages) {
      const so = field.type === 'year' ? String(value) : dinhDangSo(value, lang);
      out[lang] = field.unit ? `${so} ${field.unit}` : so;
    }
  } else if (field.type === 'select') {
    out[fallbackLanguage] = String(value);
  } else {
    if (typeof value !== 'object' || !value[fallbackLanguage]) return null;
    for (const lang of languages) if (value[lang]) out[lang] = value[lang];
  }
  return { label, value: out };
}

/** Phần specs người dùng TỰ GÕ (bỏ N dòng đầu đã sinh tự động lần trước). */
function specsTuGo(exhibit) {
  const n = Array.isArray(exhibit.fieldSpecs) ? exhibit.fieldSpecs.length : 0;
  return (exhibit.specs || []).slice(n);
}

/**
 * Ghép specs = [dòng sinh từ trường bật onDevice] + [thông số tự gõ].
 * `manual` = thông số tự gõ mới (từ biểu mẫu); bỏ trống = giữ phần tự gõ hiện có.
 */
function ghepSpecs(exhibit, fields, langs, manual) {
  const tuGo = manual !== undefined ? manual : specsTuGo(exhibit);
  const sinh = [];
  const ids = [];
  for (const f of fields) {
    if (!f.onDevice) continue;
    const d = dongSpec(f, giaTri(exhibit, f.id), langs);
    if (d) { sinh.push(d); ids.push(f.id); }
  }
  exhibit.specs = [...sinh, ...tuGo];
  if (ids.length) exhibit.fieldSpecs = ids; else delete exhibit.fieldSpecs;
}

/** Sinh lại specs cho MỌI nội dung (sau khi đổi cài đặt trường). Trả về số nội dung đã đổi. */
function sinhLaiTatCa(manifest, fields, langs) {
  let doi = 0;
  for (const z of manifest.zones || []) {
    for (const e of z.exhibits || []) {
      const truoc = JSON.stringify([e.specs || [], e.fieldSpecs || null]);
      ghepSpecs(e, fields, langs);
      if (JSON.stringify([e.specs || [], e.fieldSpecs || null]) !== truoc) doi += 1;
    }
  }
  return doi;
}

module.exports = {
  TYPES, kiemTraTruong, giaTri, apGiaTri, ghepSpecs, specsTuGo, sinhLaiTatCa, dongSpec,
};
