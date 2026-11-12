// Phải nạp ĐẦU TIÊN: chọn thư mục dữ liệu và .env của bảo tàng (xem paths.js).
const { DATA_DIR, ENV_PATH } = require('./paths');

// JWT_SECRET thiếu thì server vẫn chạy nhưng mọi lần đăng nhập lỗi 500; còn để
// nguyên chuỗi mẫu của .env.example thì AI CŨNG tự ký được token Chủ (chuỗi đó
// công khai trong mã nguồn). Cả hai đều phải chặn NGAY lúc khởi động, không đợi
// tới lúc có người đăng nhập. CLAUDE.md §5.4.
const JWT_SECRET_MAU = 'change-this-to-a-strong-secret';
{
  const s = process.env.JWT_SECRET;
  if (!s || !s.trim() || s.trim() === JWT_SECRET_MAU) {
    console.error(`[server] JWT_SECRET ${!s || !s.trim() ? 'chua dat' : 'van la chuoi mau cua .env.example'} trong ${ENV_PATH}.`);
    console.error('  Sinh khoa moi:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    console.error('  roi dien vao dong JWT_SECRET=... trong file .env tren, khoi dong lai.');
    process.exit(1);
  }
  if (s.length < 32) {
    console.warn(`[server] CANH BAO: JWT_SECRET chi dai ${s.length} ky tu — nen dung khoa ngau nhien >= 32 ky tu (lenh sinh khoa: xem CLAUDE.md §5.4).`);
  }
}

const os = require('os');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const authRouter = require('./routes/auth');
const staticContentRouter = require('./routes/staticContent');
const analyticsEventsRouter = require('./routes/analyticsEvents');
const adminStaticContentRouter = require('./routes/adminStaticContent');
const adminAnalyticsRouter = require('./routes/adminAnalytics');
const adminUsersRouter = require('./routes/adminUsers');
const adminMailRouter = require('./routes/adminMail');
const { tenBaoTang } = require('./tenBaoTang');
const { router: models3dRouter } = require('./routes/models3d');
const adminModelsRouter = require('./routes/adminModels');
const adminVanHanhRouter = require('./routes/adminVanHanh');
const adminCmsSettingsRouter = require('./routes/adminCmsSettings');
const cmsSettings = require('./cmsSettings');
const { router: adminContentRouter } = require('./routes/adminContent');
const { CONTENT_DIR } = require('./staticContentBundle');

const app = express();
const PORT = process.env.PORT || 3000;
// Mặc định 0.0.0.0 để máy dev vào được qua LAN. LƯU Ý: máy chủ thật đứng sau nginx
// PHẢI đặt BIND_HOST=127.0.0.1 — nếu không, cổng Node lộ thẳng ra ngoài, đi vòng
// qua TLS. CLAUDE.md §5.8.
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';

// CSP: style cho phép 'unsafe-inline' (giao diện dùng nhiều style nội tuyến), còn
// script CHỈ cho phép file cùng origin — không có onclick="..." nội tuyến (dùng
// data-act + bộ điều phối trong admin.js). Lớp này chặn trường hợp một file .html
// lọt vào content/ chạy script trên cùng origin với trang quản trị. CLAUDE.md §5.14.
const isProd = process.env.NODE_ENV === 'production';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Không có 'unsafe-inline' cho script — đó là điểm mấu chốt.
      // 'wasm-unsafe-eval' CHỈ cho biên dịch WebAssembly; eval()/new Function() vẫn
      // bị cấm. Cần cho bộ giải nén Draco của khung xem 3D và trang dựng dải ảnh
      // xoay — thiếu thì mô hình nén Draco không bao giờ nạp xong. CLAUDE.md §5.22c.
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      // three.js tạo worker giải nén Draco từ blob: URL. Không đặt worker-src thì
      // trình duyệt dùng script-src ('self') và chặn worker đó.
      workerSrc: ["'self'", 'blob:'],
      // fonts.googleapis.com: phông chữ của admin.html và login.html.
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      // blob: xem trước ảnh trước khi tải lên; data: icon nhúng sẵn. (Đã bỏ
      // images.unsplash.com — trang đăng nhập không còn tải ảnh từ bên ngoài.)
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      // Chặn gửi dữ liệu ra domain lạ: kể cả chạy được script cũng không gửi token
      // đi đâu được. blob: là ngoại lệ hẹp (URL do chính trang tạo, cùng origin) —
      // khung xem 3D đọc dữ liệu qua blob: nội bộ.
      connectSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      // Chỉ ép HTTPS ở production; máy dev chạy HTTP thuần.
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
}));

// Cần khi chạy sau reverse proxy (nginx) để req.secure và IP khách đúng.
app.set('trust proxy', 1);

// Production bắt buộc HTTPS: chuyển hướng nếu proxy báo request là HTTP.
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
    res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Đồng bộ nội dung cho app: GET /version.json + GET /bundle-<version>.tar.gz ở gốc
// domain (xem staticContentBundle.js).
app.use('/', staticContentRouter);

// Nhận thống kê từ app (POST /events, NDJSON) — routes/analyticsEvents.js.
app.use('/', analyticsEventsRouter);

// Kho mô hình 3D: /models.json, /models/..., /turntable/... ở gốc domain, công khai
// (khách không có tài khoản). Không đi qua bundle — xem models3d.js.
app.use('/', models3dRouter);

// Ảnh/audio/video để xem trước trong trang quản trị. Không nhạy cảm (đằng nào cũng
// vào bundle công khai). Chỉ mở từng thư mục, KHÔNG mở cả content/ vì bên trong
// còn các bản sao lưu.
app.use('/content-media/images', express.static(path.join(CONTENT_DIR, 'images')));
app.use('/content-media/audio', express.static(path.join(CONTENT_DIR, 'audio')));
app.use('/content-media/videos', express.static(path.join(CONTENT_DIR, 'videos')));

// Tên bảo tàng cho trang đăng nhập/quản trị — công khai (trang đăng nhập chưa có token).
// Kèm thuật ngữ/trạng thái để trang đăng nhập cũng gọi đúng tên (cmsSettings.js).
app.get('/api/v1/site', (req, res) => res.json({ ten: tenBaoTang(), ...cmsSettings.doc() }));

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/admin/static-content', adminStaticContentRouter);
app.use('/api/v1/admin/analytics', adminAnalyticsRouter);
app.use('/api/v1/admin/users', adminUsersRouter);
app.use('/api/v1/admin/mail', adminMailRouter);
app.use('/api/v1/admin/models', adminModelsRouter);
app.use('/api/v1/admin/content', adminContentRouter);
app.use('/api/v1/admin/van-hanh', adminVanHanhRouter);
app.use('/api/v1/admin/cms-settings', adminCmsSettingsRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Loi server noi bo' });
});

const VIRTUAL_ADAPTER_PATTERN = /virtual|vmware|vethernet|wsl|hyper-v|loopback/i;

function getLanIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    if (VIRTUAL_ADAPTER_PATTERN.test(name)) continue;
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

const server = app.listen(PORT, BIND_HOST, () => {
  console.log(`Beacon server dang chay tai ${BIND_HOST}:${PORT}`);
  console.log(`Du lieu: ${DATA_DIR}`);
  console.log('');
  console.log('Truy cap trang quan tri tai:');
  console.log(`  - May nay:        http://localhost:${PORT}/admin.html`);
  // Chỉ in địa chỉ LAN khi thật sự nghe trên mọi interface.
  if (BIND_HOST === '0.0.0.0' || BIND_HOST === '::') {
    for (const ip of getLanIps()) {
      console.log(`  - Cung mang LAN:  http://${ip}:${PORT}/admin.html`);
    }
  } else {
    console.log(`  - Chi nghe tren ${BIND_HOST} (khong lo ra LAN) - xem BIND_HOST trong .env`);
  }
  console.log('');
});

// Nhập gói ZIP có thể tới 1.2 GB (routes/adminContent.js). Node mặc định hủy request
// sau 300 giây — upload lớn qua mạng chậm sẽ hỏng giữa chừng với lỗi kiểu "socket
// hang up". Nới lên 30 phút, vẫn có trần để request treo được thu hồi. CLAUDE.md §5.9.
server.requestTimeout = 30 * 60 * 1000;
// headersTimeout phải >= requestTimeout, nếu không Node đóng kết nối sớm hơn.
server.headersTimeout = 31 * 60 * 1000;
