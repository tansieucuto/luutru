// Kho mô hình 3D của hiện vật: đọc/kiểm tra file .glb, lưu trên đĩa, sinh
// models.json cho app.
//
// LƯU Ý: hình dạng dữ liệu ở đây là HỢP ĐỒNG với app — đọc
// beacon-client/docs/3d-handover.md trước khi sửa.
//
// Mô hình không nằm trong bundle: bundle tải nguyên khối, nhét .glb vào thì mỗi lần
// sửa chính tả là cả đội máy tải lại hàng trăm MB. Mô hình đi đường riêng, từng
// file, địa chỉ theo nội dung, tải lúc khách mở hiện vật.
//
//   bundle (tar.gz)   manifest + ảnh + audio + poster + thumb
//   models.json       danh mục: id → file, sha256, bytes, turntable
//   models/<id>/<sha12>.glb
//
// Manifest chỉ mang KHÓA (media[0].id), không mang đường dẫn: đổi file mô hình
// không đụng tới manifest, và ngược lại.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { CONTENT_DIR } = require('./paths');
const MODELS_DIR = path.join(CONTENT_DIR, 'models');
const TURNTABLE_DIR = path.join(CONTENT_DIR, 'turntable');

// LƯU Ý: PHẢI KHỚP ManifestParser._modelIdRule bên app — chỗ duy nhất hai kho mã
// nguồn buộc phải đồng ý với nhau (3d-handover.md mục 10). Lệch nhau thì app lặng
// lẽ bỏ khối model mà không báo gì.
const MODEL_ID_RULE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// Chính sách extension glTF — theo HÀNH VI THẬT của app: app không đặt đường dẫn
// bộ giải nén nào cho model-viewer, nên trên tablet:
//   - Draco, KTX2: bộ giải nén tải từ www.gstatic.com lúc mở mô hình → mất Internet
//     là mô hình không hiện. Chỉ CẢNH BÁO, không bắt buộc (khác museum_server, bên
//     đó bắt buộc Draco).
//   - meshopt: model-viewer không có đường mặc định → mô hình KHÔNG BAO GIỜ dựng
//     được. `gltf-transform optimize` dùng meshopt theo mặc định, nên CHẶN khi nó
//     nằm trong extensionsRequired.
const EXT_CHAN = {
  EXT_meshopt_compression:
    'nén meshopt — app không có bộ giải nén cho định dạng này, mô hình sẽ KHÔNG BAO GIỜ hiện trên tablet. '
    + 'Xuất lại bằng `gltf-transform optimize in.glb out.glb --compress draco` hoặc `--compress false`',
};
const EXT_CAN_MANG = {
  KHR_draco_mesh_compression: 'nén Draco',
  KHR_texture_basisu: 'texture KTX2',
};
const EXT_DAT = {
  KHR_materials_transmission: 'kính/khúc xạ — render cả cảnh ra texture mỗi khung hình, đắt nhất trên GPU yếu',
  KHR_materials_volume: 'vật liệu có thể tích — đi kèm transmission, cùng mức chi phí',
  KHR_materials_clearcoat: 'lớp sơn bóng — thêm một lớp tính sáng cho mỗi material',
};

// Trần ngân sách. LƯU Ý: cổng chính là VRAM, không phải dung lượng file —
// DamagedHelmet.glb nặng 3.6 MB trên đĩa nhưng ăn 106 MB VRAM.
//
// VRAM: trần CỨNG 110 MB theo số ĐÃ ĐO, không theo con số an toàn 10 MB cũ của
// 3d-handover.md §5 (nới 2026-10-04 — CLAUDE.md §5.22d). Trên đúng máy thực địa (Helio
// A22, 1.79 GB, Android Go), DamagedHelmet bản gốc ~106 MB chạy 38 phút tự xoay liên
// tục: không bị LMK giết, không throttle, PSS phẳng (3d-handover.md §7, M0-baseline.md).
const BUDGET = {
  vramBytes: 110 * 1024 * 1024,   // cổng chính — vượt là chặn
  triangles: 150000,
  materials: 8,
  drawCalls: 50,
  fileBytes: 8 * 1024 * 1024,    // chỉ ràng buộc tải/đĩa
};

// ---------------------------------------------------------------------------
// Đọc kích thước ảnh từ header (chỉ cần W/H để tính VRAM, không giải nén)
// ---------------------------------------------------------------------------

// Đọc được PNG, JPEG, KTX2 và cả ba biến thể WebP. LƯU Ý: định dạng nào không đọc
// được thì tổng pixel = 0 và mô hình vượt trần sẽ lọt qua bộ kiểm — thêm định dạng
// texture mới thì phải thêm nhánh ở đây.
function kichThuocAnh(buf) {
  if (buf.length < 16) return null;

  // PNG: 89 50 4E 47, IHDR ở offset 16
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }

  // JPEG: quét các marker SOFn
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      // SOF0..SOF15, trừ DHT (c4), JPG (c8), DAC (cc)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }

  // KTX2: 12 byte chữ ký, W/H là UInt32LE ở offset 20/24.
  if (buf.length >= 28 && buf[0] === 0xab && buf.toString('ascii', 1, 7) === 'KTX 20'
      && buf[7] === 0xbb && buf[8] === 0x0d && buf[9] === 0x0a && buf[10] === 0x1a && buf[11] === 0x0a) {
    return { w: buf.readUInt32LE(20), h: buf.readUInt32LE(24), ktx2: true };
  }

  // WebP: RIFF....WEBP, rồi một trong ba biến thể VP8 / VP8L / VP8X
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const loai = buf.toString('ascii', 12, 16);
    if (loai === 'VP8X') {
      // 3 byte little-endian, lưu (kích thước − 1)
      const w = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
      const h = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
      return { w, h };
    }
    if (loai === 'VP8 ') {
      // khung key bắt đầu bằng 9d 01 2a
      for (let i = 20; i < Math.min(buf.length - 6, 64); i++) {
        if (buf[i] === 0x9d && buf[i + 1] === 0x01 && buf[i + 2] === 0x2a) {
          return { w: buf.readUInt16LE(i + 3) & 0x3fff, h: buf.readUInt16LE(i + 5) & 0x3fff };
        }
      }
      return null;
    }
    if (loai === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bóc file .glb
// ---------------------------------------------------------------------------

/** Tách container GLB thành { gltf, bin }. Ném Error với câu tiếng Việt. */
function docGlb(buf) {
  if (buf.length < 12) throw new Error('File quá ngắn, không phải .glb');
  if (buf.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('Không phải file .glb (thiếu chữ ký glTF ở đầu file)');
  }
  const phienBan = buf.readUInt32LE(4);
  if (phienBan !== 2) throw new Error(`glTF phiên bản ${phienBan} không được hỗ trợ, cần bản 2`);

  let off = 12;
  let gltf = null;
  let bin = null;
  while (off + 8 <= buf.length) {
    const doDai = buf.readUInt32LE(off);
    const loai = buf.toString('ascii', off + 4, off + 8);
    const dau = off + 8;
    const cuoi = dau + doDai;
    if (cuoi > buf.length) throw new Error('File .glb hỏng: một khối dữ liệu vượt quá kích thước file');
    if (loai === 'JSON') gltf = JSON.parse(buf.subarray(dau, cuoi).toString('utf8'));
    else if (loai === 'BIN\0') bin = buf.subarray(dau, cuoi);
    off = cuoi + ((4 - (cuoi % 4)) % 4);
  }
  if (!gltf) throw new Error('File .glb hỏng: không tìm thấy phần mô tả JSON');
  return { gltf, bin };
}

/**
 * Đếm tam giác. Trả về { veRa, rieng }:
 *   - `rieng` = tổng tam giác của các mesh khác nhau
 *   - `veRa`  = nhân thêm số lần mesh được đặt vào cảnh (instancing)
 *
 * Trần áp lên `veRa`: GPU phải vẽ từng bản sao, nên 10 bản của một mesh 20k tam giác
 * đắt ngang một mesh 200k.
 */
function demTamGiac(gltf) {
  const meshes = gltf.meshes || [];
  const accessors = gltf.accessors || [];

  const theoMesh = meshes.map((mesh) => {
    let tong = 0;
    for (const prim of mesh.primitives || []) {
      // mode 4 = TRIANGLES là mặc định khi vắng mặt.
      const mode = prim.mode === undefined ? 4 : prim.mode;
      let soDinh = 0;
      if (prim.indices !== undefined) {
        soDinh = accessors[prim.indices]?.count || 0;
      } else {
        soDinh = accessors[prim.attributes?.POSITION]?.count || 0;
      }
      if (mode === 4) tong += Math.floor(soDinh / 3);
      else if (mode === 5 || mode === 6) tong += Math.max(0, soDinh - 2);
    }
    return tong;
  });

  // Đếm số lần mỗi mesh xuất hiện trong cây node.
  const soLan = new Array(meshes.length).fill(0);
  for (const node of gltf.nodes || []) {
    if (typeof node.mesh === 'number' && soLan[node.mesh] !== undefined) soLan[node.mesh]++;
  }

  let veRa = 0;
  let rieng = 0;
  for (let i = 0; i < theoMesh.length; i++) {
    rieng += theoMesh[i];
    veRa += theoMesh[i] * Math.max(1, soLan[i]);
  }
  return { veRa, rieng };
}

/** Số lệnh vẽ ≈ số primitive, đã tính cả instancing. */
function demLenhVe(gltf) {
  const meshes = gltf.meshes || [];
  const soLan = new Array(meshes.length).fill(0);
  for (const node of gltf.nodes || []) {
    if (typeof node.mesh === 'number' && soLan[node.mesh] !== undefined) soLan[node.mesh]++;
  }
  let tong = 0;
  meshes.forEach((mesh, i) => {
    tong += (mesh.primitives || []).length * Math.max(1, soLan[i]);
  });
  return tong;
}

/**
 * Ước lượng VRAM của texture: RGBA8 chưa nén + mipmap (~1.33×) là cách GPU thật sự
 * giữ texture — không phải dung lượng đã nén trên đĩa.
 */
function tinhVram(gltf, bin) {
  const images = gltf.images || [];
  const buffViews = gltf.bufferViews || [];
  let tongPixel = 0;
  let tongByte = 0;
  const chiTiet = [];
  let khongDoc = 0;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    let buf = null;
    if (typeof img.bufferView === 'number' && bin) {
      const bv = buffViews[img.bufferView];
      if (bv) buf = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    } else if (typeof img.uri === 'string' && img.uri.startsWith('data:')) {
      const c = img.uri.indexOf(',');
      if (c > 0) buf = Buffer.from(img.uri.slice(c + 1), 'base64');
    }
    if (!buf) { khongDoc++; continue; }
    const kt = kichThuocAnh(buf);
    if (!kt) { khongDoc++; continue; }
    // KTX2 tính 1 byte/pixel (GPU giữ ở dạng đã nén), còn lại 4 byte/pixel. Tính THEO
    // TỪNG TEXTURE vì một mô hình có thể trộn KTX2 với PNG. Tính chung 4 byte sẽ thổi
    // phồng KTX2 gấp 4 lần và từ chối oan mô hình tốt.
    tongByte += kt.w * kt.h * (kt.ktx2 ? 1 : 4);
    tongPixel += kt.w * kt.h;
    chiTiet.push({ index: i, w: kt.w, h: kt.h, mimeType: img.mimeType || null, ktx2: Boolean(kt.ktx2) });
  }

  return {
    bytes: Math.round(tongByte * 1.33),
    textures: chiTiet,
    khongDocDuoc: khongDoc,
  };
}

/**
 * Khám một file .glb: số liệu + đối chiếu ngân sách.
 * Trả về { soLieu, viPham[], canhBao[] }. viPham rỗng = được phép xuất bản.
 */
function khamGlb(buf) {
  const { gltf, bin } = docGlb(buf);
  const tamGiac = demTamGiac(gltf);
  const vram = tinhVram(gltf, bin);
  const materials = (gltf.materials || []).length;
  const lenhVe = demLenhVe(gltf);

  const soLieu = {
    bytes: buf.length,
    triangles: tamGiac.veRa,
    trianglesUnique: tamGiac.rieng,
    materials,
    drawCalls: lenhVe,
    vramBytes: vram.bytes,
    textures: vram.textures,
    texturesUnreadable: vram.khongDocDuoc,
    extensions: gltf.extensionsUsed || [],
  };

  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  const viPham = [];
  if (soLieu.vramBytes > BUDGET.vramBytes) {
    viPham.push(`VRAM ước tính ${mb(soLieu.vramBytes)} MB, vượt trần ${mb(BUDGET.vramBytes)} MB`
      + ' — hạ độ phân giải texture xuống (2048×2048 hoặc 1024×1024)');
  }
  if (soLieu.triangles > BUDGET.triangles) {
    viPham.push(`${soLieu.triangles.toLocaleString('vi-VN')} tam giác, vượt trần ${BUDGET.triangles.toLocaleString('vi-VN')}`);
  }
  if (soLieu.materials > BUDGET.materials) {
    viPham.push(`${soLieu.materials} material, vượt trần ${BUDGET.materials} — cần người dựng 3D gộp lại, không tự động được`);
  }
  if (soLieu.drawCalls > BUDGET.drawCalls) {
    viPham.push(`${soLieu.drawCalls} lệnh vẽ, vượt trần ${BUDGET.drawCalls}`);
  }
  if (soLieu.bytes > BUDGET.fileBytes) {
    viPham.push(`File nặng ${mb(soLieu.bytes)} MB, vượt trần ${mb(BUDGET.fileBytes)} MB`);
  }
  const canBat = gltf.extensionsRequired || [];
  const daDung = gltf.extensionsUsed || [];
  for (const [ext, lyDo] of Object.entries(EXT_CHAN)) {
    // Chỉ chặn khi BẮT BUỘC: nằm ở extensionsUsed mà không Required nghĩa là file còn
    // bản dự phòng.
    if (canBat.includes(ext)) viPham.push(`Dùng ${lyDo}`);
  }

  // Cảnh báo: không chặn, nhưng phải nói ra.
  const canhBao = [];
  const canMang = Object.keys(EXT_CAN_MANG).filter((e) => daDung.includes(e));
  if (canMang.length) {
    canhBao.push(`Dùng ${canMang.map((e) => EXT_CAN_MANG[e]).join(' và ')}: tablet phải tải bộ giải nén từ `
      + 'www.gstatic.com lúc mở mô hình — mất Internet thì mô hình không hiện. Chạy được, nhưng không chạy ngoại tuyến.');
  }
  for (const [ext, lyDo] of Object.entries(EXT_DAT)) {
    if (daDung.includes(ext)) canhBao.push(`Dùng ${lyDo}`);
  }
  // Texture không đọc được (vd. nằm ngoài file) thì con số VRAM là THIẾU — nói rõ để
  // người dùng không tin nhầm.
  if (soLieu.texturesUnreadable > 0) {
    canhBao.push(`Có ${soLieu.texturesUnreadable} texture không đọc được kích thước — con số VRAM là THIẾU, không phải đầy đủ.`);
  }
  soLieu.canhBao = canhBao;   // giữ trong soLieu để meta.json lưu lại

  return { soLieu, viPham, canhBao };
}

// ---------------------------------------------------------------------------
// Kho trên đĩa
// ---------------------------------------------------------------------------
//   content/models/<id>/<sha12>.glb   file được phục vụ
//   content/models/<id>/meta.json     { id, label, sha256, bytes, soLieu, stills }
//
// Tên file chứa 12 ký tự đầu của mã băm để URL bất biến: proxy giữ bản cũ không thể
// trả nhầm nội dung cho bản mới (app kiểm băm, lệch thì vứt rồi tải lại mãi).

function bamNoiDung(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function thuMucModel(id) {
  if (!MODEL_ID_RULE.test(id)) throw new Error(`Mã mô hình không hợp lệ: ${id}`);
  return path.join(MODELS_DIR, id);
}

/** Đọc meta của một mô hình, hoặc null nếu không có/hỏng. */
function docMeta(id) {
  try {
    const p = path.join(thuMucModel(id), 'meta.json');
    if (!fs.existsSync(p)) return null;
    const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
    return meta && meta.id === id ? meta : null;
  } catch {
    return null;
  }
}

/** Danh sách mã các mô hình đang có. */
function danhSachId() {
  if (!fs.existsSync(MODELS_DIR)) return [];
  return fs.readdirSync(MODELS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && MODEL_ID_RULE.test(d.name))
    .map((d) => d.name)
    .sort();
}

// ---------------------------------------------------------------------------
// Dải ảnh xoay + ảnh tĩnh (poster/thumb) — do turntableRenderer.js dựng
// ---------------------------------------------------------------------------
//   content/turntable/<id>-<sha12>/000.webp ... + source.json
//   content/images/models/<id>/poster-<sha12>.webp, thumb-<sha12>.webp
//
// Thư mục dải ảnh chứa mã băm nên URL bất biến. LƯU Ý: chỉ CÔNG BỐ dải ảnh khi
// source.json khớp băm CỦA FILE HIỆN TẠI — nếu không, thay file xong app sẽ xoay dải
// ảnh của bản cũ trong khi lớp 3D là bản mới.

function tenThuMucDaiAnh(id, sha) {
  return `${id}-${String(sha).slice(0, 12)}`;
}

function duongDanAnhTinh(id, sha) {
  const s12 = String(sha).slice(0, 12);
  return { poster: `images/models/${id}/poster-${s12}.webp`, thumb: `images/models/${id}/thumb-${s12}.webp` };
}

/** Dải ảnh đã dựng XONG và ĐÚNG BẢN cho file hiện tại, hoặc null. */
function docTurntable(id) {
  const meta = docMeta(id);
  if (!meta) return null;
  const ten = tenThuMucDaiAnh(id, meta.sha256);
  const dir = path.join(TURNTABLE_DIR, ten);
  let nguon;
  try { nguon = JSON.parse(fs.readFileSync(path.join(dir, 'source.json'), 'utf8')); } catch { return null; }
  if (!nguon || nguon.sha256 !== meta.sha256 || !Number.isInteger(nguon.frames) || nguon.frames < 2) return null;
  // Đủ hoặc không gì cả — app cũng vậy (thiếu một khung là không dùng dải ảnh).
  for (let i = 0; i < nguon.frames; i++) {
    if (!fs.existsSync(path.join(dir, `${String(i).padStart(3, '0')}.webp`))) return null;
  }
  return { dir: `turntable/${ten}`, frames: nguon.frames, ext: 'webp' };
}

/** Poster/thumb đã dựng cho ĐÚNG bản file hiện tại, hoặc null. Không kiểm file trên
 *  đĩa vì dongBoMedia() gọi hàm này ở mỗi lần ghi manifest — việc đó là của
 *  runIntegrityCheck. */
function docStills(id) {
  const meta = docMeta(id);
  const st = meta && meta.stills;
  if (!st || st.sha256 !== meta.sha256 || !st.poster || !st.thumb) return null;
  return { poster: st.poster, thumb: st.thumb };
}

function capNhatMeta(id, thayDoi) {
  const p = path.join(thuMucModel(id), 'meta.json');
  const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
  Object.assign(meta, thayDoi);
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(meta, null, 2));
  fs.renameSync(`${p}.tmp`, p);
  return meta;
}

/**
 * Xóa dải ảnh + ảnh tĩnh của mô hình. giuSha = giữ lại bản của mã băm này (sau khi
 * dựng xong bản mới); null = xóa hết (khi xóa mô hình). Xóa cả thư mục kiểu cũ
 * turntable/<id> (không có băm) nếu còn sót.
 */
function donAnhPhuTro(id, giuSha = null) {
  if (!MODEL_ID_RULE.test(id)) return;
  const giuTen = giuSha ? tenThuMucDaiAnh(id, giuSha) : null;
  if (fs.existsSync(TURNTABLE_DIR)) {
    for (const ten of fs.readdirSync(TURNTABLE_DIR)) {
      const cuaNo = ten === id || (ten.startsWith(`${id}-`) && /^[0-9a-f]{12}(\.tmp-\d+)?$/.test(ten.slice(id.length + 1)));
      if (cuaNo && ten !== giuTen) fs.rmSync(path.join(TURNTABLE_DIR, ten), { recursive: true, force: true });
    }
  }
  const thuMucAnh = path.join(CONTENT_DIR, 'images', 'models', id);
  if (fs.existsSync(thuMucAnh)) {
    const giu = giuSha ? new Set(Object.values(duongDanAnhTinh(id, giuSha)).map((r) => path.basename(r))) : new Set();
    for (const f of fs.readdirSync(thuMucAnh)) if (!giu.has(f)) fs.rmSync(path.join(thuMucAnh, f), { force: true });
    if (!fs.readdirSync(thuMucAnh).length) fs.rmdirSync(thuMucAnh);
  }
}

/** Mọi đường dẫn ảnh tĩnh hợp lệ (của mô hình còn trong kho, đúng bản) — để bộ kiểm
 *  toàn vẹn không coi là "file mồ côi" rồi dọn mất. */
function tapAnhTinhHopLe() {
  const out = new Set();
  for (const id of danhSachId()) {
    const st = docStills(id);
    if (st) { out.add(st.poster); out.add(st.thumb); }
  }
  return out;
}

/**
 * Nội dung models.json phục vụ cho app. Bản ghi hỏng bị bỏ RIÊNG LẺ kèm cảnh báo —
 * một mô hình khai sai không được làm hỏng cả danh mục.
 */
function dungDanhMuc() {
  const models = [];
  const canhBao = [];
  for (const id of danhSachId()) {
    const meta = docMeta(id);
    if (!meta) { canhBao.push(`models/${id}: thiếu hoặc hỏng meta.json — bỏ`); continue; }
    const tenFile = meta.fileName;
    if (!tenFile || !fs.existsSync(path.join(thuMucModel(id), tenFile))) {
      canhBao.push(`models/${id}: không tìm thấy file ${tenFile} trên đĩa — bỏ`);
      continue;
    }
    const tt = docTurntable(id);
    models.push({
      id,
      file: `models/${id}/${tenFile}`,
      sha256: meta.sha256,
      bytes: meta.bytes,
      ...(meta.label ? { label: meta.label } : {}),
      ...(tt ? { turntable: tt } : {}),
    });
  }
  return { models, canhBao };
}

/** Tập mã mô hình đang có, để manifest đối chiếu. */
function tapId() {
  return new Set(dungDanhMuc().models.map((m) => m.id));
}

module.exports = {
  CONTENT_DIR,
  tenThuMucDaiAnh,
  duongDanAnhTinh,
  docStills,
  capNhatMeta,
  donAnhPhuTro,
  tapAnhTinhHopLe,
  MODEL_ID_RULE,
  BUDGET,
  MODELS_DIR,
  TURNTABLE_DIR,
  docGlb,
  khamGlb,
  kichThuocAnh,
  bamNoiDung,
  thuMucModel,
  docMeta,
  danhSachId,
  docTurntable,
  dungDanhMuc,
  tapId,
};
