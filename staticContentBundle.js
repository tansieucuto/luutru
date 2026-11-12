// Đóng gói content/manifest.json + images/ + audio/ thành bundle-<bundleVersion>.tar.gz,
// phục vụ qua GET /version.json và GET /bundle-<version>.tar.gz (routes/staticContent.js)
// — giao thức mà beacon-client dùng (http_sync_transport.dart).
//
// bundleVersion lấy thẳng từ content/manifest.json; module này không tự sinh số
// phiên bản. Mô hình 3D KHÔNG nằm trong bundle (xem models3d.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tar = require('tar');

const { CONTENT_DIR, DOWNLOADS_DIR } = require('./paths');
const MANIFEST_PATH = path.join(CONTENT_DIR, 'manifest.json');
const CACHE_DIR = path.join(DOWNLOADS_DIR, 'static-content');
const HISTORY_PATH = path.join(CACHE_DIR, 'history.json');
const MAX_HISTORY_ENTRIES = 100;

let cached = null; // { version, sha256, filePath, fingerprint }
let inFlight = null; // Promise của lần nén đang chạy — xem ensureBundle()
let fingerprintCache = null; // { value, at } — xem contentFingerprint()

// Tính lại dấu vân tay nội dung tối đa 5 giây một lần: mọi GET /version.json đều
// cần nó, mà quét cây thư mục tốn stat() theo số file.
const FINGERPRINT_TTL_MS = 5000;

// Chỉ giữ N file bundle mới nhất. Mỗi lúc chỉ MỘT phiên bản được phục vụ
// (routes/staticContent.js trả 404 cho phiên bản khác), nên file cũ là rác — giữ
// vài bản để còn khôi phục tay.
const KEEP_BUNDLES = 3;

// Ghi một dòng lịch sử mỗi lần THẬT SỰ đóng gói lại (không tính lúc phục vụ từ
// cache); mới nhất ở đầu mảng.
function appendHistory(entry) {
  let history = [];
  try {
    history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  } catch {
    history = [];
  }
  history.unshift(entry);
  if (history.length > MAX_HISTORY_ENTRIES) history.length = MAX_HISTORY_ENTRIES;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

function getHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  } catch {
    return [];
  }
}

// Duyệt đệ quy một thư mục, gom (đường dẫn tương đối, kích thước, mtime) của mọi
// file — để biết nội dung có đổi không mà không phải đọc toàn bộ byte.
function collectEntries(dir, prefix, out) {
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Thư mục không tồn tại (vd. chưa có audio/) — coi như rỗng.
  }
  for (const ent of names) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      collectEntries(full, rel, out);
    } else {
      try {
        const st = fs.statSync(full);
        out.push(`${rel}:${st.size}:${st.mtimeMs}`);
      } catch {
        // File vừa bị xóa giữa chừng — bỏ qua.
      }
    }
  }
}

// Dấu vân tay của TOÀN BỘ dữ liệu sẽ được đóng gói (manifest + images + audio).
// Thay file ảnh/âm thanh thẳng trên đĩa (copy tay, rsync) mà không đụng
// manifest.json cũng làm cache hết hiệu lực và bundle được nén lại. Chỉ đọc
// size + mtime, không đọc nội dung, nên chi phí không tăng theo dung lượng.
// CLAUDE.md §5.10.
function contentFingerprint() {
  const now = Date.now();
  if (fingerprintCache && now - fingerprintCache.at < FINGERPRINT_TTL_MS) {
    return fingerprintCache.value;
  }
  const entries = [];
  try {
    const st = fs.statSync(MANIFEST_PATH);
    entries.push(`manifest.json:${st.size}:${st.mtimeMs}`);
  } catch {
    // Không có manifest thì ensureBundle() sẽ báo lỗi rõ ràng ngay sau đó.
  }
  collectEntries(path.join(CONTENT_DIR, 'images'), 'images', entries);
  collectEntries(path.join(CONTENT_DIR, 'audio'), 'audio', entries);
  entries.sort();
  const value = crypto.createHash('sha1').update(entries.join('\n')).digest('hex');
  fingerprintCache = { value, at: now };
  return value;
}

function readBundleVersion() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!manifest.bundleVersion) {
    throw new Error('content/manifest.json thieu truong bundleVersion');
  }
  return manifest.bundleVersion;
}

// Xóa các file bundle-*.tar.gz cũ, giữ KEEP_BUNDLES file mới nhất (luôn giữ
// keepPath). Lỗi khi xóa đều bỏ qua — dọn rác thất bại không được làm hỏng việc
// phục vụ bundle.
function pruneOldBundles(keepPath) {
  let names;
  try {
    names = fs.readdirSync(CACHE_DIR);
  } catch {
    return;
  }
  const bundles = [];
  for (const name of names) {
    if (!name.startsWith('bundle-') || !name.endsWith('.tar.gz')) continue;
    const full = path.join(CACHE_DIR, name);
    try {
      bundles.push({ full, mtimeMs: fs.statSync(full).mtimeMs });
    } catch {
      // File vừa bị tiến trình khác xóa — bỏ qua.
    }
  }
  bundles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const b of bundles.slice(KEEP_BUNDLES)) {
    if (b.full === keepPath) continue;
    try {
      fs.unlinkSync(b.full);
    } catch {
      // Không xóa được thì lần sau dọn tiếp.
    }
  }
}

/** manifest.json + mọi FILE trong images/ và audio/, đường dẫn tương đối, đã SẮP XẾP. */
function danhSachFileTatDinh() {
  const out = ['manifest.json'];
  const duyet = (rel) => {
    for (const ten of fs.readdirSync(path.join(CONTENT_DIR, rel)).sort()) {
      const r = `${rel}/${ten}`;
      const st = fs.statSync(path.join(CONTENT_DIR, r));
      if (st.isDirectory()) duyet(r);
      else if (st.isFile()) out.push(r);
    }
  };
  for (const thuMuc of ['images', 'audio']) {
    if (fs.existsSync(path.join(CONTENT_DIR, thuMuc))) duyet(thuMuc);
  }
  return out;
}

async function packBundle(version) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const destPath = path.join(CACHE_DIR, `bundle-${version}.tar.gz`);
  const tmpPath = `${destPath}.tmp-${process.pid}`;

  // Đóng gói TẤT ĐỊNH: cùng nội dung phải ra cùng sha256 bất kể mtime — danh sách
  // file đã sắp xếp, mtime ép về 0, bỏ uid/gid (`portable`). Nếu không, rsync hay
  // khôi phục sao lưu chạm mtime sẽ đổi mã băm và làm hỏng việc tải tiếp của app
  // (If-Range lệch). Chỉ liệt kê FILE (noDirRecurse): app tự tạo thư mục cha khi
  // giải nén. CLAUDE.md §5.22c.
  const entries = danhSachFileTatDinh();

  // gzip mức 1 thay vì 6: nội dung nặng nhất là ảnh JPG/PNG và MP3 vốn đã nén,
  // nén lại gần như không giảm byte mà tốn nhiều CPU.
  await tar.c({
    gzip: { level: 1 }, file: tmpPath, cwd: CONTENT_DIR,
    portable: true, mtime: new Date(0), noDirRecurse: true,
  }, entries);
  fs.renameSync(tmpPath, destPath);
  return destPath;
}

function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Chỉ đóng gói lại khi nội dung THẬT SỰ đổi (xem contentFingerprint()) hoặc chưa
// từng đóng gói. force=true (nút "Đóng gói dữ liệu") bỏ qua cache.
async function ensureBundle(force = false) {
  fs.statSync(MANIFEST_PATH); // Báo lỗi ngay nếu thiếu manifest.
  const version = readBundleVersion();
  const fingerprint = contentFingerprint();

  if (
    !force &&
    cached &&
    cached.version === version &&
    cached.fingerprint === fingerprint &&
    fs.existsSync(cached.filePath)
  ) {
    return cached;
  }

  // Chống nén SONG SONG: ngay sau khi có nội dung mới, nhiều máy gọi /version.json
  // cùng lúc — gộp về một lần nén, các request còn lại chờ chung kết quả.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const filePath = await packBundle(version);
    const sha256 = await computeSha256(filePath);
    const size = fs.statSync(filePath).size;
    cached = { version, sha256, filePath, fingerprint };
    appendHistory({ timestamp: new Date().toISOString(), version, sha256, size });
    pruneOldBundles(filePath);
    return cached;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

module.exports = { ensureBundle, getHistory, computeSha256, CONTENT_DIR, CACHE_DIR };
