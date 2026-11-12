// Tình trạng vận hành cho Trang chủ: sao lưu, ổ đĩa, máy tham quan, tạm giữ phát
// hành. Lên VPS rồi thì không ai ngồi đọc log cron hay `df -h`; những thứ hỏng im
// lặng phải hiện màu đỏ ở chỗ người quản trị mở ra mỗi ngày. CLAUDE.md §5.28.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { DATA_DIR, CONTENT_DIR } = require('../paths');
const thietBi = require('../thietBi');
const tamGiu = require('../tamGiuPhatHanh');
const { validateManifest } = require('./adminContent');
const authenticateToken = require('../middleware/auth');
const { requireLevel, LEVEL } = authenticateToken;

const router = express.Router();
router.use(authenticateToken, requireLevel(LEVEL.viewer));

const BACKUP_STATUS_PATH = path.join(DATA_DIR, 'backup-status.json');

// Cron mặc định chạy 2 giờ sáng mỗi ngày; 36 giờ cho phép trễ một lần chạy mà
// chưa báo đỏ ngay.
const SAO_LUU_QUA_HAN_MS = 36 * 60 * 60 * 1000;

// Ngưỡng ổ đĩa. Nhập một gói ZIP 1 GB cần ~4 GB trống cùng lúc (§5.9), nên dưới
// 5 GB là đã không nhập nổi gói lớn.
const DIA_DO_BYTES = 2 * 1024 ** 3;
const DIA_VANG_BYTES = 5 * 1024 ** 3;

function tinhTrangSaoLuu() {
  let s = null;
  try {
    s = JSON.parse(fs.readFileSync(BACKUP_STATUS_PATH, 'utf8'));
  } catch {
    return {
      muc: 'do',
      tomTat: 'Chưa thấy lần sao lưu nào',
      chiTiet: 'Máy chủ chưa từng chạy scripts/backup-content.sh, hoặc chạy bản cũ không ghi kết quả. Hãy đặt lịch cron (NHIEU_BAO_TANG.md).',
    };
  }
  const now = Date.now();
  const okAt = Date.parse(s.lanThanhCongCuoi || '');
  const out = {
    lanChayCuoi: s.lanChayCuoi || null,
    lanThanhCongCuoi: s.lanThanhCongCuoi || null,
    ketQua: s.ketQua || null,
    bytes: Number(s.bytes) || 0,
    dayRaNgoai: s.dayRaNgoai || 'khong',
    loi: s.loi || '',
  };
  if (s.ketQua !== 'ok') {
    return { ...out, muc: 'do', tomTat: 'Lần sao lưu gần nhất bị lỗi', chiTiet: s.loi || '' };
  }
  if (Number.isNaN(okAt) || now - okAt > SAO_LUU_QUA_HAN_MS) {
    return { ...out, muc: 'do', tomTat: 'Đã lâu không có bản sao lưu mới', chiTiet: 'Lịch cron có thể đã ngừng chạy.' };
  }
  if (s.dayRaNgoai === 'loi') {
    return { ...out, muc: 'vang', tomTat: 'Sao lưu được nhưng không đẩy ra ngoài máy được', chiTiet: 'Bản sao chỉ còn nằm cùng ổ đĩa với dữ liệu gốc.' };
  }
  if (s.dayRaNgoai !== 'ok') {
    return { ...out, muc: 'vang', tomTat: 'Bản sao lưu chỉ nằm trên cùng máy chủ', chiTiet: 'Hỏng ổ đĩa là mất cả dữ liệu lẫn bản sao. Đặt REMOTE để đẩy ra ngoài.' };
  }
  return { ...out, muc: 'xanh', tomTat: 'Sao lưu bình thường', chiTiet: '' };
}

function tinhTrangODia() {
  try {
    const st = fs.statfsSync(DATA_DIR);
    const tong = st.blocks * st.bsize;
    const trong = st.bavail * st.bsize;
    const muc = trong < DIA_DO_BYTES ? 'do' : trong < DIA_VANG_BYTES ? 'vang' : 'xanh';
    return {
      muc,
      tong,
      trong,
      tomTat: muc === 'xanh' ? 'Còn đủ chỗ' : muc === 'vang' ? 'Sắp đầy — không nhập nổi gói ZIP lớn' : 'Gần đầy — có thể hỏng khi lưu hoặc đóng gói',
    };
  } catch (err) {
    return { muc: 'vang', tomTat: `Không đọc được dung lượng ổ đĩa: ${err.message}` };
  }
}

function tinhTrangPhatHanh() {
  const giu = tamGiu.dangGiu();
  const banCms = tamGiu.banTrenCms();
  if (!giu) return { dangGiu: false, banTrenCms: banCms };
  return {
    dangGiu: true,
    banTrenCms: banCms,
    banDangPhat: giu.version,
    luc: giu.luc,
    boi: giu.boi,
    coThayDoiChoPhatHanh: banCms !== giu.version,
  };
}

router.get('/', (req, res) => {
  try {
    const may = thietBi.danhSach();
    const dem = { xanh: 0, vang: 0, do: 0 };
    for (const m of may) dem[m.trangThai] += 1;
    res.json({
      saoLuu: tinhTrangSaoLuu(),
      oDia: tinhTrangODia(),
      phatHanh: tinhTrangPhatHanh(),
      thietBi: { tong: may.length, ...dem },
      luc: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được tình trạng vận hành: ${err.message}` });
  }
});

// ==================== MÁY THAM QUAN ====================
router.get('/thiet-bi', (req, res) => {
  res.json({ thietBi: thietBi.danhSach(), nguong: { xanhMs: thietBi.XANH_MS, vangMs: thietBi.VANG_MS } });
});

router.put('/thiet-bi/:id', requireLevel(LEVEL.editor), express.json(), (req, res) => {
  const ten = typeof req.body?.ten === 'string' ? req.body.ten : '';
  if (!thietBi.datTen(req.params.id, ten)) return res.status(404).json({ error: 'Không có máy này trong danh sách' });
  res.json({ ok: true });
});

router.delete('/thiet-bi/:id', requireLevel(LEVEL.editor), (req, res) => {
  if (!thietBi.xoa(req.params.id)) return res.status(404).json({ error: 'Không có máy này trong danh sách' });
  res.json({ ok: true });
});

// ==================== TẠM GIỮ PHÁT HÀNH ====================
router.get('/phat-hanh', (req, res) => {
  res.json(tinhTrangPhatHanh());
});

router.post('/phat-hanh/tam-giu', requireLevel(LEVEL.editor), async (req, res) => {
  try {
    let hopLe = false;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'manifest.json'), 'utf8'));
      hopLe = validateManifest(manifest).length === 0;
    } catch {
      hopLe = false;
    }
    await tamGiu.batDau({ noiDungHopLe: hopLe, nguoi: req.userName || req.userLogin || null });
    res.json(tinhTrangPhatHanh());
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Bỏ chốt. Không kiểm nội dung ở đây: /version.json tự kiểm và trả 503 nếu nội
// dung đang lỗi, tablet giữ bản cũ — đúng như khi chưa từng tạm giữ. Trả kèm danh
// sách lỗi để giao diện nói rõ "đã bỏ giữ nhưng máy chưa nhận được vì…".
router.post('/phat-hanh/phat-hanh', requireLevel(LEVEL.editor), (req, res) => {
  tamGiu.ketThuc();
  let problems = [];
  try {
    problems = validateManifest(JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'manifest.json'), 'utf8')));
  } catch (err) {
    problems = [`Không đọc được manifest.json: ${err.message}`];
  }
  res.json({ ...tinhTrangPhatHanh(), problems });
});

module.exports = router;
