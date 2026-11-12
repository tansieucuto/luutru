#!/usr/bin/env node
// In ra lệnh nạp sẵn mô hình 3D vào thư mục riêng của app trên tablet.
//
// Mặc định app tải mô hình LÚC KHÁCH CHẠM vào hiện vật, tức giữa chuyến tham quan
// tablet phải với tới máy chủ. Nếu file đã nằm sẵn trên máy thì app không chạm
// mạng (model_provider.dart: `if (await _store!.has(ref.sha256)) return …`).
//
// LƯU Ý: script CHỈ IN LỆNH, không tự chạy adb — máy chạy CMS không nhất thiết là
// máy cắm tablet. Đọc lệnh, hiểu nó làm gì, rồi dán chạy.

const fs = require('fs');
const path = require('path');
const models3d = require('../models3d');

// LƯU Ý: ba hằng số này PHẢI KHỚP với app, sai một cái là app vẫn tải lại từ mạng:
//   PKG          android/app/build.gradle.kts (applicationId, giống nhau ở mọi buildType)
//   app_flutter  path_provider_android dùng Context.getDir("flutter") → tiền tố "app_"
//   models/      model_provider.dart: p.join(docs.path, 'models')
const PKG = 'com.example.beacon_client';
const GOC = `/data/data/${PKG}/app_flutter/models`;

function mb(n) {
  return (n / 1024 / 1024).toFixed(2);
}

function thuThap() {
  const ra = [];
  for (const id of models3d.danhSachId()) {
    const meta = models3d.docMeta(id);
    if (!meta || !meta.fileName) continue;
    const nguon = path.join(models3d.thuMucModel(id), meta.fileName);
    if (!fs.existsSync(nguon)) continue;

    // Trên máy chủ tên file là <sha12>.glb (URL bất biến); trên tablet phải là
    // <sha256 ĐẦY ĐỦ, chữ thường>.glb — đó là tên ModelStore.fileFor() đi tìm.
    ra.push({
      id,
      nguon,
      dich: `${GOC}/${meta.sha256.toLowerCase()}.glb`,
      bytes: meta.bytes,
      sha256: meta.sha256.toLowerCase(),
      turntable: models3d.docTurntable(id),
    });
  }
  return ra;
}

const loc = process.argv[2];
let ds = thuThap();
if (loc) ds = ds.filter((m) => m.id === loc);

if (!ds.length) {
  console.error(loc
    ? `Không có mô hình nào mang mã "${loc}".`
    : 'Kho mô hình đang rỗng — chưa có gì để nạp.');
  process.exit(1);
}

const tong = ds.reduce((s, m) => s + m.bytes, 0);

console.log(`# Nạp sẵn ${ds.length} mô hình vào tablet (${mb(tong)} MB)`);
console.log('#');
console.log('# Cắm đúng MỘT máy rồi kiểm: adb devices');
console.log('# Có nhiều máy thì thêm -s <serial> vào mọi lệnh adb bên dưới.');
console.log('');

console.log('# ─────────────────────────────────────────────────────────────');
console.log('# CÁCH A — bản cài là bản DEBUG (dùng được run-as, không cần root)');
console.log('# ─────────────────────────────────────────────────────────────');
console.log('# Kiểm trước, phải in ra đường dẫn chứ không phải lỗi:');
console.log(`#   adb shell run-as ${PKG} pwd`);
console.log('# Báo "not debuggable" nghĩa là máy đang chạy bản release — xem CÁCH B,');
console.log('# hoặc dùng CÁCH C (không cần công cụ gì).');
console.log('');
console.log(`adb shell run-as ${PKG} mkdir -p app_flutter/models`);
for (const m of ds) {
  console.log('');
  console.log(`# ${m.id} — ${mb(m.bytes)} MB`);
  console.log(`adb push ${JSON.stringify(m.nguon)} /data/local/tmp/nap.glb`);
  // `cat >` thay vì `cp`: shell của run-as trên một số ROM rất tối giản, không phải
  // lúc nào cũng có cp.
  console.log(`adb shell "cat /data/local/tmp/nap.glb | run-as ${PKG} sh -c 'cat > app_flutter/models/${m.sha256}.glb'"`);
  if (m.turntable) {
    console.log(`adb shell run-as ${PKG} mkdir -p app_flutter/models/turntable/${m.sha256}`);
    for (let i = 0; i < m.turntable.frames; i++) {
      const ten = `${String(i).padStart(3, '0')}.${m.turntable.ext}`;
      const nguonKhung = path.join(models3d.CONTENT_DIR, m.turntable.dir, ten);
      console.log(`adb push ${JSON.stringify(nguonKhung)} /data/local/tmp/k.${m.turntable.ext}`);
      console.log(`adb shell "cat /data/local/tmp/k.${m.turntable.ext} | run-as ${PKG} sh -c 'cat > app_flutter/models/turntable/${m.sha256}/${ten}'"`);
    }
  }
}
console.log('');
console.log('adb shell rm -f /data/local/tmp/nap.glb /data/local/tmp/k.*');
console.log('');
console.log('# Kiểm lại — cột kích thước phải khớp bảng ở cuối file này:');
console.log(`adb shell run-as ${PKG} ls -l app_flutter/models`);

console.log('');
console.log('# ─────────────────────────────────────────────────────────────');
console.log('# CÁCH B — máy đã root');
console.log('# ─────────────────────────────────────────────────────────────');
console.log('# ⚠ CHOWN VÀ RESTORECON LÀ BẮT BUỘC, KHÔNG PHẢI TÙY CHỌN.');
console.log('# File do root tạo trong thư mục app sẽ thuộc về root và mang nhãn');
console.log('# SELinux sai. App chạy dưới UID riêng nên MỞ KHÔNG ĐƯỢC, và triệu');
console.log('# chứng y hệt như chưa nạp gì: 3D không mở, không lỗi nào hiện ra.');
console.log('');
for (const m of ds) {
  console.log(`adb push ${JSON.stringify(m.nguon)} /data/local/tmp/nap.glb`);
  console.log(`adb shell su -c "mkdir -p ${GOC} && cp /data/local/tmp/nap.glb ${m.dich}"`);
}
console.log(`adb shell su -c "chown -R \\$(stat -c '%u:%g' /data/data/${PKG}) ${GOC}"`);
console.log(`adb shell su -c "restorecon -R ${GOC}"`);
console.log('adb shell rm -f /data/local/tmp/nap.glb');

console.log('');
console.log('# ─────────────────────────────────────────────────────────────');
console.log('# CÁCH C — mồi sẵn bằng cách mở thử (bản release, không root)');
console.log('# ─────────────────────────────────────────────────────────────');
console.log('# Không cần công cụ gì, và là cách DUY NHẤT chạy được trên bản');
console.log('# release chưa root. Lúc lắp máy, khi còn ở chỗ có mạng:');
console.log('#   mở lần lượt từng hiện vật có mô hình, chạm vào xem 3D một lần.');
console.log('# File tải về nằm lại vĩnh viễn (tên đặt theo băm nội dung), nên');
console.log('# lần sau app không tải lại. Chỉ phải làm lại khi mô hình ĐỔI.');
console.log('# Các hiện vật cần mở:');
try {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(models3d.CONTENT_DIR, 'manifest.json'), 'utf8'));
  const idCanNap = new Set(ds.map((m) => m.id));
  let thay = 0;
  for (const z of manifest.zones || []) {
    for (const e of z.exhibits || []) {
      if (e.model3dId && idCanNap.has(e.model3dId)) {
        const ten = (e.name && (e.name[manifest.fallbackLanguage] || Object.values(e.name)[0])) || e.id;
        const tenKhu = (z.name && (z.name[manifest.fallbackLanguage] || Object.values(z.name)[0])) || z.id;
        console.log(`#   • ${ten}  (khu vực "${tenKhu}", mô hình "${e.model3dId}")`);
        thay++;
      }
    }
  }
  if (!thay) console.log('#   (chưa hiện vật nào được gán mô hình — gán trong trang quản trị trước đã)');
} catch (err) {
  console.log(`#   (không đọc được manifest.json: ${err.message})`);
}

console.log('');
console.log('# ─────────────────────────────────────────────────────────────');
console.log('# BẢNG ĐỐI CHIẾU — dùng để kiểm sau khi nạp');
console.log('# ─────────────────────────────────────────────────────────────');
for (const m of ds) {
  console.log(`# ${m.id}`);
  console.log(`#   ${m.dich}`);
  console.log(`#   ${m.bytes} byte · sha256 ${m.sha256}`);
  if (m.turntable) {
    console.log(`#   ${GOC}/turntable/${m.sha256}/  (${m.turntable.frames} khung .${m.turntable.ext})`);
    console.log('#   ⚠ Dải ảnh THIẾU MỘT KHUNG là app coi như không có (turntableFrames trả rỗng).');
  }
}
