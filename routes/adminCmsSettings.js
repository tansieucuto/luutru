// GET/PUT /api/v1/admin/cms-settings — thuật ngữ, trạng thái, trường thông tin.
// Đọc: mọi vai trò (đã có ở /api/v1/site công khai). Ghi: chỉ Chủ.
const express = require('express');
const authenticateToken = require('../middleware/auth');
const { requireLevel, LEVEL } = require('../middleware/auth');
const cms = require('../cmsSettings');

const router = express.Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  res.json({ ...cms.doc(), mau: cms.MAU, colors: cms.COLORS, fieldTypes: require('../customFields').TYPES });
});

router.put('/', requireLevel(LEVEL.owner), async (req, res) => {
  try {
    const data = cms.luu(req.body || {});
    // Đổi bộ trường thông tin → sinh lại dòng "Thông số" tự động trên máy khách (§5.33).
    // Nạp muộn: routes/adminContent.js nặng và cũng require cmsSettings.
    let capNhat = 0;
    try {
      capNhat = await require('./adminContent').sinhLaiTruongThongTin(req);
    } catch (e) {
      console.error('[cms-settings] sinh lai truong thong tin loi:', e);
    }
    res.json({ ...data, capNhat });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
