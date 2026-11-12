// Dựng dải ảnh xoay 360° + poster + thumbnail cho mô hình 3D, ngay trong CMS.
//
// Chrome headless mở public/render/turntable.html từ chính máy chủ này, dựng 24
// khung bằng <model-viewer> (cùng bộ dựng với app), rồi ghi kết quả vào
// content/turntable/<id>-<sha12>/ và content/images/models/<id>/. Mỗi lần một việc,
// qua hàng đợi. Thiết kế và số đo: CLAUDE.md §5.22c.
//
// Cần Chromium trên máy chủ (`apk add chromium` hoặc CHROME_BIN trong .env) và
// Node ≥ 22 (WebSocket có sẵn). Thiếu thì mô hình vẫn chạy — app dùng ảnh hiện vật
// làm poster — và giao diện nói rõ phải cài gì.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const models3d = require('./models3d');

const SO_KHUNG = 24;          // 360° / 24 = 15° mỗi khung
const CANH = 720;             // cạnh khung (px); app vẽ bằng BoxFit.contain
const CANH_THUMB = 400;       // ô lưới rộng khoảng nửa màn 720px
const HET_GIO_TONG_MS = 10 * 60 * 1000;
const HET_GIO_DUNG_MS = 120 * 1000;   // 2 phút không thêm được khung nào = coi là treo

// ---------------------------------------------------------------- Tìm Chrome
const UNG_VIEN = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'];

function timChrome() {
  if (process.env.CHROME_BIN) return fs.existsSync(process.env.CHROME_BIN) ? process.env.CHROME_BIN : null;
  const thuMuc = (process.env.PATH || '').split(path.delimiter).concat(['/usr/bin', '/usr/local/bin']);
  for (const ten of UNG_VIEN) {
    for (const d of thuMuc) {
      const p = path.join(d, ten);
      try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* thử tiếp */ }
    }
  }
  return null;
}

function thongTinMayDung() {
  // WebSocket có sẵn chỉ bật mặc định từ Node 22.
  if (typeof WebSocket !== 'function') {
    return {
      coChrome: false,
      huongDan: `Node ${process.version} quá cũ để dựng dải ảnh xoay (cần Node 22 trở lên). Mô hình vẫn hiện trên tablet, chỉ không có lớp xoay tức thì.`,
    };
  }
  const p = timChrome();
  return p
    ? { coChrome: true, duongDan: p }
    : {
      coChrome: false,
      huongDan: 'Máy chủ chưa cài Chromium nên chưa dựng được dải ảnh xoay. Mô hình vẫn hiện trên tablet, '
        + 'chỉ là không có lớp xoay tức thì. Cài: `apk add chromium` (Alpine) hoặc đặt CHROME_BIN trong .env.',
    };
}

// ---------------------------------------------------------------- Hàng đợi
// Mỗi lần một việc: SwiftShader dựng WebGL bằng CPU, hai Chrome cùng dựng thì cả
// hai chậm gấp đôi và tranh RAM của máy chủ.
const trangThai = new Map();   // id → { trangThai, tien, tong, loi, sha256, batDau, xong }
const hangDoi = [];
let dangChay = false;
let hookSauKhiDung = null;     // adminContent đăng ký: làm mới manifest + tăng version

function datHookSauKhiDung(fn) { hookSauKhiDung = fn; }

async function lamMoiManifest(id) {
  if (!hookSauKhiDung) return;
  try { await hookSauKhiDung(id); } catch (err) { console.error(`[dai-anh] lam moi manifest cho "${id}" hong:`, err.message); }
}

function trangThaiCua(id) {
  const st = trangThai.get(id);
  if (st && (st.trangThai === 'cho' || st.trangThai === 'dang' || st.trangThai === 'loi')) return { ...st };
  const tt = models3d.docTurntable(id);
  if (tt) return { trangThai: 'xong', tien: tt.frames, tong: tt.frames };
  return { trangThai: 'chua', tien: 0, tong: SO_KHUNG };
}

function xepHang(id) {
  const cu = trangThai.get(id);
  if (cu && (cu.trangThai === 'cho' || cu.trangThai === 'dang')) {
    // Đang dựng mà file vừa bị THAY: đánh dấu để dựng lại khi việc hiện tại xong
    // (kết quả lần đang chạy sẽ bị bỏ vì sha không còn khớp).
    if (cu.trangThai === 'dang') cu.canDungLai = true;
    return trangThaiCua(id);
  }
  trangThai.set(id, { trangThai: 'cho', tien: 0, tong: SO_KHUNG, loi: null });
  hangDoi.push(id);
  setImmediate(chayHangDoi);
  return trangThaiCua(id);
}

function huy(id) {
  const i = hangDoi.indexOf(id);
  if (i >= 0) hangDoi.splice(i, 1);
  trangThai.delete(id);
}

async function chayHangDoi() {
  if (dangChay) return;
  dangChay = true;
  try {
    while (hangDoi.length) {
      const id = hangDoi.shift();
      const st = trangThai.get(id);
      if (!st) continue;   // đã bị hủy (mô hình bị xóa)
      st.trangThai = 'dang';
      st.batDau = new Date().toISOString();
      try {
        await dungMot(id, st);
        st.trangThai = 'xong';
        st.xong = new Date().toISOString();
        await lamMoiManifest(id);
        trangThai.delete(id);   // trạng thái 'xong' đọc lại từ đĩa (docTurntable)
      } catch (err) {
        st.trangThai = 'loi';
        st.loi = err.message;
        console.error(`[dai-anh] "${id}" hong: ${err.message}`);
      }
      if (st.canDungLai) { trangThai.delete(id); xepHang(id); }
    }
  } finally {
    dangChay = false;
  }
}

// ---------------------------------------------------------------- Điều khiển Chrome (DevTools Protocol)
const nghi = (ms) => new Promise((r) => setTimeout(r, ms));

async function moChrome(chromePath) {
  const hoSo = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-dai-anh-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    // SwiftShader: dựng WebGL bằng CPU vì máy chủ không có GPU.
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${hoSo}`, 'about:blank',
  ], { stdio: 'ignore' });
  let loiKhoiDong = null;
  chrome.once('error', (e) => { loiKhoiDong = e; });

  const don = async () => {
    await new Promise((r) => {
      if (chrome.exitCode !== null || chrome.signalCode) return r();
      chrome.once('exit', r); chrome.kill();
      setTimeout(r, 5000);
    });
    // Chờ Chrome thoát rồi mới xóa hồ sơ — xóa sớm thì Chrome còn đang ghi vào.
    try { fs.rmSync(hoSo, { recursive: true, force: true }); } catch { /* bỏ qua */ }
  };

  let cong = null;
  for (let i = 0; i < 100 && !cong; i++) {
    if (loiKhoiDong) { await don(); throw new Error(`không chạy được Chromium (${loiKhoiDong.message})`); }
    await nghi(150);
    try { cong = fs.readFileSync(path.join(hoSo, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch { /* chưa lên */ }
  }
  if (!cong) { await don(); throw new Error('Chromium không mở cổng điều khiển (DevTools)'); }

  // Hai bước nối DevTools cũng phải có giới hạn giờ như goi() bên dưới: Chromium
  // treo SAU khi đã ghi DevToolsActivePort thì fetch/handshake chờ mãi, mà hàng đợi
  // chạy từng việc một (dangChay) nên cả hàng đợi dựng ảnh xoay kẹt theo tới khi
  // khởi động lại Node. Lỗi ở đây cũng phải dọn Chromium, không để lại tiến trình mồ côi.
  let ws;
  try {
    const ds = await (await fetch(`http://127.0.0.1:${cong}/json/list`, { signal: AbortSignal.timeout(10000) })).json();
    const trang = ds.find((t) => t.type === 'page');
    if (!trang) throw new Error('Chromium không có tab nào');
    ws = new WebSocket(trang.webSocketDebuggerUrl);
    await new Promise((ok, loi) => {
      const t = setTimeout(() => loi(new Error('DevTools không nhận kết nối sau 15 giây')), 15000);
      ws.addEventListener('open', () => { clearTimeout(t); ok(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(t); loi(new Error('không nối được DevTools')); }, { once: true });
    });
  } catch (e) {
    try { ws?.close(); } catch { /* bỏ qua */ }
    await don();
    throw e.name === 'TimeoutError' ? new Error('Chromium không trả lời danh sách tab sau 10 giây') : e;
  }

  let n = 0; const cho = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && cho.has(m.id)) { cho.get(m.id)(m); cho.delete(m.id); }
  });
  // Mọi lệnh đều có giới hạn giờ: trang treo không được kéo cả máy chủ treo theo.
  const goi = (method, params = {}, ms = 30000) => new Promise((ok, loi) => {
    const id = ++n;
    const t = setTimeout(() => { cho.delete(id); loi(new Error(`DevTools không trả lời ${method}`)); }, ms);
    cho.set(id, (m) => { clearTimeout(t); m.error ? loi(new Error(m.error.message)) : ok(m.result); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const chay = async (bieuThuc, ms) => (await goi('Runtime.evaluate', { expression: bieuThuc, returnByValue: true }, ms))?.result?.value;

  return {
    goi, chay,
    dong: async () => { try { ws.close(); } catch { /* bỏ qua */ } await don(); },
  };
}

function diaChiMayChu() {
  const port = process.env.PORT || 3000;
  const host = process.env.BIND_HOST && process.env.BIND_HOST !== '0.0.0.0' ? process.env.BIND_HOST : '127.0.0.1';
  return `http://${host}:${port}`;
}

// ---------------------------------------------------------------- Dựng một mô hình
async function dungMot(id, st) {
  const meta = models3d.docMeta(id);
  if (!meta) throw new Error('mô hình không còn trong kho');
  const shaDung = meta.sha256;
  st.sha256 = shaDung;
  const may = thongTinMayDung();
  if (!may.coChrome) throw new Error(may.huongDan);
  const chromePath = may.duongDan;

  const c = await moChrome(chromePath);
  let kq;
  try {
    await c.goi('Page.enable');
    await c.goi('Runtime.enable');
    await c.goi('Network.enable');
    // NODE_ENV=production chuyển mọi request thiếu header này sang https:// — nơi
    // không có TLS. Bình thường nginx thêm header; ở đây Chrome gọi thẳng cổng Node.
    await c.goi('Network.setExtraHTTPHeaders', { headers: { 'X-Forwarded-Proto': 'https' } });
    await c.goi('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    // Ép kích thước viewport, không tin --window-size (cửa sổ 720 có thể cho ảnh
    // 720×577).
    await c.goi('Emulation.setDeviceMetricsOverride', { width: CANH, height: CANH, deviceScaleFactor: 1, mobile: false });

    const src = `/models/${id}/${meta.fileName}`;
    await c.goi('Page.navigate', {
      url: `${diaChiMayChu()}/render/turntable.html?src=${encodeURIComponent(src)}&frames=${SO_KHUNG}&size=${CANH}&thumb=${CANH_THUMB}`,
    });

    const batDau = Date.now();
    let tienCu = -1; let lucTien = Date.now();
    for (;;) {
      await nghi(300);
      const tt = await c.chay(`JSON.stringify({t:document.title,n:window.__tien||0})`, 10000).catch(() => null);
      if (tt) {
        const { t, n } = JSON.parse(tt);
        st.tien = n;
        if (n !== tienCu) { tienCu = n; lucTien = Date.now(); }
        if (t === 'READY') break;
        if (String(t).startsWith('ERROR')) throw new Error(`trang dựng báo lỗi: ${t.slice(7)}`);
      }
      if (Date.now() - batDau > HET_GIO_TONG_MS) throw new Error('quá 10 phút mà chưa dựng xong');
      if (Date.now() - lucTien > HET_GIO_DUNG_MS) throw new Error(`đứng ở khung ${tienCu}/${SO_KHUNG} quá 2 phút`);
    }
    kq = await c.chay('window.__ketQua', 60000);
  } finally {
    await c.dong();
  }
  if (!kq || !Array.isArray(kq.frames) || kq.frames.length !== SO_KHUNG || !kq.thumb) {
    throw new Error('trang dựng trả về thiếu khung');
  }

  // File vừa bị THAY trong lúc dựng: kết quả là của bản cũ — bỏ đi, không gắn nhãn
  // bản mới cho dải ảnh của bản cũ.
  const metaMoi = models3d.docMeta(id);
  if (!metaMoi || metaMoi.sha256 !== shaDung) throw new Error('file mô hình vừa bị thay trong lúc dựng — sẽ dựng lại');

  ghiKetQua(id, shaDung, kq);
}

// Ghi vào thư mục tạm rồi đổi tên: dựng ngắt giữa chừng không để lại dải ảnh cụt.
// source.json ghi trong thư mục tạm, nên dải ảnh chỉ "tồn tại" khi đủ khung.
function ghiKetQua(id, sha, kq) {
  const tenDai = models3d.tenThuMucDaiAnh(id, sha);
  const dich = path.join(models3d.TURNTABLE_DIR, tenDai);
  const tam = `${dich}.tmp-${process.pid}`;
  fs.rmSync(tam, { recursive: true, force: true });
  fs.mkdirSync(tam, { recursive: true });
  kq.frames.forEach((b, i) => fs.writeFileSync(path.join(tam, `${String(i).padStart(3, '0')}.webp`), Buffer.from(b, 'base64')));
  fs.writeFileSync(path.join(tam, 'source.json'), JSON.stringify({
    sha256: sha, frames: SO_KHUNG, size: CANH, renderedAt: new Date().toISOString(),
    renderer: 'model-viewer 4.0.0 (CMS)',
  }, null, 2));
  fs.rmSync(dich, { recursive: true, force: true });
  fs.renameSync(tam, dich);

  // Poster = khung 0 NGUYÊN KHỔ (phải khớp từng pixel với dải ảnh phủ lên nó).
  const anh = models3d.duongDanAnhTinh(id, sha);
  const thuMucAnh = path.join(models3d.CONTENT_DIR, path.dirname(anh.poster));
  fs.mkdirSync(thuMucAnh, { recursive: true });
  const ghiNguyenTu = (rel, buf) => {
    const p = path.join(models3d.CONTENT_DIR, rel);
    fs.writeFileSync(`${p}.tmp`, buf); fs.renameSync(`${p}.tmp`, p);
  };
  ghiNguyenTu(anh.poster, Buffer.from(kq.frames[0], 'base64'));
  ghiNguyenTu(anh.thumb, Buffer.from(kq.thumb, 'base64'));

  models3d.capNhatMeta(id, { stills: { sha256: sha, poster: anh.poster, thumb: anh.thumb } });

  // Dọn bản CŨ (sha khác) — SAU khi bản mới đã nằm yên.
  models3d.donAnhPhuTro(id, sha);
}

module.exports = {
  SO_KHUNG, timChrome, thongTinMayDung, xepHang, huy, trangThaiCua, datHookSauKhiDung, lamMoiManifest,
};
