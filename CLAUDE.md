# `beacon_server` — tài liệu vận hành (đọc file này TRƯỚC khi đụng vào server)

File này để 1 phiên Claude Code mới mở trong thư mục `beacon_server/` hiểu ngay cách server
hoạt động và cách vận hành nó an toàn, không phải dò lại từ đầu. Claude Code tự động nạp file
này vào ngữ cảnh mỗi khi mở phiên mới trong thư mục này — không cần dán lại nội dung.

Các file `.md` khác trong repo (đọc thêm khi cần, không lặp lại nội dung ở đây):
- `../HuongDanChay.md` — hướng dẫn cài đặt/chạy từ đầu trên máy mới (cả `beacon_server` lẫn
  `beacon-client`), có phần "Xử lý sự cố thường gặp".
- `../TienDoKetHop.md` — nhật ký phát triển đầy đủ, giải thích TẠI SAO kiến trúc hiện tại như
  vậy (đặc biệt mục cuối "Beacon-client bản viết lại" — QUAN TRỌNG, xem phần 1 bên dưới).
- `API_INTEGRATION.md` — tham chiếu endpoint cho người viết client.
- `NHIEU_BAO_TANG.md` — chạy nhiều bảo tàng bằng một bộ mã nguồn (thêm bảo tàng, pm2, Docker, sao lưu).
- `../CMS.md` — yêu cầu kỹ thuật gốc cho tính năng resume download (`routes/bundle.js`).

---

## 1. Sự thật kiến trúc: server từng có 2 hệ thống nội dung song song, hệ CŨ đã bị GỠ BỎ (2026-07-31)

Server này ban đầu được viết cho 1 kiến trúc `beacon-client` CŨ (JWT visitor, check-in,
artifacts phẳng lưu trong SQLite). Sau đó người dùng **viết lại hoàn toàn `beacon-client`**
theo mô hình "zone-first" đọc thẳng `manifest.json` đa ngôn ngữ, đồng bộ kiểu **static file
server** chứ không phải REST. Server được vá thêm để khớp với client mới, nhưng ban đầu vẫn
giữ nguyên toàn bộ code hệ cũ (không ai gọi tới nữa) — sau đó đã xác nhận rõ hệ cũ hoàn toàn
mồ côi (`grep` toàn bộ `public/admin.js`/`admin.html` = 0 lần gọi bất kỳ route nào của hệ cũ)
và **xóa sạch** ngày 2026-07-31: `routes/checkin.js`, `routes/artifacts.js`, `routes/floors.js`,
`routes/bundle.js`, `routes/admin.js`, `routes/adminArtifacts.js`, `routes/adminZones.js`,
`routes/events.js` (SSE), `bundleBuilder.js`, `events.js` (root, broadcaster SSE),
`artifactCatalog.js`, `public/display.html`, `db.js`, `beacon.db`, route `POST /device` trong
`routes/auth.js`, và dependency `sqlite3` trong `package.json`. **Có backup đầy đủ** tại
`.legacy-backup-2026-07-31/` (cùng cấp `server.js`) — copy nguyên bản trước khi xóa, phòng khi
cần khôi phục lại. Lúc xóa, repo **chưa có git** — git chỉ được khởi tạo sau đó (`git log` xem
commit đầu `Khoi tao git cho beacon_server`), nên việc xóa này KHÔNG nằm trong lịch sử git,
`.legacy-backup-2026-07-31/` vẫn là nơi DUY NHẤT còn giữ các file này (thư mục này bị
`.gitignore` loại khỏi git luôn, xem `.gitignore`). Các thay đổi code SAU thời điểm git init thì
git mới là lưới an toàn chính.

Hiện tại **chỉ còn 1 hệ nội dung duy nhất** — mọi việc vận hành/sửa lỗi tập trung vào đây:
- `content/manifest.json` + `content/images/` + `content/audio/` — toàn bộ dữ liệu khu vực/
  hiện vật/chuỗi giao diện/cấu hình beacon, đa ngôn ngữ, xem mục 3.
- `GET /version.json`, `GET /bundle-<bundleVersion>.tar.gz` (route gốc domain, KHÔNG có tiền
  tố `/api/v1/`) — client tải bundle offline theo kiểu static file, có hỗ trợ HTTP Range để
  resume (`routes/staticContent.js`, `staticContentBundle.js`).
- `POST /events` (gốc domain, KHÔNG auth, NDJSON) — app gửi log hành vi khách tham quan lên
  (`routes/analyticsEvents.js`), server chống trùng rồi ghi vào
  `content/.analytics/events.ndjson`.
- `/api/v1/admin/*` — toàn bộ trang quản trị `public/admin.html` (JWT, phân quyền theo vai
  trò, xem mục 4), CRUD thẳng lên `content/manifest.json` qua `routes/adminContent.js` +
  `routes/adminStaticContent.js` + `routes/adminAnalytics.js` + `routes/adminUsers.js`.
- `/api/v1/auth`: `POST /login`, `GET /me` (trang admin hỏi vai trò của chính mình để ẩn/hiện
  chức năng), `PUT /password` (đổi mật khẩu của chính mình), 3 route email khôi phục
  (`POST /recovery-email`, `POST /recovery-email/verify`, `DELETE /recovery-email` — chỉ vai
  trò Chủ) và 2 route công khai `POST /forgot`, `POST /forgot/verify` — xem mục 5.17.
  ⚠ `PUT /password/public` **đã bị gỡ** — xem mục 5.16.

Nếu sau này thấy có nhắc tới "check-in", "floors", "artifacts phẳng trong DB", "bảng zones
trong SQLite" ở đâu đó (comment cũ, tài liệu cũ như `TienDoKetHop.md`) — đó là NÓI VỀ HỆ ĐÃ XÓA,
không còn áp dụng cho code hiện tại. Không cần tìm lại các file đó trong `routes/`.

→ Khi debug "vì sao app không thấy dữ liệu mới" hoặc "vì sao thống kê sai": luôn nhìn vào
`content/manifest.json` + `content/.analytics/events.ndjson` — đây là nguồn dữ liệu DUY NHẤT
còn lại, không còn DB nào khác để nhầm lẫn nữa.

## 2. Cấu trúc thư mục

```
beacon_server/
  server.js            # entrypoint, mount toàn bộ router (chỉ còn hệ ACTIVE, xem mục 1)
  staticContentBundle.js # dong goi content/ thanh bundle-<version>.tar.gz + version.json
                          # CONTENT_DIR = path.join(__dirname, 'content') - HARDCODE, xem mục 5.1
  middleware/auth.js    # xac thuc JWT dung chung (kiem tra req.userRole cho requireRole())
  ecosystem.config.js   # cau hinh pm2, TEN APP la "beacon-server" (gach ngang) - xem mục 5.2
  .env                  # PORT, JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD_HASH - xem mục 5.3
  userStore.js          # kho tai khoan (3 vai tro), doc/ghi users.json - xem mục 5.16
  mailer.js             # gui thu qua API HTTP cua Brevo (khong dependency) - xem mục 5.17
  users.json            # TAI KHOAN + hash mat khau. NGOAI content/ la CO Y (mục 5.16).
                        # .gitignore bo qua; scripts/backup-content.sh CO sao luu.
  content/
    manifest.json        # nguon su that duy nhat cho noi dung app - xem mục 3
    images/ audio/        # file media, duong dan tham chieu tu manifest.json
    .analytics/events.ndjson  # log hanh vi tho, ghi boi POST /events
    .language-backups/    # backup tu dong khi them/xoa ngon ngu (routes/adminContent.js)
    .import-backups/      # backup tu dong khi POST /admin/content/import (thay toan bo)
    .version-sequence.json # bo dem sinh bundleVersion dang YYYY.MM.DD-NN
  public/
    admin.html/.js/.css  # trang quan tri SPA, xem mục 4
    users.html/.js        # trang Quan ly tai khoan (CHI vai tro Chu) - xem mục 5.16/5.17
    appearance.js         # doi bang mau + sang/toi + menu tai khoan, DUNG CHUNG
                          # cho admin.html va users.html - xem mục 5.17
    login.html/.js/.css  # trang dang nhap
    index.html            # chi redirect sang admin.html hoac login.html
    redirect.js           # script cua index.html, tach ra vi CSP - xem mục 5.14
  routes/                # auth.js, staticContent.js, analyticsEvents.js, adminContent.js,
                          # adminStaticContent.js, adminAnalytics.js, adminUsers.js - 7 file
  .legacy-backup-2026-07-31/  # backup nguyên vẹn code hệ CŨ đã xóa, xem mục 1
```

## 3. `content/manifest.json` — nguồn dữ liệu duy nhất app thật đọc

Top-level: `schemaVersion`, `bundleVersion`, `generatedAt`, `languages: []`, `fallbackLanguage`,
`languageNames: {mã: tên hiển thị}`, `zoneChangeConfirmSeconds` (tùy chọn), `ui: {mã ngôn ngữ:
{key: chuỗi giao diện}}`, `museum: {name{đa ngôn ngữ}, welcomeImage, welcomeAccentImage}`,
`beacon: {uuid, deskMajor, arbitration: {...}}` (tham số phân xử beacon, xem
`routes/adminContent.js` hàm `GET/PUT /beacon-config` để biết range hợp lệ của từng field —
`uuid`, `deskMajor` + 6/11 field trong `arbitration` (`minDeltaDb`, `dwellSeconds`,
`lockoutSeconds`, `zoneSilenceSeconds`, `deskDwellSeconds`, `sessionSilenceMinutes`) là
**bắt buộc** với client, thiếu là app lỗi khi parse bundle; `engageAtMeters`,
`releaseAtMeters`, `pathLossExponent`, `kalmanProcessNoise`, `kalmanMeasurementNoise` là tùy
chọn, có default),
`policies: {allowLoudspeaker, autoplayRequiresHeadphones, revisitPlaysWelcome}`, `zones: []`.

Mỗi phần tử `zones[]`: `major` (số, khớp major beacon vật lý), `id`, `name{đa ngôn ngữ}`,
`welcomeText{đa ngôn ngữ}`, `heroImage`, `heroImageBlurred`, `introAudio.tracks.{mã ngôn ngữ}:
{file, durationSec, transcript}`, `exhibits: []`.

Mỗi phần tử `exhibits[]`: `minor` (số, duy nhất trong zone), `id`, `name{đa ngôn ngữ}`,
`summary{đa ngôn ngữ}`, `meaning{đa ngôn ngữ}`, `specs: [{label{đa ngôn ngữ}, value{đa ngôn
ngữ}}]`, `image`, `thumbnail`, `audio.tracks.{mã ngôn ngữ}: {file, durationSec, transcript}`.

**Field ở ngôn ngữ `fallbackLanguage` là BẮT BUỘC** (thiếu → `validateManifest()` chặn đóng gói,
xem `routes/adminContent.js` hàm `runIntegrityCheck`/`findMissingLanguageCoverage`). Field ở
ngôn ngữ khác là tùy chọn — client tự fallback về ngôn ngữ mặc định khi thiếu, không sập app.

Muốn kiểm tra nhanh 1 manifest có đủ dữ liệu để đóng gói/đổi fallback language không, gọi:
`GET /api/v1/admin/content/integrity-check` (JWT admin) — trả về danh sách lỗi/cảnh báo, hoặc
dùng thẳng 2 hàm export `validateManifest`/`findMissingLanguageCoverage` trong
`routes/adminContent.js` từ 1 script Node nhỏ (xem ví dụ cách làm ở lịch sử phiên làm việc
gần đây — copy manifest ra rồi require route file để tái dùng đúng logic server dùng, không tự
viết lại logic kiểm tra riêng).

## 4. Trang quản trị (`public/admin.html` + `admin.js`)

SPA 1 trang, các tab (`data-view` / `id="view-*"`): `home`, `videos` (quản lý khu vực/hiện vật +
"Bản sao lưu dữ liệu" + import ZIP), `search`, `static-content` (lịch sử đóng gói bundle),
`ui-strings` (đặt tên nhầm lịch sử — thực chất là tab "**Giao diện ứng dụng**": quản lý ngôn
ngữ + **Cấu hình nâng cao** gồm cả tham số beacon `uuid`/`deskMajor`/`arbitration.*` + chuỗi
giao diện `ui{}`), `analytics` (thống kê hành vi khách, đọc `content/.analytics/events.ndjson`).

Trang thứ hai: `public/users.html` + `users.js` — **Quản lý tài khoản**, chỉ vai trò Chủ mở
được. Tách file riêng (không phải tab trong SPA) vì `admin.js` đã ~2700 dòng và đây là việc
vài tháng một lần, lỗi ở đó không được phép làm hỏng trang nhập liệu hằng ngày.

Đăng nhập: `POST /api/v1/auth/login`, so với **`users.json`** (không còn so với `.env`) → JWT
mang `role` thật + `user_id` + `name`. Ba vai trò, phân quyền theo CẤP:
`viewer(1) < editor(2) < owner(3)` — xem mục 5.16.

## 5. VẬN HÀNH SERVER — phần quan trọng nhất của file này

### 5.1. `CONTENT_DIR` bị HARDCODE, không đọc biến môi trường

⚠ **ĐÃ ĐỔI (2026-09-13, §5.24):** mọi đường dẫn dữ liệu nay đi qua `paths.js` và đọc `DATA_DIR`. Không đặt `DATA_DIR` thì vẫn là thư mục cạnh `server.js`, nên mọi điều dưới đây **vẫn đúng** cho app `beacon-server`. Thử nghiệm an toàn giờ đơn giản hơn: `node scripts/tao-bao-tang.js` vào một thư mục tạm rồi chạy `DATA_DIR=<thư mục đó> PORT=<cổng khác> node server.js` — không cần chép cả mã nguồn.

`staticContentBundle.js`: `const CONTENT_DIR = path.join(__dirname, 'content');` — **cố định
vào đúng thư mục `content/` cạnh `server.js` đang chạy, không có cách nào trỏ ra chỗ khác qua
`.env`**. Hệ quả:
- Chạy 2 tiến trình server từ CÙNG 1 thư mục mã nguồn (khác `PORT`) sẽ **đọc/ghi chung 1**
  `content/manifest.json` — test ghi/xóa dữ liệu kiểu này sẽ ảnh hưởng dữ liệu thật.
- Muốn test an toàn các thao tác GHI (PUT/POST/DELETE vào `/api/v1/admin/content/...`) mà
  không đụng dữ liệu thật: **copy nguyên thư mục `beacon_server` ra 1 chỗ khác** (symlink
  `node_modules` cho nhanh, không cần copy — `ln -s $(pwd)/node_modules <đích>/node_modules`),
  sửa `.env` bản copy (`PORT` khác, `DB_PATH` khác, đổi tạm `ADMIN_PASSWORD_HASH` sang mật khẩu
  test tự sinh bằng `node -e "console.log(require('bcryptjs').hashSync('...', 10))"`), chạy
  `node server.js` trong thư mục copy đó rồi test thoải mái, xong `rm -rf` thư mục copy.
- Nếu chỉ ĐỌC (GET), chạy `PORT=<cổng khác> node server.js` ngay trong thư mục thật là đủ an
  toàn (không ghi gì).
- Luôn kiểm tra cổng đang test có bị chiếm không bằng `ss -ltnp | grep ':<port>'` trước/sau khi
  chạy — **không dùng `pgrep -f "node server.js"`**, dễ dính false-positive nếu chạy trong môi
  trường có shell wrapper chứa sẵn chuỗi đó trong command line của chính nó.

### 5.2. pm2 — CẨN THẬN tên app, gõ sai KHÔNG restart mà tạo tiến trình mới

`ecosystem.config.js` đặt `name: 'beacon-server'` (**gạch ngang**). Gõ nhầm
`pm2 start beacon_server` (**gạch dưới**, dễ gõ nhầm vì tên thư mục hay dùng gạch dưới) **không
báo lỗi** — pm2 hiểu đó là 1 app HOÀN TOÀN MỚI (suy ra từ thư mục hiện tại), tạo thêm 1 tiến
trình song song với tiến trình gốc, rất dễ dẫn tới xung đột cổng hoặc chạy code cũ song song
code mới mà không ai để ý. Luôn dùng đúng 1 trong các cách sau, không gõ tay `pm2 start`:

**Từ 2026-08-31 có `scripts/beacon.sh` gói cả ba cái bẫy vào một lệnh** — dùng cái này, đừng gõ
tay `pm2`:

```bash
sh scripts/beacon.sh bat             # bat; dang chay thi khoi dong lai
sh scripts/beacon.sh tat
sh scripts/beacon.sh khoi-dong-lai   # y het `bat`
sh scripts/beacon.sh trang-thai      # pm2 + ai giu cong + goi thu vao server
sh scripts/beacon.sh nhat-ky [so-dong]
```

(Hoặc `npm run bat` / `tat` / `khoi-dong-lai` / `trang-thai` / `nhat-ky`. Các lệnh `pm2:*` cũ
vẫn còn nhưng nay chỉ gọi sang script này, để thói quen gõ cũ không rơi vào bẫy nữa. Truyền
tham số qua npm phải có `--`: `npm run nhat-ky -- 100`.)

Script làm ba việc mà lệnh `pm2` trần không làm:
- **Luôn khởi động từ `ecosystem.config.js`** → không thể gõ nhầm tên app thành gạch dưới.
- **`pm2 restart` báo "not found" thì tự ngã về `pm2 start ecosystem.config.js`**, rồi `pm2 save`
  ngay sau khi bật. Đây đúng là lỗi đã gặp ngày 2026-08-31.
- **Kiểm cổng TRƯỚC khi bật**: có tiến trình ngoài pm2 đang giữ cổng thì dừng lại và in đúng
  dòng `netstat` kèm PID, thay vì để app quay vòng chết vì `EADDRINUSE` trong khi web vẫn 200.

⚠ `tat` **cố ý không** `pm2 save` — lưu lúc đang tắt nghĩa là sau khi máy reboot server nằm im,
cả bảo tàng mất mạng mà không ai hiểu tại sao. Muốn tắt hẳn cả sau reboot thì tự chạy
`pm2 stop beacon-server && pm2 save`.

Lệnh pm2 gốc, khi cần làm tay:

```bash
pm2 start ecosystem.config.js   # lan dau
pm2 restart beacon-server
pm2 stop beacon-server
pm2 logs beacon-server
```

Nếu lỡ tạo trùng tiến trình: `pm2 list` xem app nào tên sai (gạch dưới) → `pm2 delete
<tên_sai>` → `npm run pm2:restart` → `pm2 list` xác nhận chỉ còn đúng 1 dòng `beacon-server`
→ `pm2 save` để lưu lại danh sách cho lần reboot sau.

### 5.3. Sửa code route KHÔNG tự nạp lại — bắt buộc restart; file tĩnh thì KHÔNG cần

- Sửa bất kỳ file `.js` trong `routes/`, `middleware/`, `server.js`,
  `staticContentBundle.js`... → tiến trình Node đang chạy **vẫn dùng code CŨ trong bộ nhớ**
  cho tới khi được restart (`npm run pm2:restart` hoặc restart tiến trình `node server.js` thủ
  công). Đây là nguyên nhân phổ biến nhất của kiểu lỗi "tôi sửa rồi mà vẫn báo lỗi cũ" hoặc
  route mới trả về 404 y hệt trang lỗi mặc định của Express.
- Sửa file trong `public/` (`admin.html`, `admin.js`, `admin.css`) → **phục vụ trực tiếp từ đĩa
  qua `express.static`, có hiệu lực ngay lập tức, không cần restart**, chỉ cần tải lại trang
  trình duyệt (thường phải hard-refresh / xóa cache nếu trình duyệt cache JS cũ).

### 5.4. `.env` — không bao giờ copy nguyên sang máy/server khác đang public

`.env` chứa `JWT_SECRET` + `ADMIN_PASSWORD_HASH`. Copy nguyên file này sang 1 server khác nghĩa
là 2 server dùng chung bí mật — ai chiếm được `.env` của 1 bên thì giả mạo token admin được ở
cả 2 bên. Khi đem code sang máy/server mới để host: tạo `.env` mới từ `.env.example`, sinh
`JWT_SECRET` mới (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
và mật khẩu admin mới (`node -e "console.log(require('bcryptjs').hashSync('mật-khẩu-mới',
10))"`), trừ khi có lý do rõ ràng muốn 2 server share y hệt 1 danh tính đăng nhập (đã có tiền lệ
người dùng chủ động chọn giữ nguyên `.env` khi copy — vẫn là lựa chọn hợp lệ, chỉ cần họ hiểu
đánh đổi).

### 5.5. File/thư mục KHÔNG nên mang theo khi deploy sang máy khác

`node_modules/` (cài lại bằng `npm install --omit=dev`, đặc biệt bắt buộc nếu khác kiến trúc
CPU/OS vì có module native), `downloads/static-content/` (bundle cache tự sinh lại),
`tmp_import/` (rác tạm), `.claude/` (cấu hình Claude Code cục bộ, không liên quan runtime),
`.legacy-backup-2026-07-31/` (backup code hệ cũ đã xóa hẳn, xem mục 1 — không cần thiết cho
server mới trừ khi muốn giữ lịch sử), `content/.import-backups/` + `content/.language-backups/`
(backup nội bộ, giữ lại được nếu muốn nhưng không bắt buộc, có thể khá nặng theo thời gian).
**Phải giữ**: `content/manifest.json` + `content/images/` + `content/audio/` (nội dung thật),
toàn bộ `routes/`, `middleware/`, `public/`, `package.json`, `package-lock.json`,
`ecosystem.config.js`.

### 5.6. Backup nội dung — cơ chế đã có sẵn, không cần tự làm thủ công

- Thêm/xóa ngôn ngữ (`PUT /api/v1/admin/content/languages`) → tự động tạo backup trước khi
  thay đổi, đặt tên theo các ngôn ngữ được backup. Xem/khôi phục/xóa qua
  `GET/POST /api/v1/admin/content/language-backups`,
  `POST .../language-backups/:id/restore`, `DELETE .../language-backups/:id` — panel "Bản sao
  lưu dữ liệu" ở tab "Quản lý video" trong `admin.html`.
- Nhập gói nội dung mới (`POST /api/v1/admin/content/import`, thay thế TOÀN BỘ manifest +
  images + audio) → tự backup vào `content/.import-backups/<timestamp>-import/` trước khi ghi
  đè, kèm `manifest-before.json` để đối chiếu/khôi phục thủ công nếu cần (chưa có nút restore
  UI cho loại backup này, phải khôi phục tay bằng cách copy ngược file lại).

### 5.7. Sự cố đã từng gặp thật (đọc trước khi báo "chắc là bug")

- **"Không thể xóa bản sao lưu" (404 dạng trang lỗi HTML mặc định của Express, không phải JSON
  lỗi của app)** → không phải bug logic, do tiến trình server đang chạy chưa được restart sau
  khi route DELETE mới được thêm vào code. Restart là hết (xem mục 5.3).
- **`pm2 list` hiện 2 dòng, 1 dòng tên gạch dưới `beacon_server`** → gõ nhầm `pm2 start` thay vì
  `pm2 restart` (xem mục 5.2), không phải server tự nhân bản.
- **`EADDRINUSE` khi chạy `node server.js` để test** → cổng đang bị 1 tiến trình cũ (có thể do
  lần test trước kill hụt) chiếm giữ; kiểm tra bằng `ss -ltnp | grep ':<port>'`, kill đúng PID
  tìm được, không đoán mò.
- **Test dedup của `POST /events` mà xóa tay `content/.analytics/events.ndjson` giữa lúc server
  vẫn đang chạy** → server giữ tập khóa chống trùng (`seenKeys`) trong bộ nhớ, nạp 1 LẦN lúc
  request đầu tiên sau khi khởi động; xóa file mà không restart sẽ khiến các lần ghi lại sau đó
  bị coi nhầm là trùng lặp và bị bỏ qua âm thầm. Luôn restart sau khi xóa tay file log kiểu này
  nếu đang test.
- **`pm2 restart beacon-server` báo "Process or Namespace beacon-server not found"`** → pm2
  daemon không còn nhớ app này nữa (có thể do lỡ `pm2 delete` lúc dọn tiến trình trùng, hoặc
  máy reboot mà chưa `pm2 save`/`pm2 startup`). Không phải lỗi code — chạy lại từ đầu bằng
  đúng file cấu hình: `pm2 start ecosystem.config.js` rồi `pm2 save` để lần sau khỏi mất lại.

### 5.8. Server thật chạy sau nginx (reverse proxy + TLS) — PHẢI đặt `BIND_HOST=127.0.0.1`

Server production KHÔNG expose thẳng ra Internet/LAN — có nginx đứng trước lo TLS (certbot).
Nếu `.env` không có `BIND_HOST` (hoặc để mặc định `0.0.0.0`), Node **tự nghe trên MỌI
interface**, nghĩa là cổng `PORT` (thường 3000) vẫn lộ thẳng ra LAN song song với nginx, đi
vòng qua TLS hoàn toàn. Tệ hơn: vì server chạy `NODE_ENV=production`, middleware ép HTTPS ở
`server.js` sẽ redirect 301 mọi request HTTP thẳng vào cổng đó sang `https://<ip>:<port>` —
nơi không hề có TLS lắng nghe — khiến client (vd tablet cấu hình nhầm sang thẳng IP:PORT thay
vì qua domain) lỗi kết nối khó hiểu, tưởng server hỏng.

**Bắt buộc trong `.env` của server thật**: `BIND_HOST=127.0.0.1` (máy dev để trống, mặc định
`0.0.0.0` để vẫn test qua LAN được). Đã verify bằng `curl` thật: đặt `127.0.0.1` thì gọi qua
`localhost`/qua nginx vẫn `200`, gọi thẳng qua IP LAN vào đúng `PORT` sẽ không kết nối được
(connection refused) — không chỉ là đổi dòng log.

**`client_max_body_size` của nginx vs giới hạn upload ZIP nhập nội dung** — 1 đợt audit hạ tầng
phát hiện nginx trên server thật đặt `client_max_body_size 60M`, trong khi `importUpload` ở
`routes/adminContent.js` (`POST /api/v1/admin/content/import`) lúc đó cho phép tới 300MB. Lệch
nhau kiểu này khiến gói nội dung lớn bị **nginx chặn trước bằng trang lỗi HTML 413** (không
phải JSON), `admin.js` parse lỗi khó hiểu — đúng kiểu sự cố ở mục 5.7.

**Phát hiện phụ nghiêm trọng hơn lúc đo đạc để quyết định nâng giới hạn lên bao nhiêu**: route
`/import` ban đầu dùng `multer.memoryStorage()` + `unzipper.Open.buffer()` + `entry.buffer()` -
nghĩa là NGUYÊN file ZIP + từng file con giải nén đều bị nạp hết vào RAM của tiến trình Node.
Đo thật bằng cách upload 1 gói ZIP giả ~131MB và theo dõi `VmRSS`: **RAM tiến trình nhảy từ
~76MB (idle) lên ~617MB lúc xử lý — gấp 4.7 lần dung lượng file**. Trong khi
`ecosystem.config.js` đặt `max_memory_restart: '300M'`, nghĩa là 1 gói ZIP tầm 65-70MB trở lên
đã đủ khiến **pm2 tự kill server GIỮA LÚC đang ghi đè `images/`/`audio/`**, để lại `content/` ở
trạng thái dở dang (nguy hiểm hơn nhiều so với lỗi 413 đơn thuần).

**Đã sửa tận gốc** (không chỉ đổi số): chuyển `importUpload` sang `multer.diskStorage()` (ghi
file ZIP tạm ra `tmp_import/` thay vì giữ trong RAM — thư mục này trước đó chỉ dùng cho hệ
LEGACY đã xóa ở mục 1, giờ tái dùng cho mục đích mới), dùng `unzipper.Open.file()` thay vì
`.buffer()` (đọc central directory từ đĩa, không nạp cả ZIP vào bộ nhớ), và ghi từng file
ảnh/audio bằng `entry.stream().pipe(fs.createWriteStream())` thay vì `entry.buffer()` (stream
thẳng đĩa-tới-đĩa, không giữ nguyên file trong Buffer). File ZIP tạm luôn được xóa trong khối
`finally` dù thành công hay lỗi. **Kết quả đo lại đúng file test 131MB đó: RAM đỉnh chỉ còn
~123MB** (từ 617MB) — gần như không đổi theo dung lượng file nữa.

### 5.9. Nâng giới hạn import ZIP lên 1.2GB — 5 tầng chặn, không chỉ 1 con số

Sau khi RAM hết là rào cản (mục 5.8), giới hạn `importUpload` đã nâng lên **1.2GB**. Nhưng đổi
mỗi con số đó là KHÔNG đủ — ZIP lớn bị chặn ở 5 tầng khác nhau, 3 tầng trong số đó báo lỗi
trông không giống lỗi dung lượng chút nào:

| Tầng | Mặc định | Triệu chứng khi vượt |
|---|---|---|
| nginx `client_max_body_size` | 60M (server thật) | trang HTML 413, không phải JSON |
| multer `fileSize` (`routes/adminContent.js`) | nay 1.2GB | JSON 413 |
| nginx `proxy_read_timeout` | 60s | **504** khi Node giải nén lâu hơn 60s |
| Node `server.requestTimeout` | 300s (mặc định từ v18) | **"socket hang up"** — tưởng lỗi mạng |
| Dung lượng đĩa | — | hỏng giữa chừng, `content/` dở dang |

`server.requestTimeout`/`headersTimeout` đã nới lên 30 phút trong `server.js` (không đặt 0 để
request treo thật vẫn được thu hồi). **Phần nginx phải làm trên server thật**, đặt trong block
`server {}` của `beacon.conf` rồi `nginx -t && rc-service nginx reload`:

```nginx
client_max_body_size 1300M;
proxy_read_timeout 1800s;
proxy_request_buffering off;   # stream thang sang Node, khoi ton them 1GB dia cua nginx
```

**Phép tính đĩa**: 1 lần import ZIP ~1GB cần **~4GB trống cùng lúc** — ZIP tạm trong
`tmp_import/` + `images`/`audio` vừa giải nén + bản sao `content/` cũ mà `fs.cpSync` chép vào
`.import-backups/` + file `.tar.gz` sinh ra sau đó. Server thật hiện có 129GB trống (đã kiểm
tra 2026-07-31) nên thoải mái, nhưng phải `df -h` lại nếu nâng giới hạn tiếp.

**Hai thứ nội dung cỡ GB làm lộ ra, đã sửa cùng đợt trong `staticContentBundle.js`**:
- `ensureBundle()` trước đây **không có khóa chống nén song song** — ngay sau khi publish,
  cache rỗng, N máy cùng gọi `GET /version.json` sẽ khởi động N lần tar+gzip riêng trên cùng
  bộ nội dung. Với `content/` vài MB không ai nhận ra; với GB thì đủ làm chết server. Nay gom
  về đúng 1 lần nén qua biến `inFlight`, các request còn lại chờ chung kết quả (đã test 5 lời
  gọi song song → chỉ 1 dòng history).
- `downloads/static-content/` **tích rác vô hạn** — chỉ đúng 1 phiên bản được phục vụ tại mỗi
  thời điểm (`routes/staticContent.js` trả 404 cho version khác), nên mọi file cũ là rác thuần
  túy; đã từng tích 21 file/57MB. Nay `pruneOldBundles()` giữ `KEEP_BUNDLES = 3` file mới nhất
  sau mỗi lần nén thành công (luôn giữ file đang phục vụ). ⚠️ Lần nén ĐẦU TIÊN sau khi deploy
  bản này sẽ tự xóa các bundle cũ — đây là hành vi cố ý.
- `tar.c` đổi từ `gzip: true` (level 6) sang `gzip: { level: 1 }`: media trong bundle là
  JPG/PNG/MP3 đã nén sẵn, đo thật cho thấy file chỉ lớn hơn **0.4%** (6,915,972 vs 6,888,949
  bytes) trong khi tiết kiệm rất nhiều CPU — khác biệt tính bằng phút khi `content/` cỡ GB.

`max_memory_restart` trong `ecosystem.config.js` đã nâng **300M → 600M** cùng đợt này: RAM đã
ổn định nhờ streaming, nhưng chưa ai đo với file cỡ GB, mà cái giá của việc đoán sai là
`content/` hỏng dở dang chứ không phải một lỗi upload thường.

### 5.10. Cache bundle bám theo dấu vân tay nội dung, KHÔNG phải mtime của manifest

Trước đây `ensureBundle()` chỉ coi cache là cũ khi `mtime` của `content/manifest.json` đổi. Hệ
quả âm thầm: **thay file trong `content/images/` hoặc `content/audio/` thẳng trên đĩa** (copy
tay, `rsync`, script ngoài, khôi phục backup) mà không đụng `manifest.json` thì server vẫn phục
vụ bundle CŨ với `sha256` CŨ — app không hề biết có nội dung mới, và không có cách nào phát
hiện ngoài việc so tay.

Nay `contentFingerprint()` băm danh sách `(đường dẫn, kích thước, mtime)` của **toàn bộ**
`manifest.json` + `images/` + `audio/`, và cache chỉ còn hiệu lực khi dấu vân tay đó không đổi.
Vẫn KHÔNG đọc nội dung file (chỉ `stat`), nên chi phí không tăng theo dung lượng — và kết quả
được nhớ tạm 5 giây (`FINGERPRINT_TTL_MS`) để nhiều máy cùng gọi `GET /version.json` không làm
quét lại cây thư mục liên tục.

Đã test đúng kịch bản từng bị bỏ sót: sửa 1 file ảnh mà không chạm `manifest.json` → bundle
được nén lại, `sha256` đổi; gọi lại ngay sau đó vẫn dùng cache.

**Vẫn cần nhớ — và đây là chỗ rất dễ hiểu sai**: `bundleVersion` KHÔNG tự đổi theo dấu vân tay.
Nó chỉ tăng khi `bumpVersion()` được gọi, mà `bumpVersion()` chỉ chạy trong các route GHI nội
dung của `routes/adminContent.js` (sửa zone/hiện vật/ngôn ngữ/import...). **Nút "Đóng gói ngay"
(`POST /admin/static-content/rebuild`) KHÔNG gọi `bumpVersion()`** — nó chỉ ép nén lại với
`force=true`, `bundleVersion` giữ nguyên.

Hệ quả: thay media thẳng trên đĩa → `sha256` đổi (nhờ vân tay), nhưng `bundleVersion` không
đổi → **máy đã đồng bộ rồi sẽ KHÔNG tải lại** vì client so `bundleVersion` trước. Muốn client
nhận nội dung mới thì phải làm 1 thao tác ghi bất kỳ qua trang admin (để `bumpVersion()` chạy),
hoặc sửa tay trường `bundleVersion` trong `content/manifest.json`.

Cách tự kiểm: `sha256` trong `/version.json` đổi mà `bundleVersion` đứng yên = đang ở đúng
tình huống này.

### 5.11. Backup `content/` — `scripts/backup-content.sh`

`content/` là nguồn dữ liệu duy nhất. Git (đã có từ sau này, xem mục 1) chỉ theo dõi
`manifest.json` + `.version-sequence.json` trong `content/` (xem `.gitignore`) — `images/`,
`audio/`, `.import-backups/`, `.language-backups/`, `.analytics/` đều bị loại khỏi git (quá
nặng/nhị phân để commit). Và `.import-backups/`/`.language-backups/` nằm NGAY BÊN TRONG
`content/` nên chết chung nếu ổ đĩa hỏng hoặc bị ghi đè nhầm — git không cứu được phần này.
Script này đóng gói `manifest.json` + `images/` + `audio/` + `.analytics/` +
`.version-sequence.json` thành `.tar.gz` có ngày giờ, kiểm tra `gzip -t` trước khi coi là thành
công, và xoay vòng giữ `KEEP` bản gần nhất (mặc định 7).

```sh
sh scripts/backup-content.sh                 # chay tay
# cron 2h sang hang ngay:
0 2 * * * sh /root/beacon_server/scripts/backup-content.sh >> /var/log/beacon-backup.log 2>&1
```

Biến: `APP_DIR`, `DEST` (mặc định `/root/beacon-backups`), `KEEP`, `REMOTE`. **`REMOTE` để
trống nghĩa là bản sao nằm cùng ổ đĩa với dữ liệu gốc** — chống được xóa/ghi đè nhầm nhưng
KHÔNG chống được hỏng đĩa. Đặt `REMOTE='user@may-khac:/backup/beacon'` (cần SSH key không mật
khẩu) để có bản sao thật sự ở ngoài. Cố tình BỎ QUA `.import-backups/`/`.language-backups/` vì
chúng chỉ là bản sao nội bộ, backup lại chỉ làm file phình.

Khôi phục: `tar -xzf <file> -C content/` rồi **`pm2 restart beacon-server`** — `seenKeys` của
analytics và cache bundle đều nằm trong bộ nhớ tiến trình (mục 5.7).

### 5.12. `ffmpeg` là phụ thuộc HỆ THỐNG bắt buộc (thêm 2026-08-09)

Mọi ảnh/audio tải lên qua form **thêm/sửa khu vực & hiện vật** đều được chuẩn hóa trước khi lưu
(`routes/adminContent.js`, hàm `toJpeg()` / `toMp3CappedBitrate()`):
- **Ảnh → luôn ra JPEG.** Vùng trong suốt của PNG/WEBP được lót nền **trắng** — nếu không,
  encoder mjpeg biến phần trong suốt thành **đen** (đã kiểm chứng bằng cách đọc màu pixel).
- **Audio → mp3, 128 kbps là MỨC TRẦN, không phải mức cố định.** File ≤128 kbps giữ nguyên
  byte-for-byte (đã verify bằng md5), file >128 kbps mới bị nén xuống. Lý do: toàn bộ audio
  hiện có là 64 kbps, mã hóa lại lên 128 chỉ làm file to gấp đôi (đo thật 200KB→400KB) và
  **giảm** chất lượng (generation loss) — phình gói tải về của mọi tablet mà không được gì.
  Chủ dự án đã chốt phương án mức trần này.

Dùng **ffmpeg hệ thống** (`execFile`), không dùng `sharp`/`ffmpeg-static`: server thật chạy
Alpine/musl, mà `ffmpeg-static` chỉ có bản glibc nên sẽ không chạy. Dùng ffmpeg cho cả ảnh lẫn
audio → chỉ phải cài **duy nhất 1 thứ** trên server:

```sh
apk add ffmpeg    # BAT BUOC, neu khong moi upload anh/audio deu that bai
```

Thiếu ffmpeg thì **không âm thầm hỏng**: route bắt `ENOENT` và trả lỗi rõ ràng *"Server chưa cài
ffmpeg... Chạy apk add ffmpeg"*, dữ liệu cũ không bị ghi đè (đã test bằng cách chạy server với
`PATH` không có ffmpeg).

⚠️ **Không áp dụng cho luồng nhập gói ZIP** (`POST /import`) — gói ZIP được coi là đã chuẩn bị
sẵn bên ngoài, giải nén nguyên trạng. Ảnh/audio trong ZIP KHÔNG bị ép định dạng.

### 5.13. Nhật ký thao tác + hoàn tác, và phân trang cho kho lớn (thêm 2026-08-12)

Ba việc làm cùng đợt, phục vụ mục tiêu **~3000 hiện vật**.

**`contentHistory.js` — nhật ký và hoàn tác dùng chung một cơ chế.** Mọi thao tác ghi đi qua
`withHistory()` (thay cho `withManifestLock()` trực tiếp) trong `routes/adminContent.js`. Trước
khi ghi, nó chụp `manifest.json` vào `content/.history/<seq>/manifest-before.json`, và:
- `saveFile()` gọi `noteBeforeWrite()` → file **bị ghi đè** được cất bản gốc, file **mới** được
  ghi nhớ để hoàn tác thì xóa đi.
- `deleteFileQuiet()` gọi `noteDelete()` → **không xóa hẳn**, mà chuyển vào thùng rác của thao tác.
- Video ghi thẳng qua multer nên KHÔNG đi qua `saveFile()` — phải gọi `noteCreatedFile()` thủ công.

Nhờ vậy hoàn tác khôi phục được **cả nội dung lẫn file media** — khác hẳn cơ chế sao lưu cũ (chỉ
cứu được toàn bộ kho, không cứu được từng thao tác). Đã kiểm chứng: xóa hiện vật rồi hoàn tác →
ảnh trở lại **trùng khít md5** bản gốc.

⚠️ **Hoàn tác là "khôi phục về một thời điểm", không phải bỏ riêng một thao tác.** Vì các thao
tác chồng lên nhau, hoàn tác về thao tác `#n` sẽ hoàn tác luôn mọi thao tác sau nó — giao diện
báo rõ số lượng trước khi chạy. Đã test chuỗi 3 thao tác lồng nhau → lùi đúng cả 3.

Hai chi tiết dễ sai nếu sửa lại sau này:
- `POST /history/:seq/undo` **cố tình không** bọc trong `withHistory` (sẽ thành đệ quy, làm rối
  nhật ký) nhưng **vẫn** dùng `withManifestLock` để không đâm vào thao tác ghi khác.
- Sau khi khôi phục **bắt buộc gọi `bumpVersion()`**. Manifest cũ mang `bundleVersion` cũ, giữ
  nguyên thì máy đã đồng bộ sẽ không tải lại — đúng cái bẫy đã mô tả ở mục 5.10.

Giữ 30 thao tác gần nhất (`KEEP_ACTIONS`), cũ hơn thì xóa hẳn kèm thùng rác. `content/.history/`
đã được thêm vào `.gitignore`.

**Phân trang.** Trang quản trị trước đây tải CẢ manifest rồi vẽ toàn bộ khu vực + hiện vật. Đo
với 3000 hiện vật: manifest 16 MB, `GET /content` trả **13,7 MB / 151 ms**. Nay có
`GET /zones-page` và `GET /zones/:id/exhibits-page` (kèm `q`, `page`, `pageSize`) →
**4 KB / 2 ms**. Kèm theo `GET /zones/:zoneId` và `GET /zones/:zoneId/exhibits/:exhibitId` để
các form sửa lấy riêng từng đối tượng thay vì tìm trong cả kho.

Hệ quả với `public/admin.js`: tab quản lý **không còn dùng `contentManifest`**. Biến đó giờ chỉ
còn phục vụ tab "Trang chủ" và "Tìm kiếm" (2 chỗ tính số liệu trên toàn kho — **vẫn tải cả
manifest, là việc còn tồn đọng**). Thông tin ngôn ngữ tách sang `contentMeta` (tải từ
`GET /languages`), và `getLangs()`/`langLabel()` đọc `contentMeta` trước.

**`readManifestCached()`** cho các route CHỈ ĐỌC (cache theo `mtime`+`size`, tự bỏ khi
`writeManifest()` chạy). Các route GHI vẫn dùng `readManifest()` đọc tươi — **không được đổi
chỗ**: route ghi sửa thẳng vào object trả về, dùng bản cache là sửa vào bản dùng chung của mọi
request sau, kể cả khi thao tác ghi thất bại.

### 5.14. Siết bảo mật + dọn nợ kỹ thuật (2026-08-17)

Đợt này xuất phát từ 1 bản kiểm định mã nguồn. Chủ dự án đã duyệt từng mục.

**Nhập gói ZIP — hai lỗ hổng nghiêm trọng, ĐÃ VÁ.** Vòng lặp giải nén trước đây chỉ kiểm tra
`relPath.startsWith('images/')`. Kiểm tra tiền tố chuỗi là KHÔNG ĐỦ:
`images/../../PWNED.txt` **thỏa mãn** điều kiện đó, và `path.join` giải `..` ra ngoài
`content/`. Đã kiểm chứng bằng ZIP tấn công thật: code cũ ghi file vào đúng thư mục mã nguồn
server (thêm vài `..` nữa là tới `/root/.ssh/`). Lỗi thứ hai: không lọc đuôi file, mà
`content/` được `express.static` phục vụ công khai — 1 file `images/note.html` sẽ chạy script
trên **cùng origin với `admin.html`** và đọc được token quản trị trong `sessionStorage`.

Nay mọi entry đi qua `safeImportDest()` (`routes/adminContent.js`) với 4 tầng chặn: tiền tố
thư mục → chặn đường dẫn tuyệt đối/đoạn `..` → whitelist đuôi file (`IMPORT_ALLOWED_EXT`) →
so đường dẫn đã `path.resolve` với `CONTENT_DIR`. Entry bị từ chối được trả về trong
`skipped[]` để người dùng biết. **Đừng "đơn giản hóa" hàm này về lại kiểm tra tiền tố.**

**CSP đã BẬT** (`server.js`). Trước đây tắt hoàn toàn với lý do "admin.html dùng nhiều inline
style" — nhưng tắt cả CSP để cho qua inline *style* thì đồng thời cho qua inline *script*, tức
là bỏ đúng lớp phòng vệ lẽ ra đã chặn được chuỗi tấn công ở trên. Nay tách: `style-src` giữ
`'unsafe-inline'` (giao diện không phải viết lại), `script-src 'self'`.

Để làm được điều đó, **mọi `onclick="..."` nội tuyến đã bị xóa** (helmet đặt
`script-src-attr 'none'` chặn chúng). Thay bằng `data-act` + bảng `ACTIONS` và 1 bộ điều phối
delegation duy nhất trong `admin.js`; script nội tuyến của `index.html` tách ra `redirect.js`.
⚠️ **Thêm nút mới thì dùng `data-act`, đừng viết `onclick=`** — nó sẽ im lặng không chạy.
Sự kiện `error` của `<img>` không nổi bọt nên bắt ở pha capture (`data-hide-on-error`).

CSP cho phép đúng 2 domain ngoài, đều là phụ thuộc thật của giao diện: `fonts.googleapis.com`
+ `fonts.gstatic.com` (phông chữ, cả `admin.html` lẫn `login.html`) và `images.unsplash.com`
(6 ảnh trang trí chữ BEACON ở `login.js`). Bỏ 2 cái này ra là giao diện đổi phông/mất ảnh —
đã kiểm chứng bằng Chrome headless, lần đầu bật CSP đúng là chặn phông thật.
`upgradeInsecureRequests` chỉ bật ở production (máy dev chạy HTTP thuần).

**Khôi phục sao lưu nay tự dọn file mồ côi** (`cleanOrphansAfterRestore()`). Trước đây
`manifest.json` bị thay toàn bộ nhưng ảnh/audio chỉ được *chép thêm* — file tạo sau thời điểm
sao lưu nằm lại thành rác, mà `staticContentBundle.js` đóng gói CẢ thư mục chứ không lọc theo
manifest, nên rác đó vẫn tải về mọi máy khách. Xóa qua `deleteFileQuiet()` nên vào thùng rác
của thao tác → **bấm "hoàn tác" vẫn lấy lại được** (đã verify md5 trùng khít).

**`.import-backups/` nay có nút khôi phục** — 3 route `GET/POST .../restore/DELETE
/import-backups`. Khác backup ngôn ngữ (chỉ chép thêm): import đã xóa sạch `images/`+`audio/`
nên khôi phục phải **thay thế** cả 2 thư mục; làm qua thư mục tạm `.images-restoring/` rồi
đổi chỗ, để `fs.cpSync` lỗi giữa chừng không mất luôn dữ liệu đang có. Giữ
`MAX_IMPORT_BACKUPS_KEEP = 5` (mỗi bản chép cả images+audio nên rất nặng).

**Audio ≤128 kbps nay đi qua ffmpeg với `-c:a copy`.** Vẫn KHÔNG mã hóa lại (âm thanh trùng
khít từng mẫu — đã verify bằng md5 của luồng đã giải mã), nhưng ffmpeg dựng lại file sạch nên
tag ID3/ảnh bìa/dữ liệu lạ nhét kèm bị vứt. Đây từng là đường upload duy nhất không được khử
trùng. **`catch` trả về buffer gốc là CỐ Ý** — bước làm sạch chỉ là phòng vệ thêm, không được
phép làm hỏng upload nếu ffmpeg thiếu/lỗi.

**Cảnh báo ngưỡng** (`.threshold-warn`): hiện khi nhật ký ≥24/30 thao tác hoặc sao lưu ≥8/10
bản. Hai con số giữ nguyên theo quyết định của chủ dự án, chỉ báo trước. CSS dùng
`display:block` + icon đặt tuyệt đối — **đừng đổi sang flex**, các thẻ `<strong>` bên trong sẽ
thành ô flex riêng và câu văn bị bẻ thành từng cột (đã dính đúng lỗi này một lần).

**Chốt chặn "Áp dụng bản sao lưu" nay mới thật sự hoạt động.** `<select>` gốc luôn có 1 option
được chọn sẵn, nên điều kiện `!selectEl.value` chỉ đúng khi danh sách rỗng — tức đúng lúc
không ai cần nó. Mở tab rồi bấm "Áp dụng" là ghi đè toàn bộ nội dung mà chưa chọn gì. Đã thêm
option rỗng `— Chọn bản sao lưu —` làm mặc định. **Đừng bỏ dòng đó đi.**

**Đổi tên nút đóng gói** (chủ dự án chốt): "Đóng gói hiện vật" → **"Dữ liệu để trình chiếu"**,
"Đóng gói ngay" → **"Đóng gói dữ liệu"**. Hành vi giữ nguyên, KHÔNG gọi `bumpVersion()` — vẫn
đúng như mô tả ở mục 5.10.

**Đã xóa hàm chết `renderContentZonesListLegacy()`** trong `admin.js` (không ai gọi từ đợt
phân trang 5.13).

**Còn tồn đọng, đã thống nhất để sau**: chống giả mạo beacon (A9); rate limit + xoay vòng file
cho `POST /events`; ghi đúng người thao tác vào nhật ký (`beginAction` có nhận `user` nhưng
chưa lời gọi nào truyền `req.userId` — hiện luôn là `'admin'`); kiểm tra phiên bản khi 2 người
sửa cùng lúc; và **thay `PUT /password/public` bằng tài khoản riêng cho từng người + hai tài
khoản chủ** (phương án mã khôi phục in giấy đã bị chủ dự án bác vì vẫn lấy cắp được).

### 5.15. Thống kê: giới hạn tần suất + cắt file theo tháng, và chống hai người sửa cùng lúc (2026-08-18)

**`POST /events` nay có giới hạn tần suất** (`express-rate-limit`, 60 lần / 15 phút / IP).
Route này **bắt buộc phải mở** — khách tham quan không có tài khoản, đó không phải chỗ sai.
Chỗ sai là mở mà không giới hạn: ai cũng bơm được 2 MB mỗi lần cho tới khi đầy đĩa, mà đĩa đầy
sẽ làm **hỏng giữa chừng** thao tác nhập ZIP hoặc đóng gói bundle (mục 5.8/5.9) — tệ hơn nhiều
so với việc mất số liệu thống kê.

⚠️ **Chọn con số 60 dựa trên hành vi thật của app, đừng hạ xuống mà không đọc lại chỗ này**:
app **chỉ gửi 1 lần mỗi chuyến tham quan** (lúc máy về dock — xem `analytics_uploader.dart` +
`injection.dart`, `analytics.drain()`), KHÔNG gửi định kỳ. Cả bảo tàng thường đi ra Internet
qua **cùng một địa chỉ IP**, nên giới hạn phải đủ rộng cho tình huống vài chục máy cùng về dock
lúc đóng cửa. Trả **429** (không phải lỗi khác) để app giữ lại lô đó và thử lại sau — không mất
dữ liệu thật.

**File thống kê nay cắt theo tháng**: `content/.analytics/events-YYYY-MM.ndjson`. Trước đây tất
cả đổ vào một file duy nhất dài vô hạn, gây **ba** vấn đề cùng lúc, và cắt theo tháng giải quyết
cả ba:
1. `loadSeenKeys()` đọc CẢ file lúc khởi động → Node một luồng nên **cả server đứng im vài giây**.
2. Bộ khóa chống trùng giữ trong RAM **không bao giờ được cắt tỉa** → vượt `max_memory_restart`
   (600M) thì pm2 giết server, khởi động lại, đọc lại cả file, rồi lại chết. Vòng luẩn quẩn.
3. Mở tab Thống kê chọn "Hôm nay" vẫn đọc toàn bộ lịch sử từ ngày đầu.

Kèm theo: cả hai phía **đọc theo luồng** (`readline`) thay vì `readFileSync`, và bộ khóa chống
trùng chỉ giữ **tháng này + tháng trước**. Đánh đổi đã biết và đã chấp nhận: một sự kiện app gửi
lại **muộn hơn một tháng** có thể bị đếm hai lần — thực tế gần như không xảy ra vì app chỉ đệm
2 MB và gửi lại trong vòng vài phút.

`MAX_MONTH_BYTES = 200MB` là **lưới an toàn cuối**, không phải cơ chế chính (giới hạn tần suất
mới là chính). Vượt ngưỡng thì trả **204** chứ không phải lỗi — để app coi là đã nhận và không
gửi lại mãi mãi. Dùng thật khoảng 37 MB/tháng cho 20 máy, nên 200 MB là thừa rất nhiều.

Phía đọc (`routes/adminAnalytics.js`) chọn file theo khoảng thời gian được hỏi, **cộng 1 tháng
đệm mỗi đầu** để không hụt sự kiện nằm sát ranh giới múi giờ. File cũ `events.ndjson` (trước khi
cắt theo tháng) vẫn được đọc để không mất số liệu đã có.

**Chống hai người sửa cùng lúc — kiểm tra phiên bản** (`objectRev()` / `assertRev()` trong
`routes/adminContent.js`). Vấn đề: biểu mẫu gửi lên **tất cả** các ô với giá trị đọc được **lúc
mở form**. A sửa mô tả lúc 10:00, B (mở form từ 09:59) bấm lưu lúc 10:01 → biểu mẫu của B vẫn
mang mô tả CŨ → sửa của A biến mất, **không ai được báo gì**.

Cách làm: `GET /zones/:zoneId` và `GET /zones/:zoneId/exhibits/:exhibitId` trả thêm `rev` —
dấu vân tay sha1 của chính đối tượng. `admin.js` giữ nó trong `editingZoneRev` /
`editingExhibitRev`, gửi kèm khi lưu; server so lại, khác thì **409** kèm câu giải thích rõ.
Đã kiểm chứng đúng kịch bản trên: B bị chặn, sửa của A còn nguyên, và sau khi B tải lại thì
**cả hai thay đổi đều được giữ**.

Ba chi tiết dễ sai nếu sửa lại sau này:
- `rev` của **khu vực** băm phần **không gồm `exhibits`** — sửa một hiện vật bên trong không được
  làm hỏng biểu mẫu sửa khu vực của người khác (hai việc độc lập). Cả `GET` lẫn `PUT` phải băm
  **cùng một phần**, nếu lệch thì mọi lần lưu đều 409.
- **Không gửi `rev` thì bỏ qua kiểm tra** — cố ý, để script hoặc bản `admin.js` cũ không bị hỏng.
  Nghĩa là lớp bảo vệ này **im lặng biến mất** nếu ai đó quên gửi `rev` từ biểu mẫu.
- `resetContentZoneForm()` / `resetExhibitForm()` **xóa `rev` về null**, nên phải gán `rev`
  **SAU** khi gọi reset trong `startEditContentZone` / `startEditExhibit`.
- Câu lỗi 409 **cố ý không có dấu chấm cuối** vì `pushNotification` tự thêm "." vào.

**Còn tồn đọng**: chống số liệu giả (server không phân biệt được sự kiện từ tablet thật hay từ
máy người lạ — cần khóa bí mật nhúng trong app, cùng nhóm với A9 chống giả mạo beacon); chưa có
cơ chế tự xóa file thống kê quá cũ (hiện chỉ cắt theo tháng, không tự dọn).

### 5.16. Phân quyền 3 vai trò + kho tài khoản riêng (2026-08-20)

Trước đợt này hệ thống có **xác thực** nhưng gần như không có **phân quyền**: đúng một tài
khoản trong `.env`, đúng một vai trò cứng `'admin'` — `requireRole('admin')` chỉ là cánh cửa
hai trạng thái "có mật khẩu = làm được mọi thứ". Chủ dự án chọn phương án **3 vai trò cố
định** (đã cân nhắc và loại bỏ phương án ma trận quyền chi tiết vì dễ cấu hình sai).

**Ba vai trò, so theo CẤP chứ không so tên**: `viewer(1) < editor(2) < owner(3)`
(`userStore.roleLevel`). Dùng `requireLevel(n)` trong `middleware/auth.js`, không dùng
`requireRole('admin')` nữa — so theo cấp thì "cần Biên tập trở lên" viết gọn và không bỏ sót
vai trò cao hơn.

| | Chủ | Biên tập | Chỉ xem |
|---|:-:|:-:|:-:|
| Đọc nội dung, xem thống kê | ✓ | ✓ | ✓ |
| Thêm/sửa/xóa hiện vật, khu vực, đóng gói, sao lưu | ✓ | ✓ | ✗ |
| Nhập ZIP, áp dụng/xóa sao lưu, thêm/xóa ngôn ngữ | ✓ | ✗ | ✗ |
| Hoàn tác | mọi thao tác | chỉ việc của mình | ✗ |
| Quản lý tài khoản | ✓ | ✗ | ✗ |

**`adminContent.js` dùng MỘT cổng chung, mặc định an toàn** (~30 route, gắn từng cái là bỏ
sót): `GET` → viewer, mọi method khác → editor, các đường dẫn trong mảng `OWNER_ONLY` → owner.
⚠ Nhờ mặc định này, **route GHI mới thêm sau này tự động đòi quyền Biên tập** mà không ai phải
nhớ gắn gì — quên thì ngã về phía chặt hơn, không phải phía lộ ra. Đừng đổi thành whitelist.

**`users.json` nằm NGOÀI `content/` — cố ý.** `content/` bị nhiều thao tác đụng vào: nhập ZIP
**xóa sạch rồi ghi lại** `images/`+`audio/`, khôi phục sao lưu **thay thế** cả thư mục, một
phần được phục vụ công khai qua `/content-media/`. Để file tài khoản trong đó thì sớm muộn một
thao tác nội dung sẽ xóa mất nó và cả bảo tàng không đăng nhập được. Ghi qua file tạm rồi
`rename` (mất điện giữa chừng không làm hỏng JSON), quyền `600`.
⚠ Đã thêm vào `.gitignore` VÀ vào `scripts/backup-content.sh` (script đó `tar -C content/` nên
**không** tự lấy file ngoài đó — phải có dòng `EXTRA` riêng).

**Chuyển đổi từ hệ cũ tự động, không ai bị khóa ra ngoài**: `userStore.ensureBootstrap()` chạy
ở lần đăng nhập đầu tiên — nếu chưa có `users.json` thì tạo tài khoản **Chủ** từ đúng
`ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` đang có. Mật khẩu đang dùng vẫn vào bình thường. Đã
kiểm chứng. Sau bước này `.env` **không còn là nguồn xác thực** — đổi `ADMIN_PASSWORD_HASH`
trong `.env` sẽ KHÔNG có tác dụng gì nữa.

**Hai chốt an toàn** trong `routes/adminUsers.js`, thiếu là có ngày không ai vào lại được:
`assertNotSelf` (không tự khóa/tự hạ vai trò/tự xóa) và `assertNotLastOwner` (không để hết
sạch tài khoản Chủ dùng được). Thực tế `assertNotSelf` mới là cái giữ bất biến "luôn còn ≥1
Chủ" — nhưng giữ cả hai làm lớp phòng vệ kép. Xóa tài khoản phải **khóa trước** (hai bước).

**`PUT /password/public` ĐÃ GỠ** (route + form trong `login.html` + code trong `login.js`).
Route đó đổi được mật khẩu mà không cần đăng nhập, nên người vừa nghỉ việc — vẫn nhớ mật khẩu
chung — có thể khóa cả bảo tàng ra ngoài. Chủ dự án cũng đã **bác** phương án "mã khôi phục in
ra giấy" vì giấy vẫn lấy cắp được. Giải pháp: luôn có **hai tài khoản Chủ** để đặt lại cho nhau.

**Mật khẩu do server sinh**, không nhận từ client (`generatePassword()`, bỏ ký tự dễ nhầm
0/O/1/l/I). Trả về **đúng một lần** lúc tạo/đặt lại. Bắt người quản lý tự nghĩ mật khẩu là
đường ngắn nhất dẫn tới `bt2024`.

**Nhật ký cuối cùng cũng ghi đúng người (A4).** `withHistory(req, meta, fn)` — `req` là tham số
ĐẦU TIÊN để mọi thao tác ghi đều buộc phải nói rõ ai làm. ⚠ `beginAction` phải đưa `userId` vào
**cả object `meta`**, không chỉ khai báo tham số — đã dính đúng lỗi này: tên ghi đúng nhưng
`userId` luôn null, khiến Biên tập không bao giờ hoàn tác được việc của chính mình.

**Ba lỗi giao diện đã dính, đừng lặp lại:**
- `[hidden] { display: none !important; }` là **BẮT BUỘC** trong `admin.css`. Thuộc tính
  `hidden` của HTML chỉ là `display:none` ở bảng kiểu mặc định của trình duyệt, nên
  `.nav-item{display:flex}` đè lên nó — vai trò "Chỉ xem" vẫn nhìn thấy mục "Quản lý tài khoản".
- `.btn:disabled` phải có kiểu riêng. Trước đây chỉ `.pager-btn:disabled` có, nên các chốt an
  toàn nhìn y hệt nút bấm được.
- Ẩn nút, **đừng** để bấm rồi báo lỗi — báo lỗi làm người dùng tưởng phần mềm hỏng. Nút bị chặn
  vì chốt an toàn thì làm mờ + hiện lý do khi rê chuột (`.hint-wrap`).

**Còn tồn đọng đã biết** (mục này đã được sửa ở 5.18 — giữ lại để hiểu bối cảnh): tab "Trang chủ"
hiện `0 khu vực / 0 hiện vật`.

⚠ **Đính chính**: mô tả cũ ở đây ("hiện 0 cho tới khi chuyển sang tab khác rồi quay lại") là
**SAI**. Đo lại bằng cách ghé lần lượt từng tab: `videos`, `static-content`, `ui-strings`,
`history`, `analytics` đều **không** chữa được — chỉ tab **Tìm kiếm** mới nạp `contentManifest`.
Nguyên nhân thật nằm ở `refreshContentViews()`: `if (contentManifest) loadContentManifest();`
chỉ tải lại khi *đã* tải rồi, mà lúc khởi động biến đó là `null` nên lời gọi không bao giờ chạy.

### 5.17. Email khôi phục cho tài khoản Chủ (2026-08-23)

Đường vào dự phòng thứ hai, **bổ sung chứ không thay thế** quy tắc hai tài khoản Chủ.

**Phạm vi cố ý rất hẹp — chỉ đúng một tình huống**: người làm Chủ quên mật khẩu của chính họ.
Nhân viên (Biên tập/Chỉ xem) quên thì Chủ bấm "Đặt lại mật khẩu" giúp, **không** cần email —
nhờ vậy hệ thống không phải giữ email của từng nhân viên. Thứ tự lấy lại quyền:
Chủ còn lại đặt lại hộ → mã 6 số về email → sửa tay trên máy chủ (lưới cuối).

⚠ **EMAIL GẮN VỚI CON NGƯỜI, KHÔNG GẮN VỚI CÁI GHẾ.** Nếu tài khoản Chủ được "bàn giao" qua
nhiều đời sếp thì hộp thư đó dần thành hộp thư dùng chung, và người đã nghỉ việc vẫn bấm
"quên mật khẩu" để vào lại — **đúng lại kịch bản mà chủ dự án đã bác ở mục 5.16**. Đổi sếp thì
TẠO tài khoản Chủ mới và KHÓA tài khoản cũ.

**Gửi thư bằng API HTTP của Brevo, không dùng SMTP** (`mailer.js`). Node 24 có sẵn `fetch` nên
**không thêm dependency nào** — server thật chạy Alpine/musl, thêm `nodemailer` là thêm một
bước `npm install` nữa trên máy chủ. Cổng 587 đã đo là mở (2026-08-23) nên SMTP cũng chạy được,
chỉ là không cần. Chưa cấu hình `MAIL_API_KEY`/`MAIL_FROM` thì tính năng **tắt hẳn** và giao
diện nói rõ là chưa cấu hình — cố ý, vì một cơ chế khôi phục hỏng im lặng còn tệ hơn không có.

**Mã 6 số, không phải đường link.** Bộ quét liên kết của Gmail/Outlook có thói quen tự mở thư
trước, "đốt" mất liên kết dùng-một-lần trước khi người thật kịp bấm — lỗi đó rất khó hiểu với
người không rành kỹ thuật. Mã sống 10 phút, sai 5 lần thì tự hủy, dùng xong là chết.

**Bốn chốt ở route công khai `POST /forgot`**: chỉ vai trò Chủ, đang dùng được, đã xác minh
email; trả lời **chung chung** để không lộ tên đăng nhập nào tồn tại; không gửi lại trong vòng
1 phút (chống biến thành công cụ dội thư); và **gửi thất bại thì trả 502 chứ không giả vờ thành
công** — bắt người dùng ngồi đợi một bức thư không bao giờ đến là kiểu hỏng tệ nhất.

**Đổi/gỡ email khôi phục bắt nhập lại mật khẩu hiện tại**, và mọi thay đổi đều **báo cho các
tài khoản Chủ còn lại** qua thư. Nếu không, ai ngồi vào máy đang mở sẵn trang quản trị 30 giây
là trỏ được đường khôi phục về hộp thư của họ mà không ai hay.

**`middleware/auth.js` nay đối chiếu lại với kho tài khoản trên từng request** thay vì tin hết
vào token. Trước đây khóa một tài khoản vẫn không đuổi được người đang mở sẵn trang, và hạ vai
trò phải đợi hết 8 tiếng. Với luồng khôi phục thì đó là lỗ hổng thật. `userStore.readAll()` đã
có cache theo `(mtime, size)` nên chi phí không đáng kể.

⚠ **Ba cái bẫy đã dính thật khi chạy thử, đừng lặp lại:**
- **`iat` của JWT chỉ có độ phân giải đến GIÂY.** So `iat * 1000` với `passwordChangedAt`
  (có mili giây) sẽ coi token vừa cấp SAU khi đổi mật khẩu là cũ hơn → người vừa đăng nhập
  bằng mật khẩu mới bị đá ra ngay. Phải so **theo giây ở cả hai vế**:
  `payload.iat < Math.floor(Date.parse(passwordChangedAt) / 1000)`. Đánh đổi: token cấp trong
  cùng giây với lần đổi mật khẩu vẫn sống — cửa sổ ≤1 giây, là giới hạn của chính định dạng JWT.
- **Giới hạn tần suất của "gửi mã" và "nhập mã" phải TÁCH RIÊNG.** Gộp làm một bộ đếm
  5 lần/giờ thì người gõ nhầm mã 2 lần là kẹt cứng giữa chừng, không hoàn tất nổi việc đang làm.
  Nhập mã đã có chốt chắc hơn nhiều: mỗi mã chỉ cho sai 5 lần rồi tự hủy.
- ~~Người TỰ đổi mật khẩu thì KHÔNG cắt phiên~~ — **ĐÃ ĐẢO NGƯỢC (2026-10-06)** theo yêu cầu chủ
  dự án: đổi xong mà bấm Back vẫn vào được trang quản trị. Nay `PUT /auth/password` cắt **mọi**
  phiên (kể cả phiên đang dùng), `admin.js` báo "Đang chuyển về trang đăng nhập..." rồi `logout()`
  để lại lời nhắn trong `sessionStorage.beacon_login_msg` cho `login.js` hiện. Không còn trông như
  phần mềm hỏng vì người dùng được báo trước. Kèm theo: `logout()`, chốt đầu `admin.js` và
  `login.js` dùng `location.replace()` (trang cũ không nằm trong lịch sử), và `admin.js` có
  `pageshow` kiểm lại token — Back khôi phục trang từ bfcache **không chạy lại script**.

**`appearance.js`** tách từ `admin.js` cùng đợt: đổi bảng màu + sáng/tối + đóng/mở menu tài
khoản, dùng chung cho `admin.html` và `users.html`. Trước đây nằm trong `admin.js` (~2700 dòng)
nên trang Quản lý tài khoản mất sạch cụm nút đó và bị ném về nền Tối.

⚠ `login.css` **bắt buộc** có `[hidden] { display: none !important; }` — `.login-card` đặt
`display:flex` sẽ đè lên thuộc tính `hidden`, đúng lỗi đã dính ở mục 5.16.

**Thẻ vai trò (`.chip`) phải là `inline-flex`.** Phần tử inline có padding trên/dưới **không
đẩy được chiều cao dòng**, nên viên thuốc "Chủ"/"Biên tập" tràn sang dòng bên cạnh khi dòng bị
xuống hàng.

### 5.18. Quy ước 401 vs 403 — sửa lỗi "bấm nút không có quyền là bị đá ra ngoài" (2026-08-23)

Phát hiện qua một đợt kiểm định chạy thật với cả ba vai trò. **Đây là lỗi do chính đợt 5.16 gây
ra**: khi thêm phân quyền, `403` có thêm nghĩa mới mà phía giao diện không được cập nhật theo.

**Triệu chứng**: Biên tập mở tab "Giao diện ứng dụng", sửa vài dòng, bấm "Lưu danh sách ngôn
ngữ" → trang nhảy thẳng về màn hình đăng nhập, không một chữ giải thích, mọi thứ vừa gõ mất
sạch. Tái hiện được với cả Biên tập lẫn Chỉ xem.

**Nguyên nhân**: `authFetch()` trong `admin.js` gộp `401` và `403` rồi gọi `logout()`. Cách viết
đó đúng khi hệ thống chỉ có một tài khoản — lúc ấy `403` chỉ có thể là token hỏng. Từ 5.16 thì
`403` mang nghĩa "không đủ quyền", hoàn toàn khác.

⚠ **QUY ƯỚC MÃ LỖI — GIỮ ĐÚNG NHƯ VẬY, HAI PHÍA PHỤ THUỘC LẪN NHAU:**

| Mã | Nghĩa | Giao diện làm gì |
|---|---|---|
| **401** | Phiên không còn dùng được: token hỏng/hết hạn, tài khoản bị xóa, **bị khóa**, mật khẩu vừa đổi | Đăng xuất, về trang đăng nhập |
| **403** | Đã xác thực được nhưng **không đủ quyền** | **Giữ nguyên trang**, hiện câu máy chủ trả về |

`middleware/auth.js` đã đổi: `jwt.verify` lỗi → **401** (trước là 403), thiếu `user_id` → 401,
tài khoản bị khóa → **401** (trước là 403 — nhưng bị khóa thì không việc gì trong trang còn dùng
được, phải đưa họ về trang đăng nhập; ở đó `POST /login` sẽ nói rõ "Tài khoản này đã bị khóa").
**Đổi lại chỗ nào trong bảng trên là hỏng chỗ kia**: trả 403 cho token hỏng thì người dùng bị
kẹt trong trang với thông báo lặp vô tận; trả 401 cho thiếu quyền thì lại bị đá ra như cũ.

**Phía `admin.js`**: có **hai** hằng số đánh dấu "lỗi đã báo cho người dùng rồi" —
`SESSION_EXPIRED` và `PERMISSION_DENIED` — và hàm `daBaoLoi(err)` gom cả hai. Mọi khối `catch`
dùng `if (!daBaoLoi(err))` thay vì so thẳng với `SESSION_EXPIRED` (33 chỗ). ⚠ Thêm lời gọi
`authFetch` mới thì khối `catch` **phải** dùng `daBaoLoi()`, nếu không sẽ ra hai thông báo chồng
nhau. Đường tải video qua `XMLHttpRequest` (`uploadVideoXhr`) cũng theo đúng quy ước này.

**Tab "Giao diện ứng dụng" nay mới thật sự phân quyền ở giao diện.** Trước đó Chỉ xem nhìn thấy
**307 ô nhập sửa được** và 4 nút Lưu; Biên tập thấy cả nút chỉ Chủ mới dùng được:
- khối thêm/xóa ngôn ngữ + nút "Lưu danh sách ngôn ngữ" → `data-need-role="owner"`
- nút "Lưu cấu hình nâng cao" + "Lưu chuỗi giao diện" → `data-need-level="editor"`
- nút xóa ngôn ngữ trong `renderLanguagesList()` cũng gắn `data-need-role="owner"`

⚠ Hai hàm vẽ động (`renderLanguagesList`, `renderUiStringsForm`) **phải gọi
`applyRoleVisibility()` ở cuối** — phần tử vừa tạo không đi qua lần quét lúc khởi động, quên là
`data-need-*` trong chuỗi HTML im lặng không có tác dụng.

Riêng Chỉ xem còn bị **khóa toàn bộ ô nhập** trong tab này (`readOnly`, radio thì `disabled`).
Ẩn nút Lưu là đủ để chặn, nhưng vẫn cho gõ thì người ta gõ xong cả trang mới phát hiện không lưu
được. Cố ý **chỉ** làm trong `#view-ui-strings`: các tab khác có ô tìm kiếm/lọc mà Chỉ xem vẫn
phải dùng được.

Đã kiểm chứng bằng Chrome với cả ba vai trò: Biên tập chạm vào 4 việc chỉ-Chủ (đổi ngôn ngữ,
nhập ZIP, xóa sao lưu, xem danh sách tài khoản) đều **ở nguyên trang** kèm đúng câu *"Tài khoản
của bạn (Biên tập) không làm được việc này..."*; token hỏng thì vẫn đăng xuất đúng; Chủ lưu
chuỗi giao diện vẫn báo thành công; 7 tab × 3 vai trò không lỗi JS/CSP nào.

### 5.19. Tương thích với `beacon-client` — hai chỗ lệch nhau (2026-08-23)

Kiểm bằng cách chạy thật: 280/280 test của app đều đạt, và đưa **đúng `content/manifest.json`
thật** vào `ManifestParser` của app. Hai phát hiện, đều **có từ trước**, không phải do đợt sửa nào.

**(1) Tải tiếp (resume) đã CHẾT hẳn — ĐÃ SỬA.** `version.json` trước đây trả `etag` là chuỗi
sha256 **trần, không có dấu nháy kép**. Đường đi của lỗi:
- `http_sync_transport.dart` lưu nguyên chuỗi đó vào `_lastEtag`, khi tải tiếp thì gửi lại y
  nguyên ở header `If-Range`.
- Thư viện `send` của Express kiểm `ifRange.indexOf('"') !== -1` để phân biệt ETag với ngày
  tháng. Chuỗi hex trần không có dấu nháy → bị hiểu nhầm là NGÀY → `parseHttpDate()` ra `NaN`
  → so sánh thất bại → server trả **200 kèm toàn bộ file** thay vì 206.
- App thấy 200 thì **xóa phần đã tải rồi tải lại từ đầu** (đúng như nó được viết).

Không ai báo lỗi, không có gì hỏng — chỉ âm thầm tải lại từ đầu **mỗi lần** rớt mạng. Với gói
10 MB thì không ai để ý; với kho cỡ GB (mức server đã được gia cố để chịu, mục 5.9) thì đây là
lỗi nặng.

Sửa trong `routes/staticContent.js`: `etag` trong `version.json` nay **có dấu nháy kép** đúng
chuẩn RFC 9110, và route bundle `res.setHeader('ETag', ...)` **trước** khi gọi `sendFile` (nếu
không, `send` tự sinh ETag yếu theo mtime+size và đè lên). Bám theo nội dung còn đúng hơn theo
mtime: đóng gói lại cùng một nội dung sẽ ra cùng ETag. **Sửa hoàn toàn ở server — không phải
dựng lại app trên tablet.** Đã mô phỏng đúng luồng của client: tải 3 MB → ngắt → tải tiếp →
**206**, ghép lại đủ 10.352.485 byte, sha256 khớp `version.json`, giải nén ra 129 mục.

**(2) ⚠ MỘT KHU VỰC RỖNG LÀM APP TỪ CHỐI CẢ GÓI — CHƯA SỬA, CẦN QUYẾT ĐỊNH.**
`ManifestParser._parseZone` coi khu vực không có hiện vật nào là lỗi **chí mạng cho cả bundle**:

```
BundleValidationException: zone "day-la-khu-vuc-5": exhibits must be non-empty
```

Trong khi `runIntegrityCheck` của server chỉ xếp nó là **`warning`** (`category: 'empty-zone'`)
và **vẫn cho đóng gói**. Hai bên hiểu khác nhau về cùng một tình huống, và bên chặt hơn lại là
bên không ai nhìn thấy.

`content/manifest.json` hiện **đang có** một khu vực như vậy (`major: 5`, tên `"day la khu vuc 5"`,
0 hiện vật, thêm ngày 16/08) và nó **đã nằm trong `bundleVersion` 2026.08.16-03 đang phục vụ**.
Bỏ khu vực đó ra thì app đọc sạch phần còn lại: 3 khu vực / 9 hiện vật, **không một cảnh báo nào**.

**ĐÃ XỬ LÝ CẢ HAI (2026-08-29):**
- Khu vực `major: 5` đã bị xóa khỏi `content/manifest.json` (dữ liệu thử: tên `"day la khu vuc 5"`,
  lời thoại `"ok ok ok"`), kèm 2 file media riêng của nó. `bundleVersion` đã tăng
  `2026.08.16-03` → `2026.08.29-01` — **bắt buộc**, nếu không thì `sha256` đổi mà máy đã đồng bộ
  vẫn không tải lại (bẫy ở mục 5.10). Bản sao lưu trước khi xóa nằm ở scratchpad của phiên đó.
- `empty-zone` nâng từ `warning` lên **`error`**, kèm câu giải thích nói thẳng hậu quả.
  Vòng lặp kiểm khu vực rỗng viết riêng trong `validateManifest()` đã bỏ đi vì trùng lặp.

⚠ **VÀ MỘT ĐIỀU QUAN TRỌNG HƠN: CỬA KIỂM TRA TRƯỚC ĐÂY GÁC NHẦM CỬA.**
`validateManifest()` chỉ được gọi ở `POST /admin/static-content/rebuild` — tức nút "Đóng gói dữ
liệu" bấm tay. Nhưng gói mà tablet **thật sự** tải về không đi qua nút đó: mọi thao tác ghi nội
dung đều gọi `bumpVersion()`, rồi lần `GET /version.json` kế tiếp tự động nén lại qua
`ensureBundle()` — và đường đó **không kiểm tra gì cả**. Nên dù có nâng `empty-zone` lên `error`
thì gói hỏng vẫn ra tới máy khách như thường.

Nay `GET /version.json` (`routes/staticContent.js`) gọi `validateManifest()` trước, có lỗi thì
trả **503** kèm danh sách vấn đề và ghi rõ vào log server. Kết quả cuối với tablet không đổi —
đã đối chiếu `content_sync_service.dart`: gặp bundle hỏng thì nó `_discard()` và **giữ nguyên
bản đang dùng**, máy vẫn chạy bình thường với nội dung cũ. Khác biệt là không bắt hàng chục máy
tải vài trăm MB về chỉ để vứt đi, và có dấu vết trong log để biết hỏng từ bao giờ.

→ Đây chính là lý do sự cố này im lặng suốt: máy tablet **vẫn chạy tốt** với nội dung cũ, nên
không ai ở bảo tàng nhận ra nội dung mới đã ngừng cập nhật.

**(3) Hai file ảnh trong manifest KHÔNG có thật trên đĩa, mà không lớp nào phát hiện.**
`exhibits[].images` trong manifest là **mảng chuỗi đường dẫn**, còn `runIntegrityCheck` lại đọc
`im.file` (tưởng là mảng **object**) → `checkFile(undefined)` thoát ngay → không báo gì. App thì
đọc đúng dạng chuỗi nên sẽ thật sự đi tìm 2 file đó:

```
images/exhibits/bang-da-thanh-nien-my-bieu-tinh-1970/detail-1.jpg
images/exhibits/bang-da-thanh-nien-my-bieu-tinh-1970/detail-2.jpg
```

Cả hai không tồn tại (thư mục chỉ có `main.jpg` + `thumb.jpg`). **ĐÃ SỬA phần phát hiện**: vòng
lặp `images` nay xử lý cả hai dạng (`typeof im === 'string' ? im : im?.file`), nên hai file này
hiện ra thành **cảnh báo** trong kiểm tra toàn vẹn. Cố ý để mức `warning` chứ không phải `error`:
app bỏ qua ảnh phụ hỏng mà không sập, chặn phát hành vì mấy tấm ảnh minh họa là phản ứng quá tay.
~~Hai file đó vẫn đang thiếu~~ — **đã chép lại từ `museum_server/src/images/exhibits/…` (2026-10-06)**.
Cùng đợt: câu cảnh báo nay ghi tên file + cách xử lý (trước đó in `""` vì dạng chuỗi không có
`originalName`), và CMS **hiện + xóa được** ảnh phụ dạng chuỗi (`renderMediaPanel` chuẩn hóa về
`{file}`, `handleGalleryImageDelete` so cả hai dạng) — trước đó dòng ảnh hiện tên rỗng và nút Xóa
luôn 404, nên người nhập liệu không tự gỡ tham chiếu hỏng được.

### 5.20. Mã xác thực 2 lớp cho tài khoản Chủ (2026-08-29)

Mô hình **giống AWS**: đăng nhập bằng tên + mật khẩu như thường, đúng rồi mới hỏi mã 6 số từ
ứng dụng xác thực (Google Authenticator / Microsoft Authenticator / bất kỳ app TOTP nào).

**Vì sao KHÔNG dùng "Đăng nhập bằng Google" (phương án ban đầu chủ dự án nêu):** nếu đăng nhập
bằng tài khoản Google **và** hạt giống Authenticator cũng đồng bộ lên chính tài khoản Google
đó, thì ai chiếm được tài khoản Google sẽ qua **cả hai** lớp — hai lớp tưởng độc lập hóa ra
cùng tựa vào một chân. Cách hiện tại giữ hai lớp thật sự tách rời: mật khẩu ở máy chủ này, hạt
giống trong điện thoại. Kèm theo: không phải dựng Google Cloud project, và **đăng nhập không
cần mạng ra ngoài** (Authenticator chạy ngoại tuyến).

⚠ **NGUYÊN TẮC XƯƠNG SỐNG: MỖI KÊNH CHỈ MỞ ĐƯỢC MỘT KHÓA.** Đừng phá vỡ nó khi thêm tính năng:

| Mất gì | Ai cứu | Route |
|---|---|---|
| Quên mật khẩu | Email đã xác minh | `POST /auth/forgot` |
| Mất điện thoại | **Tài khoản Chủ KIA** | `PUT /admin/users/:id/totp/reset` |
| Mất cả hai, Chủ kia cũng không dùng được | Lệnh SSH trên máy chủ | `scripts/cuu-ho-tai-khoan.js` |

Nếu để email đặt lại được **cả** mật khẩu **lẫn** mã thì ai chiếm hộp thư là qua sạch hai lớp,
và 2FA chỉ còn là hình thức. Vì vậy **cố ý KHÔNG có route nào** đặt lại mã bằng email. Đây cũng
là cách AWS làm (mất MFA thì quản trị viên gỡ hộ; tài khoản gốc thì đòi **cả** email lẫn số
điện thoại). Và đây là lý do quy tắc **hai tài khoản Chủ phải là hai NGƯỜI khác nhau** chuyển
từ khuyến nghị thành bắt buộc.

**`totp.js` tự viết, không thêm thư viện.** Thuật toán chỉ là HMAC-SHA1 trên số thứ tự khoảng
thời gian, mà `crypto` có sẵn. Đã đối chiếu **toàn bộ vector kiểm thử của RFC 4226 (10 vector)
và RFC 6238 (5 vector)** — 30/30 đạt. Cửa sổ chấp nhận ±1 khoảng (±30 giây) cho lệch đồng hồ
điện thoại; rộng hơn là kéo dài cửa sổ đoán mò.

**Phụ thuộc mới duy nhất: `qrcode-svg`** — thuần JS, **không kéo theo gói nào** (đã thử `qrcode`
trước, nó kéo cả `yargs` chỉ để chạy dòng lệnh nên bỏ). Mã QR sinh ra đã được **giải mã ngược
lại bằng jsQR** để chắc nó quét được thật, trùng khít từng ký tự — mã QR hỏng là kiểu lỗi chỉ
lộ ra lúc người dùng giơ điện thoại lên.
⚠ Phải `npm install` trên máy chủ sau khi deploy, nếu không `routes/auth.js` không nạp được.

**Năm chốt an toàn, mỗi cái vá một lỗ cụ thể:**
- **Vé tạm giữa hai bước** mang `purpose: 'mfa'`, sống 5 phút, và `middleware/auth.js` không
  chấp nhận nó. ⚠ Route `/login/mfa` **bắt buộc** kiểm `payload.purpose !== 'mfa'` — thiếu dòng
  đó thì một token đăng nhập thật (8 tiếng) cũng dùng được ở đây để xin token mới vô hạn.
- **Chống dùng lại mã**: `totpLastStep` ghi lại khoảng vừa dùng. Một mã sống 30 giây — trong
  khoảng đó ai nhìn trộm màn hình hoặc bắt được gói tin đều gửi lại y nguyên được.
- **Bật mã phải có email khôi phục trước** (409 nếu chưa). Không thì người ta tự khóa mình sau
  hai lớp mà không còn đường lấy lại mật khẩu.
- **Tự tắt mã phải có CẢ mật khẩu LẪN một mã đang hợp lệ.** Chỉ hỏi mật khẩu thì kẻ trộm được
  mật khẩu sẽ tự tắt 2FA rồi vào thoải mái — lớp thứ hai thành vô nghĩa.
- **Đang bật mã thì KHÔNG gỡ được email khôi phục** (`DELETE /recovery-email` trả 409, thêm
  2026-08-31). Chốt trên chỉ dựng bất biến "có mã ⇒ có email" lúc BẬT; không có chốt này thì gỡ
  email sau đó là phá vỡ nó, người dùng kẹt sau hai lớp mà không còn kênh nào tự lấy lại mật
  khẩu. Muốn **đổi** email thì dùng `POST /recovery-email` (không cần gỡ trước), nên chốt này
  không chặn việc gì hợp lệ. Thứ tự dọn dẹp đúng là: **tắt mã trước, gỡ email sau.**

**Đem code sang nơi khác dùng lại**: email và hạt giống mã là **dữ liệu trong `users.json`**,
không có gì nằm trong mã nguồn — xóa tài khoản là hết. Chuỗi thương hiệu duy nhất từng bị
hardcode là tên hiện trong ứng dụng xác thực, nay đọc từ `TOTP_ISSUER` trong `.env`
(mặc định `Beacon`). Đổi nó chỉ ảnh hưởng mã QR sinh ra **từ lúc đổi trở đi**.

**Nhân viên (Biên tập / Chỉ xem) KHÔNG dùng mã xác thực** — chủ dự án chốt. Tài khoản của họ do
Chủ tạo và Chủ đặt lại được bất cứ lúc nào, thêm lớp nữa chỉ làm khó mà không được thêm gì.

⚠ **Hai cái bẫy đã dính khi chạy thử:**
- `public/login.js`: chốt `if (!res.ok || !data.token)` cũ chạy **trước** nhánh `mfaRequired`,
  nên phản hồi hai bước (cố ý không kèm token) bị báo "Sai tài khoản hoặc mật khẩu" dù mật khẩu
  đúng, và ô nhập mã không bao giờ hiện. **Kiểm `mfaRequired` phải nằm TRƯỚC.**
- `public/users.js`: khối khởi động gọi `renderRecovery()` trực tiếp chứ không qua `loadMe()`,
  nên thêm `renderTotp()` vào `loadMe()` là chưa đủ — ô "Mã xác thực 2 lớp" đứng mãi ở
  "Đang tải...". Phải gọi ở **cả hai** chỗ.

**`.qr-wrap` nền TRẮNG cố định, không theo bảng màu** — camera điện thoại cần tương phản
đen-trắng thật; mã QR sẫm trên nền tối là không quét nổi.

**Đã kiểm chứng**: 34/34 phép thử API (gồm cả "email không đặt lại được mã", "Biên tập không
đặt lại được mã của Chủ", "không tự đặt lại mã của chính mình"), 19/19 phép thử giao diện (quét
QR thật bằng bộ giải mã), 17/17 hồi quy (3 vai trò × 7 tab, đường app `/version.json` +
`/bundle-*` + `/events` không đổi). Lệnh cứu hộ SSH đã chạy thử: gỡ mã và đặt lại mật khẩu đều
**có hiệu lực ngay, không cần restart** (`userStore` đọc lại theo `mtime`).

### 5.21. Sự thật về server thật (đã kiểm chứng 2026-08-02)

Hạ tầng thực tế, để phiên sau khỏi dò lại:

- **OS**: Alpine/BusyBox, init là **OpenRC** (`rc-service`, `rc-update`), **không có systemd**,
  **không có `sudo`** (đăng nhập thẳng root), **không có `ss`** — dùng `netstat -ltnp`.
- **Đường đi request**: `https://baotang.tapama.cloud` → nginx 1.28 (TLS bằng certbot, cert
  chung với `conquest.tokyo`) → `proxy_pass http://127.0.0.1:3000`. nginx CÓ set
  `X-Forwarded-Proto` nên `NODE_ENV=production` là đúng, không gây redirect vòng lặp.
  `cloudflared` có cài nhưng KHÔNG chạy và phục vụ site khác (`valider.site`) — không liên quan.
- **Server chạy bằng pm2** (7.0.3, cài global ở `/usr/local/lib/node_modules/pm2`), app tên
  `beacon-server`, đã `pm2 startup openrc` (`/etc/init.d/pm2` + `rc-update add pm2 default`) và
  `pm2 save`. **Tuyệt đối không khởi động bằng `nohup node server.js`** — sẽ chiếm port 3000 và
  làm app pm2 quay vòng chết với `EADDRINUSE` trong khi web vẫn `200`, cực khó nhận ra. Đã dính
  đúng lỗi này một lần.
- **Bẫy khi kill tiến trình**: nếu tiến trình được khởi động bằng `cd <dir> && node server.js`
  thì dòng lệnh của nó là `node server.js`, nên `pkill -f '/root/beacon_server/server.js'`
  **không khớp** và im lặng không giết gì cả. Luôn lấy PID thật từ `netstat -ltnp | grep ':3000'`
  rồi `kill <pid>`, đừng đoán pattern.
- **Cron**: có 2 cron daemon cùng cài — `crond` (BusyBox) chạy và là cái thực thi crontab của
  root, `cronie` ở trạng thái crashed (đã `rc-update del`). Job gia hạn cert
  (`0 3 * * * certbot renew --quiet && rc-service nginx reload`) đã xác nhận hoạt động bằng
  `certbot renew --dry-run`.
- **Đĩa**: 142GB, còn ~129GB trống — thoải mái cho import cỡ GB.

### 5.22. Mô hình 3D cho hiện vật + `media[]` (2026-09-09)

Đọc kèm `beacon-client/docs/3d-handover.md` — mọi hình dạng dữ liệu ở đây là **hợp đồng với
ứng dụng**, không phải lựa chọn của riêng máy chủ.

**⚠ VIỆC CẤP BÁCH ĐÃ XỬ LÝ: manifest cũ làm ỨNG DỤNG BẢN 3D TỪ CHỐI CẢ GÓI.** Nhánh
`epic/exhibit-3d-models` thay `image` + `thumbnail` + `images[]` bằng **`media[]`**, và thiếu
`media[]` thì hiện vật bị **bỏ hẳn** → khu vực rỗng → `BundleValidationException` → vứt cả
bundle. Đã kiểm chứng bằng cách đưa `content/manifest.json` thật vào bộ phân tích của nhánh đó:

```
BundleValidationException: zone "vu-khi-tu-tao-ben-tre": no valid exhibits survived
```

**Cách xử lý: manifest mang CẢ HAI hình dạng.** Giữ nguyên `image`/`thumbnail`/`images[]` cho
bản `main`, thêm `media[]` cho bản 3D. Cả hai bộ phân tích đều **bỏ qua khóa lạ**, nên một
manifest mang cả hai chạy đúng trên cả hai bản app — đã đo thật, mỗi bên **3 khu vực / 9 hiện
vật / 0 cảnh báo**.
⚠ **Chỉ được bỏ `image`/`thumbnail` sau khi TOÀN BỘ máy đã lên bản đọc `media[]`.** Bỏ sớm là
bản `main` (dùng `_reqPath('image')`) bỏ sạch hiện vật — hỏng theo đúng kiểu vừa mô tả.

**`media[]` là BẢN CHIẾU, không phải nguồn sự thật.** `writeManifest()` gọi `dongBoMedia()` sinh
lại toàn bộ trước mỗi lần ghi. Nguồn sự thật vẫn là `image` / `thumbnail` / `images[]` /
`model3dId` — các trường đơn giản mà biểu mẫu CMS đã biết sửa. **Đừng sửa `media[]` bằng tay ở
bất kỳ route nào**, nó bị ghi đè ngay. Đặt ở `writeManifest()` chứ không ở từng route là cố ý:
có 3 đường ghi hiện vật và sẽ còn thêm; bỏ sót một đường nghĩa là một hiện vật không có
`media[]`, và hậu quả là cả gói bị từ chối.

Thứ tự trong `media[]` là **ngữ nghĩa**: `media[0]` là sân khấu màn hiện vật, `media[1..]` là
lưới tư liệu. **Mô hình bắt buộc ở `media[0]`** — vuốt ngang trên mô hình là *xoay* nó nên cuộn
phim không lật trang được; bộ phân tích bỏ thẳng một `model` không đứng đầu.

**Mô hình KHÔNG nằm trong bundle.** Bundle tải nguyên khối: nhét vài chục MB `.glb` vào đó thì
sửa một dấu phẩy trong manifest là bắt cả đội máy tải lại hàng trăm MB. Ba đường mới ở **gốc
domain, CÔNG KHAI** (khách tham quan không có tài khoản — cùng lý do với `/version.json`):

| Đường | Việc |
|---|---|
| `GET /models.json` | danh mục: `id`, `file`, `sha256`, `bytes`, `turntable` |
| `GET /models/<id>/<sha12>.glb` | file mô hình, có Range/206 để tải tiếp |
| `GET /turntable/<id>/000.webp` | dải ảnh xoay 360° (chưa dựng, để dành) |

Tên file mang **12 ký tự đầu của băm** nên URL **bất biến** và cache được vĩnh viễn. Nếu để tên
cố định thì một proxy giữ bản cũ sẽ trả file cũ cho một sha mới → ứng dụng verify băm, thấy
lệch, vứt đi rồi tải lại → lặp mãi mãi. Triệu chứng sẽ là *"3D không bao giờ mở được"* mà không
lỗi nào hiện ra.

**⚠ CHỐT CHẶN NGÂN SÁCH NẰM Ở LÚC TẢI LÊN, VÀ PHẢI NẰM Ở ĐÓ.** `models3d.js` bóc file `.glb`
ra và từ chối nếu vượt trần. Không bộ dựng nào chữa được một mô hình quá nặng, và ghi trần vào
một trang tài liệu thì nhà thầu 3D có thể không đọc — chỗ còn từ chối được là nút Tải lên.

| Chỉ tiêu | Trần |
|---|---|
| **VRAM ước tính** | **≤ 110 MB** ← cổng chính — ⚠ nới từ 10 MB ngày 2026-10-04, xem §5.22d |
| Tam giác (tính cả instancing) | ≤ 150.000 |
| Material | ≤ 8 |
| Lệnh vẽ | ≤ 50 |
| Dung lượng `.glb` | ≤ 8 MB |

**Cổng chính là VRAM chứ không phải megabyte**: `DamagedHelmet.glb` nặng 3.6 MB trên đĩa mà ăn
106 MB VRAM — khuếch đại 30 lần. Công thức: `tổng pixel × 4 × 1.33` (RGBA8 + mipmap), là cách
GPU thật sự giữ texture. Tam giác nhân theo số lần mesh được đặt vào cảnh: 10 bản của một mesh
20k đắt đúng bằng một mesh 200k.
⚠ **WebP là chỗ đã từng bỏ lọt** (`glb_report.py` mục 44): `gltf-transform` xuất texture sang
WebP, hàm đọc kích thước không hiểu WebP thì tổng pixel ra 0 và một mô hình vượt trần **đi qua**
bài kiểm. `kichThuocAnh()` đọc cả PNG, JPEG, WebP (cả 3 biến thể VP8/VP8L/VP8X) — đã kiểm từng
định dạng.

**Ba chốt chống hỏng im lặng:**
- `model3dId` phải khớp `MODEL_ID_RULE` = `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. ⚠ Đây là chỗ
  **duy nhất** hai kho mã nguồn buộc phải đồng ý (`ManifestParser._modelIdRule`). Đã hỏng thật
  một lần: máy chủ xuất bản id có dấu cách, đối chiếu báo khớp, ứng dụng **lặng lẽ bỏ cả khối
  model** — khách đứng trước hiện vật, không có gì xảy ra.
- Gán một id không có trong kho → **404** ngay lúc gán, và `runIntegrityCheck` xếp mức **error**.
- Xóa mô hình còn hiện vật trỏ tới → **409** kèm tên các hiện vật đó.

**Không có trong đợt này**: dải ảnh xoay 360° (cần Chrome + `model-viewer` để render, `models.json`
tự bỏ khóa `turntable` khi thư mục trống nên thêm sau không phải sửa hợp đồng); ảnh poster riêng
cho mô hình (hiện mượn ảnh chính của hiện vật — luôn tồn tại nên không bao giờ sinh ra `media[0]`
hỏng). Việc tải/xóa mô hình **không vào nhật ký hoàn tác** (nhật ký bám theo manifest, mô hình
nằm ngoài) — xóa là mất, nên mới có chốt 409.

**⚠ Lỗi cũ bắt được khi chạy thử đợt này — `daBaoLoi()` TỰ GỌI CHÍNH NÓ:**

```js
function daBaoLoi(err) { return daBaoLoi(err) || err === PERMISSION_DENIED; }
```

Đợt sửa 401/403 (mục 5.18) thay hàng loạt `err !== SESSION_EXPIRED` thành `!daBaoLoi(err)` bằng
`sed`, và phép thay đó trúng luôn vào **thân của chính hàm** → đệ quy vô hạn. Hậu quả: mọi khối
`catch` gọi `daBaoLoi()` đều ném `RangeError: Maximum call stack size exceeded` thay vì trả
true/false, tức **cả đường xử lý lỗi hỏng ở 33 chỗ** — đúng cái mục 5.18 vừa dựng lên. Nó chỉ lộ
ra khi thật sự có 401/403, nên bài kiểm ở đợt đó (chạy với vai trò Chủ, không gặp lỗi quyền nào)
không chạm tới. Đã sửa thành `err === SESSION_EXPIRED || err === PERMISSION_DENIED` và kiểm lại
bằng Chrome với cả Biên tập lẫn Chỉ xem: mỗi vai trò đúng **1 thông báo, 0 exception**.

→ Bài học: một hàm được `sed` sửa hàng loạt thì **phải đọc lại chính định nghĩa của nó**.

### 5.23. Xem `.glb` trên CMS + đưa mô hình xuống tablet (2026-09-09)

Nối tiếp mục 5.22. Hai việc: **nhìn thấy** mô hình trước khi xuất bản, và **đưa được nó xuống
máy** mà không sửa một dòng nào trong `beacon-client`.

#### Bảy đường đưa `.glb` xuống máy — và vì sao chỉ ba đường dùng được

Điểm tựa duy nhất: **có file sẵn trên đĩa thì app KHÔNG chạm mạng**
(`model_provider.dart:127` — `if (await _store!.has(ref.sha256)) return …path`).

| # | Cách | Kết luận |
|---|---|---|
| 1 | Tải lên CMS, app tự lấy khi khách chạm | **Đang chạy.** Điểm yếu: lần chạm đầu cần mạng |
| 2 | Nạp sẵn vào thư mục app qua `adb` | **Dùng được** — `scripts/nap-mo-hinh-tablet.js` |
| 3 | Mồi cache bằng cách mở thử một lần | **Dùng được**, và là cách duy nhất chạy trên bản release chưa root |
| 4 | Dựng dải ảnh xoay trên máy chủ | Chưa làm — cần Chromium trên VPS. Làm thì thứ phải tải lúc chạm nhẹ đi 10 lần (0.8 MB thay vì 8 MB) |
| 5 | Máy chủ nội bộ trong LAN | **Loại** — sẽ chạy trên VPS, không có máy nội bộ |
| 6 | Nhét `.glb` vào APK làm asset | **Loại** — phải sửa `pubspec.yaml`, tức sửa `beacon-client` |
| 7 | Nhét `.glb` vào bundle `tar.gz` | **Loại** — app không có đường đọc mô hình từ bundle, và `_unpackTarGzStreaming` (`content_sync_service.dart:350-361`) từ chối mọi entry thoát khỏi thư mục đích lẫn symlink. Hành vi đó ĐÚNG, đừng tìm cách lách |

#### `scripts/nap-mo-hinh-tablet.js` — chỉ IN lệnh, không tự chạy `adb`

Máy chạy CMS không nhất thiết là máy cắm tablet. Ba hằng số phải khớp với app, sai một cái là
app vẫn tải lại từ mạng mà **không báo gì**:

```
/data/data/com.example.beacon_client/app_flutter/models/<sha256 đầy đủ, chữ thường>.glb
/data/data/com.example.beacon_client/app_flutter/models/turntable/<sha256>/000.webp …
```

- `app_flutter` **không phải** `files`: `path_provider_android` dùng `Context.getDir("flutter")`,
  mà `getDir()` tự thêm tiền tố `app_`.
- Trên máy chủ tên file là `<sha12>.glb` (để URL bất biến), **trên máy tablet phải là `<sha256>` đầy đủ** —
  đó là cái `ModelStore.fileFor()` đi tìm. Đổi tên khi đẩy, đừng copy nguyên tên.
- Thư mục dải ảnh khóa theo **sha256 của model**, không theo `id`. Và **thiếu một khung là app
  coi như không có** (`turntableFrames()` trả rỗng) — đẩy thì phải đẩy đủ.

⚠ **Nhánh root: `chown` và `restorecon` là BẮT BUỘC.** File do root tạo trong thư mục app thuộc
về root và mang nhãn SELinux sai; app chạy dưới UID riêng nên mở không được, và triệu chứng y hệt
như chưa nạp gì.

⚠ **`run-as` chỉ chạy với bản DEBUG.** `android/app/build.gradle.kts:28-34` — release ký bằng
khóa debug nhưng **không** `debuggable`. Ký bằng khóa debug ≠ debuggable, đừng nhầm hai thứ.

#### Khung xem mô hình trên CMS

Dùng chính `<model-viewer>` mà app dùng (`model_viewer_plus` chỉ là lớp bọc), nên cái người quản
trị thấy **là** cái khách sẽ thấy. Tự host ở `public/vendor/model-viewer/` — xem README trong thư
mục đó để biết nguồn và phiên bản đã ghim.

**Tự host chứ không gọi CDN**: thêm một CDN vào `script-src` là nới lại đúng lớp phòng vệ mà mục
5.14 vừa dựng lên, cho một tính năng dùng vài tháng một lần.

⚠ **PHẢI kèm cả `draco/` và `basis/`.** `model-viewer` không đóng gói sẵn bộ giải nén; mặc định
nó tải từ `www.gstatic.com` **lúc chạy**, và **chỉ khi** gặp mô hình thật sự dùng tới. CSP chặn
gstatic, nên nếu không trỏ lại thì: mô hình thường hiện bình thường, còn mô hình nén DRACO hoặc
texture KTX2 **không hiện ra mà không báo gì** — trong khi bảng ngân sách ở `models3d.js` lại
**khuyến nghị KTX2**, tức đúng loại nên dùng lại là loại sẽ hỏng.

⚠ **Đặt hai đường giải nén bằng `self.ModelViewerElement` TRƯỚC khi chèn script.** Trong
`model-viewer.min.js` có:

```js
const e = self.ModelViewerElement || {},
      h = e.dracoDecoderLocation || "https://www.gstatic.com/draco/versioned/decoders/1.5.6/";
DA.setDRACODecoderLocation(h);
```

Gán `MV.dracoDecoderLocation = …` **sau** khi nạp trông y như chạy được — không lỗi, không cảnh
báo — nhưng dòng trên xóa lại về gstatic. Đã mất một vòng gỡ lỗi vì đúng chuyện này: đọc lại thấy
nguyên chuỗi gstatic. `datDuongGiaiNen()` trong `admin.js` giữ lại làm lớp thứ hai, có **đọc lại
để xác nhận** và `console.error` nếu không ăn — vì một bản nâng cấp đổi tên thuộc tính sẽ làm
đường chính im lặng không có tác dụng.

**CSP chỉ phải nới đúng MỘT directive**: `connectSrc: ["'self'", 'blob:']`. `blob:` là URL do
chính trang này tạo, cùng gốc, không trỏ ra ngoài được. `script-src` vẫn là `'self'` trần. Đo
bằng Chrome: thiếu nó thì khung xem báo *"Refused to connect"* và ảnh sáng môi trường không nạp
được.

**Xem được TRƯỚC khi tải lên**: nút "Kiểm thử trước" nay kèm "Xem thử mô hình này", dựng bằng
`URL.createObjectURL(file)`. Đây mới là chỗ tiết kiệm nhất — con số nói mô hình nặng bao nhiêu,
nhưng chỉ nhìn mới biết có đúng hiện vật không, có bị lộn ngược không, có mất texture không. Xem
được cả file **vượt ngân sách** (để biết mình vừa chọn nhầm file nào) dù nó không bao giờ được
tải lên.

Đóng modal thì **gỡ hẳn** thẻ `<model-viewer>` và `revokeObjectURL`: để nó sống trong DOM là giữ
một ngữ cảnh WebGL cùng vài chục MB texture.

`.qr-wrap` ở `users.html` nền trắng vì camera cần tương phản; `#m3d-view-stage` nền sáng cố định
vì lý do khác — mô hình 3D được chiếu sáng theo môi trường, đặt trên nền tối thì chi tiết tối màu
chìm hẳn và người kiểm duyệt tưởng mô hình hỏng.

**Đã kiểm chứng** (Chrome headless, SwiftShader): 7/7 khung xem + 10/10 xem-thử-và-phân-quyền,
**0 vi phạm CSP, 0 exception**; Chỉ xem không thấy khối tải lên và nút Xóa nhưng **vẫn xem được**
mô hình. Hồi quy: `/version.json` 200 (etag có nháy kép), bundle 200 + **206** với `Range`,
`/events` 204, `meta.json` bị chặn 404, và **0 mục `models/` trong bundle**.

⚠ **Bẫy lúc chạy thử, không phải lỗi code**: Chrome headless của lần chạy trước còn sống và giữ
cổng gỡ lỗi, nên lần chạy sau **gắn vào tiến trình cũ** với `admin.js` trong bộ nhớ đệm — mọi
sửa đổi trông như "không có tác dụng". Luôn `ss -ltn` kiểm cổng gỡ lỗi và xóa `--user-data-dir`
trước mỗi lượt, hoặc bật `Network.setCacheDisabled`.

#### 5.22b. Đợt 2 — giao diện thêm/sửa/xóa, gán theo hiện vật, và vá bộ kiểm (2026-09-10)

⚠ **ĐÃ ĐỔI (2026-10-04): bỏ trang "Mô hình 3D" riêng, tải `.glb` ngay trong biểu mẫu hiện vật.**
Chủ dự án muốn thêm mô hình cùng lúc với thêm hiện vật. Giao diện mới (`admin.js`, khối "Mô hình 3D
NGAY TRONG biểu mẫu hiện vật"):
- Chọn file → `POST /admin/models/kham-thu` ngay. Bấm lưu mà file **chưa đạt** thì **không lưu gì**,
  kể cả hiện vật — lưu nửa vời thì người dùng không biết cái gì đã vào.
- Lưu hiện vật TRƯỚC (máy chủ đòi hiện vật đã tồn tại và có ảnh), rồi `guiMoHinhSauKhiLuu()`:
  `POST /admin/models` với mã tự đặt theo mã hiện vật (`taoMaMoHinh`, trùng thì `-2`, `-3`), rồi
  `PUT .../model`. Thay file thì `replace=1` trên **chính mã cũ**, nhưng CHỈ khi mô hình đó thuộc
  riêng hiện vật này; mô hình dùng chung (gán từ thời còn trang riêng) thì tạo mã mới, để không
  âm thầm đổi mô hình của hiện vật khác. Hỏng ở bước mô hình thì báo "Đã lưu hiện vật, nhưng chưa
  gắn được mô hình" để không ai nhập lại cả hiện vật.
- "Gỡ" chỉ `PUT .../model {modelId:null}`, **cố ý không xóa file**: hoàn tác thao tác gỡ (contentHistory
  không chụp `content/models/`) cần file còn đó. Hệ quả: mô hình bị gỡ/thay mã nằm lại trên đĩa,
  không còn giao diện để xóa. Mỗi file ≤ 8 MB nên chấp nhận được; cần thì xóa tay qua
  `DELETE /admin/models/:id` (máy chủ vẫn chặn nếu còn hiện vật dùng).
- API kho mô hình (`routes/adminModels.js`) **không đổi**.
- `#m3d-view-overlay` có `z-index: 210`: mở từ trong biểu mẫu hiện vật (cùng `.modal-overlay`
  z-index 200, đứng trước trong HTML) thì khung xem bị che mất — đã thấy trên ảnh chụp, bài thử
  chỉ kiểm "phần tử tồn tại" thì không bắt được.

Đã thử bằng Chrome headless trên bản sao dữ liệu: 24 ca (vượt ngân sách chặn lưu, thêm kèm mô hình,
thay tại chỗ, gỡ rồi lưu không 409, gắn lại, `/version.json` vẫn 200), 0 lỗi JS/CSP.

**Giao diện.** Tab "Mô hình 3D": thêm, **sửa** (đổi tên gợi nhớ, hoặc thay file), xóa, xem 3D, và
*Kiểm thử trước* + *Xem thử* file **chưa tải lên** (qua `blob:`). Biểu mẫu sửa hiện vật có ô chọn
mô hình, **lưu ngay khi đổi** (cùng kiểu ảnh phụ/audio phụ/video); khi *thêm* hiện vật mới thì ô
bị khóa kèm gợi ý "Lưu hiện vật trước". Popup chi tiết hiện vật hiện mô hình đã gán + nút Xem 3D.

**Sửa mô hình.** `PATCH /api/v1/admin/models/:id` chỉ đổi tên — không chạm file, `sha256` giữ
nguyên, tablet không tải lại. Thay file thì `POST /api/v1/admin/models` kèm **`replace=1`**, và
file mới phải qua lại bước kiểm ngân sách. ⚠ Trước đợt này route POST **ghi đè im lặng**: gõ trùng
mã với một mô hình đang được 5 hiện vật dùng là thay luôn cả 5. Nay tải trùng mã mà không có
`replace=1` → **409**. **Không cho đổi MÃ**: mã là khóa manifest trỏ tới và là tên thư mục trên đĩa.
Danh sách trả kèm `dungO` (hiện vật nào đang dùng) để giao diện hiện ra và để 409 khi xóa nêu tên.

**⚠ Cuộc đua "gán rồi bấm Lưu ngay" — đo được, đã vá.** `rev` của hiện vật băm cả `model3dId`,
nên lệnh gán làm đổi `rev`. Route gán nay trả `rev` mới và giao diện cập nhật `editingExhibitRev`.
Nhưng như vậy vẫn chưa đủ: nếu bấm Lưu trước khi phản hồi gán kịp về thì biểu mẫu gửi `rev` cũ →
**409 "người khác vừa sửa"** — mà người khác chính là họ. Nhật ký máy chủ ghi hai request cách
nhau **33 ms**. Đo trên code cũ: đổi ô chọn rồi Lưu cùng một nhịp → **5/6 lần 409**. Vá bằng cách
cho handler submit **chờ Promise của lần gán đang chạy** (`m3dGanDangChay`) trước khi đóng gói
`rev` — không chặn ai, chỉ xếp thứ tự. Đo lại: **0/6**. Trên VPS mạng chậm cửa sổ này dài vài
trăm ms, nên đây không phải lỗi lý thuyết.

**Ba lỗ trong bộ kiểm, bắt được khi đối chiếu với `museum_server/pack_models.py`:**
- **Không đọc được header KTX2** → mô hình toàn texture KTX2 có tổng pixel 0, VRAM 0, **đi lọt**
  cổng chặn. Nay đọc chữ ký `\xabKTX 20\xbb\r\n\x1a\n`, W/H ở offset 20/24.
- **Luôn tính RGBA8 (4 byte/px)** → mô hình KTX2 bị thổi phồng **4 lần** và bị từ chối oan (đúng ca
  tượng Phật `museum_server` từng dính: 5.3 MB, đạt, mà vẫn bị chấm trượt). Nay tính **theo từng
  texture**: KTX2 1 byte/px, còn lại 4 byte/px — chính xác hơn cả `pack_models.py` (bên đó đổi công
  thức cho *cả file* theo cờ extension, sai khi một mô hình trộn KTX2 với PNG).
  ⚠ Hai lỗi này **che nhau**: sửa lỗi đọc KTX2 mà không sửa công thức là bắt đầu từ chối oan hàng loạt.
- **Không kiểm extension.** Xem mục ngay dưới.

**⚠ Chính sách extension KHÁC `museum_server` có chủ ý.** Bên đó **bắt buộc** nén Draco. Nhưng
`git grep dracoDecoder\|ktx2Transcoder\|meshopt` trong `lib/` của nhánh 3D ra **rỗng** — app không
đặt đường dẫn bộ giải nén nào cho `model-viewer`. Nên trên tablet:
- **Draco, KTX2**: bộ giải nén tải từ `www.gstatic.com` **lúc mở mô hình**. Mất Internet là mô hình
  không hiện — trong khi cả mục tiêu là chạy được khi mạng chập chờn. ⇒ **cảnh báo**, không bắt buộc.
- **meshopt**: `model-viewer` **không có đường mặc định** (chỉ nạp khi nơi nhúng tự đặt
  `meshoptDecoderLocation`) ⇒ mô hình **không bao giờ dựng được**. Mà `gltf-transform optimize` dùng
  meshopt **theo mặc định** — rất dễ dính. ⇒ **chặn** khi nó nằm trong `extensionsRequired`, kèm lệnh
  xuất lại. Chỉ nằm ở `extensionsUsed` (có bản dự phòng) thì cho qua.
- `transmission` / `volume` / `clearcoat` ⇒ cảnh báo chi phí GPU.

Cảnh báo **không biến mất sau 4 giây**: chúng được lưu vào `meta.json` và hiện trên từng dòng kho.

**`/version.json` nay có `bytes`.** Nhánh 3D đọc trường này để kiểm chỗ trống trước khi tải
(cần ~3× gói + 200 MB). Thiếu thì điều kiện là `null` và bước kiểm **bị bỏ qua im lặng**.
`museum_server` có từ đầu; bên này thiếu.

**Khung xem 3D** dùng chính `<model-viewer>` (app dùng nó qua `model_viewer_plus`), **tự host** ở
`public/vendor/model-viewer/` kèm bộ giải nén Draco + KTX2 — xem `README.md` trong thư mục đó.
Nạp **lười** (chỉ khi bấm Xem lần đầu). ⚠ **ĐÍNH CHÍNH (2026-09-10):** bản trước ghi "0 vi phạm CSP,
`script-src 'self'` không phải nới chữ nào" — **SAI với mô hình nén Draco**. Bài thử khi đó chỉ dùng khối lập
phương KHÔNG nén; cả 4 mô hình thật của `museum_server` đều nén Draco và khung xem **không mở được cái nào**.
Đã sửa CSP — xem §5.22c. ⚠ Phải đặt `dracoDecoderLocation` /
`ktx2TranscoderLocation` **trước** khi chèn script; gán sau thì có lúc `customElements.get()` còn
trả `undefined` và thư viện lặng lẽ quay về gstatic (bị CSP chặn).

**Chưa làm** (khi viết mục này): dải ảnh xoay 360° và poster/thumb riêng — **đã làm ở §5.22c**, ngay trong CMS.

#### 5.22d. Nới trần VRAM 10 MB → 110 MB theo số đã đo (2026-10-04)

Chủ dự án tải `tuong phat.glb` (85.1 MB VRAM, 1 material, 92k tam giác) và bị chặn; họ cho rằng
tablet chạy nổi. **Số đo ủng hộ họ:** trên đúng máy thực địa (Helio A22, 1.79 GB, Android Go,
không Vulkan), `DamagedHelmet` bản gốc ~106 MB VRAM chạy **38 phút tự xoay liên tục — không LMK,
không throttle, PSS phẳng** (`beacon-client` nhánh `epic/exhibit-3d-models`:
`docs/3d-handover.md` §7, `docs/M0-baseline.md` §3–5; máy còn ~880 MB trống). 10 MB là mức an toàn
tự đặt, không phải giới hạn đo được.

Nay `BUDGET.vramBytes = 110 MB` (chặn). Có thử thêm một mức cảnh báo cam ở 32 MB (nóng máy/hao
pin — chưa đo) nhưng chủ dự án yêu cầu **bỏ**: giao diện chỉ báo "✓ Hợp lệ" / "✗ Chưa hợp lệ" kèm
lý do. Các cảnh báo cam khác (Draco cần Internet, kính/khúc xạ...) vẫn giữ, chỉ hiện khi file có. Trên 106 MB là vùng chưa ai đo — đừng nới thêm khi chưa đo
lại trên máy thật. App không tự kiểm VRAM (không có hằng số ngân sách nào trong `lib/`), nên trần
duy nhất là ở đây. Các trần khác giữ nguyên. Đã thử: `tuong phat.glb` tải lên 201, gắn vào hiện vật,
có trong `/models.json`, dải ảnh xoay dựng xong 24/24; con Mercedes vẫn bị chặn vì tam giác/material.

#### 5.22c. Học từ `museum_server`, cải thiện, đưa vào CMS: dải ảnh xoay + poster/thumb (2026-09-10)

Chủ dự án chốt hướng: **không chép `museum_server`, mà học, làm tốt hơn, rồi đưa vào CMS**. `museum_server`
(Python, không có git) là xưởng người phát triển app dựng để thử 3D; nó có đúng thứ CMS thiếu — dựng dải
ảnh xoay 360° và ảnh giữ chỗ. Nay CMS tự làm, **tải file lên xong là tự dựng**.

**Luồng:** tải `.glb` lên → xếp hàng (`turntableRenderer.js`) → Chrome headless mở
`public/render/turntable.html` từ chính máy chủ này → 24 khung 720² + thumb 400² → ghi
`content/turntable/<id>-<sha12>/` và `content/images/models/<id>/{poster,thumb}-<sha12>.webp` → nếu mô hình
đang được gán thì làm mới manifest + tăng `bundleVersion`. Giao diện hiện tiến độ `7/24`, tự làm mới 2 giây/lần.

| Học được từ `museum_server` | Chỗ còn hở ở đó (đã đo) | Trong CMS |
|---|---|---|
| Dựng bằng chính `<model-viewer>` (lớp mặt khớp lớp 3D), nền trong suốt | Phải bật máy chủ riêng cổng 8000, chạy tay, đóng gói model **lần hai** | CMS *là* máy chủ: tải lên là tự dựng, có tiến độ trên giao diện |
| Chờ điều kiện thật (`READY`), ép viewport | **Nạp lại trang + mô hình cho TỪNG khung** | Nạp 1 lần, `cameraOrbit` + `jumpCameraToGoal()`. Đo cùng phiên Chrome: **12.8 s vs 41.4 s (3.2×)**, khung **trùng từng bit** (PSNR ∞) |
| Khóa bán kính camera `max(kích thước)×1.9` | **Con số đó không có tác dụng**: đặt 1.9× rồi chờ 2 khung hình mà *không* `jumpCameraToGoal()` → camera mới lướt được một chút từ `auto`. Áp 1.9× THẬT thì tượng Phật **bị xén đầu và chân ở mọi góc** (PSNR so bản gốc chỉ 17–19 dB) | Dùng bán kính **`auto`** (theo khối cầu bao, không đổi theo góc). Hộp bao **trùng từng điểm ảnh** với dải của họ, PSNR 45–47 dB |
| Ẩn thanh tiến trình bằng CSS (nó bị nướng vào mọi khung) | Vá triệu chứng | Chụp bằng `toBlob()` của canvas — lớp DOM không bao giờ lọt vào |
| `source.json` giữ băm để phát hiện dải ảnh cũ | Thư mục đặt theo **id**, cache 1 giờ → dựng lại mà proxy giữ khung cũ thì app lưu khung cũ vào thư mục của bản mới (app KHÔNG verify từng khung) | Thư mục `turntable/<id>-<sha12>/` → URL bất biến, cache vĩnh viễn; **chỉ công bố khi `source.json` khớp băm file hiện tại** |
| Poster = khung 0 nguyên khổ; thumb = cắt sát vật | Cần ImageMagick, chạy tay, bump tay | Cắt trong trình duyệt (`OffscreenCanvas`) — **không cần ImageMagick**; poster **trùng từng byte** khung 0; tự bump |
| Cổng DevTools 9222 cố định | Đụng cổng khi chạy hai lần | `--remote-debugging-port=0`, đọc `DevToolsActivePort`; WebSocket có sẵn của Node 24 — **không thêm gói nào** |
| Đóng gói tất định (`pack_bundle.py`) | — | Áp vào `staticContentBundle.js`: danh sách file sắp xếp, `mtime` = 0, `portable`. Đo: chạm mtime 5 file thì cách cũ **đổi băm**, cách mới **giữ nguyên**; bung ra khớp 63/63 file |

**⚠ CSP phải nới đúng HAI chỗ — đo A/B với tượng Phật (Draco) thật** (`server.js`):

| CSP | Kết quả |
|---|---|
| gốc `script-src 'self'` | `Creating a worker from 'blob:…' violates … script-src` → **không bao giờ nạp xong, im lặng** |
| + `worker-src 'self' blob:` | Worker lên, nhưng `WebAssembly.instantiate() … violates … script-src` → vẫn không nạp |
| + `'wasm-unsafe-eval'` trong `script-src` | Nạp sau 0.69 s, 24 khung 720² có alpha |

`'wasm-unsafe-eval'` chỉ cho **biên dịch WebAssembly** — JS `eval()`/`new Function()` **vẫn bị cấm** (khác hẳn
`'unsafe-eval'`). three.js tạo worker giải nén Draco bằng `new Worker(URL.createObjectURL(…))`, nên cần `blob:`.

**Bảy chốt dễ sai nếu sửa lại:**
- Poster = khung 0 **nguyên khổ, không cắt**: app phủ dải ảnh lên poster bằng `BoxFit.contain`, lệch một pixel
  là vật nhảy đúng lúc dải ảnh sẵn sàng. Thumb thì **phải** cắt (lưới dùng `BoxFit.cover`).
- **Không cắt viền từng khung** (bài học `optimize_turntable.sh`): hộp bao đổi theo góc, cắt riêng từng khung
  là pho tượng phình to thu nhỏ khi xoay.
- Ghi dải ảnh vào thư mục **tạm** rồi đổi tên, `source.json` ghi trong thư mục tạm → dải ảnh chỉ "tồn tại"
  khi đủ 24 khung.
- File bị **thay trong lúc đang dựng**: kết quả bị vứt (so lại băm trước khi ghi) và tự dựng lại.
- **Thay file**: làm mới manifest *trước* (media[0] lùi về ảnh hiện vật + bump), *rồi* mới xóa poster cũ — không
  có lúc nào manifest trỏ tới file đã xóa; dựng bản mới hỏng thì hiện vật vẫn có poster hợp lệ.
- Poster/thumb của mô hình trong kho được đăng ký là **file đang dùng** trong bộ kiểm toàn vẹn (dù chưa gán) —
  nếu không, nút "xóa file mồ côi" sẽ dọn mất chúng.
- Chrome gọi thẳng cổng Node nên phải gửi `X-Forwarded-Proto: https` — thiếu thì ở production bị 301 sang
  `https://127.0.0.1:…`, nơi không có TLS.

**Cần trên máy chủ:** Chromium (`apk add chromium` trên Alpine, hoặc `CHROME_BIN` trong `.env`). Thiếu thì mô
hình **vẫn chạy** (app lùi về ảnh hiện vật làm poster) và tab Mô hình 3D nói rõ phải cài gì — cùng cách với ffmpeg
(§5.12). Dựng chạy MỘT việc một lúc (SwiftShader dựng WebGL bằng CPU). Đo trên máy dev: khối lập phương 5.7 s,
tượng Phật (Draco, 76k tam giác) 20 s tính cả khởi động Chrome.

**Đã kiểm bằng code THẬT của app** (nhánh `epic/exhibit-3d-models`): `ManifestParser` đọc manifest đầu ra
3 khu vực / 9 hiện vật / 0 cảnh báo, `media[0]` = `ModelMedia` trỏ đúng poster thật; `ModelRef.tryParse` +
`TurntableRef.tryParse` nhận `models.json` đầu ra, 0 cảnh báo. Bản `main` cũng 3/9/0. Thử đầu-cuối 26/26,
giao diện 16/16 (0 lỗi CSP, 0 exception, 8 tab, cả vai trò Chỉ xem).

**Chưa làm:** tối ưu `.glb` tự động (`gltf-transform`, như `server.sh --models` bên kia) — cần `npx` + mạng lúc
chạy trên VPS, và đổi file người ta tải lên mà không hỏi là quyết định cần chủ dự án chốt.

### 5.24. Nhiều bảo tàng + cài đặt gửi thư ngay trong CMS (2026-09-13)

Chủ dự án sẽ triển khai cho **khoảng 3 bảo tàng** và chọn mô hình **mỗi bảo tàng một bản chạy**
(cùng mã nguồn, khác tiến trình/cổng/tên miền/dữ liệu) — không gộp một máy chủ đa khách hàng:
gộp thì phải lọc theo bảo tàng ở mọi route và tablet phải gửi mã bảo tàng, tức sửa
`beacon-client`; một chỗ quên lọc là lộ dữ liệu chéo. Cách vận hành: `NHIEU_BAO_TANG.md`.

**`paths.js` là nguồn DUY NHẤT của mọi đường dẫn dữ liệu** (`CONTENT_DIR`, `DOWNLOADS_DIR`,
`TMP_IMPORT_DIR`, `USERS_PATH`, `MAIL_CONFIG_PATH`) và là chỗ nạp `.env`. `server.js` require nó
ĐẦU TIÊN. Thêm file dữ liệu mới thì khai báo ở đó — `path.join(__dirname, 'content')` viết thẳng
trong một module là bảo tàng B ghi vào dữ liệu của bảo tàng A.

⚠ Ba điều dễ sai:
- **`DATA_DIR` chỉ đến từ môi trường thật** (pm2 / Docker / dòng lệnh). `paths.js` đọc
  `DATA_DIR/.env` — nên không thể đặt `DATA_DIR` trong `.env`.
- **Chỉ nạp `.env` của đúng bảo tàng.** Trước đây `server.js` gọi `require('dotenv').config()`
  (đọc `.env` cạnh mã nguồn); giữ lại cả hai là trộn `JWT_SECRET` của bảo tàng này vào bảo tàng
  kia. `scripts/cuu-ho-tai-khoan.js` cũng đã bỏ dòng đó.
- **`pm2 restart beacon-<mã> --update-env` làm mất `DATA_DIR`** (lấy môi trường của shell đang
  gõ). `ecosystem.config.js` sinh app `beacon-<mã>` từ `bao-tang.json` kèm `DATA_DIR`, và
  `scripts/beacon.sh bat <mã>` luôn dùng `pm2 startOrRestart ecosystem.config.js --only …`.
  App cũ `beacon-server` giữ nguyên hành vi (dữ liệu cạnh `server.js`).

`scripts/tao-bao-tang.js` tạo thư mục dữ liệu (`.env` với `JWT_SECRET` mới + `PORT` +
`BIND_HOST=127.0.0.1`, manifest khởi đầu đủ các trường app `_req*` — `bundleVersion`,
`languages`, `fallbackLanguage`, `museum.name`, `beacon.{uuid,deskMajor,arbitration}`, `policies`),
ghi `bao-tang.json`, in mật khẩu Chủ đầu tiên một lần. Không ghi đè thư mục có dữ liệu, không nhận
cổng trùng. Cấu hình beacon được **chép** từ bảo tàng đang có — phần cứng khác UUID thì phải sửa.

**Tên bảo tàng = `museum.name` trong manifest** (`tenBaoTang.js`, cache theo mtime+size). Sửa ở
tab Giao diện ứng dụng (`GET/PUT /admin/content/museum`, có `bumpVersion()` — §5.10). Dùng cho:
`GET /api/v1/site` (công khai — trang đăng nhập chưa có token), tiêu đề trang + dòng dưới chữ
"Beacon" ở thanh bên (`appearance.js`, `login.js`), tên người gửi thư, tiêu đề mọi thư, và
`issuer` của mã TOTP khi `.env` không đặt `TOTP_ISSUER`. Chuỗi "Beacon" viết cứng trong
`routes/auth.js` đã thay hết.

#### Cài đặt gửi thư trong CMS — kiểu "Verified identities" của AWS SES

⚠ **ĐÃ ĐỔI (2026-10-04): CMS chỉ cài được Gmail.** Chủ dự án chỉ cần Gmail, nên hộp cài đặt bỏ
hẳn thẻ chọn nhà cung cấp và chỉ còn ô Gmail, mật khẩu ứng dụng, tên người gửi (`oGmail()` trong
`public/users.js`). `POST /admin/mail/xac-minh/gui` trả 400 với mọi `provider` khác `gmail`.
**Cố ý giữ** code gửi của SES/SMTP/Brevo trong `mailer.js`/`smtp.js`: một `mail.json` loại khác đã
lưu từ trước, hoặc `MAIL_API_KEY` trong `.env`, vẫn gửi được, để máy chủ đang chạy không hỏng.
Phần mô tả bên dưới vẫn đúng về cơ chế xác minh, chỉ có danh sách nhà cung cấp trên giao diện là
đã thu về một. App (`beacon-client`) không dùng tới gửi thư ở đâu cả.

Trước đây chỉ cấu hình được qua `MAIL_API_KEY`/`MAIL_FROM` trong `.env` (Brevo) — người không
rành kỹ thuật không tự làm được, và giao diện chỉ báo "thiếu … trong .env". Nay ô **"Gửi thư của
hệ thống"** trên trang Quản lý tài khoản (chỉ Chủ, `routes/adminMail.js`) cho chọn **Gmail,
Amazon SES, SMTP khác, Brevo**.

**Cài đặt chỉ được bật SAU KHI mã 6 số gửi bằng CHÍNH nó tới được hộp thư**: `POST
/admin/mail/xac-minh/gui` gửi thử và giữ cấu hình trong **bộ nhớ** (mật khẩu chưa được chứng minh
đúng thì không chạm đĩa), `POST /admin/mail/xac-minh` nhập mã rồi mới ghi `DATA_DIR/mail.json`
(quyền 600). Nhờ vậy sai mật khẩu ứng dụng Gmail, SES còn sandbox, địa chỉ gửi chưa được xác minh…
lộ ra lúc cài, không phải đúng hôm có người quên mật khẩu. Vẫn giữ **mã 6 số chứ không phải
đường link** — lý do ở §5.17 (bộ quét thư đốt link dùng một lần).

⚠ **Đây là chỗ nhạy cảm**: thư khôi phục mật khẩu của MỌI tài khoản Chủ đi qua cấu hình này, nên
một Chủ trỏ nó về máy chủ thư của mình là đọc được mã khôi phục của Chủ kia. Vì vậy: đổi/tắt đòi
nhập lại mật khẩu, và báo cho các Chủ còn lại (`mailer.baoChoChuKhac`, chuyển từ `auth.js` sang).
Tắt thì báo TRƯỚC rồi mới xóa. Ô mật khẩu để trống = dùng lại bí mật cũ, nhưng **chỉ khi cùng nhà
cung cấp, cùng máy chủ, cùng tài khoản** (`chuanHoa`) — đổi máy chủ mà tái dùng mật khẩu cũ là
gửi mật khẩu đó tới máy lạ.

`.env` vẫn thắng nếu có `MAIL_API_KEY`/`MAIL_FROM`: CMS chỉ hiện, không cho sửa (409). Máy chủ
đang chạy bằng `.env` không bị đổi hành vi.

**`smtp.js` tự viết (~200 dòng, chỉ `net` + `tls`)** — giữ quyết định "không thêm thư viện gửi
thư" của §5.17. Cổng 465/2465 bắt tay TLS ngay; 587/2587 **bắt buộc** STARTTLS — máy chủ không
có thì dừng TRƯỚC `AUTH`. Không nhận cổng 25. Chứng chỉ luôn được kiểm, không có tùy chọn tắt.
Tiêu đề/tên có dấu mã hóa RFC 2047 (cắt theo ký tự, ≤45 byte mỗi khúc); CR/LF bị bỏ khỏi mọi
giá trị đi vào header. Lỗi được dịch theo **bước** thất bại (`loiDeHieu`): Gmail sai mật khẩu →
nhắc mật khẩu ứng dụng; SES → nhắc "SMTP credentials, không phải Access key IAM", Verified
identities, sandbox.

Đã kiểm với máy chủ SMTP giả có TLS thật: 465 và 587 gửi được, tiêu đề/tên/thân giải mã lại
trùng khít; không STARTTLS → dừng trước `AUTH` (nhật ký máy giả không có dòng `AUTH`); sai mật
khẩu / địa chỉ gửi / địa chỉ nhận / chứng chỉ tự ký → đúng từng bước; chèn `\r\nBcc:` qua tiêu đề
→ không ra header mới. **Chưa kiểm với Gmail/SES thật** — cần tài khoản thật của chủ dự án.

**Gộp "cài gửi thư" + "đặt email khôi phục" (2026-09-15).** Trước đó, khi chưa gửi được thư, ô
Email khôi phục chỉ hiện cảnh báo, không có nút — người mới chỉ có một tài khoản Chủ tưởng tính
năng không tồn tại. Nay ô đó có nút mở hộp cài gửi thư kèm dấu tích `lamEmailKhoiPhuc` (mặc định
bật khi chưa có email). Cờ này được giữ **phía máy chủ** trong `dangCho` từ bước gửi mã, và
`POST /admin/mail/xac-minh` đặt `recoveryEmail = guiToi` sau khi nhập đúng mã. An toàn tương đương
`/auth/recovery-email`: đã hỏi lại mật khẩu ở bước 1, mã chứng minh mở được hộp thư đó. Có cờ mà
để trống ô nhận mã → 400 (không được rơi về `cfg.from` — đó là hộp thư chung của hệ thống).

**Đổi tên tài khoản: `PUT /admin/users/:id/identity` `{name, login}`** (chỉ Chủ, đổi được cả chính
mình). An toàn vì mọi thứ bám theo **id**: middleware tra `user_id` trong token (không dùng `sub`
= login), nhật ký/quyền hoàn tác dùng `userId`. Trùng tên đăng nhập so không phân biệt hoa thường
→ 409. Đổi login của một Chủ thì `baoChoChuKhac` (login là nửa đầu của đường Quên mật khẩu). Đã
thử 30 ca API + đi hết luồng trên Chrome headless, 0 lỗi JS/CSP.

`backup-content.sh` nay nhận `DATA_DIR` + `TEN` (tiền tố tên file) và sao lưu thêm `mail.json`.
`docker-entrypoint.sh` bỏ qua trò chép `users.json` khi có `DATA_DIR` (mọi thứ đã nằm trong volume).

### 5.25. Đợt sửa UX/UI theo bản kiểm định 35 tiêu chí (2026-09-16)

Xuất phát từ một lượt chấm điểm UX/UI chạy thật (bản sao dữ liệu riêng, 3 vai trò, Chrome
headless): **98/175 — 56%**. Điểm mạnh nằm ở an toàn dữ liệu (hoàn tác, xác nhận, kiểm tra toàn
vẹn, nhật ký); điểm yếu tập trung ở hiệu suất thao tác và khả năng tiếp cận. Đợt này làm 8 việc
"nhỏ, tác động lớn" — **toàn bộ nằm trong `public/`, KHÔNG đụng route nào, nên không cần restart**,
chỉ cần tải lại trang (hard-refresh nếu trình duyệt cache JS cũ — xem mục 5.3).

**1. Tìm kiếm bỏ dấu** (`admin.js`, hàm `khongDau()`). Trước đây so chuỗi bằng `toLowerCase()`
thuần nên `"may bay"` ra **0 kết quả** dù kho có 4 hiện vật "máy bay", `"sung"` ra 0 còn `"Súng"`
ra 2. Người Việt gõ nhanh hay bỏ dấu → tưởng hiện vật chưa có rồi **nhập trùng**. Nay chuẩn hóa
`NFD` + bỏ dải `̀-ͯ` cho **cả từ khóa lẫn dữ liệu**. ⚠ `đ/Đ` KHÔNG nằm trong dải dấu
thanh của NFD nên phải thay riêng — thiếu dòng đó thì "do dung" vẫn trượt "đồ dùng".

**2. Trang chủ hết báo 0 khu vực / 0 hiện vật.** Đây là mục "còn tồn đọng" ở 5.16 nay mới sửa
tận gốc: `bootstrap()` gọi `refreshContentViews()`, mà hàm đó có `if (contentManifest)
loadContentManifest();` — chỉ tải lại khi ĐÃ tải, trong khi lúc khởi động biến đó là `null`. Nay
`bootstrap()` `await loadContentManifest()` trước `renderHome()`. Kèm theo: `renderHome()` hiện
**"—"** khi chưa có manifest thay vì `0`, vì số 0 trông y hệt "kho rỗng" nên người dùng tưởng mất
sạch dữ liệu.

**3. Vai trò Chỉ xem không còn thấy nút ghi.** `renderZoneRow()` và `loadExhibitsPage()` dựng nút
"+ Hiện vật"/sửa/xóa bằng JS mà **không gắn `data-need-level`** → Chỉ xem nhìn thấy 9 nút ghi, bấm
Xóa còn mở được hộp xác nhận *"Xóa khu vực … Có thể hoàn tác"* rồi mới nhận 403. Nay cả 5 nút có
`data-need-level="editor" hidden` và **hai hàm vẽ đều gọi `applyRoleVisibility()` ở cuối** — đúng
cái bẫy đã ghi ở 5.18, lần này dính ở tab Quản lý thay vì tab Giao diện ứng dụng.
Thêm **lớp phòng vệ thứ hai**: bảng `ACTION_MIN_LEVEL` trong bộ điều phối `data-act` — nút nào sau
này quên gắn thuộc tính thì vẫn bị chặn ngay khi bấm, không mở hộp xác nhận.

**4. Esc / × / bấm nền không còn xóa trắng form đang sửa.** Ba đường đó gọi thẳng
`resetContentZoneForm()` / `resetExhibitForm()`, nên form 33 ô cao 2.696 px vừa gõ biến mất không
một lời hỏi. Nay có cờ `zoneFormDirty` / `exhibitFormDirty` (bật bởi sự kiện `input`/`change`) và
`dongFormKhuVuc()` / `dongFormHienVat()` hỏi bằng `confirmDialog` trước khi bỏ.
⚠ Mốc "sạch" đặt trong `openZoneModal()` / `openExhibitModal()` chứ không trong hàm reset: cả hai
luồng (thêm mới và sửa) đều **điền form bằng mã TRƯỚC rồi mới mở**, mà gán `.value` bằng mã không
sinh sự kiện `input` nên không bị tính là bẩn. Nút "Hủy" **cố ý** vẫn đóng thẳng — đó là ý định rõ ràng.

**5. Điện thoại có lối điều hướng trở lại.** Dưới 780 px `admin.css` đặt `.sidebar { display: none }`
và **không có gì thay thế** — vào trang chủ rồi là mắc kẹt (đo ở 390 px: 0 mục menu). Nay thanh bên
thành ngăn kéo `position: fixed` + `translateX(-100%)`, mở bằng nút `#menu-toggle` (☰) trên thanh
đầu, đóng bằng nền mờ `#sidebar-backdrop` / Esc / chọn xong một tab.
⚠ **Luật `.menu-toggle { display: none }` phải đứng TRƯỚC media query bật lại nó.** Đã dính đúng
lỗi này: đặt luật nền ở cuối file thì nó đè ngược media query (cùng độ ưu tiên, cái sau thắng) và
nút không bao giờ hiện, dù JS chạy đúng.

**6. Ba mã màu đạt WCAG AA.** `--muted` `#7a6e5e → #8b7d6b` (nền tối, 3.74 → 4.64) và
`#8a7c60 → #756952` (nền sáng, 3.57 → 5.39). Quan trọng hơn: thêm token **`--accent-text`** tách
màu-nhấn-làm-CHỮ khỏi màu-nhấn-làm-NỀN, vì ở giao diện sáng `--gold` dùng làm chữ chỉ đạt **2.03:1**
(36 quy tắc CSS: breadcrumb, "Xem tất cả", "+ Thêm dòng"…). Nền tối `--accent-text: var(--gold2)`
nên đổi bảng màu vẫn tự đúng; nền sáng đặt `#916215` và 4 bảng màu sáng lấy theo `var(--gold2)` của
chính nó. ⚠ Phép thay dùng lookbehind `(?<![-\w])color:` để **không** trúng `border-color`/
`background-color`. Cỡ chữ gợi ý 11,5 → 13 px, nhãn menu 11 → 12 px.

**7. Bàn phím tới được menu tài khoản.** 4 nút trên thanh đầu là `<div tabIndex=-1>` → **không
đăng xuất và không đổi mật khẩu được bằng bàn phím**. `theme-toggle` nay là `<button>` thật; ba cái
còn lại (bảng màu, thông báo, tài khoản) **buộc phải giữ `<div>`** vì bên trong chứa panel có nút
con, mà nút lồng trong nút là HTML không hợp lệ — bù bằng `role="button" tabindex="0"
data-nut-ban-phim` + xử lý Enter/Space trong `appearance.js`.
⚠ Panel đóng trước đây chỉ `opacity: 0; pointer-events: none` nên **vẫn nằm trong thứ tự Tab**: bấm
Tab là focus rơi vào các nút bảng màu VÔ HÌNH. Phải thêm `visibility: hidden` mới thật sự đưa chúng
ra khỏi thứ tự Tab. Thêm `:focus-visible` viền rõ cho nút/ô nhập.

**8. Danh sách khu vực lên đầu tab Quản lý.** Trước đó 4 khối công cụ vài-tháng-dùng-một-lần (nhập
ZIP, sao lưu, đóng gói, kiểm tra toàn vẹn) chiếm hơn 1.000 px phía trên, việc hằng ngày nằm dưới cùng.

**Hai lỗi người dùng báo, đã xử lý:**
- **Nút "Sao chép" mật khẩu không hoạt động** (`users.js`). Nguyên nhân: `navigator.clipboard` CHỈ
  tồn tại ở ngữ cảnh an toàn (HTTPS hoặc localhost) — vào CMS qua IP LAN kiểu
  `http://192.168.1.18:8000` thì nó là `undefined`, code cũ gọi thẳng `.writeText()` nên ném lỗi, rồi
  **khối `catch` RỖNG nuốt mất**: bấm nút không có gì xảy ra và cũng không báo gì. Nay có
  `chepVaoClipboard()` với bản dự phòng `document.execCommand('copy')` và **luôn nói rõ kết quả**
  (đổi nhãn nút + toast hướng dẫn bôi đen rồi Ctrl+C nếu trình duyệt vẫn chặn).
- **"Chưa có chức năng đổi tên đăng nhập"** — thực ra **đã có** từ 15/09 (nút "Đổi tên" trên từng
  dòng ở trang Quản lý tài khoản → `PUT /admin/users/:id/identity`, xem 5.24). Nếu máy chủ thật
  không thấy nút thì là **chưa deploy bản đó**, không phải thiếu tính năng.

**Đã kiểm chứng** (bản sao dữ liệu riêng, cổng 8124, Chrome headless): tìm kiếm không dấu ra đúng
2/4/4 kết quả; Trang chủ hiện 3 khu vực / 9 hiện vật; Chỉ xem còn **0** nút ghi và bấm ép vào nút ẩn
thì không mở hộp xác nhận, chỉ ra thông báo thiếu quyền; Esc khi đang sửa hiện hộp "Thoát mà không
lưu", bấm Hủy thì form còn nguyên, còn khi chưa gõ gì thì Esc đóng thẳng không hỏi; ở 390 px thanh
bên nằm ngoài màn hình (x = −262…0) và bấm ☰ trượt vào (x = 0…262), chọn tab xong tự đóng; chữ gợi ý
đo được **4.64:1 — đạt AA**; Tab đi hết 9 mục menu rồi tới đủ 4 nút thanh đầu, **không** lọt vào bảng
màu đang ẩn, Enter mở được menu tài khoản. Không lỗi JS/CSP nào (chỉ có 404 `favicon.ico` vô hại).

**Chưa làm** (các mục lớn hơn trong bản kiểm định, đã xếp ưu tiên): thao tác hàng loạt + xuất/nhập
CSV cho bản dịch (điểm D2 = 0, nặng nhất khi kho lên 3.000 hiện vật), Trang chủ kiểu "việc cần làm",
chia tab cho form hiện vật 33 ô, thang chữ/khoảng cách, gắn nhãn cho 37 ô nhập còn thiếu.

### 5.26. Nhật ký thao tác tài khoản + nhắc/báo khi đổi tên đăng nhập (2026-09-16)

Xuất phát từ câu hỏi của chủ dự án: *"cho đổi tên đăng nhập của nhân viên thì có bảo mật không?"*.
Kết luận sau khi đọc mã: **bản thân việc đổi tên an toàn** — chỉ Chủ đổi được (`requireLevel(owner)`
ở cổng router), danh tính bám theo UUID (token luôn có `user_id`; `LOGIN_RE` tối đa 32 ký tự nên
không bao giờ trùng một UUID 36 ký tự, đường dự phòng `payload.sub` trong middleware không giả được
id người khác), và chỉ nhận `a-z0-9._-` nên không giả dạng bằng chữ Unicode. Nhưng nó **làm lộ
một lỗ hổng thật ở chỗ khác**, nên làm ba việc:

**1. `accountAudit.js` — nhật ký thao tác tài khoản.** Trước đây tạo / đổi tên / đổi vai trò / khóa /
đặt lại mật khẩu / gỡ mã / xóa tài khoản **không để lại dấu vết nào**. Kịch bản thật: dùng tài khoản
Chủ đặt lại mật khẩu của nhân viên "lan", đăng nhập vào, xóa hiện vật → nhật ký NỘI DUNG ghi "lan"
đã xóa và không cách nào chứng minh ngược lại. Nay mỗi thao tác ghi một dòng NDJSON vào
`DATA_DIR/account-audit.ndjson`: thời điểm, `actor`, `target` (chỉ id/name/login/role), `detail`
(giá trị cũ → mới), `ip`. Xem ở khung **"Nhật ký tài khoản"** trên `users.html` (`GET
/admin/users/audit`, chỉ Chủ), thao tác nhạy cảm có vạch đỏ.

Ghi ở 9 chỗ: 7 route trong `routes/adminUsers.js` + `PUT /auth/password` (tự đổi) +
`POST /auth/forgot/verify` (đặt lại qua email — `actor` là chính chủ vì chưa đăng nhập).
⚠ **Chưa ghi**: bật/tắt mã TOTP, đặt/gỡ email khôi phục, đổi cài đặt gửi thư (các việc này đã có
thư báo cho Chủ khác, nhưng chưa vào nhật ký), và đăng nhập thành công/thất bại.

Bốn quyết định cố ý — **đừng "sửa" lại**:
- **NGOÀI `content/`**, cùng lý do với `users.json` (§5.16): nhập ZIP và khôi phục sao lưu thay
  thế cả `content/`. Đã thêm vào `paths.js` (`ACCOUNT_AUDIT_PATH`), `.gitignore` và vòng `EXTRA`
  của `scripts/backup-content.sh`.
- **Chỉ ghi thêm, KHÔNG có route xóa/sửa.** Chủ vẫn xóa được file qua SSH, nhưng không xóa được dấu
  vết bằng chính tài khoản web vừa bị chiếm.
- **Ghi thất bại KHÔNG chặn thao tác**, chỉ `console.error` ra log pm2 kèm nguyên dòng. Đĩa đầy mà
  chặn luôn việc đặt lại mật khẩu là tự khóa bảo tàng ra ngoài.
- `nguoi()` **chép đúng 4 trường** chứ không chép nguyên object tài khoản — đưa nhầm object vào là
  `passwordHash`/`totpSecret` nằm trong file nhật ký. Mật khẩu mới do Chủ đặt lại **không bao giờ**
  vào `detail`.

Khóa một tài khoản đang khóa sẵn **không ghi dòng thừa** (so `Boolean(target.locked) !== locked`).
⚠ Trong `users.js` mọi giá trị nhật ký đi qua `escapeHtml()` vì chèn bằng `innerHTML` — tên tài
khoản là dữ liệu người gõ vào.

**2. Cảnh báo trong hộp "Đổi tên tài khoản"** (`users.js`, `modalRename`). Cách dùng sai hay gặp nhất:
nhân viên nghỉ, Chủ đổi tên tài khoản của họ cho người mới → **toàn bộ lịch sử chỉnh sửa của người cũ
hiện dưới tên người mới**. Khung cảnh báo nói thẳng: chỉ dùng để sửa tên gõ sai; người khác tiếp
quản thì tạo tài khoản mới + khóa tài khoản cũ. Hiện **cả khi tự đổi tên mình** — cùng nguyên tắc
"gắn với con người, không gắn với cái ghế" ở §5.17.

**3. Báo cho người bị đổi tên đăng nhập** (`thongBaoDoiTen` trong bản ghi tài khoản). Route
`identity` đặt `{tu, sang, boi, luc}`; `GET /auth/me` trả về cho **chính chủ** (không có trong
`publicView`, nên danh sách tài khoản không lộ); `admin.js` `hienThongBaoDoiTen()` hiện băng ở đầu
trang tới khi bấm "Đã hiểu" (`POST /auth/me/da-doc-thong-bao`), không tự biến mất như toast.
- Đổi nhiều lần trước khi họ kịp xem → giữ tên **gốc** ở `tu`; đổi về đúng tên gốc → bỏ thông báo.
- Tự đổi tên mình → không báo chính mình.

⚠ **GIỚI HẠN CÓ THẬT — thông báo KHÔNG thay được việc Chủ báo trực tiếp.** Người bị đổi tên không
đăng nhập được bằng tên cũ, nên nếu đã đăng xuất thì họ không bao giờ thấy băng này cho tới khi có
người cho biết tên mới. Băng chỉ tới được người **đang còn phiên** (phiên bám theo id nên không bị
cắt khi đổi tên), hoặc người đã được báo tên mới rồi đăng nhập lại. Vì vậy hộp đổi tên vẫn nhắc
in đậm *"Người này sẽ KHÔNG đăng nhập được bằng tên cũ — hãy báo tên mới cho họ"*.
Cố ý **không** gợi ý tên mới ở màn hình đăng nhập khi gõ tên cũ: làm vậy là lộ cho người lạ biết
tên cũ từng tồn tại và tên mới là gì.

**Đã kiểm chứng** (bản sao dữ liệu riêng, cổng 8125): **28/28 phép thử API** — ghi đúng từng loại
thao tác và đúng người làm; IP thật (đã bỏ `::ffff:`); khóa lần hai không ghi thừa; mật khẩu mới và
mọi hash **không** có trong file; xóa rồi vẫn tra được `@tên`; phiên cũ sống sau khi bị đổi tên và
`/me` trả đúng thông báo; đăng nhập bằng tên cũ thất bại, tên mới thành công; đổi 2 lần giữ tên gốc;
đổi về tên gốc tự bỏ thông báo; "Đã hiểu" xóa được; Chủ tự đổi tên không tự báo mình; Biên tập đọc
nhật ký → 403, không token → 401, `DELETE /audit` bị từ chối; file quyền **600**, nằm ngoài
`content/`. **12/12 phép thử giao diện** — băng thông báo hiện đúng nội dung, bấm "Đã hiểu" ẩn và
tải lại không hiện lại; bảng nhật ký có vạch đỏ ở dòng nhạy cảm; **tên tài khoản đặt là
`<img src=x onerror=alert(1)>` hiện thành chữ, không tạo thẻ `<img>` nào, không `alert()` nào chạy**;
hộp đổi tên có đủ cảnh báo; 0 lỗi JS/CSP.

**Deploy: BẮT BUỘC restart** — đợt này sửa `routes/adminUsers.js`, `routes/auth.js`, `paths.js` và
thêm module `accountAudit.js` (xem §5.3). ⚠ `adminUsers.js` và `accountAudit.js` phụ thuộc
`paths.js` / `tenBaoTang.js` / `mailer.baoChoChuKhac` từ §5.24 — **đừng chép lẻ vài file lên một
máy chủ đang chạy mã cũ hơn §5.24**, phải đưa lên cả cây mã nguồn.

### 5.27. Tiện ích nhập liệu (2026-10-04)

Bảy việc cho người nhập liệu, phần lớn trong `public/admin.js` (khối "TIỆN ÍCH NHẬP LIỆU" ở cuối file)
và vài route mới trong `routes/adminContent.js`. Chủ dự án yêu cầu **chưa làm tự động dịch** (đã bàn:
chỉ dịch chữ, không dịch audio, bấm nút chứ không dịch khi đang gõ, không dịch lời thuyết minh vì máy
chủ bắt nó đi cùng file audio cùng ngôn ngữ).

| Việc | Ở đâu | Điều cần nhớ |
|---|---|---|
| Gợi ý số Major/Minor + báo trùng khi gõ | `GET /numbers`, `chuanBiSo()` | Major tránh cả `beacon.deskMajor` |
| Tự lưu nháp biểu mẫu | `localStorage` khóa `beacon_nhap:<userId>:hv|kv:<id hoặc moi:...>` | File không lưu được; xóa nháp khi lưu thành công / Hủy / chủ động bỏ thay đổi; nháp quá 7 ngày bị bỏ |
| Nhân bản hiện vật | chỉ giao diện | Mở biểu mẫu THÊM đã điền chữ; **không** chép lời thuyết minh ngôn ngữ khác (máy chủ bắt đi cùng audio — chép sẽ 400) |
| Chuyển khu vực | `POST /zones/:z/exhibits/:e/move {toZoneId, minor}` | Không dời file (mã hiện vật duy nhất toàn bảo tàng, đường dẫn theo mã hiện vật). **Chặn chuyển hiện vật cuối cùng** (khu rỗng = lỗi đỏ, ngừng phát hành). Thống kê cũ gắn theo cặp major:minor nên sẽ lệch sang hiện vật đang mang cặp số đó |
| Sắp xếp | `PUT /zones-order`, `PUT /zones/:z/exhibits-order {ids}` | Nhận CẢ danh sách một lần = 1 mục nhật ký (lưu từng bước ↑↓ là đẩy hết 30 mục hoàn tác). Danh sách lệch (ai vừa thêm/xóa) → 409. App hiện đúng thứ tự manifest — đã kiểm `beacon-client` không tự sắp |
| Ctrl+S | `keydown` toàn trang | Dùng `requestSubmit()` để vẫn qua kiểm `required` của HTML |
| Độ đầy đủ ngôn ngữ | `GET /language-coverage`, panel trong tab Giao diện ứng dụng | Chỉ tính CHỮ; trường chỉ bị tính thiếu khi ngôn ngữ mặc định có nội dung; audio chỉ để tham khảo |
| Dọn mô hình 3D mồ côi | `runIntegrityCheck` → `orphaned-model` (info), xóa qua `DELETE /admin/models/:id` | Không hoàn tác được; hoàn tác một thao tác cũ còn trỏ tới mô hình đã xóa sẽ ra lỗi đỏ `model-3d` |

⚠ Biến trạng thái của khối tiện ích khai báo bằng **`var`**: `bootstrap()` nằm phía trên trong file,
các hàm móc vào luồng mở/đặt lại biểu mẫu có thể chạy trước khi dòng `let/const` tới → lỗi "chưa khởi
tạo". Nút trong hộp thoại cần chính phần tử được bấm nên có bộ bắt sự kiện riêng (bộ điều phối
`ACTIONS` chỉ truyền `dataset`).

Đã thử bằng Chrome headless trên bản sao dữ liệu: 52 ca (3 vai trò quyền, kéo thả thật bằng
`DragEvent`, Ctrl+S bằng phím thật qua CDP, nháp sau khi tải lại trang), 0 lỗi JS. Ảnh chụp hộp thoại
trông "trong suốt" là do chụp trong 0,3 giây hiệu ứng mở — đo `opacity` sau 400 ms là 1.

### 5.28. Vận hành: sao lưu + ổ đĩa, máy tham quan, tạm giữ phát hành, ~~xuất Excel~~ (2026-10-04)

Lên VPS rồi thì không ai đọc log cron hay `df -h`. Đợt này đưa những thứ **hỏng im lặng** lên
Trang chủ CMS, kèm hai việc người dùng hỏi: tạm giữ phát hành và xuất báo cáo. Route mới:
`/api/v1/admin/van-hanh` (`routes/adminVanHanh.js`); đọc: mọi vai trò, ghi: Biên tập trở lên.

| Việc | Ở đâu | Điều cần nhớ |
|---|---|---|
| Sao lưu | `scripts/backup-content.sh` ghi `DATA_DIR/backup-status.json` qua `trap EXIT` | Lần lỗi vẫn ghi (`ketQua: loi`) và **giữ** `lanThanhCongCuoi` cũ. Đỏ: lỗi / chưa có file / quá 36 giờ. Vàng: thành công nhưng không `REMOTE` hoặc `scp` hỏng |
| Ổ đĩa | `fs.statfsSync(DATA_DIR)` | Vàng < 5 GB (không nhập nổi ZIP 1 GB, §5.9), đỏ < 2 GB |
| Máy tham quan | `thietBi.js` → `DATA_DIR/devices.json`, gọi từ `POST /events` | Xem bên dưới |
| Tạm giữ phát hành | `tamGiuPhatHanh.js`, móc vào `routes/staticContent.js` | Xem bên dưới |

**Máy tham quan.** App **không gửi định danh nào** khi gọi `/version.json` hay tải bundle; chỗ duy
nhất máy tự xưng là trường `device` trong từng dòng của `POST /events` (chuỗi ngẫu nhiên app sinh
lần đầu, `buffering_analytics_sink.dart`). Nên "máy còn sống" = "máy còn gửi thống kê", mà app chỉ
gửi khi về dock sau một chuyến — máy không ai dùng thì cũng im. Ngưỡng 26 giờ (xanh) / 72 giờ
(vàng), quá nữa là đỏ; vàng trước đỏ vì bảo tàng nghỉ một ngày trong tuần là thường.
- Đếm cả dòng **trùng** (máy gửi lại lô cũ vẫn là bằng chứng máy chạy).
- `POST /events` công khai ⇒ trần `MAX_DEVICES = 300`, mã phải khớp `^[A-Za-z0-9_-]{4,64}$`;
  quá trần thì bỏ mã MỚI, máy đã biết vẫn cập nhật. Mốc sự kiện ở **tương lai** (đồng hồ tablet
  sai) không được nhận làm "lần khách dùng cuối".
- `devices.json` nằm **ngoài `content/`** (cùng lý do với `users.json`, §5.16), có trong
  `backup-content.sh` và `.gitignore`. ⚠ Module **cache trong bộ nhớ**: sửa tay file khi server
  đang chạy sẽ bị ghi đè ở lần gửi kế tiếp — phải restart.

**Tạm giữ phát hành.** Bình thường mỗi thao tác ghi `bumpVersion()` và lần `/version.json` kế tiếp
tự đóng gói ⇒ sửa là phát hành ngay, kể cả sửa dở giữa giờ mở cửa. Khi giữ, `/version.json` và
`/bundle-*` **chỉ** phục vụ gói đã chốt; CMS vẫn sửa bình thường.
- Gói chốt là file riêng `downloads/static-content/held-<version>.tar.gz` (link cứng, không được
  thì chép) + `hold.json`. ⚠ **Đừng đặt tên `bundle-*`**: `pruneOldBundles()` giữ 3 file `bundle-*`
  mới nhất, bấm "Đóng gói dữ liệu" vài lần trong lúc giữ sẽ xóa mất thứ tablet đang tải dở.
- Trong lúc giữ, `/version.json` **bỏ qua** `validateManifest()` — gói chốt hợp lệ lúc chốt, chỗ
  đang sửa dở (vd khu vực mới chưa có hiện vật) không được làm tablet nhận 503.
- Chốt khi nội dung **đang lỗi**: lấy bản gần nhất trong `history.json` còn file trên đĩa và
  **băm lại** (cùng version có thể đã đóng gói lại nhiều lần). Không có bản nào ⇒ 409.
- Mất file chốt (ai xóa tay `downloads/`) ⇒ coi như không giữ + log, phục vụ bản mới thay vì 404
  cho mọi máy.
- "Phát hành ngay" **không** kiểm nội dung trước khi bỏ giữ: `/version.json` tự trả 503 như khi
  chưa từng giữ. Route trả kèm `problems` để giao diện nói rõ "đã bỏ giữ nhưng máy chưa nhận vì…".
- Không tự hết hạn, cố ý. Thẻ Trang chủ luôn vàng khi đang giữ để nhắc.

**Xuất Excel — ĐÃ GỠ (2026-10-05)** theo yêu cầu người dùng: xóa `xlsx.js`, route
`/export.xlsx`, khối "Xuất báo cáo Excel" ở tab Thống kê, và trường `perDay` trong
`tinhThongKe()` (chỉ bản xuất dùng). **Giữ lại** `?month=YYYY-MM` của `/summary`: lọc theo giờ
bảo tàng (`MUSEUM_TZ`, mặc định `Asia/Ho_Chi_Minh`) và đọc thêm một file tháng đệm mỗi đầu — file
chia theo giờ máy chủ, VPS chạy UTC thì 6 giờ sáng giờ VN là 23 giờ hôm trước. Đừng thêm lại xuất
Excel nếu người dùng không hỏi.

⚠ **Bẫy giao diện đã dính: bảng rộng làm cả trang rộng ra ở điện thoại.** Bảng máy tham quan
trong `div{overflow-x:auto}` vẫn đẩy trang lên **951 px** ở màn 390 px, vì tổ tiên là flex/grid
item có `min-width:auto` nên nhận chiều rộng tối thiểu của bảng. Sửa: `.table-scroll { width: 0;
min-width: 100% }`. Và **đừng đo bằng `scrollWidth - innerWidth`** ở chế độ mobile: viewport tự
giãn theo nội dung nên hiệu luôn bằng 0 — phải so `scrollWidth` với con số tuyệt đối (≤ 400).

**Đã thử** trên bản sao dữ liệu (cổng 8131): API **51/51** — chạy `backup-content.sh` thật (thành
công / lỗi giữ mốc cũ / `REMOTE` thành công / quá hạn), `/events` với mã rác và lô trùng, quyền 3
vai trò, tạm giữ ⇒ `version.json` + bundle 200 + **206** với `If-Range` vẫn là bản chốt, đóng gói
lại 4 lần không mất file chốt, nội dung lỗi trong lúc giữ không 503, mất file chốt tự lùi. File
`.xlsx` mở bằng openpyxl (6 trang, `-W error` không cảnh báo). Giao diện Chrome headless **27/27**:
3 vai trò, đặt tên máy (Enter lưu / Esc hủy / tên chứa `<img onerror>` hiện thành chữ), tạm giữ →
đóng gói → phát hành, tải 2 file Excel, 390 px không cuộn ngang, 0 lỗi JS/CSP.

**Deploy: BẮT BUỘC restart** (module + route mới). Cron sao lưu phải đặt đúng `DATA_DIR` thì ô Sao
lưu mới thấy kết quả (`NHIEU_BAO_TANG.md`). `fs.statfsSync` cần Node ≥ 18.15.

### 5.29. Kiểm tra toàn vẹn quét CẢ manifest + lệnh kiểm trước khi thử nghiệm (2026-10-06)

**Lỗ hổng:** `runIntegrityCheck` chỉ biết các trường của `museum`/`zones`/`exhibits`. Manifest
còn những khối CMS chưa có chỗ sửa nhưng app vẫn đọc — `guide.steps[].image` (đang có), và
`about`/`faq`/`topics`... sau này. Hậu quả hai chiều: file **thiếu** ở đó không ai báo (3 ảnh
`images/guide/step-1..3.jpg` đã thiếu từ commit đầu mà không lần kiểm nào thấy), còn file **có
thật** ở đó bị coi là mồ côi → `cleanOrphansAfterRestore()` **xóa mất** khi khôi phục sao lưu.

**Sửa:** cuối `runIntegrityCheck` có lượt `quetDuongDan()` duyệt MỌI chuỗi bắt đầu bằng
`images/` `audio/` `videos/`, đăng ký vào `referencedFiles` và báo `warning` kèm vị trí JSON
(`guide.steps[0].image`) nếu thiếu file. Đường dẫn đã kiểm ở trên thì bỏ qua, không báo hai lần.
Mức `warning` vì app (`_optArticle`) bỏ riêng ảnh hỏng, giữ bước hướng dẫn với biểu tượng.

**Dữ liệu:** 3 dòng `image` của `guide.steps` đã bị bỏ (file không có ở `museum_server`, `src`
hay bất kỳ đâu), `bundleVersion` → `2026.10.06-01`. Bản sao trước khi sửa nằm ở scratchpad phiên đó.

**`node scripts/kiem-tra-du-lieu.js`** — chạy TRƯỚC mỗi đợt thử nghiệm để lỗi dữ liệu có sẵn
không bị nhầm thành lỗi mới. Dùng đúng `runIntegrityCheck` + `validateManifest` (đã export),
**chỉ đọc**, an toàn trong thư mục thật khi server đang chạy; nhận `DATA_DIR`, `--ca-info` in cả
file mồ côi. Mã thoát 2 = có lỗi chặn phát hành, 1 = chỉ cảnh báo, 0 = sạch.
Dữ liệu thật lúc viết mục này: **0 lỗi, 0 cảnh báo**.

**Deploy: BẮT BUỘC restart** (sửa `routes/adminContent.js`).

### 5.30. Định dạng chữ, xem trước trên máy, việc dịch (2026-11-05)

Ba việc từ bản đánh giá theo thang CMS (Phụ lục C). Phía máy chủ **chỉ sửa `public/`** — không cần
restart. Có sửa `beacon-client`.

**Định dạng chữ — HỢP ĐỒNG HAI KHO.** Tóm tắt + ý nghĩa hiện vật nhận markdown rút gọn: `**đậm**`,
`*nghiêng*`, dòng `- ` = gạch đầu dòng, dòng trống = sang đoạn. Hai nơi cài quy tắc phải khớp từng chữ:
`vanBanDinhDangHtml()` (`admin.js`) và `RichBodyText` (`beacon-client/lib/presentation/widgets/rich_body_text.dart`,
có test). Dấu `*` phải ôm sát chữ (`[^\s*]` ở hai đầu) nên `5 * 3 * 2` và `** x **` vẫn là chữ thường.
⚠ App bản CŨ gặp nội dung có định dạng sẽ hiện nguyên dấu `**` — xấu nhưng không hỏng. Nên cập nhật app
trên tablet **trước** khi người nhập liệu bắt đầu dùng định dạng. Máy chủ không kiểm gì thêm.

**Xem trước trên máy** (nút trong biểu mẫu hiện vật): dựng từ các ô đang nhập, chưa cần lưu; mỗi ngôn ngữ
một nút; chỗ chưa dịch có viền đứt + nhãn "máy hiện bản <mặc định>" (đúng cách app lùi ngôn ngữ). Esc bắt ở
pha capture trên `window` để không lan xuống hộp "thoát mà không lưu" của biểu mẫu. Chưa có cho khu vực.

**Việc dịch:** thẻ trên Trang chủ (đếm theo `GET /language-coverage`), bảng ở tab Giao diện ứng dụng có lọc
theo ngôn ngữ, nút "Dịch" mở biểu mẫu, mở sẵn phần ngôn ngữ đó và đặt con trỏ vào ô thiếu đầu tiên.

Đã thử trên bản sao (Chrome headless, CDP): 16/16 ca, 0 lỗi JS/CSP; app 285/285 test.

### 5.31. CMS dùng chung mọi ngành: thuật ngữ tự đặt + trạng thái/giá/diện tích (2026-11-12)

⚠ **Mặc định nhà đất ở mục này đã bị thay bởi §5.32 (dùng chung mọi ngành).**

Chủ dự án muốn CMS "ngành nào nhìn vào cũng hiểu", thiên về nhà đất. Đã chốt: **chỉ đổi giao diện
CMS** — khóa dữ liệu (`zones`/`exhibits`/`major`/`minor`) và API **giữ nguyên** vì là hợp đồng với
`beacon-client`.

**Thuật ngữ do Chủ tự đặt** (`cmsSettings.js` → `DATA_DIR/cms-settings.json`, ngoài `content/`, có
trong `.gitignore` + `backup-content.sh`). Mặc định nhà đất: đơn vị / dự án / sản phẩm / thiết bị
trình chiếu / khách / giới thiệu; có mẫu "Bảo tàng" và "Dùng chung". Sửa ở khung **"Cách gọi tên &
trạng thái"** trên `users.html` (chỉ Chủ, `PUT /api/v1/admin/cms-settings`). `GET /api/v1/site`
trả kèm để trang đăng nhập cũng đúng tên.

⚠ **QUY ƯỚC VIẾT CHỮ GIAO DIỆN — đừng viết cứng "hiện vật"/"khu vực" nữa.** Viết mã:
`{muc}` `{nhom}` `{donVi}` `{thietBi}` `{khach}` `{thuyetMinh}`; `{Muc}` = hoa chữ đầu, `{MUC}` =
hoa hết. `public/thuatNgu.js` (nạp TRƯỚC `appearance.js`/`admin.js`/`users.js`/`login.js`) thay mã
trong text node + `placeholder/title/aria-label/alt/data-tip/data-confirm`, cả phần JS vẽ sau
(MutationObserver), và bọc `alert/confirm/prompt`. **Không** đụng `.value` của ô nhập → dữ liệu
người dùng không bao giờ bị đổi chữ. Câu lỗi của máy chủ (routes vẫn viết từ cũ) được
`CMS.ttCu()` đổi trong `pushNotification`/`toast`. Đổi tên gọi → trang tự tải lại một lần.
Chuyển đổi hàng loạt đã làm bằng acorn (chỉ chuỗi/template, không đụng chú thích) — chữ cũ còn
trong `admin.js` là chú thích. Chữ VÍ DỤ trong khung cài đặt (`TERM_FIELDS`, `MAU_TEN`) **phải** để
nguyên văn.

**Trạng thái / giá / diện tích** → `exhibit.listing {status, price, area}` (app bỏ qua khóa lạ,
`/version.json` vẫn 200). Gửi qua form `listing_status|price|area`: không gửi = giữ, chuỗi rỗng =
xóa; trạng thái phải có trong danh sách cài đặt (400), số âm → 400 (`applyListing` trong
`routes/adminContent.js`). `exhibits-page` nhận `?status=<id>|__none` và trả `listing`. Danh sách
hiện huy hiệu màu + giá/diện tích, có ô lọc. Trạng thái đã bị xóa khỏi cài đặt vẫn hiện trong
biểu mẫu "(đã bỏ khỏi danh sách)" để không âm thầm mất khi lưu.

**Chưa làm**: tìm kiếm/lọc theo giá–diện tích (khoảng), thống kê theo trạng thái, trường vị trí
(địa chỉ/tầng/hướng), đổi tên mã nguồn/route. **Deploy: BẮT BUỘC restart** (module + route mới).

**Đã xóa dữ liệu bảo tàng (2026-11-12, chủ dự án yêu cầu).** `zones` rỗng, xóa `images/{zones,exhibits}` +
`audio/*/{zones,exhibits}`, `museum.name` tạm = "Chung cư mẫu", `bundleVersion` 2026.11.12-01. Mọi chỗ
ở trên nhắc "3 khu vực / 9 hiện vật" là dữ liệu CŨ. Bản sao trước khi xóa nằm ở scratchpad của phiên đó
(`content-truoc-khi-xoa-bao-tang.tar.gz`). `/version.json` trả 503 cho tới khi có ≥1 dự án kèm ≥1 căn —
đúng thiết kế (§5.19). CÒN giữ, chưa đổi: ảnh `images/welcome/*`, `guide`, và ~80 chuỗi `ui{}` của app
mang giọng bảo tàng ("Danh mục hiện vật", "Sơ đồ bảo tàng"...) — sửa ở tab Giao diện ứng dụng.

**Tên thương hiệu thay "Beacon" (2026-11-12).** `cmsSettings.brand` (mặc định "Quản trị", ≤30 ký tự, giữ hoa
thường), sửa ở ô "Tên hiển thị trên logo". Mã `{thuongHieu}` / `{THUONGHIEU}` / `{thuongHieuChu}` (chữ đầu
cho logo) trong `admin.html`, `users.html`, `login.html`; chữ chạy ở `login.js` đọc `tt('{THUONGHIEU}')`.
Chỉ đổi BỀ NGOÀI: tên thư mục, app pm2 `beacon-server`, khóa `beacon_admin_token`, và chữ "beacon" chỉ
thiết bị phần cứng (UUID/major) giữ nguyên. Đổi tên → trang tự tải lại một lần.

**Phong cách "Vận hành" kiểu dashboard (Wazuh/OpenSearch) — mặc định từ 2026-11-12.** `public/phongCachVanHanh.css`
nạp SAU `admin.css`, chỉ có hiệu lực khi `data-palette="ops"` (nền sáng #f1f4fa, xanh chủ đạo #0077cc, bo 6px,
phẳng, mục menu đang chọn có vạch xanh trái); bảng màu cũ vẫn chọn được ở nút Bảng màu. `appearance.js` dùng
khóa `beacon-admin-theme-v2` / `beacon-admin-palette-v2` (mặc định light / ops) để máy đã lưu lựa chọn cũ cũng
nhận giao diện mới. Biến vẫn tên `--gold`/`--gold2` (là màu chủ đạo) để khỏi sửa admin.css; chữ trên nút chính
dùng `--on-accent`. `login.css` đổi thẳng sang tông xanh. Chỉ học phong cách, không dùng logo/tên Wazuh.

**Nút "?" thay dòng giải thích nhỏ (2026-11-12).** `public/hoTro.js` (nạp sau `thuatNgu.js` ở admin.html +
users.html) ẩn `.panel-head + .form-hint`, `.panel-head .panel-title + .form-hint` và `.ops-card .ops-sub`, đặt
nút `.ht-btn` cạnh tiêu đề; rê chuột/focus = xem, bấm = ghim, bấm ra ngoài/Esc = đóng. Phần tử gốc chỉ bị
`hidden` nên code ghi vào nó vẫn chạy; popup chép node (không innerHTML). Khung mới viết theo đúng cấu trúc
trên là TỰ có "?". Muốn giữ một dòng hiện ra: thêm `data-giu-hien`. Gợi ý cạnh ô nhập trong form KHÔNG bị thu.

### 5.32. Giao diện "dùng chung mọi ngành" thay cho giọng nhà đất + đợt sửa lỗi (2026-11-13)

Chủ dự án: CMS phải đọc như **một giải pháp thuyết minh / giới thiệu nội dung chung**, không phải
trang mua bán nhà đất. Mọi điều ở §5.31 về "mặc định nhà đất" nay **không còn đúng**.

**Mặc định mới (`cmsSettings.js`, khớp `public/thuatNgu.js`):** khu vực / nội dung / thiết bị thuyết
minh / khách / thuyết minh / đơn vị; thương hiệu "Thuyết minh". Trạng thái mặc định là trạng thái
**biên tập** (Đang soạn / Chờ duyệt / Hoàn thiện / Cần cập nhật) — chỉ hiện trong CMS, app bỏ qua.
Bốn mẫu điền nhanh, mỗi mẫu là bộ cài đặt ĐẦY ĐỦ (tên + trạng thái + ô số liệu): Dùng chung, Bảo
tàng, Showroom, Nhà đất.

**(Đã thay bởi §5.33 — trường tự định nghĩa.)** **Giá/diện tích → "Ô số liệu" tùy chọn**: `showNumbers` (mặc định **false**), `priceLabel`/`priceUnit`,
`areaLabel`/`areaUnit`. Khóa dữ liệu vẫn là `exhibit.listing.price/area` (tương thích). Ô tắt thì
biểu mẫu KHÔNG gửi `listing_price/area` (= giữ nguyên số cũ). ⚠ File `cms-settings.json` đã lưu từ
bản trước (thiếu `showNumbers`) được coi là `true` — đơn vị đang dùng giá/diện tích không bị ẩn
mất; muốn giao diện chung thì Chủ bấm mẫu "Dùng chung" rồi Lưu.

**Phong cách "Trình diễn" — mặc định** (`public/phongCachTrinhDien.css`, `data-palette="stage"`,
khóa localStorage `-v3`). Cấu trúc dùng chung với "Vận hành": selector trong `phongCachVanHanh.css`
nay là `:root:is([data-palette="ops"],[data-palette="stage"])`. Thanh bên màu mực, lục lam
`#0d7a72` chủ đạo, hổ phách `--signal` chỉ cho "đang phát/đang chọn". Trang chủ có dải **"Hành trình
thuyết minh"** 3 bước (khu vực → nội dung → thiết bị) thay hai thẻ số liệu; vẫn giữ id
`stat-total-zones`/`stat-total-exhibits`, thêm `stat-total-langs`. Liên kết `data-di-toi="<view>"`
bấm hộ nút thanh bên. Trang đăng nhập cùng bộ màu, **bỏ 6 ảnh Unsplash** (CSP `img-src` không còn
domain ngoài), tôn trọng `prefers-reduced-motion`. Có `favicon.svg`.

**Chuỗi app (`content/manifest.json`)**: ~47 chuỗi `ui{}` vi/en/zh + 3 bước `guide` đổi từ giọng
bảo tàng ("hiện vật", "khu trưng bày", "tham quan", "quầy lễ tân") sang giọng chung; `museum.name`
= "Không gian trải nghiệm". Đây là dữ liệu MẪU trong mã nguồn — máy chủ thật sửa ở tab Giao diện
ứng dụng, **đừng chép đè `content/` của máy chủ thật khi deploy mã nguồn**.

**Lỗi đã sửa cùng đợt:**
- `applyListing` chặn 400 khi lưu một nội dung đang mang trạng thái đã bị bỏ khỏi danh sách (đổi
  mẫu là dính) — biểu mẫu hiện "(đã bỏ khỏi danh sách)" nhưng không lưu được. Nay giữ nguyên được
  trạng thái HIỆN CÓ; trạng thái lạ khác vẫn 400.
- `chuanHoaSo` ô giá bỏ HẾT dấu chấm/phẩy → "1.5" thành 15. Nay chỉ bỏ dấu phân nhóm nghìn; biểu
  mẫu sửa điền số thô (tránh "1.500" đọc lại thành 1,5).
- `CMS.ttCu` thay chữ nhiều lượt → "máy tham quan" thành "thiết bị giới thiệu". Nay một lượt regex.
- `chuanHoa` gặp một trạng thái hỏng là bỏ CẢ file cài đặt (mất luôn tên gọi). Nay chỉ bỏ trạng thái.
- Trang Quản lý tài khoản cuộn ngang 52px (chú thích ẩn của nút "Khóa" thò ra mép phải).
- Điện thoại: thanh trên đẩy ảnh đại diện ra ngoài màn hình; dải hoa văn trống đồng ẩn bằng
  `visibility` vẫn chiếm chỗ — nay `display:none` ở hai phong cách ops/stage.
- Khung cài đặt tên gọi: nhãn hàng dưới dính vào ô hàng trên (gap dọc 0).
- Breadcrumb "Home" (tiếng Anh) → "Trang quản trị". Xóa 3 ảnh SVG bảo tàng không dùng trong `public/images/`.

**Không đụng**: khóa dữ liệu `zones/exhibits/major/minor`, mọi route/API, `beacon-client`. Deploy:
**restart** (đổi `cmsSettings.js`, `routes/adminContent.js`, `server.js`).

### 5.33. Trường thông tin tự định nghĩa — thay hai ô Giá/Diện tích cố định (2026-11-13)

Mỗi đơn vị tự đặt bộ trường cho `{muc}`: nhà đất (Giá, Diện tích, Phòng ngủ, Hướng, Pháp lý),
bảo tàng (Niên đại, Chất liệu, Kích thước, Xuất xứ, Số hiệu), showroom (Giá, Bảo hành, Mã, Năm ra
mắt)… Sửa ở khung **Cách gọi tên & trạng thái → Trường thông tin** (`users.js`, chỉ Chủ). Thay cho
`showNumbers/priceLabel/priceUnit/areaLabel/areaUnit` của §5.32 — các khóa đó **không còn**.

**Cài đặt** `cmsSettings.fields[]` (kiểm ở `customFields.kiemTraTruong`, tối đa 24):
`{ id, label, labelI18n:{en,zh…}, type: text|number|year|select, unit (number), options[] (select),
onDevice, inList }`. `id` sinh từ tên lúc lưu lần đầu (bỏ dấu, `_`), **không đổi sau đó** vì là khóa
dữ liệu. Mẫu Bảo tàng/Showroom/Nhà đất nay điền CẢ bộ trường (kèm tên tiếng Anh/Trung).
File cài đặt cũ → `chuyenBanCu()`: còn hiện giá/diện tích thì thành 2 trường số `price`/`area`.

**Dữ liệu** `exhibit.fields = { id: giá trị }` — text = `{vi, en…}` (bắt buộc có bản mặc định trước
bản dịch), number/year = số, select = chuỗi lựa chọn. Gửi qua form `fields` (JSON); không gửi = giữ
nguyên, `''` = xóa. Trường bị bỏ khỏi cài đặt thì giá trị **vẫn giữ** trong dữ liệu (thêm lại trường
cùng `id` là hiện lại). Dữ liệu kiểu cũ `listing.price/area` vẫn đọc được (`giaTri()`), lưu lần sau
thì chuyển sang `fields`.

**Hiện cho khách KHÔNG cần sửa app**: trường `onDevice` được máy chủ sinh thành **N dòng đầu của
`exhibit.specs`** (bảng "Thông số" app vốn đã hiện), `exhibit.fieldSpecs` = id các dòng đó.
Số định dạng theo từng ngôn ngữ (`Intl.NumberFormat`), năm không phân nhóm nghìn. ⚠ Mọi chỗ ghi
`specs` phải qua `customFields.ghepSpecs()`; biểu mẫu chỉ sửa phần thông số TỰ GÕ phía sau
(`specsTuGoThanhHang()` bỏ N dòng đầu). Trình duyệt còn admin.js cũ gửi cả N dòng lên thì
`boDongSinhTuDong()` nhận ra và bỏ, không nhân đôi. Lưu cài đặt → `sinhLaiTruongThongTin()` sinh lại
specs mọi nội dung (1 dòng nhật ký, có hoàn tác; không đổi gì thì không ghi).

**Giới hạn còn lại**: lựa chọn của trường `select` chỉ có một thứ tiếng (khách nước ngoài thấy chữ
tiếng mặc định); chưa lọc/tìm theo khoảng giá trị; trường chỉ áp cho `{muc}`, chưa có cho `{nhom}`.

### 5.34. Cài đặt app + chữ app bổ sung sửa được trên CMS (2026-11-13)

Rà mã `beacon-client` (bản gộp trong `argon4_bundle.xml`) thấy app ĐỌC nhiều thứ trong manifest mà CMS
không có chỗ sửa. Nay có 2 khung ở tab **Giao diện ứng dụng** (`public/caiDatApp.js`):

1. **Cài đặt app trên điện thoại** — `GET/PUT /api/v1/admin/content/app-settings` (cuối
   `routes/adminContent.js`): `policies` (loa ngoài / bắt buộc tai nghe / quay lại khu cũ có đọc lại),
   `summary` (lời cảm ơn, góp ý, mã QR + link), `feedback` (thang điểm, câu hỏi, tối đa 8 lý do),
   `menu` (chỉ bật/tắt Hướng dẫn — catalog/map/tours app chưa có màn), `farewell.autoReturnSeconds`,
   `autoSyncHours`. Luật kiểm khớp `manifest_parser.dart`. ⚠ `policies` mặc định cũ
   (`allowLoudspeaker:false` + `autoplayRequiresHeadphones:true`) = không cắm tai nghe là app IM LẶNG.
2. **Chữ hiển thị trên app (bổ sung)** — 88 khóa `ui` app dùng mà form "Chuỗi giao diện" chưa có
   (form cũ chỉ 95/172). Danh sách + chữ mặc định chép từ `ui_strings.dart` bản 14/10/2026; app mới hơn
   có khóa mới thì dùng ô "Thêm khóa khác". Gửi qua `PUT /ui-strings` đúng các khóa của khung (máy chủ
   gộp theo từng khóa, ô trống = xóa = app dùng chữ mặc định). Ô nào chữ hiện thật còn giọng bảo tàng
   được đánh dấu. Ví dụ: `poster.kicker` (mặc định "Bảo tàng") là dòng nhỏ trên tên đơn vị ở màn đầu.

Thứ tự app lấy chữ: `ui[ngôn ngữ]` → `ui[ngôn ngữ mặc định]` → chữ gài sẵn trong app → tên khóa.
App chỉ tải gói khi `bundleVersion` đổi (mọi route ghi đều tăng). Cấu hình beacon (UUID, lockout,
zoneChangeConfirmSeconds...) đã có sẵn ở "Cấu hình nâng cao". Chưa làm: sửa `guide`/`about`/`faq`.
