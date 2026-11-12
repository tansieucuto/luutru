// GET /version.json và GET /bundle-<version>.tar.gz ở gốc domain (không có tiền
// tố /api/v1) — giao thức beacon-client dùng để đồng bộ nội dung
// (HttpSyncTransport). Cách đóng gói: staticContentBundle.js.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { ensureBundle, CONTENT_DIR } = require('../staticContentBundle');
const { validateManifest } = require('./adminContent');
const tamGiu = require('../tamGiuPhatHanh');

const router = express.Router();

// Kiểm tra nội dung ngay tại /version.json, vì đây là đường tablet thật sự đi:
// mọi thao tác ghi đều tăng bundleVersion và lần gọi kế tiếp tự đóng gói lại.
// Nội dung lỗi thì trả 503 và ghi log, thay vì để tablet tải về, bị app từ
// chối (BundleValidationException) rồi âm thầm giữ nội dung cũ. CLAUDE.md §5.19.
function kiemTraNoiDung() {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'manifest.json'), 'utf8'));
    return validateManifest(manifest);
  } catch (err) {
    return [`Không đọc được manifest.json: ${err.message}`];
  }
}

// ETag phải có dấu nháy kép (RFC 9110 §8.8.3). App gửi lại nguyên giá trị này
// ở header If-Range khi tải tiếp; thiếu dấu nháy thì Express hiểu nhầm là ngày
// tháng, trả 200 kèm toàn bộ file thay vì 206, và app tải lại từ đầu mỗi lần
// rớt mạng. CLAUDE.md §5.19.
function bundleEtag(sha256) {
  return `"${sha256}"`;
}

router.get('/version.json', async (req, res) => {
  try {
    // Đang tạm giữ phát hành: trả đúng gói đã chốt, bỏ qua cả bước kiểm nội dung —
    // gói đó hợp lệ lúc chốt, còn chỗ đang sửa dở trên CMS chưa phải việc của tablet.
    const giu = tamGiu.dangGiu();
    if (giu) {
      return res.json({
        bundleVersion: giu.version,
        sha256: giu.sha256,
        etag: bundleEtag(giu.sha256),
        bytes: giu.bytes,
      });
    }

    const problems = kiemTraNoiDung();
    if (problems.length) {
      console.error('[bundle] TU CHOI PHUC VU - noi dung chua du dieu kien dong goi:');
      for (const p of problems) console.error(`  - ${p}`);
      return res.status(503).json({
        error: 'Nội dung trên máy chủ đang có lỗi nên chưa phát hành được. Máy tham quan sẽ giữ nguyên nội dung cũ cho tới khi sửa xong.',
        problems,
      });
    }

    const bundle = await ensureBundle();
    // `bytes`: app bản 3D dùng để kiểm tra chỗ trống trước khi tải. Thiếu trường
    // này thì bước kiểm tra bị bỏ qua và máy đầy ổ sẽ hỏng giữa lúc giải nén.
    let bytes;
    try { bytes = fs.statSync(bundle.filePath).size; } catch { bytes = undefined; }
    res.json({
      bundleVersion: bundle.version,
      sha256: bundle.sha256,
      etag: bundleEtag(bundle.sha256),
      ...(bytes ? { bytes } : {}),
    });
  } catch (err) {
    console.error('Loi tao version.json:', err);
    res.status(500).json({ error: 'Khong the tao version.json' });
  }
});

// Tham số là một đoạn đường dẫn đơn rồi tự tách ".tar.gz", để không phụ thuộc
// cách Express xử lý dấu chấm trong pattern route.
router.get('/bundle-:versionfile', async (req, res) => {
  const { versionfile } = req.params;
  if (!versionfile.endsWith('.tar.gz')) {
    return res.status(404).json({ error: 'Duong dan khong hop le' });
  }
  const requestedVersion = versionfile.slice(0, -'.tar.gz'.length);

  try {
    const giu = tamGiu.dangGiu();
    const bundle = giu ? { version: giu.version, sha256: giu.sha256, filePath: giu.filePath } : await ensureBundle();
    if (bundle.version !== requestedVersion) {
      return res.status(404).json({ error: 'Khong tim thay dung phien ban nay' });
    }
    // Đặt ETag trước sendFile: nếu header còn trống, `send` tự sinh ETag yếu theo
    // mtime+size. ETag theo nội dung khớp với giá trị trong version.json nên
    // If-Range so sánh đúng và tải tiếp hoạt động.
    res.setHeader('ETag', bundleEtag(bundle.sha256));
    res.sendFile(bundle.filePath, (err) => {
      if (err && err.code !== 'ECONNABORTED' && !res.headersSent) {
        console.error('Loi gui bundle tinh:', err);
        res.status(err.status || 500).json({ error: 'Khong the tai bundle' });
      }
    });
  } catch (err) {
    console.error('Loi dong goi bundle tinh:', err);
    res.status(500).json({ error: 'Khong the tao bundle' });
  }
});

module.exports = router;
