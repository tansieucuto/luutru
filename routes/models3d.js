// GET /models.json, /models/... và /turntable/... ở gốc domain — kho mô hình 3D
// mà app tải riêng, không đi qua bundle (xem models3d.js).
//
// LƯU Ý: công khai, không xác thực — có chủ ý. Khách tham quan không có tài
// khoản; giống /version.json và POST /events.
const path = require('path');
const express = require('express');
const models3d = require('../models3d');

const router = express.Router();

// Danh mục đọc từ đĩa, nhớ tạm 5 giây: đủ để nhiều tablet mở cùng lúc không
// quét thư mục liên tục, đủ ngắn để mô hình vừa tải lên hiện ra gần như ngay.
const CACHE_MS = 5000;
let cache = null;
let cacheAt = 0;

router.get('/models.json', (req, res) => {
  if (!cache || Date.now() - cacheAt > CACHE_MS) {
    cache = models3d.dungDanhMuc();
    cacheAt = Date.now();
    for (const c of cache.canhBao) console.warn('[models] ' + c);
  }
  // Danh mục thay đổi được nên không cache ở máy khách; file .glb và khung ảnh
  // mới là thứ bất biến.
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ models: cache.models });
});

// Chỉ phục vụ .glb/.gltf (meta.json là dữ liệu nội bộ). Phải đặt TRƯỚC
// express.static bên dưới — Express chạy middleware theo thứ tự khai báo.
const DUOI_CHO_PHEP = new Set(['.glb', '.gltf']);
router.use('/models', (req, res, next) => {
  if (!DUOI_CHO_PHEP.has(path.extname(req.path).toLowerCase())) {
    return res.status(404).json({ error: 'Không tìm thấy' });
  }
  next();
});

// File .glb: tên chứa 12 ký tự đầu của mã băm nên URL bất biến và cache vĩnh
// viễn được — proxy giữ bản cũ không thể trả nhầm nội dung cho bản mới.
// express.static hỗ trợ sẵn HTTP Range (206), app dùng để tải tiếp.
router.use('/models', express.static(models3d.MODELS_DIR, {
  index: false,
  dotfiles: 'deny',
  setHeaders: (res, duongDan) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (duongDan.endsWith('.glb')) res.setHeader('Content-Type', 'model/gltf-binary');
  },
}));

// Dải ảnh xoay 360°: `turntable/<id>-<sha12>/000.webp`... Thư mục chứa mã băm
// nên URL cũng bất biến. Chỉ phục vụ file .webp (source.json là dữ liệu nội bộ).
router.use('/turntable', (req, res, next) => {
  if (!/^\/[A-Za-z0-9_-]+\/\d{3}\.webp$/.test(req.path)) return res.status(404).json({ error: 'Không tìm thấy' });
  next();
});
router.use('/turntable', express.static(models3d.TURNTABLE_DIR, {
  index: false,
  dotfiles: 'deny',
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'),
}));

/** Xóa cache danh mục — gọi sau khi thêm/xóa mô hình để thấy ngay. */
function xoaCache() {
  cache = null;
  cacheAt = 0;
}

module.exports = { router, xoaCache };
