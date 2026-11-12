// Cài đặt giao diện CMS cho từng đơn vị triển khai: cách GỌI TÊN các đối tượng
// (thuật ngữ), danh sách trạng thái và bộ TRƯỜNG THÔNG TIN tự định nghĩa (customFields.js).
//
// Chỉ đổi CÁCH HIỂN THỊ trên trang quản trị — KHÔNG đổi khóa dữ liệu. manifest.json
// vẫn là zones/exhibits vì đó là hợp đồng với beacon-client (CLAUDE.md §1, §3).
//
// Nằm NGOÀI content/ (DATA_DIR/cms-settings.json), cùng lý do với users.json (§5.16):
// nhập ZIP / khôi phục sao lưu thay thế cả content/.
const fs = require('fs');
const { CMS_SETTINGS_PATH } = require('./paths');
const { kiemTraTruong } = require('./customFields');

// Mặc định DÙNG CHUNG cho mọi ngành (bảo tàng, showroom, nhà máy, trường học, triển lãm,
// nhà đất...): "khu vực" là không gian có đặt beacon, "nội dung" là từng điểm được thuyết
// minh. Mỗi khóa là một danh từ, viết thường; giao diện tự viết hoa chữ đầu khi cần ({Muc}).
const TERMS_CHUNG = {
  donVi: 'đơn vị',
  nhom: 'khu vực',               // zones
  muc: 'nội dung',               // exhibits
  thietBi: 'thiết bị thuyết minh',
  khach: 'khách',
  thuyetMinh: 'thuyết minh',
};

// Trạng thái mặc định là trạng thái BIÊN TẬP — chỉ dùng trong CMS để theo dõi việc soạn
// nội dung; app trên máy bỏ qua (không có trạng thái nào làm ẩn nội dung trên máy).
const STATUS_CHUNG = [
  { id: 'draft', label: 'Đang soạn', color: 'amber' },
  { id: 'review', label: 'Chờ duyệt', color: 'blue' },
  { id: 'ready', label: 'Hoàn thiện', color: 'green' },
  { id: 'update', label: 'Cần cập nhật', color: 'red' },
];

const MAC_DINH = {
  terms: TERMS_CHUNG,
  statuses: STATUS_CHUNG,
  // Trường thông tin tự định nghĩa cho mỗi nội dung — xem customFields.js. Mặc định rỗng;
  // các mẫu Bảo tàng / Showroom / Nhà đất điền sẵn bộ trường hợp ngành.
  fields: [],
  // Tên hiện ở logo/thanh bên/trang đăng nhập (thay chữ "Beacon"). Giữ hoa thường.
  brand: 'Thuyết minh',
};

// Bộ trường mẫu. labelI18n = tên trường ở ngôn ngữ khác (hiện cho khách nước ngoài).
const HUONG = ['Đông', 'Tây', 'Nam', 'Bắc', 'Đông Bắc', 'Đông Nam', 'Tây Bắc', 'Tây Nam'];
const TRUONG_BAO_TANG = [
  { id: 'nien_dai', label: 'Niên đại', labelI18n: { en: 'Date', zh: '年代' }, type: 'text', onDevice: true, inList: true },
  { id: 'chat_lieu', label: 'Chất liệu', labelI18n: { en: 'Material', zh: '材质' }, type: 'text', onDevice: true },
  { id: 'kich_thuoc', label: 'Kích thước', labelI18n: { en: 'Dimensions', zh: '尺寸' }, type: 'text', onDevice: true },
  { id: 'xuat_xu', label: 'Xuất xứ', labelI18n: { en: 'Origin', zh: '出处' }, type: 'text', onDevice: true },
  { id: 'so_hieu', label: 'Số hiệu', labelI18n: { en: 'Inventory no.', zh: '编号' }, type: 'text', onDevice: false, inList: true },
];
const TRUONG_SHOWROOM = [
  { id: 'price', label: 'Giá', labelI18n: { en: 'Price', zh: '价格' }, type: 'number', unit: 'VNĐ', onDevice: true, inList: true },
  { id: 'bao_hanh', label: 'Bảo hành', labelI18n: { en: 'Warranty (months)', zh: '保修（月）' }, type: 'number', unit: 'tháng', onDevice: true },
  { id: 'ma_sp', label: 'Mã sản phẩm', labelI18n: { en: 'Model', zh: '型号' }, type: 'text', onDevice: true, inList: true },
  { id: 'nam_ra_mat', label: 'Năm ra mắt', labelI18n: { en: 'Launched', zh: '上市年份' }, type: 'year', onDevice: true },
];
const TRUONG_NHA_DAT = [
  { id: 'price', label: 'Giá', labelI18n: { en: 'Price', zh: '价格' }, type: 'number', unit: 'VNĐ', onDevice: true, inList: true },
  { id: 'area', label: 'Diện tích', labelI18n: { en: 'Area', zh: '面积' }, type: 'number', unit: 'm²', onDevice: true, inList: true },
  { id: 'phong_ngu', label: 'Phòng ngủ', labelI18n: { en: 'Bedrooms', zh: '卧室' }, type: 'number', onDevice: true },
  { id: 'huong', label: 'Hướng', labelI18n: { en: 'Facing', zh: '朝向' }, type: 'select', options: HUONG, onDevice: true },
  { id: 'phap_ly', label: 'Pháp lý', labelI18n: { en: 'Title status', zh: '产权' }, type: 'select', options: ['Sổ hồng', 'Hợp đồng mua bán', 'Đang chờ sổ'], onDevice: false },
];

// Mẫu điền nhanh: mỗi mẫu là một bộ cài đặt đầy đủ (tên gọi + trạng thái + ô số liệu).
const MAU = {
  'chung': { terms: TERMS_CHUNG, statuses: STATUS_CHUNG, fields: [] },
  'bao-tang': {
    terms: {
      donVi: 'bảo tàng', nhom: 'khu trưng bày', muc: 'hiện vật',
      thietBi: 'máy tham quan', khach: 'khách tham quan', thuyetMinh: 'thuyết minh',
    },
    statuses: STATUS_CHUNG,
    fields: TRUONG_BAO_TANG,
  },
  'showroom': {
    terms: {
      donVi: 'doanh nghiệp', nhom: 'khu trưng bày', muc: 'sản phẩm',
      thietBi: 'thiết bị thuyết minh', khach: 'khách', thuyetMinh: 'giới thiệu',
    },
    statuses: [
      { id: 'active', label: 'Đang trưng bày', color: 'green' },
      { id: 'new', label: 'Mới ra mắt', color: 'blue' },
      { id: 'paused', label: 'Tạm ngừng', color: 'gray' },
    ],
    fields: TRUONG_SHOWROOM,
  },
  'nha-dat': {
    terms: {
      donVi: 'đơn vị', nhom: 'dự án', muc: 'sản phẩm',
      thietBi: 'thiết bị trình chiếu', khach: 'khách', thuyetMinh: 'giới thiệu',
    },
    statuses: [
      { id: 'available', label: 'Còn trống', color: 'green' },
      { id: 'reserved', label: 'Đang giữ chỗ', color: 'amber' },
      { id: 'sold', label: 'Đã bán', color: 'red' },
    ],
    fields: TRUONG_NHA_DAT,
  },
};

const COLORS = ['green', 'amber', 'red', 'gray', 'blue'];
const STATUS_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

let cache = null; // { key, data }

function doc() {
  try {
    const st = fs.statSync(CMS_SETTINGS_PATH);
    const key = `${st.mtimeMs}:${st.size}`;
    if (cache && cache.key === key) return cache.data;
    const raw = JSON.parse(fs.readFileSync(CMS_SETTINGS_PATH, 'utf8'));
    const data = chuanHoa(raw);
    cache = { key, data };
    return data;
  } catch {
    return structuredClone(MAC_DINH);
  }
}

// Ném lỗi kèm câu cho người dùng đọc nếu dữ liệu sai; trả bản đã làm sạch.
function kiemTra(input) {
  const loi = (m) => Object.assign(new Error(m), { status: 400 });
  const terms = {};
  for (const k of Object.keys(MAC_DINH.terms)) {
    const v = String(input?.terms?.[k] ?? '').trim().replace(/[\r\n{}<>]/g, '');
    if (!v) throw loi(`Thiếu tên gọi cho "${MAC_DINH.terms[k]}"`);
    if (v.length > 40) throw loi(`Tên gọi "${v.slice(0, 20)}…" quá dài (tối đa 40 ký tự)`);
    terms[k] = v.toLocaleLowerCase('vi');
  }
  const ds = Array.isArray(input?.statuses) ? input.statuses : [];
  if (ds.length > 12) throw loi('Tối đa 12 trạng thái');
  const seen = new Set();
  const statuses = ds.map((s) => {
    const id = String(s?.id || '').trim();
    const label = String(s?.label || '').trim().replace(/[\r\n<>]/g, '');
    if (!STATUS_ID_RE.test(id)) throw loi(`Mã trạng thái "${id}" không hợp lệ (chỉ a-z, 0-9, - _)`);
    if (seen.has(id)) throw loi(`Mã trạng thái "${id}" bị trùng`);
    if (!label || label.length > 40) throw loi(`Tên trạng thái "${id}" trống hoặc quá dài`);
    seen.add(id);
    return { id, label, color: COLORS.includes(s.color) ? s.color : 'gray' };
  });
  return {
    terms,
    statuses,
    fields: kiemTraTruong(input?.fields),
    brand: (String(input?.brand ?? MAC_DINH.brand).trim().replace(/[\r\n{}<>]/g, '').slice(0, 30)) || MAC_DINH.brand,
  };
}

// Bản cài đặt §5.31/§5.32 (hai ô cố định giá/diện tích) → hai trường kiểu số mã price/area.
// Giá trị cũ ở exhibit.listing.price/area vẫn đọc được (customFields.giaTri).
function chuyenBanCu(raw) {
  if (Array.isArray(raw?.fields)) return raw.fields;
  // File cũ chưa có showNumbers = bản §5.31, khi đó hai ô luôn hiện.
  const hien = typeof raw?.showNumbers === 'boolean' ? raw.showNumbers : true;
  if (!hien) return [];
  return [
    { id: 'price', label: raw.priceLabel || 'Giá', type: 'number', unit: raw.priceUnit ?? 'VNĐ', onDevice: false, inList: true },
    { id: 'area', label: raw.areaLabel || 'Diện tích', type: 'number', unit: raw.areaUnit ?? 'm²', onDevice: false, inList: true },
  ];
}

// Đọc file cũ/hỏng một phần: trường nào sai thì lấy mặc định, không làm sập trang.
function chuanHoa(raw) {
  const terms = { ...MAC_DINH.terms, ...(raw?.terms || {}) };
  const fields = chuyenBanCu(raw);
  const thu = (over) => kiemTra({ ...MAC_DINH, ...raw, terms, fields, ...over });
  try {
    return thu({});
  } catch {
    // Một trạng thái/trường hỏng không được kéo theo mất cả tên gọi đã đặt.
    for (const over of [{ statuses: MAC_DINH.statuses }, { fields: [] }, { statuses: MAC_DINH.statuses, fields: [] }]) {
      try { return thu(over); } catch { /* thử cách tiếp theo */ }
    }
    return structuredClone(MAC_DINH);
  }
}

function luu(input) {
  const data = kiemTra(input);
  const tmp = `${CMS_SETTINGS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o644 });
  fs.renameSync(tmp, CMS_SETTINGS_PATH);
  cache = null;
  return data;
}

module.exports = { doc, luu, MAC_DINH, MAU, COLORS };
