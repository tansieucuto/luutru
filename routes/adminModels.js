// API quản lý kho mô hình 3D trên trang quản trị: danh sách, kiểm thử, tải lên /
// thay file, đổi tên, dựng lại dải ảnh, xóa. Mô hình không nằm trong bundle — xem
// models3d.js.
//
// LƯU Ý: chốt chặn ngân sách (VRAM, tam giác, material…) phải nằm ở đây, lúc tải
// lên — không bộ dựng nào cứu được một mô hình quá nặng trên máy tablet 1.79 GB RAM.
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const models3d = require('../models3d');
const { xoaCache } = require('./models3d');
const dungAnh = require('../turntableRenderer');
const authenticateToken = require('../middleware/auth');
const { requireLevel, LEVEL } = authenticateToken;

const router = express.Router();

// GET: Chỉ xem trở lên; mọi thao tác ghi: Biên tập trở lên (cùng quy ước với
// adminContent.js). Xóa không đòi quyền Chủ vì đã có chốt "đang được dùng thì không
// xóa được".
router.use(authenticateToken, (req, res, next) =>
  requireLevel(req.method === 'GET' ? LEVEL.viewer : LEVEL.editor)(req, res, next));

// Trần 32 MB cho multer (trần ngân sách là 8 MB): để bộ kiểm nhận file và từ chối
// kèm lý do cụ thể, thay vì multer trả 413 không giải thích gì.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024, files: 1 },
});

function locSo(n) {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Map mã mô hình → danh sách hiện vật đang gắn nó. Đọc manifest MỘT lần; lỗi đọc
 * → map rỗng (không chặn việc liệt kê vì một lý do phụ).
 */
function hienVatDangDung() {
  const map = new Map();
  try {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(models3d.CONTENT_DIR, 'manifest.json'), 'utf8'));
    const fb = manifest.fallbackLanguage;
    for (const z of manifest.zones || []) {
      for (const e of z.exhibits || []) {
        if (!e.model3dId) continue;
        if (!map.has(e.model3dId)) map.set(e.model3dId, []);
        map.get(e.model3dId).push({
          zoneId: z.id,
          exhibitId: e.id,
          name: (e.name && (e.name[fb] || Object.values(e.name)[0])) || e.id,
        });
      }
    }
  } catch { /* xem chú thích trên */ }
  return map;
}

/** Bản ghi trả về cho giao diện, kèm số liệu ngân sách và tình trạng dựng ảnh. */
function banGhi(id, dangDung = null) {
  const meta = models3d.docMeta(id);
  if (!meta) return null;
  const tt = models3d.docTurntable(id);
  return {
    id,
    label: meta.label || null,
    sha256: meta.sha256,
    bytes: meta.bytes,
    uploadedAt: meta.uploadedAt || null,
    uploadedBy: meta.uploadedBy || null,
    fileName: meta.fileName,
    url: `models/${id}/${meta.fileName}`,
    soLieu: meta.soLieu || null,
    turntable: tt,
    dungAnh: dungAnh.trangThaiCua(id),
    // Poster/thumb để giao diện xem trước (/content-media/ là đường server.js mở cho
    // ảnh nội dung).
    stills: (() => { const st = models3d.docStills(id); return st ? {
      poster: '/content-media/' + st.poster, thumb: '/content-media/' + st.thumb,
    } : null; })(),
    dungO: dangDung ? (dangDung.get(id) || []) : undefined,
  };
}

// ---------- Danh sách ----------
router.get('/', (req, res) => {
  try {
    const dangDung = hienVatDangDung();
    const items = models3d.danhSachId().map((id) => banGhi(id, dangDung)).filter(Boolean);
    res.json({
      models: items,
      mayDung: dungAnh.thongTinMayDung(),
      budget: {
        vramBytes: models3d.BUDGET.vramBytes,
        triangles: models3d.BUDGET.triangles,
        materials: models3d.BUDGET.materials,
        drawCalls: models3d.BUDGET.drawCalls,
        fileBytes: models3d.BUDGET.fileBytes,
      },
    });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được kho mô hình: ${err.message}` });
  }
});

// ---------- Kiểm thử một file, KHÔNG lưu ----------
// Để người dùng biết file có đạt ngân sách không trước khi điền biểu mẫu.
router.post('/kham-thu', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn file .glb' });
  try {
    const { soLieu, viPham, canhBao } = models3d.khamGlb(req.file.buffer);
    res.json({ soLieu, viPham, canhBao, dat: viPham.length === 0 });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Tải lên / thay file ----------
router.post('/', upload.single('file'), async (req, res) => {
  const id = String(req.body?.id || '').trim();
  const label = String(req.body?.label || '').trim();

  if (!models3d.MODEL_ID_RULE.test(id)) {
    return res.status(400).json({
      error: 'Mã mô hình chỉ được dùng chữ, số, gạch ngang và gạch dưới, bắt đầu bằng chữ hoặc số, '
        + 'tối đa 64 ký tự. Ví dụ: "sung-go-tu-tao".',
    });
  }
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn file .glb' });

  // Mã đã có mà không nói rõ là muốn THAY: từ chối, để gõ trùng mã không vô tình thay
  // mô hình của nhiều hiện vật. Thay file phải có chủ đích (nút "Sửa" gửi replace=1).
  const metaCu = models3d.docMeta(id);
  const thayThe = String(req.body?.replace || '') === '1';
  if (metaCu && !thayThe) {
    return res.status(409).json({
      error: `Mã "${id}" đã có trong kho. Muốn thay file của mô hình đó thì bấm "Sửa" ở dòng của nó; `
        + 'muốn thêm mô hình mới thì đặt mã khác.',
    });
  }
  if (!metaCu && thayThe) {
    return res.status(404).json({ error: `Không có mô hình "${id}" để thay.` });
  }

  let kham;
  try {
    kham = models3d.khamGlb(req.file.buffer);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (kham.viPham.length) {
    // 422 chứ không phải 400: file hợp lệ về định dạng, cái sai là NỘI DUNG vượt
    // ngân sách.
    return res.status(422).json({
      error: 'Mô hình vượt ngân sách nên không xuất bản được.',
      viPham: kham.viPham,
      soLieu: kham.soLieu,
    });
  }

  const sha = models3d.bamNoiDung(req.file.buffer);
  const tenFile = `${sha.slice(0, 12)}.glb`;
  const dir = models3d.thuMucModel(id);

  try {
    fs.mkdirSync(dir, { recursive: true });

    // Ghi file tạm rồi đổi tên: mất điện giữa chừng không để lại file .glb cụt.
    const tam = path.join(dir, `.${tenFile}.tmp`);
    fs.writeFileSync(tam, req.file.buffer);
    fs.renameSync(tam, path.join(dir, tenFile));

    const meta = {
      id,
      // Thay file mà để trống tên thì GIỮ tên cũ (để trống = "không đổi").
      label: label || (metaCu && metaCu.label) || null,
      sha256: sha,
      bytes: req.file.buffer.length,
      fileName: tenFile,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.userName || req.userLogin || null,
      soLieu: {
        triangles: kham.soLieu.triangles,
        trianglesUnique: kham.soLieu.trianglesUnique,
        materials: kham.soLieu.materials,
        drawCalls: kham.soLieu.drawCalls,
        vramBytes: kham.soLieu.vramBytes,
        texturesUnreadable: locSo(kham.soLieu.texturesUnreadable),
        canhBao: kham.canhBao || [],
      },
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

    // Dọn các file .glb cũ của CHÍNH mô hình này (tên file chứa mã băm, nên bản cũ
    // không bị ghi đè mà vẫn tải được qua URL cũ).
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.glb') && f !== tenFile) fs.unlinkSync(path.join(dir, f));
    }
  } catch (err) {
    return res.status(500).json({ error: `Không lưu được mô hình: ${err.message}` });
  }

  xoaCache();

  if (thayThe) {
    // THAY file: poster/dải ảnh cũ thuộc bản cũ. Làm mới manifest TRƯỚC (media[0]
    // lùi về ảnh hiện vật) rồi mới xóa file cũ, để manifest không lúc nào trỏ tới
    // file đã xóa.
    await dungAnh.lamMoiManifest(id);
    try { models3d.donAnhPhuTro(id, sha); } catch (err) { console.error('[models] don anh cu hong:', err.message); }
  }
  // Tự dựng dải ảnh — không bắt người quản trị bấm thêm nút nào.
  dungAnh.xepHang(id);

  res.status(thayThe ? 200 : 201).json({
    model: banGhi(id, hienVatDangDung()),
    soLieu: kham.soLieu,
    canhBao: kham.canhBao || [],
    thayThe,
  });
});

// ---------- Dựng (lại) dải ảnh xoay + poster/thumb ----------
router.post('/:id/dung-anh', (req, res) => {
  const id = req.params.id;
  if (!models3d.MODEL_ID_RULE.test(id)) return res.status(400).json({ error: 'Mã mô hình không hợp lệ' });
  if (!models3d.docMeta(id)) return res.status(404).json({ error: 'Không tìm thấy mô hình này' });
  const may = dungAnh.thongTinMayDung();
  if (!may.coChrome) return res.status(503).json({ error: may.huongDan });
  res.status(202).json({ dungAnh: dungAnh.xepHang(id) });
});

// ---------- Đổi tên gợi nhớ ----------
// Chỉ đổi phần chữ: không chạm file, sha256 giữ nguyên, tablet không tải lại. Thay
// FILE thì dùng POST / với replace=1 (qua lại bước kiểm ngân sách).
//
// Không cho đổi MÃ: mã là khóa mà manifest trỏ tới (model3dId) và là tên thư mục
// trên đĩa.
router.patch('/:id', (req, res) => {
  const id = req.params.id;
  if (!models3d.MODEL_ID_RULE.test(id)) return res.status(400).json({ error: 'Mã mô hình không hợp lệ' });
  const meta = models3d.docMeta(id);
  if (!meta) return res.status(404).json({ error: 'Không tìm thấy mô hình này' });

  const label = String(req.body?.label ?? '').trim().slice(0, 120);
  meta.label = label || null;
  try {
    const p = path.join(models3d.thuMucModel(id), 'meta.json');
    const tam = `${p}.tmp`;
    fs.writeFileSync(tam, JSON.stringify(meta, null, 2));
    fs.renameSync(tam, p);
  } catch (err) {
    return res.status(500).json({ error: `Không lưu được: ${err.message}` });
  }
  xoaCache();
  res.json({ model: banGhi(id, hienVatDangDung()) });
});

// ---------- Xóa ----------
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  if (!models3d.MODEL_ID_RULE.test(id)) {
    return res.status(400).json({ error: 'Mã mô hình không hợp lệ' });
  }
  if (!models3d.docMeta(id)) {
    return res.status(404).json({ error: 'Không tìm thấy mô hình này' });
  }

  // Không cho xóa khi còn hiện vật trỏ tới — xóa xong thì models.json thiếu mã đó và
  // màn hình hiện vật không bao giờ mở được 3D, không một thông báo nào.
  const dangDung = (hienVatDangDung().get(id) || []).map((h) => h.name);

  if (dangDung.length) {
    return res.status(409).json({
      error: `Mô hình này đang được ${dangDung.length} hiện vật sử dụng: ${dangDung.join(', ')}. `
        + 'Hãy bỏ gán ở những hiện vật đó trước đã.',
    });
  }

  try {
    dungAnh.huy(id);
    fs.rmSync(models3d.thuMucModel(id), { recursive: true, force: true });
    models3d.donAnhPhuTro(id, null);
  } catch (err) {
    return res.status(500).json({ error: `Không xóa được: ${err.message}` });
  }

  xoaCache();
  res.json({ ok: true });
});

module.exports = router;
