#!/usr/bin/env node
// Tạo một bảo tàng mới trên cùng máy chủ: thư mục dữ liệu riêng (.env, tài khoản Chủ
// đầu tiên, manifest khởi đầu) và đăng ký vào bao-tang.json để pm2 chạy nó
// (ecosystem.config.js). Xem NHIEU_BAO_TANG.md.
//
//   node scripts/tao-bao-tang.js <mã> --ten "Bảo tàng Lịch sử" --cong 3001
//        [--thu-muc <thư mục dữ liệu>] [--tai-khoan <tên đăng nhập Chủ>]
//
// Mặc định thư mục dữ liệu là ../beacon-data/<mã>, NGOÀI thư mục mã nguồn: cập nhật mã
// nguồn (git pull, chép đè) không bao giờ đụng tới dữ liệu của bảo tàng nào.
//
// LƯU Ý: script KHÔNG bật máy chủ và KHÔNG sửa nginx — chỉ in đúng lệnh cần chạy tiếp.
// Không bao giờ ghi đè một thư mục đã có dữ liệu.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const APP_DIR = path.join(__dirname, '..');
const REGISTRY = path.join(APP_DIR, 'bao-tang.json');

function thoat(msg) {
  console.error(`\nLoi: ${msg}\n`);
  process.exit(1);
}

function docThamSo(argv) {
  const kq = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) kq[argv[i].slice(2)] = argv[++i];
    else kq._.push(argv[i]);
  }
  return kq;
}

// Cùng bộ ký tự với userStore.generatePassword: bỏ 0/O, 1/l/I cho dễ chép tay.
function sinhMatKhau() {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const pick = (n) => Array.from(crypto.randomBytes(n)).map((b) => cs[b % cs.length]).join('');
  return `${pick(3)}-${pick(4)}-${pick(4)}`;
}

function docDangKy() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).baoTang || [];
  } catch {
    return [];
  }
}

function congTrongEnv(file) {
  try {
    return Number((fs.readFileSync(file, 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m) || [])[1]) || null;
  } catch {
    return null;
  }
}

const ts = docThamSo(process.argv.slice(2));
const ma = ts._[0];
if (!ma || !ts.ten || !ts.cong) {
  console.log(`
Tao mot bao tang moi:
  node scripts/tao-bao-tang.js <ma> --ten "Ten bao tang" --cong <cong>
       [--thu-muc <thu muc du lieu>] [--tai-khoan <ten dang nhap Chu>]

  <ma>        chu thuong khong dau, so, gach ngang; bat dau bang chu cai (vd baotang-lichsu)
  --cong      cong rieng cua bao tang nay tren may chu (vd 3001, 3002...)
  --thu-muc   mac dinh ../beacon-data/<ma> (ngoai thu muc ma nguon)
  --tai-khoan mac dinh "chu"
`);
  process.exit(1);
}

if (!/^[a-z][a-z0-9-]{1,30}$/.test(ma)) thoat('Ma bao tang chi gom chu thuong khong dau, so, gach ngang, bat dau bang chu cai (vd baotang-lichsu).');
const ten = String(ts.ten).replace(/\s+/g, ' ').trim();
if (!ten) thoat('Chua co ten bao tang (--ten).');
const cong = Number(ts.cong);
if (!Number.isInteger(cong) || cong < 1024 || cong > 65535) thoat('Cong phai la so nguyen tu 1024 den 65535.');
const taiKhoan = String(ts['tai-khoan'] || 'chu').toLowerCase();
if (!/^[a-z0-9._-]{3,32}$/.test(taiKhoan)) thoat('Ten dang nhap: chu thuong, so, dau cham hoac gach - 3 den 32 ky tu.');
const thuMuc = path.resolve(ts['thu-muc'] || path.join(APP_DIR, '..', 'beacon-data', ma));

const ds = docDangKy();
if (ds.some((b) => b.ma === ma)) thoat(`Da co bao tang ma "${ma}" trong bao-tang.json.`);
const trung = ds.find((b) => congTrongEnv(path.join(b.thuMuc, '.env')) === cong);
if (trung) thoat(`Cong ${cong} dang la cua bao tang "${trung.ma}". Chon cong khac.`);
if (congTrongEnv(path.join(APP_DIR, '.env')) === cong && fs.existsSync(path.join(APP_DIR, 'content', 'manifest.json'))) {
  thoat(`Cong ${cong} dang la cua app "beacon-server" (du lieu canh server.js). Chon cong khac.`);
}
if (fs.existsSync(path.join(thuMuc, '.env')) || fs.existsSync(path.join(thuMuc, 'content', 'manifest.json'))) {
  thoat(`${thuMuc} da co du lieu - khong ghi de. Chon --thu-muc khac.`);
}

// Cấu hình beacon + chính sách phát âm thanh: chép từ bảo tàng đang có (nếu có) cho khỏi
// phải điền tay, còn lại dùng giá trị mặc định đang chạy tốt.
let mau = {};
try {
  mau = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'content', 'manifest.json'), 'utf8'));
} catch { /* máy mới, chưa có bảo tàng nào */ }
const beacon = mau.beacon || {
  uuid: '4d6fc88b-be75-6698-da48-6866a36ec78e',
  deskMajor: 99,
  arbitration: {
    minDeltaDb: 5, dwellSeconds: 2, lockoutSeconds: 12, zoneSilenceSeconds: 8,
    deskDwellSeconds: 10, sessionSilenceMinutes: 10,
  },
};
const policies = mau.policies || { allowLoudspeaker: false, autoplayRequiresHeadphones: true, revisitPlaysWelcome: false };

const bayGio = new Date();
// Cùng cách tính ngày với bumpVersion() (giờ máy chủ, không phải UTC).
const ngay = `${bayGio.getFullYear()}.${String(bayGio.getMonth() + 1).padStart(2, '0')}.${String(bayGio.getDate()).padStart(2, '0')}`;
// Đủ các trường app BẮT BUỘC (manifest_parser.dart: _req*). Chưa có khu vực nào nên
// máy chủ chưa phát hành gói cho tablet — thêm khu vực + hiện vật là chạy.
const manifest = {
  schemaVersion: 1,
  bundleVersion: `${ngay}-01`,
  generatedAt: bayGio.toISOString(),
  languages: ['vi'],
  fallbackLanguage: 'vi',
  languageNames: { vi: 'Tiếng Việt' },
  ui: {},
  museum: { name: { vi: ten } },
  beacon,
  policies,
  zones: [],
};

const matKhau = sinhMatKhau();
const env = [
  `# ${ten} (ma: ${ma}) - tao boi scripts/tao-bao-tang.js luc ${bayGio.toISOString()}`,
  '# Bi mat cua RIENG bao tang nay - khong chep sang bao tang khac (CLAUDE.md 5.4).',
  `PORT=${cong}`,
  '# May chu that dung sau nginx: chi nghe trong may (CLAUDE.md 5.8).',
  'BIND_HOST=127.0.0.1',
  `JWT_SECRET=${crypto.randomBytes(48).toString('hex')}`,
  '# Chi dung MOT LAN, o lan dang nhap dau tien, de tao tai khoan Chu dau tien.',
  `ADMIN_USERNAME=${taiKhoan}`,
  `ADMIN_PASSWORD_HASH=${bcrypt.hashSync(matKhau, 10)}`,
  '',
].join('\n');

fs.mkdirSync(path.join(thuMuc, 'content'), { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(thuMuc, '.env'), env, { mode: 0o600 });
fs.writeFileSync(path.join(thuMuc, 'content', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
// LƯU Ý: thiếu bộ đếm này thì lần sửa đầu tiên trong ngày lại sinh đúng "-01" — trùng số
// phiên bản đang có, máy tablet không tải lại (CLAUDE.md §5.10).
fs.writeFileSync(path.join(thuMuc, 'content', '.version-sequence.json'), JSON.stringify({ date: ngay, seq: 1 }));

ds.push({ ma, ten, thuMuc, taoLuc: bayGio.toISOString() });
fs.writeFileSync(REGISTRY, `${JSON.stringify({ baoTang: ds }, null, 2)}\n`);

console.log(`
Da tao bao tang "${ten}" (ma ${ma})
  Thu muc du lieu : ${thuMuc}
  Cong            : ${cong}
  App pm2         : beacon-${ma}
  Tai khoan Chu   : ${taiKhoan}
  Mat khau        : ${matKhau}      <- GHI LAI NGAY, khong hien lai lan nao nua

Viec tiep theo:
  1. Bat may chu:   sh scripts/beacon.sh bat ${ma}
  2. nginx: them mot khoi server cho ten mien cua bao tang nay, roi
     'nginx -t && rc-service nginx reload', va 'certbot --nginx -d <ten-mien>':

     server {
         listen 80;
         server_name <ten-mien>;
         client_max_body_size 1300M;
         proxy_read_timeout 1800s;
         proxy_request_buffering off;
         location / {
             proxy_pass http://127.0.0.1:${cong};
             proxy_set_header Host $host;
             proxy_set_header X-Forwarded-Proto $scheme;
             proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
         }
     }

  3. Mo https://<ten-mien>/admin.html, dang nhap bang tai khoan tren, roi:
     doi mat khau -> tao tai khoan Chu thu hai -> cai "Gui thu cua he thong"
     -> them khu vuc va hien vat.
  4. Tablet cua bao tang nay: trong Cai dat cua app, dat dia chi may chu la
     https://<ten-mien>

LUU Y: cau hinh beacon (UUID, deskMajor) ${mau.beacon ? 'duoc CHEP tu bao tang dang co' : 'la gia tri mac dinh'}.
Neu phan cung beacon cua bao tang nay dung UUID khac, sua trong CMS:
Giao dien ung dung -> Cau hinh nang cao.
`);
