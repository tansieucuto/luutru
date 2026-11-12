// Nhật ký thao tác và hoàn tác cho content/manifest.json cùng các file media.
//
// Mỗi thao tác GHI được bọc trong beginAction() / endAction*(). Trước khi ghi:
//   1. chụp manifest.json hiện tại         → .history/<seq>/manifest-before.json
//   2. giữ lại mọi file bị XÓA hoặc GHI ĐÈ → .history/<seq>/files/<đường-dẫn>
//   3. ghi nhớ các file MỚI được tạo (hoàn tác thì xóa đi)
// Nhờ (2) và (3), hoàn tác khôi phục được cả nội dung lẫn file media.
//
// Trạng thái "thao tác đang chạy" để ở cấp module: saveFile()/deleteFileQuiet()
// được gọi ở hàng chục chỗ, và mọi thao tác ghi đi qua hàng đợi
// withManifestLock() nên tại một thời điểm chỉ có một thao tác.
const fs = require('fs');
const path = require('path');
const { CONTENT_DIR } = require('./staticContentBundle');

const HISTORY_DIR = path.join(CONTENT_DIR, '.history');
const LOG_FILE = path.join(HISTORY_DIR, 'log.json');

// Giữ 30 thao tác gần nhất; cũ hơn thì xóa hẳn (kể cả file trong thùng rác của
// nó) để thư mục .history không phình vô hạn.
const KEEP_ACTIONS = 30;

let current = null; // { seq, dir, filesDir, moved: [], created: [] }

function readLog() {
  try {
    const arr = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeLog(entries) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
}

function nextSeq(entries) {
  return entries.reduce((max, e) => Math.max(max, e.seq || 0), 0) + 1;
}

function actionDir(seq) {
  return path.join(HISTORY_DIR, String(seq));
}

// ---------- Bắt đầu / kết thúc một thao tác ----------

function beginAction({ action, summary, user, userId }) {
  const entries = readLog();
  const seq = nextSeq(entries);
  const dir = actionDir(seq);
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });

  const manifestPath = path.join(CONTENT_DIR, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    fs.copyFileSync(manifestPath, path.join(dir, 'manifest-before.json'));
  }

  current = {
    seq,
    dir,
    filesDir: path.join(dir, 'files'),
    moved: [],
    created: [],
    // LƯU Ý: userId phải có ở đây — quyền "Biên tập chỉ hoàn tác việc của mình"
    // đối chiếu bằng userId.
    meta: { action, summary, user, userId },
  };
  return current;
}

function endActionOk(ctx, extraSummary) {
  if (!ctx) return;
  const entries = readLog();
  entries.unshift({
    seq: ctx.seq,
    at: new Date().toISOString(),
    // Tên để hiển thị trong nhật ký; userId để kiểm tra quyền hoàn tác. Mục tạo
    // trước khi có hệ tài khoản không có hai trường này → hiện "không rõ".
    user: ctx.meta.user || 'không rõ',
    userId: ctx.meta.userId || null,
    action: ctx.meta.action,
    summary: extraSummary || ctx.meta.summary,
    moved: ctx.moved,
    created: ctx.created,
  });
  writeLog(entries);
  prune(entries);
  current = null;
}

// Thao tác lỗi giữa chừng: trả lại các file đã chuyển vào thùng rác và xóa file
// vừa tạo, để không để lại rác hay mất file thật.
function endActionFail(ctx) {
  if (!ctx) return;
  try {
    for (const rel of [...ctx.moved].reverse()) restoreOne(ctx, rel);
    for (const rel of [...ctx.created].reverse()) removeQuiet(path.join(CONTENT_DIR, rel));
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  } catch {
    /* dọn dẹp hết mức có thể — không che lỗi gốc của route */
  }
  current = null;
}

function prune(entries) {
  if (entries.length <= KEEP_ACTIONS) return;
  for (const old of entries.slice(KEEP_ACTIONS)) {
    fs.rmSync(actionDir(old.seq), { recursive: true, force: true });
  }
  writeLog(entries.slice(0, KEEP_ACTIONS));
}

// ---------- Móc nối với saveFile() / deleteFileQuiet() ----------

function isTracking() {
  return current !== null;
}

// Gọi TRƯỚC khi ghi đè một file: file đã có thì cất bản gốc vào thùng rác, chưa
// có thì ghi nhớ là file mới.
function noteBeforeWrite(relPath) {
  if (!current || !relPath) return;
  const full = path.join(CONTENT_DIR, relPath);
  if (fs.existsSync(full)) {
    if (current.moved.includes(relPath) || current.created.includes(relPath)) return;
    stash(relPath, full);
    current.moved.push(relPath);
  } else if (!current.created.includes(relPath)) {
    current.created.push(relPath);
  }
}

// Đánh dấu file được ghi ra đĩa BÊN NGOÀI saveFile() — hiện chỉ có video (multer
// ghi thẳng vào content/videos/). Phải gọi thủ công, nếu không hoàn tác sẽ bỏ sót.
function noteCreatedFile(relPath) {
  if (!current || !relPath) return;
  if (!current.created.includes(relPath) && !current.moved.includes(relPath)) {
    current.created.push(relPath);
  }
}

// Gọi thay cho việc xóa hẳn: chuyển file vào thùng rác của thao tác này. Trả về
// true nếu đã xử lý (route không cần xóa nữa).
function noteDelete(relPath) {
  if (!current || !relPath) return false;
  const full = path.join(CONTENT_DIR, relPath);
  if (!fs.existsSync(full)) return true;
  if (!current.moved.includes(relPath)) {
    stash(relPath, full);
    current.moved.push(relPath);
  }
  fs.rmSync(full, { force: true });
  cleanEmptyDirs(path.dirname(full));
  return true;
}

function stash(relPath, fullPath) {
  const dest = path.join(current.filesDir, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(fullPath, dest);
}

function restoreOne(entryCtx, relPath) {
  const src = path.join(entryCtx.filesDir || path.join(actionDir(entryCtx.seq), 'files'), relPath);
  if (!fs.existsSync(src)) return;
  const dest = path.join(CONTENT_DIR, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function removeQuiet(fullPath) {
  fs.rmSync(fullPath, { force: true });
  cleanEmptyDirs(path.dirname(fullPath));
}

// Dọn thư mục rỗng sau khi xóa, nhưng không bao giờ vượt lên trên content/.
function cleanEmptyDirs(dir) {
  let d = dir;
  while (d.startsWith(CONTENT_DIR) && d !== CONTENT_DIR) {
    let entries;
    try {
      entries = fs.readdirSync(d);
    } catch {
      return;
    }
    if (entries.length) return;
    try {
      fs.rmdirSync(d);
    } catch {
      return;
    }
    d = path.dirname(d);
  }
}

// ---------- Đọc nhật ký / hoàn tác ----------

function listLog(limit = KEEP_ACTIONS) {
  return readLog()
    .slice(0, limit)
    .map((e) => ({
      seq: e.seq,
      at: e.at,
      user: e.user,
      userId: e.userId || null,
      action: e.action,
      summary: e.summary,
      fileCount: (e.moved || []).length + (e.created || []).length,
      canUndo: fs.existsSync(path.join(actionDir(e.seq), 'manifest-before.json')),
    }));
}

// Khôi phục trạng thái NGAY TRƯỚC thao tác `seq`. Các thao tác chồng lên nhau, nên
// khôi phục về một điểm cũng hoàn tác mọi thao tác SAU nó — route phải báo rõ cho
// người dùng trước khi chạy. Trả về { manifest, undoneCount, undone }; việc tăng
// bundleVersion và ghi manifest do nơi gọi lo.
function restoreTo(seq) {
  const entries = readLog();
  const idx = entries.findIndex((e) => e.seq === seq);
  if (idx === -1) throw new Error('Không tìm thấy thao tác này trong nhật ký');

  const target = entries[idx];
  const beforePath = path.join(actionDir(seq), 'manifest-before.json');
  if (!fs.existsSync(beforePath)) throw new Error('Bản chụp của thao tác này không còn, không thể hoàn tác');

  // Lần ngược từ thao tác mới nhất về thao tác đích (entries[0] là mới nhất).
  for (let i = 0; i <= idx; i++) {
    const e = entries[i];
    const ctx = { seq: e.seq, filesDir: path.join(actionDir(e.seq), 'files') };
    for (const rel of [...(e.created || [])].reverse()) {
      removeQuiet(path.join(CONTENT_DIR, rel));
    }
    for (const rel of [...(e.moved || [])].reverse()) {
      restoreOne(ctx, rel);
    }
  }

  const manifest = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
  const undone = entries.slice(0, idx + 1);
  for (const e of undone) fs.rmSync(actionDir(e.seq), { recursive: true, force: true });
  writeLog(entries.slice(idx + 1));

  return { manifest, undoneCount: undone.length, undone };
}

module.exports = {
  beginAction,
  endActionOk,
  endActionFail,
  isTracking,
  noteBeforeWrite,
  noteCreatedFile,
  noteDelete,
  listLog,
  restoreTo,
  HISTORY_DIR,
  KEEP_ACTIONS,
};
