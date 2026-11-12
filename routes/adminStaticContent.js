// API cho khối "Dữ liệu để trình chiếu" và tab "Lịch sử đóng gói" trên trang
// quản trị: xem trạng thái, xem lịch sử, và nút "Đóng gói dữ liệu".
const express = require('express');
const fs = require('fs');
const { ensureBundle, getHistory, CONTENT_DIR } = require('../staticContentBundle');
const { validateManifest } = require('./adminContent');
const authenticateToken = require('../middleware/auth');
const { requireLevel, LEVEL } = authenticateToken;

const router = express.Router();
// Xem trạng thái và lịch sử: mọi vai trò. Đóng gói: Biên tập trở lên (gắn
// riêng ở route /rebuild bên dưới).
router.use(authenticateToken, requireLevel(LEVEL.viewer));

// Trạng thái hiện tại: bundleVersion trong manifest và số khu vực/hiện vật.
router.get('/status', (req, res) => {
  try {
    const manifestPath = require('path').join(CONTENT_DIR, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    res.json({
      manifestBundleVersion: manifest.bundleVersion || null,
      zoneCount: Array.isArray(manifest.zones) ? manifest.zones.length : 0,
      exhibitCount: Array.isArray(manifest.zones)
        ? manifest.zones.reduce((sum, z) => sum + (z.exhibits ? z.exhibits.length : 0), 0)
        : 0,
    });
  } catch (err) {
    res.status(500).json({ error: `Khong doc duoc content/manifest.json: ${err.message}` });
  }
});

// Các lần đóng gói thật sự (không tính lúc phục vụ từ cache).
router.get('/history', (req, res) => {
  try {
    res.json({ history: getHistory() });
  } catch (err) {
    res.status(500).json({ error: `Khong doc duoc lich su: ${err.message}` });
  }
});

// Nút "Đóng gói dữ liệu": kiểm tra nội dung rồi ép đóng gói lại.
// Không tăng bundleVersion — xem CLAUDE.md §5.10.
router.post('/rebuild', requireLevel(LEVEL.editor), async (req, res) => {
  try {
    const manifestPath = require('path').join(CONTENT_DIR, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const problems = validateManifest(manifest);
    if (problems.length > 0) {
      return res.status(422).json({
        error: 'Không thể đóng gói: có khu vực chưa đủ điều kiện.',
        problems,
      });
    }

    const bundle = await ensureBundle(true);
    const stat = fs.statSync(bundle.filePath);
    res.json({
      ok: true,
      bundleVersion: bundle.version,
      sha256: bundle.sha256,
      size: stat.size,
      downloadUrl: `/bundle-${bundle.version}.tar.gz`,
    });
  } catch (err) {
    console.error('Loi dong goi noi dung tinh (nut thu cong):', err);
    res.status(500).json({ error: `Khong the dong goi: ${err.message}` });
  }
});

module.exports = router;
