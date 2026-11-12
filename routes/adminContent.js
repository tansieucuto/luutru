// CRUD cho content/manifest.json: khu vực, hiện vật, ngôn ngữ, sao lưu, nhập ZIP,
// nhật ký/hoàn tác và kiểm tra toàn vẹn.
//
// Số ngôn ngữ đọc từ manifest.languages, không cố định vi/en. Ngôn ngữ mặc định
// dùng tên trường trơn (vd "name"), ngôn ngữ khác thêm hậu tố "_<lang>" (vd
// "name_zh") — xem getLangSetup(). Trường ở ngôn ngữ khác là tùy chọn.
//
// LƯU Ý: mỗi khu vực phải có ≥ 1 hiện vật hợp lệ, nếu không app từ chối cả
// bundle (xem validateManifest()).
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const multer = require('multer');
const models3d = require('../models3d');
const dungAnh = require('../turntableRenderer');
const { parseBuffer } = require('music-metadata');
const authenticateToken = require('../middleware/auth');
const { requireLevel, LEVEL } = authenticateToken;
const customFields = require('../customFields');
const cmsSettingsMod = require('../cmsSettings');
const { CONTENT_DIR } = require('../staticContentBundle');
const history = require('../contentHistory');
const { roleLevel, ROLE_LABEL } = require('../userStore');

const router = express.Router();

// ==================== PHÂN QUYỀN ====================
// File có ~30 route nên gắn middleware cho từng route rất dễ bỏ sót. Thay vào
// đó dùng MỘT cổng chung, mặc định an toàn:
//
//   GET                         -> Chỉ xem trở lên
//   mọi method khác             -> Biên tập trở lên
//   đường dẫn trong OWNER_ONLY  -> chỉ Chủ
//
// Nhờ vậy route ghi thêm sau này tự động đòi quyền Biên tập; quên khai báo thì
// nghiêng về phía CHẶT hơn, không phải phía lộ ra.
//
// LƯU Ý: đây là ranh giới bảo mật thật. Việc ẩn nút trong admin.js chỉ là lớp
// cho dễ dùng; gọi thẳng API vẫn bị chặn ở đây.
const OWNER_ONLY = [
  // Thay thế TOÀN BỘ kho nội dung — thao tác phá hủy nhất hệ thống.
  { method: 'POST', re: /^\/import$/ },
  // Ghi đè toàn bộ nội dung về một thời điểm cũ.
  { method: 'POST', re: /^\/language-backups\/[^/]+\/restore$/ },
  { method: 'POST', re: /^\/import-backups\/[^/]+\/restore$/ },
  // Xóa hẳn bản sao lưu — mất đường lui.
  { method: 'DELETE', re: /^\/language-backups\/[^/]+$/ },
  { method: 'DELETE', re: /^\/import-backups\/[^/]+$/ },
  // Thêm/xóa ngôn ngữ: xóa ngôn ngữ kéo theo xóa file audio của cả kho.
  { method: 'PUT', re: /^\/languages$/ },
];

router.use(authenticateToken, (req, res, next) => {
  const p = req.path;
  const needed = OWNER_ONLY.some((r) => r.method === req.method && r.re.test(p))
    ? LEVEL.owner
    : (req.method === 'GET' ? LEVEL.viewer : LEVEL.editor);
  return requireLevel(needed)(req, res, next);
});

const MANIFEST_PATH = path.join(CONTENT_DIR, 'manifest.json');
const SEQUENCE_FILE = path.join(CONTENT_DIR, '.version-sequence.json');

// ---------- Đọc/ghi manifest.json an toàn (hàng đợi chống ghi đè) ----------
let writeQueue = Promise.resolve();
function withManifestLock(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

// Như withManifestLock nhưng ghi nhật ký + chụp ảnh để hoàn tác. Dùng cho MỌI
// thao tác ghi. `meta.summary` là câu hiện trên nhật ký cho người dùng đọc, nên
// viết theo lời người dùng ("Xóa hiện vật ..."), không phải tên kỹ thuật.
// `req` là tham số ĐẦU TIÊN để mọi thao tác ghi đều buộc nói rõ AI làm.
function withHistory(req, meta, fn) {
  return withManifestLock(async () => {
    const ctx = history.beginAction({
      ...meta,
      user: req?.userName || req?.userLogin || 'không rõ',
      userId: req?.userId || null,
    });
    try {
      const result = await fn(ctx);
      history.endActionOk(ctx, ctx.meta.summary);
      return result;
    } catch (err) {
      history.endActionFail(ctx);
      throw err;
    }
  });
}

// Đọc manifest mới từ đĩa — dùng cho route GHI (kết quả sẽ bị sửa rồi ghi lại
// nên KHÔNG được dùng bản dùng chung trong bộ nhớ đệm).
function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

// Bản dùng chung cho các route CHỈ ĐỌC. Ở quy mô vài nghìn hiện vật, manifest
// nặng hàng chục MB và phân tích lại mỗi request tốn ~42 ms (đo với 5000 hiện
// vật). Bộ nhớ đệm bỏ hẳn chi phí đó khi không có gì thay đổi.
// LƯU Ý: chỉ ĐỌC kết quả này. Sửa vào nó là sửa thẳng vào bản dùng chung của
// mọi request sau, kể cả khi thao tác ghi thất bại.
let manifestCache = null;
function readManifestCached() {
  const st = fs.statSync(MANIFEST_PATH);
  if (manifestCache && manifestCache.mtimeMs === st.mtimeMs && manifestCache.size === st.size) {
    return manifestCache.data;
  }
  const data = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  manifestCache = { mtimeMs: st.mtimeMs, size: st.size, data };
  return data;
}

function writeManifest(manifest) {
  chuanHoaDaiAnh(manifest);
  dongBoMedia(manifest);
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  manifestCache = null;
}

// ---------------------------------------------------------------------------
// `exhibit.media[]` — hình dạng MỚI mà ứng dụng đọc, sinh từ các trường cũ
// ---------------------------------------------------------------------------
//
// LƯU Ý: đây là BẢN CHIẾU, không phải nguồn sự thật. Đừng sửa `media[]` bằng
// tay ở bất kỳ route nào: nó bị ghi đè mỗi lần `writeManifest()` chạy. Nguồn
// sự thật vẫn là `image` / `thumbnail` / `images[]` / `model3dId` — các trường
// đơn giản mà biểu mẫu CMS đã biết cách sửa.
//
// Vì sao sinh ở đây chứ không ở từng route: có nhiều đường ghi hiện vật (tạo,
// sửa, thêm ảnh vào dải...). Gắn tay vào từng chỗ là sẽ sót, và sót nghĩa là
// một hiện vật không có `media[]` -> ứng dụng bản mới bỏ hiện vật đó -> khu vực
// rỗng -> BundleValidationException -> vứt cả gói.
//
// Vì sao giữ cả hai hình dạng: nhánh `main` của beacon-client đọc `image` +
// `thumbnail`; nhánh `epic/exhibit-3d-models` đọc `media[]` và không còn đọc
// `image`. Cả hai bộ phân tích đều bỏ qua khóa lạ, nên manifest mang cả hai
// chạy đúng trên cả hai bản app.
//
// LƯU Ý: bỏ `image`/`thumbnail` khi tablet chưa lên bản 3D là HỎNG NGAY — bộ
// phân tích cũ đòi `image` (_reqPath) và sẽ bỏ cả hiện vật. Chỉ được bỏ sau khi
// TOÀN BỘ máy đã chạy bản có `media[]`.

/** Đường dẫn ảnh từ một phần tử `images[]` — chấp nhận cả 2 hình dạng đang tồn tại. */
function duongDanAnh(im) {
  return typeof im === 'string' ? im : (im && typeof im.file === 'string' ? im.file : null);
}

// ---------------------------------------------------------------------------
// `images[]` luôn là MẢNG CHUỖI đường dẫn — thông tin phụ nằm ở `imagesMeta`
// ---------------------------------------------------------------------------
//
// LƯU Ý: app bản `main` (`ManifestParser._optExtraImages`) chỉ nhận `item is
// String` và bỏ thẳng mọi phần tử object. Trước đây form tải ảnh phụ ghi object
// {file, originalName, …} vào `images[]`, nên mọi ảnh phụ tải lên từ CMS biến mất
// trên tablet mà không ai báo. Nay `images[]` chỉ chứa chuỗi; tên gốc / dung
// lượng / ngày tải (CMS cần để hiện) cất ở `imagesMeta: {đường dẫn: {...}}` —
// trường lạ, app không đọc nên không ảnh hưởng gì.
//
// Chạy ở `writeManifest()` (cùng chỗ `dongBoMedia`) nên mọi đường ghi — kể cả
// hoàn tác, khôi phục sao lưu, nhập ZIP chứa dữ liệu dạng cũ — đều ra đúng
// hình dạng. Dữ liệu object cũ được chuyển dần sang dạng mới ở lần ghi kế tiếp.
const IMAGE_META_KEYS = ['originalName', 'sizeBytes', 'uploadedAt'];

function chuanHoaAnhPhuCua(owner) {
  if (!Array.isArray(owner.images)) {
    if (owner.images === undefined) delete owner.imagesMeta;
    return; // dữ liệu hỏng: để nguyên cho integrity-check báo, không tự đoán
  }
  const metaCu = owner.imagesMeta && typeof owner.imagesMeta === 'object' ? owner.imagesMeta : {};
  const ds = [];
  const meta = {};
  for (const im of owner.images) {
    const f = duongDanAnh(im);
    if (!f || ds.includes(f)) continue;
    ds.push(f);
    const nguon = typeof im === 'string' ? metaCu[f] : im;
    if (!nguon || typeof nguon !== 'object') continue;
    const m = {};
    for (const k of IMAGE_META_KEYS) if (nguon[k] !== undefined) m[k] = nguon[k];
    if (Object.keys(m).length) meta[f] = m;
  }
  if (ds.length) owner.images = ds; else delete owner.images;
  if (Object.keys(meta).length) owner.imagesMeta = meta; else delete owner.imagesMeta;
}

function chuanHoaDaiAnh(manifest) {
  for (const zone of manifest.zones || []) {
    chuanHoaAnhPhuCua(zone);
    for (const ex of zone.exhibits || []) chuanHoaAnhPhuCua(ex);
  }
}

/** Dải ảnh ở dạng CMS hiển thị: [{file, originalName?, sizeBytes?, uploadedAt?}]. */
function anhPhuChoCms(owner) {
  const meta = owner.imagesMeta || {};
  return (owner.images || []).map(duongDanAnh).filter(Boolean).map((f) => ({ file: f, ...(meta[f] || {}) }));
}

/**
 * Sinh lại `media[]` cho mọi hiện vật trong manifest.
 *
 * Thứ tự mang NGỮ NGHĨA, không phải sở thích (3d-handover.md mục 4):
 *   media[0]    sân khấu màn 04c
 *   media[1..]  lưới tư liệu ở đáy
 *
 * LƯU Ý: mô hình BẮT BUỘC ở media[0]. Vuốt ngang trên mô hình là XOAY nó, nên
 * cuộn phim không lật trang được — mô hình ở giữa dải là một trang không ngón
 * tay nào tới được. Bộ phân tích bên ứng dụng bỏ thẳng `model` không đứng đầu,
 * nên đặt sai ở đây là mất mô hình mà không ai báo.
 */
function dongBoMedia(manifest) {
  for (const zone of manifest.zones || []) {
    for (const ex of zone.exhibits || []) {
      const media = [];
      const daCo = new Set();
      const thumbChinh = ex.thumbnail || ex.image;

      // 1. Mô hình 3D, nếu hiện vật có gắn. Poster và thumb mượn ảnh hiện vật: chúng
      //    luôn tồn tại và luôn đúng tỷ lệ, nên không bao giờ sinh ra media[0] hỏng.
      //    Sau này muốn ảnh poster riêng thì thêm trường, không phải đổi cấu trúc.
      if (ex.model3dId && models3d.MODEL_ID_RULE.test(ex.model3dId) && ex.image) {
        // Poster/thumb THẬT (dựng từ chính file .glb — turntableRenderer.js) khi đã
        // có cho ĐÚNG bản file hiện tại. Poster thật khớp từng pixel với khung đầu
        // của dải ảnh xoay phủ lên nó, nên lúc dải ảnh sẵn sàng không có cú nháy nào.
        // Chưa dựng xong (hoặc vừa thay file) thì lùi về ảnh hiện vật: vẫn hợp lệ,
        // chỉ là không khớp khung.
        const st = models3d.docStills(ex.model3dId);
        media.push({
          type: 'model',
          id: ex.model3dId,
          poster: st ? st.poster : ex.image,
          thumb: st ? st.thumb : thumbChinh,
        });
      }

      // 2. Ảnh chính.
      if (ex.image) {
        media.push({ type: 'image', file: ex.image, thumb: thumbChinh });
        daCo.add(ex.image);
      }

      // 3. Dải ảnh phụ. `thumb` là chính ảnh đó — dải ảnh cũ không có ảnh nhỏ
      //    riêng, và một ô lưới nặng hơn vẫn tốt hơn một ô trống.
      //
      //    KHÔNG kiểm file có thật trên đĩa ở đây: `writeManifest()` chạy ở mọi
      //    thao tác ghi, và với kho 3000 hiện vật thì vài nghìn lần `stat` mỗi lần
      //    bấm Lưu là cái giá không đáng. Việc báo file thiếu do `runIntegrityCheck`
      //    làm, đúng một chỗ.
      for (const im of ex.images || []) {
        const f = duongDanAnh(im);
        if (!f || daCo.has(f)) continue;
        daCo.add(f);
        media.push({ type: 'image', file: f, thumb: f });
      }

      if (media.length) ex.media = media;
      else delete ex.media;
    }
  }
  return manifest;
}

// Sinh bundleVersion dạng "YYYY.MM.DD-NN", tăng NN trong cùng ngày.
function bumpVersion(manifest) {
  const now = new Date();
  const datePart = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
  let state = { date: '', seq: 0 };
  try {
    state = JSON.parse(fs.readFileSync(SEQUENCE_FILE, 'utf8'));
  } catch {
    state = { date: '', seq: 0 };
  }
  const seq = state.date === datePart ? state.seq + 1 : 1;
  fs.writeFileSync(SEQUENCE_FILE, JSON.stringify({ date: datePart, seq }));
  manifest.bundleVersion = `${datePart}-${String(seq).padStart(2, '0')}`;
  manifest.generatedAt = now.toISOString();
}

function slugify(text) {
  const base = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'item';
}

function uniqueSlug(base, existingIds) {
  if (!existingIds.includes(base)) return base;
  let i = 2;
  while (existingIds.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// Ghép 1 ngôn ngữ vào object đa ngôn ngữ hiện có, không ghi đè các ngôn ngữ khác.
function mergeLocalized(existing, lang, value) {
  const next = { ...(existing || {}) };
  if (value && value.trim()) next[lang] = value.trim();
  else delete next[lang];
  return next;
}

// Parse specs[] từ form (chuỗi JSON): mỗi dòng bắt buộc có label + value ở ngôn
// ngữ mặc định, thiếu là cả hiện vật bị loại. Các ngôn ngữ khác tùy chọn.
function parseSpecs(raw, fallbackLang) {
  if (raw === undefined || raw === null || raw === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Định dạng thông số kỹ thuật (specs) không hợp lệ');
  }
  if (!Array.isArray(parsed)) throw new HttpError(400, 'Thông số kỹ thuật (specs) phải là một danh sách');
  return parsed.map((s, i) => {
    const fb = s?.[fallbackLang] || {};
    const labelFb = String(fb.label || '').trim();
    const valueFb = String(fb.value || '').trim();
    if (!labelFb || !valueFb) {
      throw new HttpError(400, `Thông số kỹ thuật dòng #${i + 1}: thiếu nhãn hoặc giá trị (${fallbackLang})`);
    }
    const label = { [fallbackLang]: labelFb };
    const value = { [fallbackLang]: valueFb };
    for (const lang of Object.keys(s || {})) {
      if (lang === fallbackLang) continue;
      const l = String(s[lang]?.label || '').trim();
      const v = String(s[lang]?.value || '').trim();
      if (l) label[lang] = l;
      if (v) value[lang] = v;
    }
    return { label, value };
  });
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Gom output của multer .any() thành map {fieldname: [file, ...]} như upload.fields().
function filesByField(reqFiles) {
  const map = {};
  for (const f of reqFiles || []) {
    (map[f.fieldname] = map[f.fieldname] || []).push(f);
  }
  return map;
}
const anyUpload = upload.any();

// Đọc { languages, fallbackLanguage, otherLanguages } từ manifest, dùng chung cho zones/exhibits.
function getLangSetup(manifest) {
  const languages = manifest.languages && manifest.languages.length ? manifest.languages : ['vi'];
  const fallbackLanguage = manifest.fallbackLanguage && languages.includes(manifest.fallbackLanguage)
    ? manifest.fallbackLanguage
    : languages[0];
  const otherLanguages = languages.filter((l) => l !== fallbackLanguage);
  return { languages, fallbackLanguage, otherLanguages };
}

// CHỈ nhận .mp3. App đọc được cả m4a/ogg, nhưng chủ dự án chốt một định dạng
// duy nhất để dễ kiểm soát nội dung. Trang admin chặn sẵn đúng bộ này
// (ALLOWED_AUDIO_EXT trong admin.js).
const AUDIO_MIME_EXT = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
};
const ALLOWED_AUDIO_EXT = new Set(['mp3']);

// Đuôi file được phép NẰM TRONG GÓI ZIP nhập nội dung. Rộng hơn bộ ở trên vì
// gói ZIP được chuẩn bị sẵn bên ngoài, không đi qua ffmpeg (CLAUDE.md §5.12).
const IMPORT_ALLOWED_EXT = {
  images: new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']),
  audio: new Set(['mp3', 'm4a', 'ogg', 'wav']),
};

// Kiểm tra 1 đường dẫn lấy từ ZIP trước khi ghi ra đĩa. Trả về đường dẫn tuyệt
// đối an toàn, hoặc null nếu phải bỏ qua entry đó.
//
// Chặn 2 kiểu tấn công:
//  1) zip-slip: "images/../../../root/.ssh/authorized_keys" THỎA startsWith('images/')
//     nhưng path.join giải ".." ra ngoài CONTENT_DIR. So tiền tố chuỗi là KHÔNG
//     ĐỦ — phải so trên đường dẫn đã resolve.
//  2) file thực thi được: content/ được express.static phục vụ công khai, nên
//     "images/note.html" sẽ chạy script cùng origin với admin.html và đọc được
//     token quản trị trong sessionStorage.
function safeImportDest(relPath) {
  const norm = String(relPath || '').replace(/\\/g, '/');
  const sub = norm.startsWith('images/') ? 'images' : norm.startsWith('audio/') ? 'audio' : null;
  if (!sub) return null;
  // Chặn đường dẫn tuyệt đối, ổ đĩa Windows, và mọi đoạn ".." / "." / rỗng.
  if (path.isAbsolute(norm) || /^[a-zA-Z]:/.test(norm)) return null;
  const parts = norm.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  const ext = path.extname(norm).replace('.', '').toLowerCase();
  if (!IMPORT_ALLOWED_EXT[sub].has(ext)) return null;
  // Chốt chặn cuối: dù 3 bước trên có sơ hở thì đường dẫn đã resolve vẫn phải
  // nằm trong CONTENT_DIR. Thêm path.sep để "content-media" không lọt qua khi so
  // với tiền tố "content".
  const full = path.resolve(CONTENT_DIR, norm);
  const root = path.resolve(CONTENT_DIR) + path.sep;
  if (!full.startsWith(root)) return null;
  return full;
}

function audioExtension(file) {
  const ext = path.extname(file.originalname || '').replace('.', '').toLowerCase();
  if (ext) {
    // Xét đuôi file TRƯỚC mimetype: mimetype do trình duyệt/hệ điều hành đoán, có
    // lúc báo "audio/mpeg" cho cả file không phải mp3 — tin nó trước thì file m4a
    // đổi tên vẫn lọt qua và bị lưu thành .mp3.
    if (ALLOWED_AUDIO_EXT.has(ext)) return ext;
  } else if (AUDIO_MIME_EXT[(file.mimetype || '').toLowerCase()]) {
    return AUDIO_MIME_EXT[(file.mimetype || '').toLowerCase()];
  }
  throw new HttpError(
    400,
    `Định dạng audio không được hỗ trợ: "${file.originalname || file.mimetype}" — chỉ nhận file .mp3.`
  );
}

// durationSec <= 0 bị client âm thầm bỏ qua track đó — phải báo lỗi ngay lúc upload.
async function audioDuration(buffer, mimetype, originalname) {
  let meta;
  try {
    meta = await parseBuffer(buffer, mimetype || 'audio/mpeg');
  } catch {
    throw new HttpError(400, `Không đọc được file audio (file lỗi hoặc sai định dạng): "${originalname || ''}"`);
  }
  const duration = Math.round((meta.format.duration || 0) * 100) / 100;
  if (!(duration > 0)) {
    throw new HttpError(400, `Không xác định được thời lượng audio hợp lệ: "${originalname || ''}"`);
  }
  return duration;
}

// ==================== CHUẨN HÓA MEDIA (ffmpeg) ====================
// Mọi ảnh/audio tải lên qua form thêm/sửa khu vực & hiện vật được đưa về đúng
// một định dạng trước khi lưu: ảnh -> JPEG, audio -> mp3 tối đa 128 kbps.
// KHÔNG áp dụng cho nhập gói ZIP (POST /import) — gói ZIP coi như đã chuẩn bị
// sẵn bên ngoài, giải nén nguyên trạng.
//
// Dùng ffmpeg hệ thống thay vì thư viện npm (sharp/ffmpeg-static): máy chủ thật
// chạy Alpine (musl), còn ffmpeg-static chỉ có bản glibc. `apk add ffmpeg` là
// gọn nhất, và dùng ffmpeg cho cả ảnh lẫn audio thì chỉ phải cài MỘT thứ.
const AUDIO_MAX_BITRATE_KBPS = 128;

function runFfmpeg(args, inputBuffer, whatFailed) {
  return new Promise((resolve, reject) => {
    const proc = execFile(
      'ffmpeg',
      args,
      { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if (err.code === 'ENOENT') {
            return reject(new HttpError(500, 'Server chưa cài ffmpeg nên không xử lý được media. Chạy "apk add ffmpeg" trên server rồi thử lại.'));
          }
          const detail = String(stderr || '').trim().split('\n').pop() || err.message;
          return reject(new HttpError(400, `${whatFailed}: ${detail}`));
        }
        if (!stdout || !stdout.length) {
          return reject(new HttpError(400, `${whatFailed}: kết quả rỗng (file nguồn có thể bị hỏng).`));
        }
        resolve(stdout);
      }
    );
    // ffmpeg có thể thoát sớm (file nguồn hỏng) khi ta còn đang ghi stdin -> EPIPE.
    // Nuốt lỗi ở đây vì lý do thật đã nằm trong stderr ở callback trên.
    proc.stdin.on('error', () => {});
    proc.stdin.end(inputBuffer);
  });
}

// Ảnh -> JPEG. Vùng trong suốt (PNG/WEBP có alpha) được lót nền TRẮNG, nếu
// không mjpeg sẽ biến phần trong suốt thành đen.
async function toJpeg(buffer, originalname) {
  return runFfmpeg(
    [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-frames:v', '1',
      '-filter_complex',
      '[0]format=rgba,split=2[bg][fg];[bg]drawbox=c=white@1:t=fill[bgw];[bgw][fg]overlay=format=auto',
      '-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj420p',
      '-f', 'image2', 'pipe:1',
    ],
    buffer,
    `Không chuyển được ảnh "${originalname || ''}" sang JPEG`
  );
}

// Audio -> mp3, 128 kbps là MỨC TRẦN: file đã <= 128 kbps thì giữ nguyên, không
// mã hóa lại (mã hóa lại nguồn đã nén chỉ làm giảm chất lượng và phình gói tải
// về, không được gì).
async function toMp3CappedBitrate(buffer, mimetype, originalname) {
  let bitrate = 0;
  try {
    const meta = await parseBuffer(buffer, mimetype || 'audio/mpeg');
    bitrate = meta.format.bitrate || 0;
  } catch {
    throw new HttpError(400, `Không đọc được file audio (file lỗi hoặc sai định dạng): "${originalname || ''}"`);
  }
  if (bitrate && bitrate <= AUDIO_MAX_BITRATE_KBPS * 1000 * 1.02) { // chừa 2% sai số cho VBR
    // Dưới mức trần -> KHÔNG mã hóa lại: phần đã mất khi nén lần đầu là mất hẳn,
    // mã hóa lại chỉ cắt thêm một lớp và làm file to gấp đôi.
    //
    // Nhưng vẫn cho qua ffmpeg với -c:a copy: chép NGUYÊN luồng âm thanh (không mã
    // hóa lại) rồi dựng file sạch, nhờ đó bỏ tag ID3/ảnh bìa/dữ liệu lạ nhét kèm.
    try {
      return await runFfmpeg(
        [
          '-hide_banner', '-loglevel', 'error',
          '-i', 'pipe:0',
          '-vn',                    // bỏ ảnh bìa
          '-map_metadata', '-1',    // bỏ tag ID3
          '-c:a', 'copy',           // CHÉP luồng âm thanh, KHÔNG mã hóa lại
          '-f', 'mp3', 'pipe:1',
        ],
        buffer,
        `Không xử lý được audio "${originalname || ''}"`
      );
    } catch (err) {
      // Ưu tiên tuyệt đối: upload KHÔNG BAO GIỜ hỏng vì bước làm sạch này — nó chỉ
      // là lớp phòng vệ thêm. Thiếu ffmpeg, ffmpeg quá cũ, hay file mp3 hơi lạ đều
      // rơi về đây và lưu nguyên bản gốc.
      return buffer;
    }
  }
  return runFfmpeg(
    [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn',                    // bỏ ảnh bìa nếu có, khỏi phình file
      '-map_metadata', '-1',    // bỏ tag ID3 thừa
      '-codec:a', 'libmp3lame', '-b:a', `${AUDIO_MAX_BITRATE_KBPS}k`,
      '-f', 'mp3', 'pipe:1',
    ],
    buffer,
    `Không nén được audio "${originalname || ''}" về ${AUDIO_MAX_BITRATE_KBPS} kbps`
  );
}

function saveFile(relPath, buffer) {
  // Báo cho nhật ký TRƯỚC khi ghi đè: file cũ được cất giữ để còn hoàn tác, file
  // mới thì ghi nhớ để hoàn tác sẽ xóa đi (xem contentHistory.js).
  history.noteBeforeWrite(relPath);
  const full = path.join(CONTENT_DIR, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
}

// Xóa file, dọn luôn thư mục cha nếu rỗng sau đó.
function deleteFileQuiet(relPath) {
  if (!relPath) return;
  // Đang trong một thao tác có nhật ký -> chuyển vào thùng rác của thao tác đó
  // (đồng bộ, để thứ tự hoàn tác đúng) thay vì xóa hẳn.
  if (history.noteDelete(relPath)) return;
  const full = path.join(CONTENT_DIR, relPath);
  fs.rm(full, { force: true }, () => {
    const dir = path.dirname(full);
    fs.readdir(dir, (err, entries) => {
      if (!err && entries.length === 0) fs.rmdir(dir, () => {});
    });
  });
}

// Sao chép file vào thư mục backup (giữ nguyên đường dẫn tương đối) rồi xóa bản
// gốc — dùng khi xóa ngôn ngữ, để còn đường khôi phục thủ công nếu lỡ tay.
function backupAndRemoveFile(relPath, backupDir) {
  if (!relPath) return;
  try {
    const src = path.join(CONTENT_DIR, relPath);
    const dest = path.join(backupDir, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  } catch (err) {
    // File có thể đã không tồn tại — bỏ qua, vẫn xóa bình thường.
  }
  deleteFileQuiet(relPath);
}

// ==================== CHỐNG HAI NGƯỜI SỬA CÙNG LÚC ====================
// Biểu mẫu gửi lên TẤT CẢ các ô với giá trị đọc được LÚC MỞ FORM. Nếu A sửa mô
// tả lúc 10:00 và B (mở form từ 09:59) bấm lưu lúc 10:01, biểu mẫu của B vẫn
// mang mô tả CŨ -> sửa của A biến mất mà không ai được báo.
//
// Cách chặn: lúc mở form, server gửi kèm "rev" — dấu vân tay của đối tượng.
// Lúc lưu, client gửi rev đó lại; nếu trên đĩa đã khác thì từ chối với 409.
// Người lưu sau phải tải lại (mất công gõ), nhưng KHÔNG BAO GIỜ mất dữ liệu
// âm thầm.
//
// Băm cả đối tượng thay vì thêm trường "version" vào manifest: không phải đổi
// cấu trúc dữ liệu, không phải lo các bản ghi cũ chưa có trường đó.
function objectRev(obj) {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 12);
}

// Gọi NGAY TRƯỚC khi sửa đối tượng, trong route ghi.
// Không gửi rev (vd gọi từ script) thì bỏ qua kiểm tra — cố ý để không làm hỏng
// các cách dùng khác; trang admin luôn gửi.
function assertRev(sentRev, currentObj, what) {
  if (!sentRev) return;
  if (sentRev !== objectRev(currentObj)) {
    throw new HttpError(409,
      `Người khác vừa sửa ${what} này trong lúc bạn đang mở biểu mẫu. ` +
      // Không chấm cuối câu: chỗ hiển thị tự thêm "." (pushNotification).
      `Hãy đóng biểu mẫu, mở lại để xem nội dung mới nhất rồi sửa lại — ` +
      `nếu lưu đè bây giờ sẽ xóa mất thay đổi của họ`);
  }
}

// Tên hiển thị (ngôn ngữ mặc định) — dùng cho câu tóm tắt trong nhật ký.
function dispName(nameObj, fallbackLanguage) {
  return (nameObj && (nameObj[fallbackLanguage] || Object.values(nameObj)[0])) || '';
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Khu vực cần ≥ 1 hiện vật hợp lệ. Trước khi cho đóng gói còn chạy
// runIntegrityCheck() (mục "KIỂM TRA TÍNH TOÀN VẸN" bên dưới) để chặn file
// thiếu, thiếu trường bắt buộc, trùng ID — tránh phát hành bundle hỏng cho
// khách thật.
function validateManifest(manifest) {
  const problems = [];
  if (!Array.isArray(manifest.zones) || manifest.zones.length === 0) {
    problems.push('Chưa có khu vực nào — cần ít nhất 1 khu vực (kèm ≥1 hiện vật) trước khi đóng gói.');
  }
  // Khu vực rỗng đã được runIntegrityCheck bắt ở mức 'error' nên KHÔNG lặp lại
  // vòng kiểm riêng ở đây — sẽ ra 2 dòng y hệt nhau.
  problems.push(...runIntegrityCheck(manifest)
    .filter((f) => f.severity === 'error')
    .map((f) => f.message));
  return problems;
}

// ---------- GET toàn bộ manifest (UI dùng để hiện danh sách) ----------
router.get('/', (req, res) => {
  try {
    res.json(readManifestCached());
  } catch (err) {
    res.status(500).json({ error: `Không đọc được manifest: ${err.message}` });
  }
});

// ==================== PHÂN TRANG (cho kho lớn) ====================
// Với 3000 hiện vật manifest nặng ~13,6 MB, trình duyệt không thể tải và vẽ cả
// kho một lúc. Các route dưới trả dữ liệu đã cắt trang và ĐÃ LỌC BỚT (không kèm
// transcript, specs, danh sách video...) nên nhẹ hơn nhiều.

function paginate(items, page, pageSize) {
  const total = items.length;
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
  const pageCount = Math.max(Math.ceil(total / size), 1);
  const current = Math.min(Math.max(parseInt(page, 10) || 1, 1), pageCount);
  return {
    items: items.slice((current - 1) * size, current * size),
    total,
    page: current,
    pageSize: size,
    pageCount,
  };
}

function matchesQuery(nameObj, id, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (String(id || '').toLowerCase().includes(needle)) return true;
  return Object.values(nameObj || {}).some((v) => String(v || '').toLowerCase().includes(needle));
}

// Danh sách khu vực đã cắt trang. Mỗi khu vực chỉ kèm số lượng hiện vật, KHÔNG
// kèm mảng exhibits — thứ làm response phình to ở kho lớn.
router.get('/zones-page', (req, res) => {
  try {
    const manifest = readManifestCached();
    const { q, page, pageSize } = req.query;
    const zones = (manifest.zones || [])
      .filter((z) => matchesQuery(z.name, z.id, q))
      .map((z) => ({
        id: z.id,
        major: z.major,
        name: z.name,
        heroImage: z.heroImage,
        exhibitCount: (z.exhibits || []).length,
        videoCount: (z.videos || []).length,
      }));
    res.json({
      ...paginate(zones, page, pageSize),
      totalZones: (manifest.zones || []).length,
      totalExhibits: (manifest.zones || []).reduce((s, z) => s + (z.exhibits || []).length, 0),
    });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được danh sách khu vực: ${err.message}` });
  }
});

// Giá trị các trường bật "hiện trong danh sách" (đọc cả dữ liệu cũ listing.price/area).
function giaTriDanhSach(e) {
  const out = {};
  for (const f of cmsSettingsMod.doc().fields) {
    if (!f.inList) continue;
    const v = customFields.giaTri(e, f.id);
    if (v !== undefined) out[f.id] = v;
  }
  return Object.keys(out).length ? out : null;
}

// Hiện vật của 1 khu vực, đã cắt trang. Chỉ trả các trường danh sách cần hiện.
router.get('/zones/:zoneId/exhibits-page', (req, res) => {
  try {
    const manifest = readManifestCached();
    const zone = (manifest.zones || []).find((z) => z.id === req.params.zoneId);
    if (!zone) return res.status(404).json({ error: 'Không tìm thấy khu vực' });
    const { q, page, pageSize, status } = req.query;
    const exhibits = (zone.exhibits || [])
      .filter((e) => matchesQuery(e.name, e.id, q))
      .filter((e) => !status || (status === '__none' ? !e.listing?.status : e.listing?.status === status))
      .map((e) => ({
        id: e.id,
        minor: e.minor,
        name: e.name,
        thumbnail: e.thumbnail || e.image,
        videoCount: (e.videos || []).length,
        listing: e.listing || null,
        fields: giaTriDanhSach(e),
      }));
    res.json({ ...paginate(exhibits, page, pageSize), zoneId: zone.id, zoneName: zone.name });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được danh sách hiện vật: ${err.message}` });
  }
});

// 1 khu vực đầy đủ, KHÔNG kèm mảng exhibits (trang sửa khu vực không dùng tới,
// mà ở kho lớn đây là phần nặng nhất).
router.get('/zones/:zoneId', (req, res) => {
  try {
    const manifest = readManifestCached();
    const zone = (manifest.zones || []).find((z) => z.id === req.params.zoneId);
    if (!zone) return res.status(404).json({ error: 'Không tìm thấy khu vực' });
    const { exhibits, ...rest } = zone;
    // rev băm trên phần KHÔNG gồm exhibits: sửa 1 hiện vật bên trong không được làm
    // hỏng biểu mẫu sửa khu vực của người khác (2 việc độc lập nhau).
    res.json({ ...rest, exhibitCount: (exhibits || []).length, rev: objectRev(rest) });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được khu vực: ${err.message}` });
  }
});

// 1 hiện vật đầy đủ — trang sửa gọi riêng thay vì tìm trong cả manifest.
router.get('/zones/:zoneId/exhibits/:exhibitId', (req, res) => {
  try {
    const manifest = readManifestCached();
    const zone = (manifest.zones || []).find((z) => z.id === req.params.zoneId);
    if (!zone) return res.status(404).json({ error: 'Không tìm thấy khu vực' });
    const exhibit = (zone.exhibits || []).find((e) => e.id === req.params.exhibitId);
    if (!exhibit) return res.status(404).json({ error: 'Không tìm thấy hiện vật' });
    res.json({ ...exhibit, rev: objectRev(exhibit) });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được hiện vật: ${err.message}` });
  }
});

// ==================== NHẬT KÝ THAO TÁC + HOÀN TÁC ====================
router.get('/history', (req, res) => {
  try {
    const entries = history.listLog();
    // Gửi kèm ngưỡng để giao diện cảnh báo TRƯỚC khi thao tác cũ bị xóa hẳn — vượt
    // 30 thao tác thì bản cũ nhất mất luôn, không hoàn tác về xa hơn được nữa.
    res.json({ entries, keepActions: history.KEEP_ACTIONS, count: entries.length });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được nhật ký: ${err.message}` });
  }
});

// Khôi phục về trạng thái NGAY TRƯỚC thao tác `seq`. Các thao tác sau đó cũng bị
// hoàn tác theo — giao diện phải báo rõ số lượng trước khi gọi.
router.post('/history/:seq/undo', async (req, res) => {
  try {
    // Không bọc trong withHistory: chính việc hoàn tác không được ghi thành một mục
    // nhật ký mới (sẽ thành đệ quy và làm rối danh sách). Vẫn dùng hàng đợi
    // withManifestLock để không đụng thao tác ghi khác đang chạy.
    await withManifestLock(async () => {
      const seq = parseInt(req.params.seq, 10);

      // Hoàn tác là "kéo lùi thời gian": lùi về mục #n sẽ hoàn tác LUÔN mọi thao tác
      // sau nó. Nên Biên tập chỉ được lùi khi TẤT CẢ các mục bị kéo theo đều là việc
      // của chính họ — nếu không, họ sẽ âm thầm xóa mất thay đổi của người khác. Chủ
      // thì lùi được bất kỳ đâu.
      if (roleLevel(req.userRole) < LEVEL.owner) {
        const entries = history.listLog();
        const idx = entries.findIndex((e) => e.seq === seq);
        if (idx < 0) throw new HttpError(404, 'Không tìm thấy thao tác này trong nhật ký');
        const cuaNguoiKhac = entries.slice(0, idx + 1).filter((e) => e.userId !== req.userId);
        if (cuaNguoiKhac.length) {
          const ten = [...new Set(cuaNguoiKhac.map((e) => e.user).filter(Boolean))];
          throw new HttpError(403,
            `Hoàn tác về đây sẽ hủy luôn ${cuaNguoiKhac.length} thao tác của người khác` +
            `${ten.length ? ` (${ten.join(', ')})` : ''}. ` +
            `Tài khoản Biên tập chỉ hoàn tác được việc của chính mình — hãy nhờ tài khoản Chủ.`);
        }
      }

      const { manifest, undoneCount } = history.restoreTo(seq);
      bumpVersion(manifest); // PHẢI tăng version, nếu không máy đã đồng bộ sẽ không tải lại
      writeManifest(manifest);
      res.json({ ok: true, undoneCount, bundleVersion: manifest.bundleVersion });
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.get('/validate', (req, res) => {
  try {
    res.json({ problems: validateManifest(readManifest()) });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được manifest: ${err.message}` });
  }
});

// ==================== CHUỖI GIAO DIỆN APP (trường `ui`) ====================
// Client tự lùi: ui[lang][key] -> ui[fallbackLang][key] -> mặc định có sẵn trong
// app. Để trống một ô là không sao, không cần kiểm gì thêm.
// ==================== TIỆN ÍCH NHẬP LIỆU (2026-10-04, CLAUDE.md §5.27) ====================

// Số beacon đã dùng — biểu mẫu gợi ý số còn trống và báo trùng NGAY KHI GÕ, hộp "Sắp
// xếp" và "Chuyển khu vực" cũng dùng. Nhẹ: chỉ id/số/tên, không kèm nội dung.
router.get('/numbers', (req, res) => {
  try {
    const m = readManifestCached();
    const fb = getLangSetup(m).fallbackLanguage;
    res.json({
      deskMajor: m.beacon?.deskMajor ?? null,
      zones: (m.zones || []).map((z) => ({
        id: z.id,
        major: z.major,
        name: dispName(z.name, fb) || z.id,
        exhibits: (z.exhibits || []).map((e) => ({ id: e.id, minor: e.minor, name: dispName(e.name, fb) || e.id })),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được dữ liệu: ${err.message}` });
  }
});

// Chuyển hiện vật sang khu vực khác. Không phải dời file nào: mã hiện vật là duy nhất
// trên cả bảo tàng và đường dẫn ảnh/audio đặt theo mã hiện vật, không theo khu vực.
router.post('/zones/:zoneId/exhibits/:exhibitId/move', async (req, res) => {
  try {
    await withHistory(req, { action: 'exhibit.move', summary: 'Chuyển hiện vật sang khu vực khác' }, async (ctx) => {
      const { zoneId, exhibitId } = req.params;
      const manifest = readManifest();
      const { fallbackLanguage } = getLangSetup(manifest);
      const tu = manifest.zones.find((z) => z.id === zoneId);
      if (!tu) throw new HttpError(404, 'Không tìm thấy khu vực');
      const i = tu.exhibits.findIndex((e) => e.id === exhibitId);
      if (i < 0) throw new HttpError(404, 'Không tìm thấy hiện vật');
      const den = manifest.zones.find((z) => z.id === String(req.body?.toZoneId || ''));
      if (!den) throw new HttpError(404, 'Không tìm thấy khu vực muốn chuyển tới');
      if (den.id === tu.id) throw new HttpError(400, 'Hiện vật đang ở chính khu vực này rồi');

      const ex = tu.exhibits[i];
      const ten = dispName(ex.name, fallbackLanguage) || ex.id;
      // LƯU Ý: chặn chuyển hiện vật CUỐI CÙNG. Khu vực rỗng là lỗi đỏ, máy chủ ngừng
      // phát hành gói mới cho tới khi sửa — một cú chuyển là đứng cả bảo tàng.
      if (tu.exhibits.length === 1) {
        throw new HttpError(409, `"${ten}" là hiện vật duy nhất của khu vực "${dispName(tu.name, fallbackLanguage) || tu.id}". `
          + 'Chuyển đi thì khu vực đó trống và máy tablet sẽ không nhận nội dung mới. Thêm hiện vật khác cho khu vực đó trước, hoặc xóa khu vực.');
      }
      const rawMinor = req.body?.minor;
      const minor = rawMinor === undefined || rawMinor === null || rawMinor === '' ? ex.minor : Number(rawMinor);
      if (!Number.isInteger(minor) || minor < 1 || minor > 65535) {
        throw new HttpError(400, 'Minor phải là số nguyên từ 1 đến 65535');
      }
      const trung = den.exhibits.find((e) => e.minor === minor);
      if (trung) {
        throw new HttpError(409, `Số Minor ${minor} đã dùng cho "${dispName(trung.name, fallbackLanguage) || trung.id}" ở khu vực đích. Chọn số khác.`);
      }

      tu.exhibits.splice(i, 1);
      ex.minor = minor;
      den.exhibits.push(ex);
      ctx.meta.summary = `Chuyển "${ten}" từ khu vực "${dispName(tu.name, fallbackLanguage) || tu.id}" `
        + `sang "${dispName(den.name, fallbackLanguage) || den.id}" (major ${den.major}, minor ${minor})`;
      bumpVersion(manifest);   // BẮT BUỘC — CLAUDE.md §5.10
      writeManifest(manifest);
      res.json({ ok: true, toZoneId: den.id, major: den.major, minor, bundleVersion: manifest.bundleVersion });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Sắp lại thứ tự. App hiện khu vực/hiện vật ĐÚNG theo thứ tự trong manifest (không tự
// sắp theo số). Nhận CẢ danh sách mới một lần — cả lần sắp xếp là MỘT mục nhật ký;
// lưu từng bước ↑↓ thì vài lần kéo là đẩy hết 30 mục hoàn tác cũ ra ngoài.
function sapLai(cu, ids, ten) {
  const nhan = Array.isArray(ids) ? ids.map(String) : null;
  const daCo = cu.map((x) => x.id);
  if (!nhan || nhan.length !== daCo.length || new Set(nhan).size !== nhan.length
      || !nhan.every((id) => daCo.includes(id))) {
    // Có người vừa thêm/xóa trong lúc hộp sắp xếp đang mở: không đoán, bắt mở lại.
    throw new HttpError(409, `Danh sách ${ten} vừa thay đổi trong lúc bạn sắp xếp. Đóng hộp rồi mở lại để thấy bản mới nhất.`);
  }
  const theoId = new Map(cu.map((x) => [x.id, x]));
  return nhan.map((id) => theoId.get(id));
}

router.put('/zones-order', async (req, res) => {
  try {
    await withHistory(req, { action: 'zone.order', summary: 'Sắp xếp lại thứ tự khu vực' }, async () => {
      const manifest = readManifest();
      const moi = sapLai(manifest.zones || [], req.body?.ids, 'khu vực');
      if (moi.every((z, i) => z === manifest.zones[i])) return res.json({ ok: true, unchanged: true });
      manifest.zones = moi;
      bumpVersion(manifest);
      writeManifest(manifest);
      res.json({ ok: true, bundleVersion: manifest.bundleVersion });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/zones/:zoneId/exhibits-order', async (req, res) => {
  try {
    await withHistory(req, { action: 'exhibit.order', summary: 'Sắp xếp lại thứ tự hiện vật' }, async (ctx) => {
      const manifest = readManifest();
      const zone = manifest.zones.find((z) => z.id === req.params.zoneId);
      if (!zone) throw new HttpError(404, 'Không tìm thấy khu vực');
      const moi = sapLai(zone.exhibits || [], req.body?.ids, 'hiện vật');
      if (moi.every((e, i) => e === zone.exhibits[i])) return res.json({ ok: true, unchanged: true });
      zone.exhibits = moi;
      ctx.meta.summary = `Sắp xếp lại thứ tự hiện vật trong khu vực "${dispName(zone.name, getLangSetup(manifest).fallbackLanguage) || zone.id}"`;
      bumpVersion(manifest);
      writeManifest(manifest);
      res.json({ ok: true, bundleVersion: manifest.bundleVersion });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Độ đầy đủ theo ngôn ngữ — CHỈ ĐỌC. Ngôn ngữ thiếu không phải lỗi (app tự lùi về ngôn
// ngữ mặc định) nên kiểm tra toàn vẹn không báo; bảng này cho biết còn thiếu bao nhiêu.
// Chỉ tính CHỮ: audio là thu âm thật, không dịch được — cột audio chỉ để tham khảo.
// Một trường chỉ bị tính "thiếu" khi ngôn ngữ mặc định CÓ nội dung ở trường đó.
router.get('/language-coverage', (req, res) => {
  try {
    const m = readManifestCached();
    const { fallbackLanguage: fb, otherLanguages } = getLangSetup(m);
    const co = (obj, lang) => Boolean(obj && typeof obj[lang] === 'string' && obj[lang].trim());
    const thieuChu = (cacTruong, lang) => cacTruong
      .filter(([, obj]) => co(obj, fb) && !co(obj, lang))
      .map(([ten]) => ten);
    const tong = Object.fromEntries(otherLanguages.map((l) => [l, { du: 0, tong: 0, audio: 0 }]));
    const rows = [];

    for (const z of m.zones || []) {
      const zRow = { loai: 'zone', zoneId: z.id, ten: dispName(z.name, fb) || z.id, major: z.major, lang: {} };
      for (const l of otherLanguages) {
        const thieu = thieuChu([['tên', z.name], ['giới thiệu', z.welcomeText]], l);
        const audio = Boolean(z.introAudio?.tracks?.[l]?.file);
        zRow.lang[l] = { thieu, audio };
        tong[l].tong += 1; if (!thieu.length) tong[l].du += 1; if (audio) tong[l].audio += 1;
      }
      rows.push(zRow);
      for (const e of z.exhibits || []) {
        const eRow = { loai: 'exhibit', zoneId: z.id, exhibitId: e.id, ten: dispName(e.name, fb) || e.id, minor: e.minor, lang: {} };
        for (const l of otherLanguages) {
          const truong = [['tên', e.name], ['tóm tắt', e.summary], ['ý nghĩa', e.meaning]];
          const sinh = Array.isArray(e.fieldSpecs) ? e.fieldSpecs.length : 0;
          (e.specs || []).forEach((sp, i) => {
            // Dòng sinh từ trường thông tin: nói rõ tên trường để người dịch biết sửa ở đâu
            // (nhãn → cài đặt trường; giá trị → ô của trường đó trong biểu mẫu).
            const ten = i < sinh ? `trường "${sp.label?.[fb] || e.fieldSpecs[i]}"` : `thông số ${i - sinh + 1}`;
            truong.push([`${ten} (nhãn)`, sp.label], [`${ten} (giá trị)`, sp.value]);
          });
          const thieu = thieuChu(truong, l);
          const audio = Boolean(e.audio?.tracks?.[l]?.file);
          eRow.lang[l] = { thieu, audio };
          tong[l].tong += 1; if (!thieu.length) tong[l].du += 1; if (audio) tong[l].audio += 1;
        }
        rows.push(eRow);
      }
    }
    res.json({ fallbackLanguage: fb, languages: otherLanguages, tong, rows });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được dữ liệu: ${err.message}` });
  }
});

router.get('/ui-strings', (req, res) => {
  try {
    const manifest = readManifest();
    res.json({
      languages: manifest.languages || [],
      fallbackLanguage: manifest.fallbackLanguage || null,
      ui: manifest.ui || {},
    });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được manifest: ${err.message}` });
  }
});

router.put('/ui-strings', async (req, res) => {
  try {
    await withHistory(req, { action: 'ui-strings.update', summary: 'Cập nhật chuỗi giao diện ứng dụng' }, async (ctx) => {
      const manifest = readManifest();
      const { ui } = req.body || {};
      if (!ui || typeof ui !== 'object') throw new HttpError(400, 'Thiếu dữ liệu ui');

      manifest.ui = manifest.ui || {};
      for (const lang of Object.keys(ui)) {
        if (!(manifest.languages || []).includes(lang)) continue; // chỉ nhận ngôn ngữ đã khai báo trong languages
        const langMap = ui[lang];
        if (!langMap || typeof langMap !== 'object') continue;
        manifest.ui[lang] = manifest.ui[lang] || {};
        for (const key of Object.keys(langMap)) {
          const value = String(langMap[key] ?? '').trim();
          if (value) manifest.ui[lang][key] = value;
          else delete manifest.ui[lang][key];
        }
        if (Object.keys(manifest.ui[lang]).length === 0) delete manifest.ui[lang];
      }

      bumpVersion(manifest);
      writeManifest(manifest);
      res.json({ ui: manifest.ui });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ==================== NGÔN NGỮ (languages / fallbackLanguage / languageNames) ====================
// Bỏ một ngôn ngữ khỏi danh sách sẽ xóa sạch dữ liệu liên quan (ui, nội dung
// zones/exhibits, file audio) — có sao lưu vào content/.language-backups/ trước.
router.get('/languages', (req, res) => {
  try {
    const manifest = readManifest();
    res.json({
      languages: manifest.languages || [],
      fallbackLanguage: manifest.fallbackLanguage || null,
      languageNames: manifest.languageNames || {},
    });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được manifest: ${err.message}` });
  }
});

router.put('/languages', async (req, res) => {
  try {
    await withHistory(req, { action: 'languages.update', summary: 'Cập nhật danh sách ngôn ngữ' }, async (ctx) => {
      const manifest = readManifest();
      const { languages, fallbackLanguage, languageNames } = req.body || {};
      if (!Array.isArray(languages) || languages.length === 0) {
        throw new HttpError(400, 'Danh sách ngôn ngữ không được để trống');
      }
      const cleanLangs = [...new Set(languages.map((l) => String(l || '').trim().toLowerCase()).filter(Boolean))];
      if (!cleanLangs.length) throw new HttpError(400, 'Danh sách ngôn ngữ không hợp lệ');
      for (const l of cleanLangs) {
        if (!/^[a-z]{2,3}$/.test(l)) {
          throw new HttpError(400, `Mã ngôn ngữ không hợp lệ: "${l}" — chỉ nhận 2-3 chữ cái (vd vi, en, zh)`);
        }
      }
      const fb = String(fallbackLanguage || '').trim().toLowerCase();
      if (!cleanLangs.includes(fb)) {
        throw new HttpError(400, `Ngôn ngữ mặc định "${fb}" phải nằm trong danh sách ngôn ngữ`);
      }

      // Đổi ngôn ngữ mặc định sang một ngôn ngữ còn thiếu dữ liệu sẽ làm app sập CẢ
      // BUNDLE (khu vực thiếu tên/audio ở ngôn ngữ mặc định là lỗi chết toàn bộ,
      // không chỉ riêng khu vực đó) — chặn trước khi lưu.
      if (fb !== manifest.fallbackLanguage) {
        const fbGaps = findMissingLanguageCoverage(manifest, fb);
        if (fbGaps.length) {
          return res.status(422).json({
            error: `Không thể đặt "${fb}" làm ngôn ngữ mặc định — còn thiếu dữ liệu bắt buộc, nếu lưu app sẽ không tải được nội dung.`,
            problems: fbGaps,
          });
        }
      }

      // Ngôn ngữ bị bỏ khỏi danh sách -> xóa sạch dữ liệu liên quan (ui, tên/mô tả
      // khu vực - hiện vật, specs, file audio), nhưng sao lưu trước vào
      // content/.language-backups/ để còn đường khôi phục thủ công nếu lỡ tay.
      // Ngôn ngữ được THÊM mới (không xóa gì) cũng tự sao lưu một bản nhẹ (chỉ
      // manifest, không đụng file) để có mốc khôi phục.
      const removedLangs = (manifest.languages || []).filter((l) => !cleanLangs.includes(l));
      const addedLangs = cleanLangs.filter((l) => !(manifest.languages || []).includes(l));
      let backupDir = null;
      if (removedLangs.length) {
        const backupId = `${Date.now()}-${removedLangs.join('-')}`;
        backupDir = path.join(CONTENT_DIR, '.language-backups', backupId);
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, 'manifest-before.json'), JSON.stringify(manifest, null, 2));
        fs.writeFileSync(path.join(backupDir, 'meta.json'), JSON.stringify({
          backupId,
          type: 'language-delete',
          languages: manifest.languages || [],
          removedLanguages: removedLangs,
          createdAt: new Date().toISOString(),
          bundleVersionBefore: manifest.bundleVersion,
        }, null, 2));

        for (const lang of removedLangs) {
          if (manifest.ui) delete manifest.ui[lang];
          for (const zone of manifest.zones || []) {
            if (zone.name) delete zone.name[lang];
            if (zone.welcomeText) delete zone.welcomeText[lang];
            const zoneTrack = zone.introAudio?.tracks?.[lang];
            if (zoneTrack?.file) backupAndRemoveFile(zoneTrack.file, backupDir);
            if (zone.introAudio?.tracks) delete zone.introAudio.tracks[lang];
            for (const ex of zone.exhibits || []) {
              if (ex.name) delete ex.name[lang];
              if (ex.summary) delete ex.summary[lang];
              if (ex.meaning) delete ex.meaning[lang];
              for (const spec of ex.specs || []) {
                if (spec.label) delete spec.label[lang];
                if (spec.value) delete spec.value[lang];
              }
              const exTrack = ex.audio?.tracks?.[lang];
              if (exTrack?.file) backupAndRemoveFile(exTrack.file, backupDir);
              if (ex.audio?.tracks) delete ex.audio.tracks[lang];
            }
          }
        }
      } else if (addedLangs.length) {
        const backupId = `${Date.now()}-add-${addedLangs.join('-')}`;
        backupDir = path.join(CONTENT_DIR, '.language-backups', backupId);
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, 'manifest-before.json'), JSON.stringify(manifest, null, 2));
        fs.writeFileSync(path.join(backupDir, 'meta.json'), JSON.stringify({
          backupId,
          type: 'language-add',
          languages: manifest.languages || [],
          removedLanguages: [],
          addedLanguages: addedLangs,
          createdAt: new Date().toISOString(),
          bundleVersionBefore: manifest.bundleVersion,
        }, null, 2));
      }
      if (backupDir) pruneOldBackups(MAX_BACKUPS_KEEP);

      manifest.languages = cleanLangs;
      manifest.fallbackLanguage = fb;
      manifest.languageNames = {};
      if (languageNames && typeof languageNames === 'object') {
        for (const l of cleanLangs) {
          const nm = String(languageNames[l] || '').trim();
          if (nm) manifest.languageNames[l] = nm;
        }
      }

      bumpVersion(manifest);
      writeManifest(manifest);
      res.json({
        languages: manifest.languages,
        fallbackLanguage: manifest.fallbackLanguage,
        languageNames: manifest.languageNames,
        removedLanguages: removedLangs,
        backupPath: backupDir ? path.relative(CONTENT_DIR, backupDir) : null,
      });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ==================== BẢN SAO LƯU DỮ LIỆU (content/.language-backups/) ====================
// Thư mục chứa cả bản sao lưu tự động (khi xóa/thêm ngôn ngữ) lẫn thủ công
// (nút "Sao lưu ngay") — phân biệt qua trường meta.type.
const LANGUAGE_BACKUPS_DIR = path.join(CONTENT_DIR, '.language-backups');
const MAX_BACKUPS_KEEP = 10;

// Chỉ giữ tối đa MAX_BACKUPS_KEEP bản gần nhất, xóa bớt bản cũ để không tích tụ
// vô hạn (mỗi bản có thể kèm vài MB ảnh/audio).
function pruneOldBackups(maxKeep) {
  try {
    if (!fs.existsSync(LANGUAGE_BACKUPS_DIR)) return;
    const names = fs.readdirSync(LANGUAGE_BACKUPS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => (b > a ? 1 : -1)); // tên thư mục bắt đầu bằng timestamp -> mới nhất trước
    for (const name of names.slice(maxKeep)) {
      fs.rmSync(path.join(LANGUAGE_BACKUPS_DIR, name), { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Loi don dep ban sao luu cu:', err);
  }
}

// Sao lưu thủ công toàn bộ dữ liệu hiện tại (manifest + ảnh + audio), bất kỳ
// lúc nào.
router.post('/language-backups', async (req, res) => {
  try {
    await withHistory(req, { action: 'backup.create', summary: 'Tạo bản sao lưu dữ liệu' }, async (ctx) => {
      const manifest = readManifest();
      const backupId = `${Date.now()}-manual`;
      const backupDir = path.join(LANGUAGE_BACKUPS_DIR, backupId);
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, 'manifest-before.json'), JSON.stringify(manifest, null, 2));
      fs.writeFileSync(path.join(backupDir, 'meta.json'), JSON.stringify({
        backupId,
        type: 'manual',
        languages: manifest.languages || [],
        removedLanguages: [],
        createdAt: new Date().toISOString(),
        bundleVersionBefore: manifest.bundleVersion,
      }, null, 2));
      for (const sub of ['images', 'audio']) {
        const src = path.join(CONTENT_DIR, sub);
        if (fs.existsSync(src)) fs.cpSync(src, path.join(backupDir, sub), { recursive: true });
      }
      pruneOldBackups(MAX_BACKUPS_KEEP);
      res.status(201).json({ ok: true, backupId, backupPath: path.relative(CONTENT_DIR, backupDir) });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/language-backups', (req, res) => {
  try {
    if (!fs.existsSync(LANGUAGE_BACKUPS_DIR)) return res.json({ backups: [] });
    const entries = fs.readdirSync(LANGUAGE_BACKUPS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory());

    const backups = entries.map((e) => {
      const dir = path.join(LANGUAGE_BACKUPS_DIR, e.name);
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
        return meta;
      } catch {
        // Bản sao lưu cũ (trước khi có meta.json) — suy ra thông tin từ tên thư mục.
        return { backupId: e.name, removedLanguages: [], createdAt: null, bundleVersionBefore: null };
      }
    }).sort((a, b) => (b.backupId > a.backupId ? 1 : -1));

    res.json({ backups, maxKeep: MAX_BACKUPS_KEEP, count: backups.length });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được danh sách sao lưu: ${err.message}` });
  }
});

router.delete('/language-backups/:backupId', (req, res) => {
  try {
    const { backupId } = req.params;
    // Chỉ cho phép tên thư mục thuần (không có /, .., ký tự lạ) — chặn path traversal.
    if (!/^[a-zA-Z0-9_-]+$/.test(backupId)) {
      throw new HttpError(400, 'Mã sao lưu không hợp lệ');
    }
    const backupDir = path.join(LANGUAGE_BACKUPS_DIR, backupId);
    if (!fs.existsSync(backupDir)) {
      throw new HttpError(404, 'Không tìm thấy bản sao lưu này');
    }
    fs.rmSync(backupDir, { recursive: true, force: true });
    res.status(204).end();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/language-backups/:backupId/restore', async (req, res) => {
  try {
    await withHistory(req, { action: 'backup.restore', summary: 'Áp dụng lại bản sao lưu' }, async (ctx) => {
      const { backupId } = req.params;
      // Chỉ cho phép tên thư mục thuần (không có /, .., ký tự lạ) — chặn path traversal.
      if (!/^[a-zA-Z0-9_-]+$/.test(backupId)) {
        throw new HttpError(400, 'Mã sao lưu không hợp lệ');
      }
      const backupDir = path.join(LANGUAGE_BACKUPS_DIR, backupId);
      const backupManifestPath = path.join(backupDir, 'manifest-before.json');
      if (!fs.existsSync(backupManifestPath)) {
        throw new HttpError(404, 'Không tìm thấy bản sao lưu này');
      }

      // Phục hồi file ảnh/audio đã bị xóa (chỉ PHỤC HỒI — không đụng file đang có).
      // Bản sao lưu xóa ngôn ngữ chỉ có audio; bản sao lưu thủ công có cả images.
      for (const sub of ['images', 'audio']) {
        const backupSubDir = path.join(backupDir, sub);
        if (fs.existsSync(backupSubDir)) {
          fs.cpSync(backupSubDir, path.join(CONTENT_DIR, sub), { recursive: true });
        }
      }

      const restoredManifest = JSON.parse(fs.readFileSync(backupManifestPath, 'utf8'));
      // Dọn file thừa TRƯỚC khi ghi manifest: runIntegrityCheck đọc file từ đĩa và
      // đối chiếu với manifest được truyền vào, không phụ thuộc file đã ghi.
      const removedOrphans = cleanOrphansAfterRestore(restoredManifest);
      bumpVersion(restoredManifest);
      writeManifest(restoredManifest);

      res.json({
        ok: true,
        languages: restoredManifest.languages,
        fallbackLanguage: restoredManifest.fallbackLanguage,
        languageNames: restoredManifest.languageNames,
        removedOrphanCount: removedOrphans.length,
      });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ==================== TÊN BẢO TÀNG (museum.name) ====================
// Hiện trên màn hình chào của app, và là tên của cả hệ thống quản trị: tiêu đề trang,
// tên người gửi thư, tên trong ứng dụng xác thực (tenBaoTang.js). Nhờ vậy một bộ mã
// nguồn dùng cho nhiều bảo tàng mà không phải sửa chữ nào trong code.
router.get('/museum', (req, res) => {
  try {
    const manifest = readManifestCached();
    res.json({ name: manifest.museum?.name || {} });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được manifest: ${err.message}` });
  }
});

router.put('/museum', async (req, res) => {
  try {
    await withHistory(req, { action: 'museum.update', summary: 'Đổi tên bảo tàng' }, async () => {
      const manifest = readManifest();
      const { languages, fallbackLanguage } = getLangSetup(manifest);
      const input = req.body?.name || {};
      const name = {};
      for (const lang of languages) {
        const v = String(input[lang] ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (v) name[lang] = v;
      }
      if (!name[fallbackLanguage]) {
        throw new HttpError(400, `Tên bảo tàng ở ngôn ngữ mặc định (${fallbackLanguage}) là bắt buộc`);
      }
      manifest.museum = { ...(manifest.museum || {}), name };
      bumpVersion(manifest); // app phải tải lại mới thấy tên mới — CLAUDE.md §5.10
      writeManifest(manifest);
      res.json({ name });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ==================== CẤU HÌNH BEACON (zoneChangeConfirmSeconds / phân xử nâng cao) ====================
// Đều là trường tùy chọn, client tự dùng mặc định nếu thiếu.
const BEACON_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/beacon-config', (req, res) => {
  try {
    const manifest = readManifest();
    const arb = (manifest.beacon && manifest.beacon.arbitration) || {};
    res.json({
      zoneChangeConfirmSeconds: manifest.zoneChangeConfirmSeconds ?? null,
      uuid: manifest.beacon?.uuid ?? null,
      deskMajor: manifest.beacon?.deskMajor ?? null,
      minDeltaDb: arb.minDeltaDb ?? null,
      dwellSeconds: arb.dwellSeconds ?? null,
      lockoutSeconds: arb.lockoutSeconds ?? null,
      zoneSilenceSeconds: arb.zoneSilenceSeconds ?? null,
      deskDwellSeconds: arb.deskDwellSeconds ?? null,
      sessionSilenceMinutes: arb.sessionSilenceMinutes ?? null,
      engageAtMeters: arb.engageAtMeters ?? null,
      releaseAtMeters: arb.releaseAtMeters ?? null,
      pathLossExponent: arb.pathLossExponent ?? null,
      kalmanProcessNoise: arb.kalmanProcessNoise ?? null,
      kalmanMeasurementNoise: arb.kalmanMeasurementNoise ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được manifest: ${err.message}` });
  }
});

router.put('/beacon-config', async (req, res) => {
  try {
    await withHistory(req, { action: 'beacon.update', summary: 'Cập nhật cấu hình beacon' }, async (ctx) => {
      const manifest = readManifest();
      const body = req.body || {};

      // Tùy chọn: bỏ trống -> xóa khỏi manifest, app tự dùng giá trị mặc định.
      const parseOptNum = (val, label, min, max) => {
        if (val === '' || val === null || val === undefined) return null;
        const n = Number(val);
        if (!Number.isFinite(n)) throw new HttpError(400, `${label} phải là số`);
        if (min !== undefined && n < min) throw new HttpError(400, `${label} phải >= ${min}`);
        if (max !== undefined && n > max) throw new HttpError(400, `${label} phải <= ${max}`);
        return n;
      };

      // Bắt buộc: app đọc bằng "_reqNum"/"_reqInt" — thiếu là cả bundle lỗi khi client
      // phân tích, không được phép xóa/bỏ trống.
      const parseReqNum = (val, label, min, max) => {
        if (val === '' || val === null || val === undefined) throw new HttpError(400, `${label} là trường bắt buộc, không được để trống`);
        const n = Number(val);
        if (!Number.isFinite(n)) throw new HttpError(400, `${label} phải là số`);
        if (min !== undefined && n < min) throw new HttpError(400, `${label} phải >= ${min}`);
        if (max !== undefined && n > max) throw new HttpError(400, `${label} phải <= ${max}`);
        return n;
      };
      const parseReqInt = (val, label, min, max) => {
        const n = parseReqNum(val, label, min, max);
        if (!Number.isInteger(n)) throw new HttpError(400, `${label} phải là số nguyên`);
        return n;
      };

      const zoneChangeConfirmSeconds = parseOptNum(body.zoneChangeConfirmSeconds, 'Thời gian xác nhận đổi khu vực', 1, 30);
      const pathLossExponent = parseOptNum(body.pathLossExponent, 'Path loss exponent', 0.5, 6);
      const kalmanProcessNoise = parseOptNum(body.kalmanProcessNoise, 'Kalman process noise', 0, 10);
      const kalmanMeasurementNoise = parseOptNum(body.kalmanMeasurementNoise, 'Kalman measurement noise', 0, 100);

      const uuid = typeof body.uuid === 'string' ? body.uuid.trim() : '';
      if (!uuid) throw new HttpError(400, 'uuid là trường bắt buộc, không được để trống');
      if (!BEACON_UUID_RE.test(uuid)) throw new HttpError(400, 'uuid không đúng định dạng UUID (vd 4d6fc88b-be75-6698-da48-6866a36ec78e)');

      const deskMajor = parseReqInt(body.deskMajor, 'deskMajor', 1, 65535);
      if ((manifest.zones || []).some((z) => z.major === deskMajor)) {
        throw new HttpError(400, `deskMajor (${deskMajor}) đang trùng với major của một khu vực - phải chọn số khác`);
      }

      const minDeltaDb = parseReqNum(body.minDeltaDb, 'minDeltaDb', 3, 20);
      const dwellSeconds = parseReqNum(body.dwellSeconds, 'dwellSeconds', 1, 30);
      const lockoutSeconds = parseReqNum(body.lockoutSeconds, 'lockoutSeconds', 0, 120);
      const zoneSilenceSeconds = parseReqNum(body.zoneSilenceSeconds, 'zoneSilenceSeconds', 3, 60);
      const deskDwellSeconds = parseReqNum(body.deskDwellSeconds, 'deskDwellSeconds', 5, 120);
      const sessionSilenceMinutes = parseReqNum(body.sessionSilenceMinutes, 'sessionSilenceMinutes', 2, 60);

      const engageAtMeters = parseOptNum(body.engageAtMeters, 'engageAtMeters', 1, 30);
      const releaseAtMeters = parseOptNum(body.releaseAtMeters, 'releaseAtMeters', 2, 50);
      if (engageAtMeters !== null && releaseAtMeters !== null && releaseAtMeters < engageAtMeters + 1) {
        throw new HttpError(400, 'releaseAtMeters phải lớn hơn engageAtMeters ít nhất 1 mét');
      }

      if (zoneChangeConfirmSeconds === null) delete manifest.zoneChangeConfirmSeconds;
      else manifest.zoneChangeConfirmSeconds = zoneChangeConfirmSeconds;

      if (!manifest.beacon) manifest.beacon = {};
      manifest.beacon.uuid = uuid;
      manifest.beacon.deskMajor = deskMajor;
      if (!manifest.beacon.arbitration) manifest.beacon.arbitration = {};
      const arb = manifest.beacon.arbitration;

      arb.minDeltaDb = minDeltaDb;
      arb.dwellSeconds = dwellSeconds;
      arb.lockoutSeconds = lockoutSeconds;
      arb.zoneSilenceSeconds = zoneSilenceSeconds;
      arb.deskDwellSeconds = deskDwellSeconds;
      arb.sessionSilenceMinutes = sessionSilenceMinutes;

      if (engageAtMeters === null) delete arb.engageAtMeters;
      else arb.engageAtMeters = engageAtMeters;

      if (releaseAtMeters === null) delete arb.releaseAtMeters;
      else arb.releaseAtMeters = releaseAtMeters;

      if (pathLossExponent === null) delete arb.pathLossExponent;
      else arb.pathLossExponent = pathLossExponent;

      if (kalmanProcessNoise === null) delete arb.kalmanProcessNoise;
      else arb.kalmanProcessNoise = kalmanProcessNoise;

      if (kalmanMeasurementNoise === null) delete arb.kalmanMeasurementNoise;
      else arb.kalmanMeasurementNoise = kalmanMeasurementNoise;

      bumpVersion(manifest);
      writeManifest(manifest);
      res.json({
        zoneChangeConfirmSeconds: manifest.zoneChangeConfirmSeconds ?? null,
        uuid: manifest.beacon.uuid,
        deskMajor: manifest.beacon.deskMajor,
        minDeltaDb: arb.minDeltaDb,
        dwellSeconds: arb.dwellSeconds,
        lockoutSeconds: arb.lockoutSeconds,
        zoneSilenceSeconds: arb.zoneSilenceSeconds,
        deskDwellSeconds: arb.deskDwellSeconds,
        sessionSilenceMinutes: arb.sessionSilenceMinutes,
        engageAtMeters: arb.engageAtMeters ?? null,
        releaseAtMeters: arb.releaseAtMeters ?? null,
        pathLossExponent: arb.pathLossExponent ?? null,
        kalmanProcessNoise: arb.kalmanProcessNoise ?? null,
        kalmanMeasurementNoise: arb.kalmanMeasurementNoise ?? null,
      });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ==================== NHẬP GÓI NỘI DUNG (ZIP: manifest.json + images/ + audio/) ====================
// Nhập một gói nội dung đầy đủ (đúng cấu trúc content/: manifest.json ở gốc,
// images/ và audio/ bên cạnh) — thay thế toàn bộ manifest cùng images/audio.
// Có sao lưu bản hiện tại vào content/.import-backups/ trước khi ghi đè.
//
// LƯU Ý: ghi thẳng ra đĩa (diskStorage + đọc/ghi bằng stream), KHÔNG giữ cả
// file ZIP hay từng file con trong RAM. Giữ trong RAM thì gói ~131 MB đẩy RAM
// tiến trình lên ~617 MB, vượt max_memory_restart của pm2 — pm2 giết máy chủ
// GIỮA LÚC đang ghi đè images/audio và để content/ dở dang. Chi tiết:
// CLAUDE.md §5.8.
const { TMP_IMPORT_DIR: IMPORT_TMP_DIR } = require('../paths');
const importUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(IMPORT_TMP_DIR, { recursive: true });
      cb(null, IMPORT_TMP_DIR);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.zip`),
  }),
  // 1.2GB — client_max_body_size của nginx trên máy chủ thật PHẢI nâng lên KHỚP
  // hoặc lớn hơn số này, nếu không file lớn bị nginx chặn trước bằng trang lỗi
  // HTML 413 (không phải JSON) — xem CLAUDE.md §5.8.
  //
  // An toàn về RAM bất kể con số này (diskStorage + stream), nhưng KHÔNG an toàn
  // về ĐĨA: một lần nhập ZIP ~1 GB cần khoảng 4 GB trống cùng lúc — ZIP tạm trong
  // tmp_import/, images/audio vừa giải nén, bản sao content/ cũ trong
  // .import-backups/, và bundle .tar.gz sinh ra sau đó. Kiểm tra `df -h` trước
  // khi nâng tiếp.
  limits: { fileSize: 1200 * 1024 * 1024 },
});
const IMPORT_BACKUPS_DIR = path.join(CONTENT_DIR, '.import-backups');
const MAX_IMPORT_BACKUPS_KEEP = 5;

// Chỉ giữ MAX_IMPORT_BACKUPS_KEEP bản gần nhất. Bản sao lưu import nặng hơn hẳn
// bản sao lưu ngôn ngữ (chép CẢ images/ và audio/), vài chục bản là đầy đĩa.
function pruneOldImportBackups() {
  try {
    if (!fs.existsSync(IMPORT_BACKUPS_DIR)) return;
    const names = fs.readdirSync(IMPORT_BACKUPS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const name of names.slice(MAX_IMPORT_BACKUPS_KEEP)) {
      fs.rmSync(path.join(IMPORT_BACKUPS_DIR, name), { recursive: true, force: true });
    }
  } catch (err) {
    // Dọn rác thất bại thì không được làm hỏng thao tác nhập chính.
  }
}

// Tên thư mục sao lưu import là "<timestamp>-import" nên có dấu gạch ngang; chặn
// mọi ký tự khác để không thể đi ra khỏi IMPORT_BACKUPS_DIR.
function importBackupDir(backupId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(backupId || ''))) {
    throw new HttpError(400, 'Mã sao lưu không hợp lệ');
  }
  return path.join(IMPORT_BACKUPS_DIR, backupId);
}

// ==================== BẢN SAO LƯU TRƯỚC KHI NHẬP GÓI ZIP (content/.import-backups/) ====================
// Nhập gói ZIP là thao tác PHÁ HỦY NHẤT (thay cả manifest lẫn toàn bộ images/ +
// audio/). Ba route dưới đây cho xem/khôi phục/xóa các bản sao lưu đó ngay trên
// giao diện, dùng chung cơ chế với .language-backups/.
router.get('/import-backups', (req, res) => {
  try {
    if (!fs.existsSync(IMPORT_BACKUPS_DIR)) return res.json({ backups: [] });
    const backups = fs.readdirSync(IMPORT_BACKUPS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const dir = path.join(IMPORT_BACKUPS_DIR, e.name);
        let meta;
        try {
          meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
        } catch {
          // Bản sao lưu tạo trước khi có meta.json — suy ra từ tên thư mục.
          meta = { backupId: e.name, createdAt: null, bundleVersionBefore: null, languages: [] };
        }
        let zonesCount = null;
        let exhibitsCount = null;
        try {
          const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest-before.json'), 'utf8'));
          zonesCount = (m.zones || []).length;
          exhibitsCount = (m.zones || []).reduce((n, z) => n + (z.exhibits?.length || 0), 0);
        } catch {
          // Thiếu manifest-before.json thì bản sao lưu này không khôi phục được.
        }
        return { ...meta, backupId: e.name, zonesCount, exhibitsCount, canRestore: zonesCount !== null };
      })
      .sort((a, b) => (b.backupId > a.backupId ? 1 : -1));
    res.json({ backups });
  } catch (err) {
    res.status(500).json({ error: `Không đọc được danh sách sao lưu: ${err.message}` });
  }
});

router.post('/import-backups/:backupId/restore', async (req, res) => {
  try {
    await withHistory(req, { action: 'import.restore', summary: 'Khôi phục về trước lần nhập gói ZIP' }, async (ctx) => {
      const backupDir = importBackupDir(req.params.backupId);
      const backupManifestPath = path.join(backupDir, 'manifest-before.json');
      if (!fs.existsSync(backupManifestPath)) {
        throw new HttpError(404, 'Không tìm thấy bản sao lưu này (hoặc bản sao lưu bị thiếu manifest)');
      }

      const restoredManifest = JSON.parse(fs.readFileSync(backupManifestPath, 'utf8'));

      // Khác bản sao lưu ngôn ngữ (chỉ chép thêm): import đã XÓA SẠCH images/ và
      // audio/ rồi ghi lại từ ZIP, nên phải thay cả 2 thư mục mới thực sự quay về
      // trạng thái cũ. Ghi vào thư mục tạm rồi đổi chỗ, để nếu fs.cpSync lỗi giữa
      // chừng thì không mất luôn dữ liệu đang có.
      for (const sub of ['images', 'audio']) {
        const src = path.join(backupDir, sub);
        const dest = path.join(CONTENT_DIR, sub);
        if (!fs.existsSync(src)) continue;
        const staging = path.join(CONTENT_DIR, `.${sub}-restoring`);
        fs.rmSync(staging, { recursive: true, force: true });
        fs.cpSync(src, staging, { recursive: true });
        fs.rmSync(dest, { recursive: true, force: true });
        fs.renameSync(staging, dest);
      }

      const removedOrphans = cleanOrphansAfterRestore(restoredManifest);
      bumpVersion(restoredManifest);
      writeManifest(restoredManifest);

      res.json({
        ok: true,
        zonesCount: (restoredManifest.zones || []).length,
        exhibitsCount: (restoredManifest.zones || []).reduce((n, z) => n + (z.exhibits?.length || 0), 0),
        languages: restoredManifest.languages,
        removedOrphanCount: removedOrphans.length,
      });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/import-backups/:backupId', (req, res) => {
  try {
    const backupDir = importBackupDir(req.params.backupId);
    if (!fs.existsSync(backupDir)) throw new HttpError(404, 'Không tìm thấy bản sao lưu này');
    fs.rmSync(backupDir, { recursive: true, force: true });
    res.status(204).end();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ==================== VIDEO (đính kèm khu vực / hiện vật) ====================
// Video CHƯA được app đọc — hiện chỉ là kho lưu trữ phía CMS (phạm vi đã chốt).
// Vì vậy video cố ý KHÔNG được đóng gói vào bundle (staticContentBundle.js chỉ
// lấy manifest.json + images/ + audio/), nếu không mỗi máy khách phải tải hàng
// GB không dùng tới.
//
// Khác ảnh/audio: KHÔNG dùng `anyUpload` (memoryStorage, 50 MB) mà ghi THẲNG ra
// đĩa bằng diskStorage — video nặng hàng trăm MB, nạp vào RAM sẽ khiến pm2 giết
// máy chủ giữa chừng (CLAUDE.md §5.8).
const VIDEO_MIME_EXT = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
};
const ALLOWED_VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi']);

// multer/busboy trả tên file multipart đã giải mã theo latin1, nên tên tiếng
// Việt thành dạng hỏng dấu ("Video Thử Nghiệm" -> "Video Thá»­ Nghiá»m"). Diễn
// giải lại đúng UTF-8; chuỗi không phải UTF-8 hợp lệ thì giữ nguyên bản gốc
// thay vì trả về ký tự thay thế.
function decodeOriginalName(name) {
  const raw = String(name || '');
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('�') ? raw : decoded;
}

function videoExtension(file) {
  const fromMime = VIDEO_MIME_EXT[(file.mimetype || '').toLowerCase()];
  if (fromMime) return fromMime;
  const ext = path.extname(file.originalname || '').replace('.', '').toLowerCase();
  if (ALLOWED_VIDEO_EXT.has(ext)) return ext;
  return null;
}

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(CONTENT_DIR, 'videos', req.videoOwnerDir || 'misc');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = videoExtension(file);
      if (!ext) {
        return cb(new HttpError(400, `Định dạng video không được hỗ trợ: "${file.originalname}" — chỉ nhận mp4, webm, mov, m4v, mkv, avi.`));
      }
      const cleanName = decodeOriginalName(file.originalname);
      const base = slugify(path.basename(cleanName, path.extname(cleanName)) || 'video');
      cb(null, `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
    },
  }),
  // 2 GB MỖI FILE (đã đo: multer `fileSize` áp cho từng file, KHÔNG phải tổng cả
  // lô). Cái chặn tổng thật là client_max_body_size của nginx, tính theo CẢ
  // REQUEST. Trang admin gửi mỗi request 1 file (uploadVideos trong admin.js) nên
  // nginx chỉ cần >= dung lượng file lớn nhất, không cần >= tổng cả lô.
  limits: { fileSize: 2048 * 1024 * 1024 },
});

// Xác định khu vực/hiện vật đang được đính kèm video, đặt req.videoOwnerDir
// TRƯỚC khi multer chạy (multer cần biết thư mục đích ngay lúc nhận file).
function resolveVideoOwner(req, res, next) {
  try {
    const { zoneId, exhibitId } = req.params;
    const manifest = readManifest();
    const zone = manifest.zones.find((z) => z.id === zoneId);
    if (!zone) throw new HttpError(404, 'Không tìm thấy khu vực');
    if (exhibitId) {
      const exhibit = (zone.exhibits || []).find((e) => e.id === exhibitId);
      if (!exhibit) throw new HttpError(404, 'Không tìm thấy hiện vật');
      req.videoOwnerDir = path.join('exhibits', exhibitId);
    } else {
      req.videoOwnerDir = path.join('zones', zoneId);
    }
    next();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

// Lỗi phát sinh trong multer (định dạng lạ, file quá lớn) không tự thành JSON —
// không bắt ở đây thì rơi xuống error handler chung thành "Lỗi server nội bộ"
// 500, người dùng không biết mình sai gì. Ngoài ra khi tải NHIỀU file mà 1 file
// lỗi giữa chừng, các file trước đó ĐÃ nằm trên đĩa nhưng chưa vào manifest ->
// phải xóa đi, nếu không thành file mồ côi.
function runVideoUpload(req, res, next) {
  videoUpload.array('videos')(req, res, (err) => {
    if (!err) return next();
    for (const f of req.files || []) fs.rm(f.path, { force: true }, () => {});
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Video vượt quá giới hạn 2GB mỗi file.' });
    }
    res.status(err.status || 400).json({ error: err.message || 'Không tải lên được video.' });
  });
}

// Tìm mảng videos[] của khu vực HOẶC hiện vật trong một manifest đã đọc.
function findVideoOwner(manifest, zoneId, exhibitId) {
  const zone = manifest.zones.find((z) => z.id === zoneId);
  if (!zone) throw new HttpError(404, 'Không tìm thấy khu vực');
  if (!exhibitId) return zone;
  const exhibit = (zone.exhibits || []).find((e) => e.id === exhibitId);
  if (!exhibit) throw new HttpError(404, 'Không tìm thấy hiện vật');
  return exhibit;
}

function handleVideoUpload(req, res, zoneId, exhibitId) {
  return withHistory(req, { action: 'video.add', summary: 'Thêm video đính kèm' }, async (ctx) => {
    if (!req.files || !req.files.length) throw new HttpError(400, 'Chưa chọn file video nào');
    const manifest = readManifest();
    const owner = findVideoOwner(manifest, zoneId, exhibitId);
    owner.videos = owner.videos || [];
    const added = [];
    for (const f of req.files) {
      const entry = {
        file: normRelPath(path.relative(CONTENT_DIR, f.path)),
        originalName: decodeOriginalName(f.originalname),
        sizeBytes: f.size,
        uploadedAt: new Date().toISOString(),
      };
      history.noteCreatedFile(entry.file);
      owner.videos.push(entry);
      added.push(entry);
    }
    bumpVersion(manifest);
    writeManifest(manifest);
    res.status(201).json({ added, videos: owner.videos });
  });
}

function handleVideoDelete(req, res, zoneId, exhibitId) {
  return withHistory(req, { action: 'video.delete', summary: 'Xóa video đính kèm' }, async (ctx) => {
    const rel = normRelPath((req.body || {}).file);
    if (!rel) throw new HttpError(400, 'Thiếu đường dẫn video cần xóa');
    const manifest = readManifest();
    const owner = findVideoOwner(manifest, zoneId, exhibitId);
    const idx = (owner.videos || []).findIndex((v) => v.file === rel);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy video này');
    const [removed] = owner.videos.splice(idx, 1);
    if (!owner.videos.length) delete owner.videos;
    deleteFileQuiet(removed.file);
    bumpVersion(manifest);
    writeManifest(manifest);
    res.json({ deleted: removed.file });
  });
}

router.post('/zones/:zoneId/videos', resolveVideoOwner, runVideoUpload, async (req, res) => {
  try {
    await handleVideoUpload(req, res, req.params.zoneId, null);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/zones/:zoneId/videos', async (req, res) => {
  try {
    await handleVideoDelete(req, res, req.params.zoneId, null);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/zones/:zoneId/exhibits/:exhibitId/videos', resolveVideoOwner, runVideoUpload, async (req, res) => {
  try {
    await handleVideoUpload(req, res, req.params.zoneId, req.params.exhibitId);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/zones/:zoneId/exhibits/:exhibitId/videos', async (req, res) => {
  try {
    await handleVideoDelete(req, res, req.params.zoneId, req.params.exhibitId);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ==================== GALLERY: ẢNH/AUDIO PHỤ (tùy chọn) ====================
// Khác ảnh/audio CHÍNH (bắt buộc, một file, tên cố định hero.jpg/main.jpg nên
// ghi đè được khi sửa): gallery là 0..N file, mỗi file một tên riêng, thêm/xóa
// từng cái độc lập — dùng CHUNG cơ chế với videos[] (findVideoOwner /
// handleVideoUpload). Nhưng khác video, dữ liệu vẫn qua ffmpeg (toJpeg /
// toMp3CappedBitrate) như ảnh/audio chính; video không chuẩn hóa vì quá nặng để
// ffmpeg xử lý kịp trong một HTTP request.
const MAX_GALLERY_IMAGES = 20;
const MAX_GALLERY_AUDIOS = 10;

// multer RIÊNG cho gallery (không dùng anyUpload vốn không giới hạn số file):
// giới hạn "files" ngay ở tầng multer chặn sớm request có quá nhiều file trước
// khi kịp đọc hết vào RAM.
const galleryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 20 },
}).any();

function runGalleryUpload(req, res, next) {
  galleryUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File vượt quá giới hạn 50MB.' });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Chỉ được chọn tối đa 20 file mỗi lần tải lên.' });
    res.status(err.status || 400).json({ error: err.message || 'Không tải lên được file.' });
  });
}

// Tìm mảng images[]/audios[] của khu vực HOẶC hiện vật — giống findVideoOwner,
// tách riêng vì khác thông báo lỗi.
function findGalleryOwner(manifest, zoneId, exhibitId) {
  const zone = manifest.zones.find((z) => z.id === zoneId);
  if (!zone) throw new HttpError(404, 'Không tìm thấy khu vực');
  if (!exhibitId) return zone;
  const exhibit = (zone.exhibits || []).find((e) => e.id === exhibitId);
  if (!exhibit) throw new HttpError(404, 'Không tìm thấy hiện vật');
  return exhibit;
}

function galleryOwnerDir(zoneId, exhibitId) {
  return exhibitId ? `exhibits/${exhibitId}` : `zones/${zoneId}`;
}

function handleGalleryImageUpload(req, res, zoneId, exhibitId) {
  return withHistory(req, { action: 'image.add', summary: 'Thêm ảnh phụ' }, async (ctx) => {
    const files = (req.files || []).filter((f) => f.fieldname === 'images');
    if (!files.length) throw new HttpError(400, 'Chưa chọn ảnh nào');
    const manifest = readManifest();
    const owner = findGalleryOwner(manifest, zoneId, exhibitId);
    owner.images = owner.images || [];
    if (owner.images.length + files.length > MAX_GALLERY_IMAGES) {
      throw new HttpError(400, `Chỉ được tối đa ${MAX_GALLERY_IMAGES} ảnh phụ (hiện có ${owner.images.length}).`);
    }

    // Chuẩn hóa + lưu TỪNG ảnh, dừng ở lỗi đầu tiên: ảnh không đọc được (không phải
    // ảnh thật dù đuôi file giả mạo) bị ffmpeg từ chối ngay (toJpeg ném lỗi 400).
    const added = [];
    for (const f of files) {
      const buffer = await toJpeg(f.buffer, f.originalname);
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      const rel = `images/${galleryOwnerDir(zoneId, exhibitId)}/gallery/${filename}`;
      saveFile(rel, buffer);
      history.noteCreatedFile(rel);
      const meta = {
        originalName: decodeOriginalName(f.originalname),
        sizeBytes: buffer.length,
        uploadedAt: new Date().toISOString(),
      };
      // Chuỗi trần vào `images[]` (app chỉ đọc dạng này), meta vào `imagesMeta`
      // — xem chuanHoaAnhPhuCua().
      owner.images.push(rel);
      owner.imagesMeta = { ...(owner.imagesMeta || {}), [rel]: meta };
      added.push({ file: rel, ...meta });
    }

    bumpVersion(manifest);
    writeManifest(manifest);
    res.status(201).json({ added, images: anhPhuChoCms(owner) });
  });
}

function handleGalleryImageDelete(req, res, zoneId, exhibitId) {
  return withHistory(req, { action: 'image.delete', summary: 'Xóa ảnh phụ' }, async (ctx) => {
    // `file` từ client CHỈ dùng để tra trong danh sách ảnh đã có của chính khu vực/
    // hiện vật này (tên do server sinh khi upload) — không bao giờ đưa thẳng vào
    // đường dẫn để xóa, tránh path traversal kiểu ../.
    const rel = normRelPath((req.body || {}).file);
    if (!rel) throw new HttpError(400, 'Thiếu đường dẫn ảnh cần xóa');
    const manifest = readManifest();
    const owner = findGalleryOwner(manifest, zoneId, exhibitId);
    // Dải ảnh có thể còn dạng object cũ chưa được chuẩn hóa — duongDanAnh() nhận cả hai.
    const idx = (owner.images || []).findIndex((v) => duongDanAnh(v) === rel);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy ảnh này');
    const [removed] = owner.images.splice(idx, 1);
    if (!owner.images.length) delete owner.images;
    if (owner.imagesMeta) delete owner.imagesMeta[rel];
    deleteFileQuiet(duongDanAnh(removed));
    bumpVersion(manifest);
    writeManifest(manifest);
    res.json({ deleted: duongDanAnh(removed) });
  });
}

function handleGalleryAudioUpload(req, res, zoneId, exhibitId) {
  return withHistory(req, { action: 'audio.add', summary: 'Thêm audio phụ' }, async (ctx) => {
    const files = (req.files || []).filter((f) => f.fieldname === 'audios');
    if (!files.length) throw new HttpError(400, 'Chưa chọn audio nào');
    const manifest = readManifest();
    const owner = findGalleryOwner(manifest, zoneId, exhibitId);
    owner.audios = owner.audios || [];
    if (owner.audios.length + files.length > MAX_GALLERY_AUDIOS) {
      throw new HttpError(400, `Chỉ được tối đa ${MAX_GALLERY_AUDIOS} audio phụ (hiện có ${owner.audios.length}).`);
    }

    const added = [];
    for (const f of files) {
      const ext = audioExtension(f); // ném lỗi 400 ngay nếu không phải .mp3
      const buffer = await toMp3CappedBitrate(f.buffer, f.mimetype, f.originalname);
      const duration = await audioDuration(buffer, f.mimetype, f.originalname);
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const rel = `audio/gallery/${galleryOwnerDir(zoneId, exhibitId)}/${filename}`;
      saveFile(rel, buffer);
      history.noteCreatedFile(rel);
      const entry = {
        file: rel,
        originalName: decodeOriginalName(f.originalname),
        sizeBytes: buffer.length,
        durationSec: duration,
        uploadedAt: new Date().toISOString(),
      };
      owner.audios.push(entry);
      added.push(entry);
    }

    bumpVersion(manifest);
    writeManifest(manifest);
    res.status(201).json({ added, audios: owner.audios });
  });
}

function handleGalleryAudioDelete(req, res, zoneId, exhibitId) {
  return withHistory(req, { action: 'audio.delete', summary: 'Xóa audio phụ' }, async (ctx) => {
    const rel = normRelPath((req.body || {}).file);
    if (!rel) throw new HttpError(400, 'Thiếu đường dẫn audio cần xóa');
    const manifest = readManifest();
    const owner = findGalleryOwner(manifest, zoneId, exhibitId);
    const idx = (owner.audios || []).findIndex((v) => v.file === rel);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy audio này');
    const [removed] = owner.audios.splice(idx, 1);
    if (!owner.audios.length) delete owner.audios;
    deleteFileQuiet(removed.file);
    bumpVersion(manifest);
    writeManifest(manifest);
    res.json({ deleted: removed.file });
  });
}

router.post('/zones/:zoneId/images', runGalleryUpload, async (req, res) => {
  try {
    await handleGalleryImageUpload(req, res, req.params.zoneId, null);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
router.delete('/zones/:zoneId/images', async (req, res) => {
  try {
    await handleGalleryImageDelete(req, res, req.params.zoneId, null);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
router.post('/zones/:zoneId/exhibits/:exhibitId/images', runGalleryUpload, async (req, res) => {
  try {
    await handleGalleryImageUpload(req, res, req.params.zoneId, req.params.exhibitId);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
router.delete('/zones/:zoneId/exhibits/:exhibitId/images', async (req, res) => {
  try {
    await handleGalleryImageDelete(req, res, req.params.zoneId, req.params.exhibitId);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/zones/:zoneId/audios', runGalleryUpload, async (req, res) => {
  try {
    await handleGalleryAudioUpload(req, res, req.params.zoneId, null);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
router.delete('/zones/:zoneId/audios', async (req, res) => {
  try {
    await handleGalleryAudioDelete(req, res, req.params.zoneId, null);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
router.post('/zones/:zoneId/exhibits/:exhibitId/audios', runGalleryUpload, async (req, res) => {
  try {
    await handleGalleryAudioUpload(req, res, req.params.zoneId, req.params.exhibitId);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
router.delete('/zones/:zoneId/exhibits/:exhibitId/audios', async (req, res) => {
  try {
    await handleGalleryAudioDelete(req, res, req.params.zoneId, req.params.exhibitId);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ---------- Gắn / bỏ gắn mô hình 3D cho một hiện vật ----------
//
// Route RIÊNG, không nhét vào biểu mẫu sửa hiện vật: gắn mô hình là thao tác
// một cú bấm, không nên bắt mở cả biểu mẫu (và dính cả chốt `rev` chống sửa
// đồng thời) chỉ để đổi một trường.
//
// Chỉ ghi `model3dId`. `media[]` do writeManifest() sinh lại — xem dongBoMedia().
router.put('/zones/:zoneId/exhibits/:exhibitId/model', async (req, res) => {
  try {
    await withHistory(req, { action: 'exhibit.model', summary: 'Gán mô hình 3D' }, async (ctx) => {
      const { zoneId, exhibitId } = req.params;
      const manifest = readManifest();
      const { fallbackLanguage } = getLangSetup(manifest);
      const zone = manifest.zones.find((z) => z.id === zoneId);
      if (!zone) throw new HttpError(404, 'Không tìm thấy khu vực');
      const exhibit = zone.exhibits.find((e) => e.id === exhibitId);
      if (!exhibit) throw new HttpError(404, 'Không tìm thấy hiện vật');

      const ten = dispName(exhibit.name, fallbackLanguage) || exhibit.id;
      const raw = req.body?.modelId;
      const modelId = raw === null || raw === undefined || raw === '' ? null : String(raw).trim();

      if (modelId === null) {
        delete exhibit.model3dId;
        ctx.meta.summary = `Bỏ mô hình 3D khỏi "${ten}"`;
      } else {
        if (!models3d.MODEL_ID_RULE.test(modelId)) {
          throw new HttpError(400, 'Mã mô hình không hợp lệ');
        }
        // Đối chiếu với kho THẬT trên đĩa, không tin chuỗi gửi lên. Đây đúng là chỗ
        // từng hỏng thật (3d-handover.md mục 10): manifest trỏ tới một id không tồn
        // tại, không ai được báo, và ứng dụng lặng lẽ bỏ qua.
        if (!models3d.docMeta(modelId)) {
          throw new HttpError(404, `Kho mô hình không có mã "${modelId}". Hãy tải mô hình lên trước.`);
        }
        if (!exhibit.image) {
          throw new HttpError(409, 'Hiện vật này chưa có ảnh, mà ảnh hiện vật được dùng làm ảnh giữ chỗ '
            + 'cho mô hình. Hãy thêm ảnh cho hiện vật trước đã.');
        }
        exhibit.model3dId = modelId;
        ctx.meta.summary = `Gán mô hình 3D "${modelId}" cho "${ten}"`;
      }

      // LƯU Ý: BẮT BUỘC tăng version — manifest đổi mà không tăng thì máy đã đồng bộ
      // không bao giờ tải lại (CLAUDE.md §5.10).
      bumpVersion(manifest);
      writeManifest(manifest);
      // Trả `rev` MỚI. `rev` băm cả đối tượng hiện vật, kể cả model3dId và media[],
      // nên gắn mô hình là đổi rev. Biểu mẫu sửa hiện vật đang mở mà giữ rev cũ thì
      // bấm Lưu sẽ ăn 409 "người khác vừa sửa" — trong khi người "khác" chính là họ.
      // Tính SAU writeManifest() vì dongBoMedia() vừa sửa exhibit.media tại chỗ.
      res.json({
        ok: true,
        model3dId: exhibit.model3dId || null,
        bundleVersion: manifest.bundleVersion,
        rev: objectRev(exhibit),
      });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/import', importUpload.single('package'), async (req, res) => {
  try {
    await withHistory(req, { action: 'content.import', summary: 'Nhập gói nội dung (thay thế toàn bộ)' }, async (ctx) => {
      if (!req.file) throw new HttpError(400, 'Thiếu file ZIP (field "package")');

      const unzipper = require('unzipper');
      let zip;
      try {
        zip = await unzipper.Open.file(req.file.path);
      } catch (err) {
        throw new HttpError(400, 'File không phải ZIP hợp lệ hoặc bị hỏng');
      }

      // Tìm manifest.json ở gốc ZIP; nếu không có, thử trường hợp người dùng nén cả
      // thư mục cha (vd "src/manifest.json") — tự bóc một lớp tiền tố đó để khỏi bắt
      // người dùng phải nén đúng "chỉ nội dung bên trong".
      let rootPrefix = '';
      let manifestEntry = zip.files.find((f) => f.type !== 'Directory' && f.path.replace(/\\/g, '/') === 'manifest.json');
      if (!manifestEntry) {
        const nested = zip.files.filter((f) => f.type !== 'Directory' && /^[^/]+\/manifest\.json$/.test(f.path.replace(/\\/g, '/')));
        if (nested.length === 1) {
          manifestEntry = nested[0];
          rootPrefix = manifestEntry.path.replace(/\\/g, '/').split('/')[0] + '/';
        }
      }
      if (!manifestEntry) {
        throw new HttpError(400, 'File ZIP thiếu manifest.json ở thư mục gốc (hoặc trong đúng 1 thư mục cha)');
      }

      // manifest.json luôn nhỏ (vài trăm KB), đọc thẳng vào bộ nhớ ở đây an toàn —
      // khác ảnh/audio (có thể rất nặng) được ghi bằng stream bên dưới.
      let newManifest;
      try {
        newManifest = JSON.parse((await manifestEntry.buffer()).toString('utf8'));
      } catch (err) {
        throw new HttpError(400, 'manifest.json trong ZIP không đúng định dạng JSON');
      }
      if (!Array.isArray(newManifest.zones) || !Array.isArray(newManifest.languages)) {
        throw new HttpError(400, 'manifest.json trong ZIP thiếu trường "zones" hoặc "languages"');
      }

      // Sao lưu manifest + images/audio HIỆN TẠI trước khi ghi đè.
      const backupId = `${Date.now()}-import`;
      const backupDir = path.join(IMPORT_BACKUPS_DIR, backupId);
      fs.mkdirSync(backupDir, { recursive: true });
      const currentManifest = readManifest();
      fs.writeFileSync(path.join(backupDir, 'manifest-before.json'), JSON.stringify(currentManifest, null, 2));
      fs.writeFileSync(path.join(backupDir, 'meta.json'), JSON.stringify({
        backupId,
        languages: currentManifest.languages || [],
        createdAt: new Date().toISOString(),
        bundleVersionBefore: currentManifest.bundleVersion,
        note: 'Sao luu truoc khi nhap goi noi dung moi (thay the toan bo)',
      }, null, 2));
      for (const sub of ['images', 'audio']) {
        const src = path.join(CONTENT_DIR, sub);
        if (fs.existsSync(src)) fs.cpSync(src, path.join(backupDir, sub), { recursive: true });
      }

      // Thay images/ và audio/ hiện tại bằng nội dung trong ZIP — ghi từng file bằng
      // stream để RAM không tăng theo dung lượng file.
      for (const sub of ['images', 'audio']) {
        fs.rmSync(path.join(CONTENT_DIR, sub), { recursive: true, force: true });
      }
      const skipped = [];
      for (const entry of zip.files) {
        if (entry.type === 'Directory') continue;
        let relPath = entry.path.replace(/\\/g, '/');
        if (rootPrefix) {
          if (!relPath.startsWith(rootPrefix)) continue;
          relPath = relPath.slice(rootPrefix.length);
        }
        const destPath = safeImportDest(relPath);
        if (!destPath) {
          // Chỉ ghi nhận entry TRONG images/ và audio/ bị từ chối — file ngoài 2 thư mục
          // đó (vd manifest.json, README) vốn đã bị bỏ qua, báo lên chỉ làm người dùng
          // hoang mang.
          const inMediaDir = relPath.startsWith('images/') || relPath.startsWith('audio/');
          if (inMediaDir) skipped.push(relPath);
          continue;
        }
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        await new Promise((resolve, reject) => {
          entry.stream()
            .pipe(fs.createWriteStream(destPath))
            .on('finish', resolve)
            .on('error', reject);
        });
      }

      bumpVersion(newManifest);
      writeManifest(newManifest);
      pruneOldImportBackups();

      res.json({
        ok: true,
        languages: newManifest.languages,
        zonesCount: newManifest.zones.length,
        exhibitsCount: newManifest.zones.reduce((n, z) => n + (z.exhibits?.length || 0), 0),
        backupPath: path.relative(CONTENT_DIR, backupDir),
        backupId,
        skippedCount: skipped.length,
        skipped: skipped.slice(0, 20),
      });
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    // Dọn file ZIP tạm trên đĩa dù thành công hay lỗi, không để tích lại trong tmp_import/.
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  }
});

// ==================== KHU VỰC (ZONES) ====================
// upload.any() vì số ngôn ngữ là động. Ngôn ngữ mặc định dùng tên field trơn (vd
// "heroImage"), ngôn ngữ khác thêm hậu tố "_<lang>" (vd "introAudio_zh").
router.post('/zones', anyUpload, async (req, res) => {
  try {
    await withHistory(req, { action: 'zone.create', summary: 'Thêm khu vực' }, async (ctx) => {
      const manifest = readManifest();
      const { fallbackLanguage, otherLanguages } = getLangSetup(manifest);
      const files = filesByField(req.files);
      const body = req.body || {};
      const { major, name, welcomeText, introTranscript, nearestExhibitHint } = body;

      const majorNum = Number(major);
      if (!Number.isInteger(majorNum) || majorNum < 1 || majorNum > 65535) {
        throw new HttpError(400, 'Major phải là số nguyên từ 1 đến 65535');
      }
      if (!name || !name.trim()) throw new HttpError(400, 'Thiếu tên khu vực');
      if (!files.heroImage) throw new HttpError(400, 'Thiếu ảnh nền khu vực');
      if (!files.introAudio) throw new HttpError(400, `Thiếu audio giới thiệu khu vực (${fallbackLanguage})`);
      if (!introTranscript || !introTranscript.trim()) {
        throw new HttpError(400, `Thiếu nội dung lời thoại (transcript) audio giới thiệu (${fallbackLanguage})`);
      }
      // LƯU Ý: welcomeText BẮT BUỘC ở ngôn ngữ mặc định. App đọc bằng _reqLocalized,
      // thiếu nó là BundleValidationException ở tầng zone -> SẬP CẢ BUNDLE. Chặn
      // ngay lúc tạo để nhân viên biết liền, thay vì đợi tới lúc đóng gói.
      if (!welcomeText || !welcomeText.trim()) {
        throw new HttpError(400, `Thiếu giới thiệu khu vực (${fallbackLanguage})`);
      }
      for (const lang of otherLanguages) {
        const hasAudio = Boolean(files[`introAudio_${lang}`]);
        const hasTranscript = Boolean(body[`introTranscript_${lang}`] && body[`introTranscript_${lang}`].trim());
        if (hasAudio !== hasTranscript) {
          throw new HttpError(400, `Audio và transcript (${lang}) phải đi cùng nhau (nhập cả hai hoặc để trống cả hai)`);
        }
      }

      if (manifest.zones.some((z) => z.major === majorNum)) {
        throw new HttpError(409, 'Major này đã được dùng cho khu vực khác');
      }
      if (manifest.beacon && majorNum === manifest.beacon.deskMajor) {
        throw new HttpError(409, 'Major này đang trùng với Desk Major (cấu hình bảo tàng) — phải khác nhau');
      }
      const id = uniqueSlug(slugify(name), manifest.zones.map((z) => z.id));

      // Tính duration/ext TẤT CẢ trước khi ghi file thật (dừng sớm, không để lại file
      // rác trên đĩa nếu một track sau bị lỗi).
      const fbExt = audioExtension(files.introAudio[0]);
      // Chuẩn hóa TRƯỚC khi đo thời lượng: duration phải lấy từ đúng file sẽ ghi
      // xuống đĩa, không phải file gốc.
      const fbAudioBuf = await toMp3CappedBitrate(
        files.introAudio[0].buffer,
        files.introAudio[0].mimetype,
        files.introAudio[0].originalname
      );
      const fbDuration = await audioDuration(
        fbAudioBuf,
        files.introAudio[0].mimetype,
        files.introAudio[0].originalname
      );
      const heroBuf = await toJpeg(files.heroImage[0].buffer, files.heroImage[0].originalname);
      const otherTracks = {};
      for (const lang of otherLanguages) {
        const f = files[`introAudio_${lang}`];
        if (!f) continue;
        const ext = audioExtension(f[0]);
        const buffer = await toMp3CappedBitrate(f[0].buffer, f[0].mimetype, f[0].originalname);
        const duration = await audioDuration(buffer, f[0].mimetype, f[0].originalname);
        otherTracks[lang] = { ext, duration, buffer };
      }

      const heroRel = `images/zones/${id}/hero.jpg`;
      const introRel = `audio/${fallbackLanguage}/zones/${id}/intro.${fbExt}`;
      saveFile(heroRel, heroBuf);
      saveFile(introRel, fbAudioBuf);
      const tracks = { [fallbackLanguage]: { file: introRel, durationSec: fbDuration, transcript: introTranscript.trim() } };
      for (const lang of Object.keys(otherTracks)) {
        const t = otherTracks[lang];
        const rel = `audio/${lang}/zones/${id}/intro.${t.ext}`;
        saveFile(rel, t.buffer);
        tracks[lang] = { file: rel, durationSec: t.duration, transcript: (body[`introTranscript_${lang}`] || '').trim() };
      }

      const nameObj = { [fallbackLanguage]: name.trim() };
      const welcomeObj = { [fallbackLanguage]: (welcomeText || '').trim() };
      for (const lang of otherLanguages) {
        if (body[`name_${lang}`] && body[`name_${lang}`].trim()) nameObj[lang] = body[`name_${lang}`].trim();
        if (body[`welcomeText_${lang}`] && body[`welcomeText_${lang}`].trim()) welcomeObj[lang] = body[`welcomeText_${lang}`].trim();
      }

      const zone = {
        major: majorNum,
        id,
        nearestExhibitHint: nearestExhibitHint === 'true' || nearestExhibitHint === 'on',
        name: nameObj,
        welcomeText: welcomeObj,
        heroImage: heroRel,
        heroImageBlurred: heroRel, // dùng chung ảnh, không tạo bản mờ riêng
        introAudio: { tracks },
        exhibits: [],
      };
      manifest.zones.push(zone);
      bumpVersion(manifest);
      writeManifest(manifest);
      ctx.meta.summary = `Thêm khu vực "${dispName(zone.name, fallbackLanguage) || zone.id}"`;
      res.status(201).json(zone);
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/zones/:zoneId', anyUpload, async (req, res) => {
  try {
    await withHistory(req, { action: 'zone.update', summary: 'Sửa khu vực' }, async (ctx) => {
      const { zoneId } = req.params;
      const manifest = readManifest();
      const { fallbackLanguage, otherLanguages } = getLangSetup(manifest);
      const zone = manifest.zones.find((z) => z.id === zoneId);
      if (!zone) throw new HttpError(404, 'Không tìm thấy khu vực');
      ctx.meta.summary = `Sửa khu vực "${dispName(zone.name, fallbackLanguage) || zone.id}"`;

      const files = filesByField(req.files);
      const body = req.body || {};
      // Kiểm tra TRƯỚC khi sửa bất cứ thứ gì — xem assertRev().
      // Băm phần không gồm exhibits, y hệt lúc GET trả rev về.
      const { exhibits: _exhibitsForRev, ...zoneForRev } = zone;
      assertRev(body.rev, zoneForRev, 'khu vực');
      const { major, name, welcomeText, introTranscript, nearestExhibitHint } = body;

      if (major !== undefined) {
        const majorNum = Number(major);
        if (!Number.isInteger(majorNum) || majorNum < 1 || majorNum > 65535) {
          throw new HttpError(400, 'Major phải là số nguyên từ 1 đến 65535');
        }
        if (manifest.zones.some((z) => z.id !== zoneId && z.major === majorNum)) {
          throw new HttpError(409, 'Major này đã được dùng cho khu vực khác');
        }
        if (manifest.beacon && majorNum === manifest.beacon.deskMajor) {
          throw new HttpError(409, 'Major này đang trùng với Desk Major (cấu hình bảo tàng) — phải khác nhau');
        }
        zone.major = majorNum;
      }
      if (nearestExhibitHint !== undefined) {
        zone.nearestExhibitHint = nearestExhibitHint === 'true' || nearestExhibitHint === 'on';
      }
      if (name && name.trim()) zone.name = mergeLocalized(zone.name, fallbackLanguage, name);
      // LƯU Ý: không cho xóa welcomeText ngôn ngữ mặc định về rỗng — mergeLocalized
      // với giá trị rỗng sẽ `delete` key -> app SẬP CẢ BUNDLE. Bỏ trống ô này khi sửa
      // = giữ giá trị cũ (như `name` phía trên), còn gửi rỗng TƯỜNG MINH thì báo lỗi
      // thay vì âm thầm xóa.
      if (welcomeText !== undefined) {
        if (!welcomeText.trim()) {
          throw new HttpError(400, `Khu vực phải có giới thiệu ở ngôn ngữ mặc định (${fallbackLanguage})`);
        }
        zone.welcomeText = mergeLocalized(zone.welcomeText, fallbackLanguage, welcomeText);
      }
      for (const lang of otherLanguages) {
        const nm = body[`name_${lang}`];
        if (nm !== undefined) zone.name = mergeLocalized(zone.name, lang, nm);
        const wt = body[`welcomeText_${lang}`];
        if (wt !== undefined) zone.welcomeText = mergeLocalized(zone.welcomeText, lang, wt);
      }

      if (files.heroImage) {
        saveFile(zone.heroImage, await toJpeg(files.heroImage[0].buffer, files.heroImage[0].originalname));
        zone.heroImageBlurred = zone.heroImage;
      }
      if (files.introAudio) {
        // Kiểm tra đuôi file TRƯỚC khi đọc thời lượng: sai định dạng thì báo đúng lý do
        // ("chỉ nhận .mp3") thay vì thông báo chung chung của bộ phân tích audio.
        const ext = audioExtension(files.introAudio[0]);
        const audioBuf = await toMp3CappedBitrate(
          files.introAudio[0].buffer,
          files.introAudio[0].mimetype,
          files.introAudio[0].originalname
        );
        const duration = await audioDuration(
          audioBuf,
          files.introAudio[0].mimetype,
          files.introAudio[0].originalname
        );
        const newRel = `audio/${fallbackLanguage}/zones/${zone.id}/intro.${ext}`;
        if (newRel !== zone.introAudio.tracks[fallbackLanguage].file) deleteFileQuiet(zone.introAudio.tracks[fallbackLanguage].file);
        saveFile(newRel, audioBuf);
        zone.introAudio.tracks[fallbackLanguage].file = newRel;
        zone.introAudio.tracks[fallbackLanguage].durationSec = duration;
      }
      if (introTranscript !== undefined && introTranscript.trim()) {
        zone.introAudio.tracks[fallbackLanguage].transcript = introTranscript.trim();
      }

      // Các track ngôn ngữ khác (tùy chọn, độc lập với ngôn ngữ mặc định): upload
      // audio mới thì bắt buộc kèm transcript (từ request hoặc transcript cũ nếu có).
      for (const lang of otherLanguages) {
        const f = files[`introAudio_${lang}`];
        const transcriptField = body[`introTranscript_${lang}`];
        if (f) {
          const transcriptValue = (transcriptField && transcriptField.trim()) || zone.introAudio.tracks[lang]?.transcript;
          if (!transcriptValue) {
            throw new HttpError(400, `Đã chọn audio (${lang}) thì cần nhập kèm transcript (${lang})`);
          }
          const ext = audioExtension(f[0]);
          const audioBuf = await toMp3CappedBitrate(f[0].buffer, f[0].mimetype, f[0].originalname);
          const duration = await audioDuration(audioBuf, f[0].mimetype, f[0].originalname);
          const newRel = `audio/${lang}/zones/${zone.id}/intro.${ext}`;
          const existingRel = zone.introAudio.tracks[lang]?.file;
          if (existingRel && existingRel !== newRel) deleteFileQuiet(existingRel);
          saveFile(newRel, audioBuf);
          zone.introAudio.tracks[lang] = { file: newRel, durationSec: duration, transcript: transcriptValue };
        } else if (transcriptField !== undefined) {
          if (transcriptField.trim()) {
            if (!zone.introAudio.tracks[lang]) {
              throw new HttpError(400, `Cần upload audio (${lang}) trước khi nhập transcript (${lang})`);
            }
            zone.introAudio.tracks[lang].transcript = transcriptField.trim();
          } else if (zone.introAudio.tracks[lang]) {
            // Xóa transcript (để trống) nghĩa là bỏ hẳn track ngôn ngữ này.
            deleteFileQuiet(zone.introAudio.tracks[lang].file);
            delete zone.introAudio.tracks[lang];
          }
        }
      }

      bumpVersion(manifest);
      writeManifest(manifest);
      res.json(zone);
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/zones/:zoneId', async (req, res) => {
  try {
    await withHistory(req, { action: 'zone.delete', summary: 'Xóa khu vực' }, async (ctx) => {
      const { zoneId } = req.params;
      const manifest = readManifest();
      const idx = manifest.zones.findIndex((z) => z.id === zoneId);
      if (idx === -1) throw new HttpError(404, 'Không tìm thấy khu vực');

      const [zone] = manifest.zones.splice(idx, 1);
      const { fallbackLanguage: fbDelZone } = getLangSetup(manifest);
      ctx.meta.summary = `Xóa "${dispName(zone.name, fbDelZone) || zone.id}" cùng ${(zone.exhibits || []).length} hiện vật bên trong`;
      deleteFileQuiet(zone.heroImage);
      if (zone.heroImageBlurred !== zone.heroImage) deleteFileQuiet(zone.heroImageBlurred);
      for (const track of Object.values(zone.introAudio?.tracks || {})) deleteFileQuiet(track.file);
      for (const v of zone.videos || []) deleteFileQuiet(v.file);
      for (const img of zone.images || []) deleteFileQuiet(duongDanAnh(img));
      for (const a of zone.audios || []) deleteFileQuiet(a.file);
      for (const e of zone.exhibits || []) {
        deleteFileQuiet(e.image);
        if (e.thumbnail !== e.image) deleteFileQuiet(e.thumbnail);
        for (const track of Object.values(e.audio?.tracks || {})) deleteFileQuiet(track.file);
        for (const v of e.videos || []) deleteFileQuiet(v.file);
        for (const img of e.images || []) deleteFileQuiet(duongDanAnh(img));
        for (const a of e.audios || []) deleteFileQuiet(a.file);
      }

      bumpVersion(manifest);
      writeManifest(manifest);
      res.status(204).end();
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ==================== HIỆN VẬT (EXHIBITS) ====================
// ==================== TRẠNG THÁI (exhibit.listing) + TRƯỜNG THÔNG TIN (exhibit.fields) ====================
// listing: riêng của CMS, app trên tablet bỏ qua (khóa lạ). Gửi qua form listing_status:
// KHÔNG gửi = giữ nguyên; chuỗi rỗng = xóa. Trạng thái phải nằm trong danh sách cmsSettings.
// exhibit.listing.status — trạng thái biên tập (chỉ CMS dùng). Giá/diện tích kiểu cũ nay là
// trường thông tin tự định nghĩa (customFields.js, §5.33).
function applyListing(body, current) {
  if (body.listing_status === undefined) return current;
  const next = { ...(current || {}) };
  const st = String(body.listing_status).trim();
  if (!st) delete next.status;
  else {
    // Giữ nguyên trạng thái ĐANG CÓ dù nó đã bị bỏ khỏi danh sách (đổi mẫu, xóa trạng
    // thái): biểu mẫu hiện nó là "(đã bỏ khỏi danh sách)" và gửi lại y nguyên — chặn ở đây
    // nghĩa là không sửa được nội dung đó nữa cho tới khi người dùng tự đổi trạng thái.
    const ok = st === current?.status || cmsSettingsMod.doc().statuses.some((x) => x.id === st);
    if (!ok) throw new HttpError(400, `Trạng thái "${st}" không có trong danh sách trạng thái`);
    next.status = st;
  }
  return Object.keys(next).length ? next : undefined;
}

// Biểu mẫu bản cũ (trình duyệt còn giữ admin.js cũ) gửi cả N dòng specs sinh tự động lên —
// nhận ra và bỏ đi, nếu không mỗi lần lưu lại nhân đôi các dòng đó.
function boDongSinhTuDong(exhibit, manual) {
  const n = Array.isArray(exhibit.fieldSpecs) ? exhibit.fieldSpecs.length : 0;
  if (!n || !Array.isArray(manual) || manual.length < n) return manual;
  const dau = JSON.stringify(manual.slice(0, n));
  return dau === JSON.stringify((exhibit.specs || []).slice(0, n)) ? manual.slice(n) : manual;
}

router.post('/zones/:zoneId/exhibits', anyUpload, async (req, res) => {
  try {
    await withHistory(req, { action: 'exhibit.create', summary: 'Thêm hiện vật' }, async (ctx) => {
      const { zoneId } = req.params;
      const manifest = readManifest();
      const { fallbackLanguage, otherLanguages } = getLangSetup(manifest);
      const zone = manifest.zones.find((z) => z.id === zoneId);
      if (!zone) throw new HttpError(404, 'Không tìm thấy khu vực');

      const files = filesByField(req.files);
      const body = req.body || {};
      const { minor, name, summary, meaning, transcript, specs } = body;

      const minorNum = Number(minor);
      if (!Number.isInteger(minorNum) || minorNum < 1 || minorNum > 65535) {
        throw new HttpError(400, 'Minor phải là số nguyên từ 1 đến 65535');
      }
      if (zone.exhibits.some((e) => e.minor === minorNum)) {
        throw new HttpError(409, 'Minor này đã được dùng cho hiện vật khác trong cùng khu vực');
      }
      if (!name || !name.trim()) throw new HttpError(400, 'Thiếu tên hiện vật');
      if (!summary || !summary.trim()) throw new HttpError(400, 'Thiếu tóm tắt hiện vật');
      if (!files.image) throw new HttpError(400, 'Thiếu ảnh hiện vật');
      if (!files.audio) throw new HttpError(400, `Thiếu audio thuyết minh (${fallbackLanguage})`);
      if (!transcript || !transcript.trim()) {
        throw new HttpError(400, `Thiếu nội dung lời thuyết minh (transcript) (${fallbackLanguage})`);
      }
      for (const lang of otherLanguages) {
        const hasAudio = Boolean(files[`audio_${lang}`]);
        const hasTranscript = Boolean(body[`transcript_${lang}`] && body[`transcript_${lang}`].trim());
        if (hasAudio !== hasTranscript) {
          throw new HttpError(400, `Audio và transcript (${lang}) phải đi cùng nhau (nhập cả hai hoặc để trống cả hai)`);
        }
      }
      const specsArr = parseSpecs(specs, fallbackLanguage);

      const id = uniqueSlug(
        slugify(name),
        manifest.zones.flatMap((z) => z.exhibits.map((e) => e.id))
      );

      const fbExt = audioExtension(files.audio[0]);
      const fbAudioBuf = await toMp3CappedBitrate(files.audio[0].buffer, files.audio[0].mimetype, files.audio[0].originalname);
      const fbDuration = await audioDuration(fbAudioBuf, files.audio[0].mimetype, files.audio[0].originalname);
      const imageBuf = await toJpeg(files.image[0].buffer, files.image[0].originalname);
      const otherTracks = {};
      for (const lang of otherLanguages) {
        const f = files[`audio_${lang}`];
        if (!f) continue;
        const ext = audioExtension(f[0]);
        const buffer = await toMp3CappedBitrate(f[0].buffer, f[0].mimetype, f[0].originalname);
        const duration = await audioDuration(buffer, f[0].mimetype, f[0].originalname);
        otherTracks[lang] = { ext, duration, buffer };
      }

      const imageRel = `images/exhibits/${id}/main.jpg`;
      const audioRel = `audio/${fallbackLanguage}/exhibits/${id}.${fbExt}`;
      saveFile(imageRel, imageBuf);
      saveFile(audioRel, fbAudioBuf);
      const tracks = { [fallbackLanguage]: { file: audioRel, durationSec: fbDuration, transcript: transcript.trim() } };
      for (const lang of Object.keys(otherTracks)) {
        const t = otherTracks[lang];
        const rel = `audio/${lang}/exhibits/${id}.${t.ext}`;
        saveFile(rel, t.buffer);
        tracks[lang] = { file: rel, durationSec: t.duration, transcript: (body[`transcript_${lang}`] || '').trim() };
      }

      const nameObj = { [fallbackLanguage]: name.trim() };
      const summaryObj = { [fallbackLanguage]: summary.trim() };
      const meaningObj = {};
      if (meaning && meaning.trim()) meaningObj[fallbackLanguage] = meaning.trim();
      for (const lang of otherLanguages) {
        if (body[`name_${lang}`] && body[`name_${lang}`].trim()) nameObj[lang] = body[`name_${lang}`].trim();
        if (body[`summary_${lang}`] && body[`summary_${lang}`].trim()) summaryObj[lang] = body[`summary_${lang}`].trim();
        if (body[`meaning_${lang}`] && body[`meaning_${lang}`].trim()) meaningObj[lang] = body[`meaning_${lang}`].trim();
      }

      const exhibit = {
        minor: minorNum,
        id,
        name: nameObj,
        summary: summaryObj,
        ...(Object.keys(meaningObj).length ? { meaning: meaningObj } : {}),
        specs: specsArr,
        image: imageRel,
        thumbnail: imageRel, // dùng chung ảnh, không tách thumbnail riêng
        audio: { tracks },
      };
      const listing = applyListing(body, undefined);
      if (listing) exhibit.listing = listing;
      {
        const truong = cmsSettingsMod.doc().fields;
        const langs = getLangSetup(manifest);
        customFields.apGiaTri(body, exhibit, truong, langs);
        customFields.ghepSpecs(exhibit, truong, langs, specsArr);
      }
      zone.exhibits.push(exhibit);
      bumpVersion(manifest);
      writeManifest(manifest);
      ctx.meta.summary = `Thêm "${dispName(exhibit.name, fallbackLanguage) || exhibit.id}" vào khu vực "${dispName(zone.name, fallbackLanguage) || zone.id}"`;
      res.status(201).json(exhibit);
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.put('/zones/:zoneId/exhibits/:exhibitId', anyUpload, async (req, res) => {
  try {
    await withHistory(req, { action: 'exhibit.update', summary: 'Sửa hiện vật' }, async (ctx) => {
      const { zoneId, exhibitId } = req.params;
      const manifest = readManifest();
      const { fallbackLanguage, otherLanguages } = getLangSetup(manifest);
      const zone = manifest.zones.find((z) => z.id === zoneId);
      if (!zone) throw new HttpError(404, 'Không tìm thấy khu vực');
      const exhibit = zone.exhibits.find((e) => e.id === exhibitId);
      if (!exhibit) throw new HttpError(404, 'Không tìm thấy hiện vật');
      ctx.meta.summary = `Sửa "${dispName(exhibit.name, fallbackLanguage) || exhibit.id}" trong khu vực "${dispName(zone.name, fallbackLanguage) || zone.id}"`;

      const files = filesByField(req.files);
      const body = req.body || {};
      // Kiểm tra TRƯỚC khi sửa bất cứ thứ gì — xem assertRev().
      assertRev(body.rev, exhibit, 'hiện vật');
      const { minor, name, summary, meaning, transcript, specs } = body;

      if (minor !== undefined && minor !== '') {
        const minorNum = Number(minor);
        if (!Number.isInteger(minorNum) || minorNum < 1 || minorNum > 65535) {
          throw new HttpError(400, 'Minor phải là số nguyên từ 1 đến 65535');
        }
        if (zone.exhibits.some((e) => e.id !== exhibitId && e.minor === minorNum)) {
          throw new HttpError(409, 'Minor này đã được dùng cho hiện vật khác trong cùng khu vực');
        }
        exhibit.minor = minorNum;
      }
      if (name && name.trim()) exhibit.name = mergeLocalized(exhibit.name, fallbackLanguage, name);
      if (summary && summary.trim()) exhibit.summary = mergeLocalized(exhibit.summary, fallbackLanguage, summary);
      if (meaning !== undefined) exhibit.meaning = mergeLocalized(exhibit.meaning, fallbackLanguage, meaning);
      for (const lang of otherLanguages) {
        const nm = body[`name_${lang}`];
        if (nm !== undefined) exhibit.name = mergeLocalized(exhibit.name, lang, nm);
        const sm = body[`summary_${lang}`];
        if (sm !== undefined) exhibit.summary = mergeLocalized(exhibit.summary, lang, sm);
        const mn = body[`meaning_${lang}`];
        if (mn !== undefined) exhibit.meaning = mergeLocalized(exhibit.meaning, lang, mn);
      }
      if (exhibit.meaning && Object.keys(exhibit.meaning).length === 0) delete exhibit.meaning;
      const listing = applyListing(body, exhibit.listing);
      if (listing) exhibit.listing = listing; else delete exhibit.listing;
      {
        // specs = [dòng sinh từ trường thông tin] + [thông số tự gõ] — customFields.js.
        const truong = cmsSettingsMod.doc().fields;
        const langs = getLangSetup(manifest);
        const manual = specs !== undefined ? boDongSinhTuDong(exhibit, parseSpecs(specs, fallbackLanguage)) : undefined;
        customFields.apGiaTri(body, exhibit, truong, langs);
        customFields.ghepSpecs(exhibit, truong, langs, manual);
      }

      if (files.image) {
        saveFile(exhibit.image, await toJpeg(files.image[0].buffer, files.image[0].originalname));
        exhibit.thumbnail = exhibit.image;
      }
      if (files.audio) {
        const ext = audioExtension(files.audio[0]);
        const audioBuf = await toMp3CappedBitrate(files.audio[0].buffer, files.audio[0].mimetype, files.audio[0].originalname);
        const duration = await audioDuration(audioBuf, files.audio[0].mimetype, files.audio[0].originalname);
        const newRel = `audio/${fallbackLanguage}/exhibits/${exhibit.id}.${ext}`;
        if (newRel !== exhibit.audio.tracks[fallbackLanguage].file) deleteFileQuiet(exhibit.audio.tracks[fallbackLanguage].file);
        saveFile(newRel, audioBuf);
        exhibit.audio.tracks[fallbackLanguage].file = newRel;
        exhibit.audio.tracks[fallbackLanguage].durationSec = duration;
      }
      if (transcript !== undefined && transcript.trim()) {
        exhibit.audio.tracks[fallbackLanguage].transcript = transcript.trim();
      }

      for (const lang of otherLanguages) {
        const f = files[`audio_${lang}`];
        const transcriptField = body[`transcript_${lang}`];
        if (f) {
          const transcriptValue = (transcriptField && transcriptField.trim()) || exhibit.audio.tracks[lang]?.transcript;
          if (!transcriptValue) {
            throw new HttpError(400, `Đã chọn audio (${lang}) thì cần nhập kèm transcript (${lang})`);
          }
          const ext = audioExtension(f[0]);
          const audioBuf = await toMp3CappedBitrate(f[0].buffer, f[0].mimetype, f[0].originalname);
          const duration = await audioDuration(audioBuf, f[0].mimetype, f[0].originalname);
          const newRel = `audio/${lang}/exhibits/${exhibit.id}.${ext}`;
          const existingRel = exhibit.audio.tracks[lang]?.file;
          if (existingRel && existingRel !== newRel) deleteFileQuiet(existingRel);
          saveFile(newRel, audioBuf);
          exhibit.audio.tracks[lang] = { file: newRel, durationSec: duration, transcript: transcriptValue };
        } else if (transcriptField !== undefined) {
          if (transcriptField.trim()) {
            if (!exhibit.audio.tracks[lang]) {
              throw new HttpError(400, `Cần upload audio (${lang}) trước khi nhập transcript (${lang})`);
            }
            exhibit.audio.tracks[lang].transcript = transcriptField.trim();
          } else if (exhibit.audio.tracks[lang]) {
            deleteFileQuiet(exhibit.audio.tracks[lang].file);
            delete exhibit.audio.tracks[lang];
          }
        }
      }

      bumpVersion(manifest);
      writeManifest(manifest);
      res.json(exhibit);
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/zones/:zoneId/exhibits/:exhibitId', async (req, res) => {
  try {
    await withHistory(req, { action: 'exhibit.delete', summary: 'Xóa hiện vật' }, async (ctx) => {
      const { zoneId, exhibitId } = req.params;
      const manifest = readManifest();
      const zone = manifest.zones.find((z) => z.id === zoneId);
      if (!zone) throw new HttpError(404, 'Không tìm thấy khu vực');
      const idx = zone.exhibits.findIndex((e) => e.id === exhibitId);
      if (idx === -1) throw new HttpError(404, 'Không tìm thấy hiện vật');

      const [exhibit] = zone.exhibits.splice(idx, 1);
      const { fallbackLanguage: fbDelEx } = getLangSetup(manifest);
      ctx.meta.summary = `Xóa "${dispName(exhibit.name, fbDelEx) || exhibit.id}" khỏi khu vực "${dispName(zone.name, fbDelEx) || zone.id}"`;
      deleteFileQuiet(exhibit.image);
      if (exhibit.thumbnail !== exhibit.image) deleteFileQuiet(exhibit.thumbnail);
      for (const track of Object.values(exhibit.audio?.tracks || {})) deleteFileQuiet(track.file);
      for (const v of exhibit.videos || []) deleteFileQuiet(v.file);
      for (const img of exhibit.images || []) deleteFileQuiet(duongDanAnh(img));
      for (const a of exhibit.audios || []) deleteFileQuiet(a.file);

      bumpVersion(manifest);
      writeManifest(manifest);
      res.status(204).end();
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ==================== KIỂM TRA TÍNH TOÀN VẸN DỮ LIỆU ====================
// Quét manifest.json + file thật trên đĩa, phát hiện: file bị thiếu (manifest
// trỏ tới nhưng không tồn tại), file rác không ai tham chiếu, trùng major/minor,
// thiếu trường bắt buộc ở ngôn ngữ mặc định, khu vực rỗng.
// Cũng là cổng chặn trước "Đóng gói ngay" — xem validateManifest().
function normRelPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function listFilesRecursive(dir) {
  let out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

function runIntegrityCheck(manifest) {
  // Đọc danh mục mô hình MỘT LẦN cho cả lần kiểm — nó quét thư mục trên đĩa, gọi
  // trong vòng lặp hiện vật sẽ thành vài nghìn lần quét.
  let idMoHinh;
  try {
    idMoHinh = models3d.tapId();
  } catch {
    idMoHinh = new Set();
  }
  const languages = manifest.languages || [];
  const fallbackLanguage = manifest.fallbackLanguage;
  const findings = [];
  const referencedFiles = new Set();
  // Ảnh tĩnh (poster/thumb) của mô hình còn trong kho là file ĐANG DÙNG dù chưa
  // hiện vật nào gắn mô hình đó — gắn lúc nào cũng phải có sẵn. Không đăng ký ở
  // đây thì chức năng "xóa file mồ côi" sẽ dọn mất chúng.
  try { for (const f of models3d.tapAnhTinhHopLe()) referencedFiles.add(f); } catch { /* kho mô hình hỏng: bỏ qua */ }

  function checkFile(relPath, message, severity = 'error') {
    if (!relPath) return;
    const rel = normRelPath(relPath);
    referencedFiles.add(rel);
    if (!fs.existsSync(path.join(CONTENT_DIR, rel))) {
      findings.push({ severity, category: 'missing-file', message: `${message}: ${rel}` });
    }
  }

  checkFile(manifest.museum?.welcomeImage, 'Ảnh chào mừng (museum.welcomeImage) bị thiếu');
  checkFile(manifest.museum?.welcomeAccentImage, 'Ảnh phụ chào mừng (museum.welcomeAccentImage) bị thiếu');

  const zoneMajors = new Map();

  for (const zone of manifest.zones || []) {
    const zoneName = (zone.name && (zone.name[fallbackLanguage] || Object.values(zone.name)[0])) || zone.id;
    if (!zoneMajors.has(zone.major)) zoneMajors.set(zone.major, []);
    zoneMajors.get(zone.major).push(zoneName);

    if (!zone.name || !zone.name[fallbackLanguage]) {
      findings.push({ severity: 'error', category: 'missing-field', message: `Khu vực "${zoneName}" thiếu tên ở ngôn ngữ mặc định (${fallbackLanguage})` });
    }
    // LỖI (không phải cảnh báo): app đọc welcomeText bằng _reqLocalized và coi
    // chuỗi rỗng = thiếu, nên thiếu nó ở ngôn ngữ mặc định sẽ ném
    // BundleValidationException ở tầng zone -> SẬP CẢ BUNDLE, giống audio giới
    // thiệu bên dưới. Phải chặn đóng gói.
    if (!zone.welcomeText || !zone.welcomeText[fallbackLanguage]) {
      findings.push({ severity: 'error', category: 'missing-field', message: `Khu vực "${zoneName}" thiếu giới thiệu ở ngôn ngữ mặc định (${fallbackLanguage})` });
    }

    checkFile(zone.heroImage, `Khu vực "${zoneName}" thiếu ảnh nền`);
    if (zone.heroImageBlurred && zone.heroImageBlurred !== zone.heroImage) {
      checkFile(zone.heroImageBlurred, `Khu vực "${zoneName}" thiếu ảnh nền mờ`);
    }

    // Track ngôn ngữ mặc định: file/transcript thiếu là LỖI (client sập cả khu vực).
    // Track ngôn ngữ khác: chỉ là thiếu nội dung, client tự lùi âm thanh về ngôn ngữ
    // mặc định khi phát — không làm sập gì, nên chỉ là CẢNH BÁO.
    const zoneFbTrack = zone.introAudio?.tracks?.[fallbackLanguage];
    if (!zoneFbTrack?.file) {
      findings.push({ severity: 'error', category: 'missing-field', message: `Khu vực "${zoneName}" thiếu audio giới thiệu ở ngôn ngữ mặc định (${fallbackLanguage})` });
    } else {
      checkFile(zoneFbTrack.file, `Khu vực "${zoneName}" thiếu file audio giới thiệu (${fallbackLanguage})`);
      if (!zoneFbTrack.transcript || !zoneFbTrack.transcript.trim()) {
        findings.push({ severity: 'error', category: 'missing-field', message: `Khu vực "${zoneName}" thiếu lời thoại (transcript) audio giới thiệu ở ngôn ngữ mặc định (${fallbackLanguage})` });
      }
    }
    for (const lang of languages) {
      if (lang === fallbackLanguage) continue;
      const t = zone.introAudio?.tracks?.[lang];
      if (t?.file) checkFile(t.file, `Khu vực "${zoneName}" thiếu file audio giới thiệu (${lang})`, 'warning');
    }

    for (const v of zone.videos || []) {
      checkFile(v.file, `Khu vực "${zoneName}" thiếu file video "${v.originalName || ''}"`, 'warning');
    }
    for (const im of zone.images || []) {
      const duongDan = duongDanAnh(im);
      const ten = (typeof im === 'string' ? zone.imagesMeta?.[im]?.originalName : im?.originalName) || path.basename(duongDan || '');
      checkFile(duongDan, `Khu vực "${zoneName}" có ảnh phụ "${ten}" trong dải ảnh nhưng file không có trên máy chủ — tải lại ảnh này hoặc xóa nó khỏi dải ảnh`, 'warning');
    }
    for (const au of zone.audios || []) {
      checkFile(au.file, `Khu vực "${zoneName}" thiếu 1 audio phụ "${au.originalName || ''}"`, 'warning');
    }

    const exhibitMinors = new Map();
    const exhibits = zone.exhibits || [];
    if (!exhibits.length) {
      // LỖI chứ không phải cảnh báo: app TỪ CHỐI CẢ GÓI khi gặp khu vực rỗng
      // (`ManifestParser._parseZone` ném BundleValidationException, xem CLAUDE.md
      // §5.19). Hậu quả là mọi tablet ngừng nhận nội dung mới mà không ai biết, vì
      // máy vẫn chạy bình thường với bản cũ.
      findings.push({
        severity: 'error',
        category: 'empty-zone',
        message: `Khu vực "${zoneName}" chưa có hiện vật nào — app sẽ từ chối toàn bộ gói dữ liệu. `
          + `Hãy thêm ít nhất 1 hiện vật, hoặc xóa khu vực này đi.`,
      });
    }

    for (const ex of exhibits) {
      const exName = (ex.name && (ex.name[fallbackLanguage] || Object.values(ex.name)[0])) || ex.id;
      if (!exhibitMinors.has(ex.minor)) exhibitMinors.set(ex.minor, []);
      exhibitMinors.get(ex.minor).push(exName);

      if (!ex.name || !ex.name[fallbackLanguage]) {
        findings.push({ severity: 'error', category: 'missing-field', message: `Hiện vật "${exName}" (khu vực "${zoneName}") thiếu tên ở ngôn ngữ mặc định (${fallbackLanguage})` });
      }
      if (!ex.summary || !ex.summary[fallbackLanguage]) {
        findings.push({ severity: 'error', category: 'missing-field', message: `Hiện vật "${exName}" (khu vực "${zoneName}") thiếu tóm tắt ở ngôn ngữ mặc định (${fallbackLanguage})` });
      }

      checkFile(ex.image, `Hiện vật "${exName}" thiếu ảnh`);
      if (ex.thumbnail && ex.thumbnail !== ex.image) {
        checkFile(ex.thumbnail, `Hiện vật "${exName}" thiếu ảnh thumbnail`);
      }

      // ---- mô hình 3D ----
      //
      // LƯU Ý (3d-handover.md mục 10): đây là chỗ DUY NHẤT mà hai kho mã nguồn buộc
      // phải đồng ý với nhau, và nó ĐÃ TỪNG hỏng thật: máy chủ xuất bản một id có
      // dấu cách, manifest trỏ đúng id ấy, đối chiếu báo khớp — và ứng dụng LẶNG LẼ
      // bỏ cả khối model. Nên cả hai lỗi dưới đây đều là 'error' chứ không phải cảnh
      // báo: sai ở đây thì không có triệu chứng nào khác.
      if (ex.model3dId) {
        if (!models3d.MODEL_ID_RULE.test(ex.model3dId)) {
          findings.push({
            severity: 'error',
            category: 'model-3d',
            message: `Hiện vật "${exName}" gán mã mô hình 3D không hợp lệ ("${ex.model3dId}") — `
              + 'chỉ được dùng chữ, số, gạch ngang và gạch dưới, tối đa 64 ký tự. '
              + 'App sẽ bỏ qua mô hình mà không báo gì.',
          });
        } else if (!idMoHinh.has(ex.model3dId)) {
          findings.push({
            severity: 'error',
            category: 'model-3d',
            message: `Hiện vật "${exName}" gán mô hình 3D "${ex.model3dId}" nhưng kho mô hình không có mã đó — `
              + 'app sẽ tải về một danh mục không chứa nó và màn hình hiện vật sẽ không bao giờ mở được 3D.',
          });
        }
      }

      // Poster/thumb riêng của mô hình (nếu đã dựng): app vẽ chúng ở đầu màn hiện
      // vật và ở lưới. Thiếu file = ô trống. Mức 'warning': không sập gói.
      const m0 = Array.isArray(ex.media) ? ex.media[0] : null;
      if (m0 && m0.type === 'model') {
        if (m0.poster && m0.poster !== ex.image) checkFile(m0.poster, `Hiện vật "${exName}" thiếu ảnh giữ chỗ của mô hình 3D`, 'warning');
        if (m0.thumb && m0.thumb !== ex.thumbnail && m0.thumb !== ex.image) checkFile(m0.thumb, `Hiện vật "${exName}" thiếu ảnh nhỏ của mô hình 3D`, 'warning');
      }

      // Không có ảnh nào ⇒ ứng dụng bản 3D bỏ CẢ HIỆN VẬT (media[] rỗng), và nếu cả
      // khu vực đều vậy thì khu vực thành rỗng ⇒ cả gói bị từ chối. Bản `main` cũng
      // bỏ hiện vật (image là _reqPath). Hai đường khác nhau, cùng một kết cục, nên
      // đây là 'error' ở cả hai bản app.
      if (!ex.image) {
        findings.push({
          severity: 'error',
          category: 'missing-field',
          message: `Hiện vật "${exName}" (khu vực "${zoneName}") chưa có ảnh — app sẽ bỏ hẳn hiện vật này.`,
        });
      }
      // Dải ảnh (gallery) — ảnh phụ, không bắt buộc, nhưng vẫn phải tính vào
      // referencedFiles (qua checkFile), nếu không sẽ bị báo nhầm "orphaned-file" dù
      // đang được dùng thật.
      //
      // LƯU Ý: dải ảnh chuẩn là mảng chuỗi đường dẫn trần — dạng app thực sự đọc
      // (`manifest_parser.dart` chỉ nhận `item is String`, xem chuanHoaAnhPhuCua).
      // Manifest chưa ghi lại lần nào có thể còn object {file, ...} kiểu cũ, nên vẫn
      // xử lý CẢ HAI, nếu không file thiếu lọt qua kiểm tra mà không một dòng cảnh báo.
      // Mức 'warning': app bỏ qua ảnh phụ hỏng mà không sập, chặn đóng gói vì mấy
      // tấm ảnh minh họa là phản ứng quá tay.
      for (const im of ex.images || []) {
        const duongDan = duongDanAnh(im);
        const ten = (typeof im === 'string' ? ex.imagesMeta?.[im]?.originalName : im?.originalName) || path.basename(duongDan || '');
        checkFile(duongDan, `Hiện vật "${exName}" có ảnh phụ "${ten}" trong dải ảnh nhưng file không có trên máy chủ — tải lại ảnh này hoặc xóa nó khỏi dải ảnh`, 'warning');
      }
      for (const au of ex.audios || []) {
        checkFile(au.file, `Hiện vật "${exName}" thiếu 1 audio phụ "${au.originalName || ''}"`, 'warning');
      }

      const exFbTrack = ex.audio?.tracks?.[fallbackLanguage];
      if (!exFbTrack?.file) {
        findings.push({ severity: 'error', category: 'missing-field', message: `Hiện vật "${exName}" thiếu audio thuyết minh ở ngôn ngữ mặc định (${fallbackLanguage})` });
      } else {
        checkFile(exFbTrack.file, `Hiện vật "${exName}" thiếu file audio thuyết minh (${fallbackLanguage})`);
        if (!exFbTrack.transcript || !exFbTrack.transcript.trim()) {
          findings.push({ severity: 'error', category: 'missing-field', message: `Hiện vật "${exName}" thiếu lời thuyết minh (transcript) ở ngôn ngữ mặc định (${fallbackLanguage})` });
        }
      }
      for (const lang of languages) {
        if (lang === fallbackLanguage) continue;
        const t = ex.audio?.tracks?.[lang];
        if (t?.file) checkFile(t.file, `Hiện vật "${exName}" thiếu file audio thuyết minh (${lang})`, 'warning');
      }

      for (const v of ex.videos || []) {
        checkFile(v.file, `Hiện vật "${exName}" thiếu file video "${v.originalName || ''}"`, 'warning');
      }
    }

    for (const [minor, names] of exhibitMinors) {
      if (names.length > 1) {
        findings.push({ severity: 'error', category: 'duplicate-id', message: `Khu vực "${zoneName}" có ${names.length} hiện vật trùng minor=${minor}: ${names.join(', ')}` });
      }
    }
  }

  for (const [major, names] of zoneMajors) {
    if (names.length > 1) {
      findings.push({ severity: 'error', category: 'duplicate-id', message: `Có ${names.length} khu vực trùng major=${major}: ${names.join(', ')}` });
    }
  }

  // Lưới cuối: quét MỌI chuỗi trong manifest trông như đường dẫn media. Các vòng
  // trên chỉ biết khu vực/hiện vật/museum, còn manifest có thêm những khối CMS
  // chưa có chỗ sửa (`guide.steps[].image`, sau này có thể `about`, `faq`...) mà
  // app vẫn đọc. Thiếu lượt này thì file thiếu ở đó không ai báo, và tệ hơn: file
  // có thật ở đó bị coi là mồ côi — cleanOrphansAfterRestore() sẽ xóa mất.
  // Mức 'warning': app bỏ riêng ảnh hỏng của mục đó, không sập bundle.
  (function quetDuongDan(v, viTri) {
    if (typeof v === 'string') {
      if (!/^(images|audio|videos)\//.test(v)) return;
      const rel = normRelPath(v);
      if (!rel || referencedFiles.has(rel)) return; // đã kiểm (và đã báo nếu thiếu) ở trên
      checkFile(rel, `File được nhắc ở "${viTri}" nhưng không có trên máy chủ — mục này chưa sửa được trong CMS, cần chép file vào hoặc bỏ dòng đó khỏi manifest.json`, 'warning');
      return;
    }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      quetDuongDan(x, Array.isArray(v) ? `${viTri}[${k}]` : (viTri ? `${viTri}.${k}` : k));
    }
  })(manifest, '');

  // Mô hình 3D không còn hiện vật nào trỏ tới: gỡ/thay mô hình trong biểu mẫu hiện vật
  // cố ý KHÔNG xóa file (để hoàn tác được), nên chúng nằm lại — dọn ở đây.
  const dangDungMoHinh = new Set();
  for (const z of manifest.zones || []) for (const e of z.exhibits || []) if (e.model3dId) dangDungMoHinh.add(e.model3dId);
  for (const id of models3d.danhSachId()) {
    if (dangDungMoHinh.has(id)) continue;
    const meta = models3d.docMeta(id);
    const mbStr = meta && meta.bytes ? `${(meta.bytes / 1024 / 1024).toFixed(1)} MB` : '';
    findings.push({
      severity: 'info', category: 'orphaned-model', modelId: id,
      message: `Mô hình 3D "${id}"${meta && meta.label ? ` (${meta.label})` : ''} không còn hiện vật nào dùng — có thể xóa để đỡ tốn dung lượng${mbStr ? ` (${mbStr})` : ''}`,
    });
  }

  for (const sub of ['images', 'audio', 'videos']) {
    const files = listFilesRecursive(path.join(CONTENT_DIR, sub));
    for (const full of files) {
      const rel = normRelPath(path.relative(CONTENT_DIR, full));
      if (!referencedFiles.has(rel)) {
        const sizeKb = Math.round(fs.statSync(full).size / 1024);
        findings.push({ severity: 'info', category: 'orphaned-file', path: rel, message: `File không được dùng đến (có thể xóa để đỡ tốn dung lượng): ${rel} (${sizeKb} KB)` });
      }
    }
  }

  return findings;
}

// Dọn file media không còn được manifest nhắc tới, dùng NGAY SAU khi khôi phục
// một bản sao lưu.
//
// Vì sao cần: khôi phục THAY THẾ toàn bộ manifest.json nhưng chỉ CHÉP THÊM
// ảnh/audio từ bản sao lưu — file tạo sau thời điểm sao lưu vẫn nằm nguyên trên
// đĩa. Chúng thành file mồ côi, và staticContentBundle.js đóng gói CẢ thư mục
// chứ không lọc theo manifest, nên rác đó vẫn bị tải về mọi máy khách.
//
// Xóa qua deleteFileQuiet() nên file vào thùng rác của thao tác đang chạy ->
// bấm "hoàn tác" vẫn lấy lại được, không mất hẳn.
function cleanOrphansAfterRestore(manifest) {
  const removed = [];
  for (const f of runIntegrityCheck(manifest)) {
    if (f.category !== 'orphaned-file' || !f.path) continue;
    deleteFileQuiet(f.path);
    removed.push(f.path);
  }
  return removed;
}

// Kiểm tra một ngôn ngữ có đủ dữ liệu bắt buộc ở TẤT CẢ khu vực/hiện vật chưa —
// dùng khi đổi ngôn ngữ mặc định (PUT /languages). Ngôn ngữ mặc định mà thiếu
// dữ liệu ở đâu sẽ làm client sập CẢ BUNDLE khi phân tích (khác với thiếu ở
// ngôn ngữ phụ — chỗ đó client tự bỏ qua được).
function findMissingLanguageCoverage(manifest, lang) {
  const problems = [];
  for (const zone of manifest.zones || []) {
    const zoneName = (zone.name && (zone.name[lang] || zone.name[manifest.fallbackLanguage] || Object.values(zone.name || {})[0])) || zone.id;
    if (!zone.name?.[lang]?.trim()) problems.push(`Khu vực "${zoneName}" chưa có tên ở ngôn ngữ "${lang}"`);
    if (!zone.welcomeText?.[lang]?.trim()) problems.push(`Khu vực "${zoneName}" chưa có giới thiệu ở ngôn ngữ "${lang}"`);
    const zoneTrack = zone.introAudio?.tracks?.[lang];
    if (!zoneTrack?.file) problems.push(`Khu vực "${zoneName}" chưa có audio giới thiệu ở ngôn ngữ "${lang}"`);
    else if (!zoneTrack.transcript?.trim()) problems.push(`Khu vực "${zoneName}" chưa có lời thoại (transcript) audio giới thiệu ở ngôn ngữ "${lang}"`);

    for (const ex of zone.exhibits || []) {
      const exName = (ex.name && (ex.name[lang] || ex.name[manifest.fallbackLanguage] || Object.values(ex.name || {})[0])) || ex.id;
      if (!ex.name?.[lang]?.trim()) problems.push(`Hiện vật "${exName}" (khu vực "${zoneName}") chưa có tên ở ngôn ngữ "${lang}"`);
      if (!ex.summary?.[lang]?.trim()) problems.push(`Hiện vật "${exName}" chưa có tóm tắt ở ngôn ngữ "${lang}"`);
      const exTrack = ex.audio?.tracks?.[lang];
      if (!exTrack?.file) problems.push(`Hiện vật "${exName}" chưa có audio thuyết minh ở ngôn ngữ "${lang}"`);
      else if (!exTrack.transcript?.trim()) problems.push(`Hiện vật "${exName}" chưa có lời thuyết minh (transcript) ở ngôn ngữ "${lang}"`);
    }
  }
  return problems;
}

router.get('/integrity-check', (req, res) => {
  try {
    const manifest = readManifest();
    const findings = runIntegrityCheck(manifest);
    const summary = {
      total: findings.length,
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warning').length,
      info: findings.filter((f) => f.severity === 'info').length,
    };
    res.json({ checkedAt: new Date().toISOString(), summary, findings });
  } catch (err) {
    res.status(500).json({ error: `Lỗi kiểm tra tính toàn vẹn: ${err.message}` });
  }
});

// Xóa một file "mồ côi" (không còn được manifest.json tham chiếu) khỏi
// content/images hoặc content/audio — dùng từ nút "Xóa" trong kết quả Kiểm tra
// tính toàn vẹn. Luôn tính lại runIntegrityCheck() ngay tại đây (không tin
// đường dẫn client gửi là mồ côi thật) để tránh xóa nhầm file đang dùng khi
// giao diện hiển thị dữ liệu cũ.
router.delete('/orphaned-file', (req, res) => {
  try {
    const rel = normRelPath((req.body || {}).path);
    if (!rel) throw new HttpError(400, 'Thiếu đường dẫn file');
    if (!/^(images|audio|videos)\//.test(rel)) {
      throw new HttpError(400, 'Chỉ được xóa file trong images/, audio/ hoặc videos/');
    }
    const fullPath = path.join(CONTENT_DIR, rel);
    if (path.relative(CONTENT_DIR, fullPath).startsWith('..')) {
      throw new HttpError(400, 'Đường dẫn không hợp lệ');
    }

    const manifest = readManifest();
    const findings = runIntegrityCheck(manifest);
    const stillOrphaned = findings.some((f) => f.category === 'orphaned-file' && f.path === rel);
    if (!stillOrphaned) {
      throw new HttpError(409, 'File này hiện đang được dùng trong nội dung (hoặc không tồn tại) — không thể xóa.');
    }

    fs.unlinkSync(fullPath);
    // Dọn thư mục rỗng còn lại (vd content/images/exhibits/asdasd/ sau khi xóa
    // main.jpg) — chỉ dọn lên tới images/ hoặc audio/, không đụng tới cấp trên.
    let dir = path.dirname(fullPath);
    const stopAt = path.join(CONTENT_DIR, rel.split('/')[0]);
    while (dir !== stopAt && dir.startsWith(stopAt)) {
      if (fs.readdirSync(dir).length > 0) break;
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }

    res.json({ deleted: rel });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Dựng xong dải ảnh (hoặc vừa thay file mô hình) thì poster/thumb của media[0]
// đổi. LƯU Ý: manifest đổi mà KHÔNG tăng version thì máy đã đồng bộ không bao
// giờ tải lại (CLAUDE.md §5.10). Chỉ ghi khi mô hình ĐANG được hiện vật nào
// gắn: chưa gắn thì manifest không nhắc tới nó, không có gì để làm mới.
// Đi qua withHistory để vẫn có dòng nhật ký và vẫn hoàn tác được.
dungAnh.datHookSauKhiDung(async (modelId) => {
  const nguoiLam = { userName: 'Máy chủ (dựng ảnh mô hình 3D)', userId: null };
  await withHistory(nguoiLam, { action: 'model.stills', summary: `Cập nhật ảnh giữ chỗ của mô hình 3D "${modelId}"` }, async () => {
    const manifest = readManifest();
    const dung = (manifest.zones || []).some((z) => (z.exhibits || []).some((e) => e.model3dId === modelId));
    if (!dung) return;
    bumpVersion(manifest);
    writeManifest(manifest);
  });
});

// Sau khi Chủ đổi bộ trường thông tin (tên, bản dịch, bật/tắt "hiện cho khách", đơn vị...),
// sinh lại phần specs tự động của MỌI nội dung để máy khách thấy ngay. Không có gì đổi thì
// không ghi manifest và không thêm dòng nhật ký. Trả về số nội dung đã đổi.
async function sinhLaiTruongThongTin(req) {
  const fields = cmsSettingsMod.doc().fields;
  const thu = readManifest();
  if (!customFields.sinhLaiTatCa(thu, fields, getLangSetup(thu))) return 0;
  let doi = 0;
  await withHistory(req, { action: 'fields.regenerate', summary: 'Cập nhật trường thông tin' }, async (ctx) => {
    const manifest = readManifest();
    doi = customFields.sinhLaiTatCa(manifest, fields, getLangSetup(manifest));
    if (!doi) return;
    bumpVersion(manifest);
    writeManifest(manifest);
    ctx.meta.summary = `Cập nhật trường thông tin cho ${doi} nội dung`;
  });
  return doi;
}

module.exports = { router, validateManifest, findMissingLanguageCoverage, dongBoMedia, runIntegrityCheck, sinhLaiTruongThongTin };
