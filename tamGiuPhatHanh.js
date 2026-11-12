// "Tạm giữ phát hành": chốt bản nội dung máy tham quan đang nhận, để người nhập
// liệu sửa dở giữa giờ mở cửa mà tablet không tải về nửa chừng. CLAUDE.md §5.28.
//
// Bình thường mỗi thao tác ghi tăng bundleVersion và lần GET /version.json kế tiếp
// tự đóng gói lại — tức sửa là phát hành ngay. Khi đang giữ, /version.json và
// /bundle-* chỉ phục vụ ĐÚNG gói đã chốt; nội dung trên CMS vẫn sửa bình thường.
// Bấm "Phát hành" là bỏ chốt và máy tham quan nhận bản mới ở lần hỏi kế tiếp.
//
// Gói đã chốt được giữ ở file riêng `held-<version>.tar.gz` (link cứng, không được
// thì chép): pruneOldBundles() chỉ xóa `bundle-*`, nên bấm "Đóng gói dữ liệu" vài
// lần trong lúc giữ không xóa mất thứ tablet đang tải dở.
const fs = require('fs');
const path = require('path');
const { CACHE_DIR, ensureBundle, getHistory, computeSha256, CONTENT_DIR } = require('./staticContentBundle');

const HOLD_PATH = path.join(CACHE_DIR, 'hold.json');

function docTrangThai() {
  try {
    const h = JSON.parse(fs.readFileSync(HOLD_PATH, 'utf8'));
    if (!h || !h.version || !h.file) return null;
    return h;
  } catch {
    return null;
  }
}

/**
 * Gói đang chốt, kèm đường dẫn file — hoặc null nếu không giữ. File chốt bị mất
 * (ai đó xóa tay downloads/) thì coi như không giữ và báo log: phục vụ bản mới
 * còn hơn trả 404 cho mọi máy.
 */
function dangGiu() {
  const h = docTrangThai();
  if (!h) return null;
  const filePath = path.join(CACHE_DIR, h.file);
  if (!fs.existsSync(filePath)) {
    console.error(`[tam-giu] Mat file ${h.file} - bo tam giu, phuc vu ban moi nhat.`);
    return null;
  }
  return { ...h, filePath };
}

function linkHoacChep(src, dest) {
  try { fs.unlinkSync(dest); } catch { /* chưa có */ }
  try {
    fs.linkSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
  }
}

/**
 * Chốt gói máy tham quan nhận được LÚC NÀY. Nội dung đang hợp lệ thì chốt bản mới
 * nhất (chính là bản /version.json sẽ trả); đang lỗi thì /version.json vốn đã trả
 * 503 và tablet giữ bản cũ, nên chốt bản đóng gói gần nhất còn file trên đĩa.
 */
async function batDau({ noiDungHopLe, nguoi }) {
  const daGiu = dangGiu();
  if (daGiu) return daGiu;

  let goc = null;
  if (noiDungHopLe) {
    const b = await ensureBundle();
    goc = { version: b.version, sha256: b.sha256, filePath: b.filePath };
  } else {
    for (const h of getHistory()) {
      const p = path.join(CACHE_DIR, `bundle-${h.version}.tar.gz`);
      if (!fs.existsSync(p)) continue;
      // Cùng version có thể đã đóng gói lại nhiều lần; băm lại cho chắc khớp file.
      goc = { version: h.version, sha256: await computeSha256(p), filePath: p };
      break;
    }
  }
  if (!goc) {
    const err = new Error('Chưa có gói nào để chốt: nội dung đang lỗi và chưa từng đóng gói thành công');
    err.status = 409;
    throw err;
  }

  const file = `held-${goc.version}.tar.gz`;
  linkHoacChep(goc.filePath, path.join(CACHE_DIR, file));
  const trangThai = {
    version: goc.version,
    sha256: goc.sha256,
    bytes: fs.statSync(path.join(CACHE_DIR, file)).size,
    file,
    luc: new Date().toISOString(),
    boi: nguoi || null,
  };
  const tmp = `${HOLD_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(trangThai, null, 2));
  fs.renameSync(tmp, HOLD_PATH);
  return { ...trangThai, filePath: path.join(CACHE_DIR, file) };
}

function ketThuc() {
  const h = docTrangThai();
  try { fs.unlinkSync(HOLD_PATH); } catch { /* không giữ */ }
  if (h && h.file) {
    try { fs.unlinkSync(path.join(CACHE_DIR, h.file)); } catch { /* đã mất */ }
  }
  return h;
}

/** bundleVersion trong manifest hiện tại — để giao diện so "đang giữ" với "trên CMS". */
function banTrenCms() {
  try {
    return JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'manifest.json'), 'utf8')).bundleVersion || null;
  } catch {
    return null;
  }
}

module.exports = { dangGiu, batDau, ketThuc, banTrenCms };
