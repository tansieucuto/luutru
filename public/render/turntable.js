// Trang dựng dải ảnh xoay 360° + poster + thumbnail cho MỘT mô hình. Do
// turntableRenderer.js (máy chủ) mở bằng Chrome headless — không dành cho người.
//
// Ba điểm cốt lõi (số đo: CLAUDE.md §5.22c):
//   1. Nạp mô hình MỘT lần, xoay camera bằng cameraOrbit + jumpCameraToGoal() —
//      nhanh hơn nạp lại trang cho từng khung và cho ra khung giống hệt.
//   2. Bán kính camera `auto` (theo khối cầu bao quanh vật, không đổi theo góc
//      xoay). Bán kính cố định max(kích thước)×1.9 làm xén đầu/chân vật.
//   3. Chụp bằng mv.toBlob() (pixel của canvas): không phụ thuộc kích thước cửa sổ,
//      thanh tiến trình của model-viewer không lọt vào ảnh.
//
// Poster = khung 0 NGUYÊN KHỔ (app phủ dải ảnh lên poster bằng BoxFit.contain, hai
// lớp phải khớp từng pixel). Thumbnail = khung 0 CẮT SÁT VẬT rồi đưa về vuông (ô
// lưới dùng BoxFit.cover). Cắt ngay trong trình duyệt nên máy chủ không cần
// ImageMagick.
//
// Tham số: ?src=/models/<id>/<sha12>.glb&frames=24&size=720&thumb=400
// Kết quả: document.title = 'READY' | 'ERROR: ...'; window.__ketQua =
//   { frames: [base64 webp...], thumb: base64 webp }; tiến độ ở window.__tien.

const q = new URLSearchParams(location.search);
const SIZE = Math.min(Math.max(+(q.get('size') || 720), 64), 2048);
const FRAMES = Math.min(Math.max(+(q.get('frames') || 24), 2), 360);
const THUMB = Math.min(Math.max(+(q.get('thumb') || 400), 64), 1024);
const LE_THUMB = 0.06;          // chừa quanh vật — cắt sát quá thì vật chạm mép ô
const Q_KHUNG = 0.82;           // chất lượng WebP của khung
const Q_THUMB = 0.85;

window.__tien = 0;
window.__ketQua = null;

const baoLoi = (m) => { document.title = 'ERROR: ' + m; };

try {
  const MV = customElements.get('model-viewer') || await customElements.whenDefined('model-viewer');
  // LƯU Ý: đặt TRƯỚC khi nạp mô hình. model-viewer mặc định tải bộ giải nén từ
  // www.gstatic.com — bị CSP chặn, và mô hình nén Draco sẽ không bao giờ nạp xong.
  MV.dracoDecoderLocation = '/vendor/model-viewer/draco/';
  MV.ktx2TranscoderLocation = '/vendor/model-viewer/basis/';
  if (typeof MV.prototype.jumpCameraToGoal !== 'function' || typeof MV.prototype.toBlob !== 'function') {
    throw new Error('ban model-viewer nay thieu jumpCameraToGoal/toBlob');
  }
} catch (e) { baoLoi(e.message); }

const mv = document.getElementById('mv');
mv.style.width = SIZE + 'px';
mv.style.height = SIZE + 'px';

const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const b64 = (blob) => new Promise((ok, loi) => {
  const fr = new FileReader();
  fr.onload = () => ok(String(fr.result).split(',')[1]);
  fr.onerror = () => loi(fr.error);
  fr.readAsDataURL(blob);
});

async function catThumb(khung0) {
  const bmp = await createImageBitmap(khung0);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const { data, width: W, height: H } = g.getImageData(0, 0, bmp.width, bmp.height);
  let x0 = W; let y0 = H; let x1 = -1; let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  // Khung 0 trong suốt hoàn toàn = mô hình không hiện ra trước camera (sai hướng,
  // rỗng…). Báo lỗi thay vì xuất một thumbnail trống.
  if (x1 < 0) throw new Error('khung 0 trong suot hoan toan - mo hinh khong hien ra truoc camera');
  const bw = x1 - x0 + 1; const bh = y1 - y0 + 1; const canh = Math.max(bw, bh);
  const o = canh + 2 * Math.round(canh * LE_THUMB);
  const out = new OffscreenCanvas(THUMB, THUMB);
  const og = out.getContext('2d');
  og.imageSmoothingQuality = 'high';
  og.drawImage(c, x0 - (o - bw) / 2, y0 - (o - bh) / 2, o, o, 0, 0, THUMB, THUMB);
  return out.convertToBlob({ type: 'image/webp', quality: Q_THUMB });
}

mv.addEventListener('error', (e) => baoLoi('khong nap duoc mo hinh (' + (e.detail?.type || 'load') + ')'));
mv.addEventListener('load', async () => {
  try {
    const frames = [];
    let khung0 = null;
    for (let i = 0; i < FRAMES; i++) {
      mv.cameraOrbit = `${(360 / FRAMES) * i}deg 78deg auto`;
      // jumpCameraToGoal: áp góc NGAY, bỏ qua hoạt cảnh lướt — thiếu nó thì chụp giữa
      // lúc camera đang di chuyển.
      mv.jumpCameraToGoal();
      await raf2();
      const blob = await mv.toBlob({ mimeType: 'image/webp', qualityArgument: Q_KHUNG });
      if (i === 0) khung0 = blob;
      frames.push(await b64(blob));
      window.__tien = i + 1;
    }
    const thumb = await b64(await catThumb(khung0));
    window.__ketQua = { frames, thumb };
    document.title = 'READY';
  } catch (e) {
    baoLoi(e.message);
  }
});
mv.src = q.get('src') || '';
if (!q.get('src')) baoLoi('thieu tham so src');
