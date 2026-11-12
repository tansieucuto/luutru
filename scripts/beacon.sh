#!/bin/sh
# Bật / tắt / xem máy chủ Beacon bằng MỘT lệnh.
#
# Gói ba cái bẫy của lệnh pm2 gõ tay (CLAUDE.md §5.2, 5.7, 5.21):
#   1. `pm2 start beacon_server` (gạch dưới) tạo thêm một app MỚI chạy song song
#      → script luôn khởi động từ ecosystem.config.js.
#   2. `pm2 restart` báo "Process or Namespace not found" khi pm2 quên app (reboot
#      chưa `pm2 save`) → script tự khởi động lại từ file cấu hình và luôn `pm2 save`.
#   3. Một tiến trình `node server.js` mồ côi giữ cổng làm app pm2 chết vòng vì
#      EADDRINUSE trong khi web vẫn trả 200 → script kiểm cổng TRƯỚC khi bật.
#
# Dùng:
#   sh scripts/beacon.sh bat             # bật (đang chạy thì khởi động lại)
#   sh scripts/beacon.sh tat
#   sh scripts/beacon.sh khoi-dong-lai
#   sh scripts/beacon.sh trang-thai      # pm2 + cổng + gọi thử vào máy chủ
#   sh scripts/beacon.sh nhat-ky [số-dòng]
#
# Nhiều bảo tàng (NHIEU_BAO_TANG.md) — thêm mã bảo tàng sau lệnh:
#   sh scripts/beacon.sh bat baotang-a
#   sh scripts/beacon.sh nhat-ky baotang-a 100
#   sh scripts/beacon.sh danh-sach       # mọi bảo tàng + cổng + trạng thái
#   sh scripts/beacon.sh bat-het         # bật/khởi động lại tất cả
# Không có mã = app "beacon-server" với dữ liệu cạnh server.js, như trước.
#
# Chạy được từ bất kỳ thư mục nào. POSIX sh — máy chủ thật là Alpine/BusyBox,
# không có bash.

set -e

APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$APP_DIR"

LENH=${1:-}
MA=''
SO_DONG=40
# Tham số thứ hai: chữ số = số dòng nhật ký, còn lại = mã bảo tàng (mã luôn bắt đầu
# bằng chữ cái, xem tao-bao-tang.js).
case "${2:-}" in
  '') ;;
  *[!0-9]*) MA=$2; SO_DONG=${3:-40} ;;
  *) SO_DONG=$2 ;;
esac

if [ -n "$MA" ]; then
  DATA_DIR=$(node -e '
    try {
      const ds = JSON.parse(require("fs").readFileSync("bao-tang.json", "utf8")).baoTang || [];
      const b = ds.find((x) => x.ma === process.argv[1]);
      if (!b) process.exit(3);
      console.log(require("path").resolve(b.thuMuc));
    } catch { process.exit(3); }' "$MA") || {
    echo "Khong co bao tang '$MA' trong bao-tang.json. Xem: sh scripts/beacon.sh danh-sach" >&2
    exit 1
  }
  APP_NAME="beacon-$MA"
else
  DATA_DIR=$APP_DIR
  APP_NAME='beacon-server'
fi

# Đọc PORT từ .env của đúng bảo tàng thay vì cố định 3000.
PORT=$(sed -n 's/^[[:space:]]*PORT[[:space:]]*=[[:space:]]*\([0-9]\{1,\}\).*/\1/p' "$DATA_DIR/.env" 2>/dev/null | head -n 1)
[ -n "$PORT" ] || PORT=3000

thoat_neu_thieu_pm2() {
  command -v pm2 >/dev/null 2>&1 && return 0
  echo "Khong tim thay lenh pm2." >&2
  echo "Cai: npm install -g pm2   (server that da co san o /usr/local/lib/node_modules/pm2)" >&2
  exit 1
}

# In dòng netstat/ss của tiến trình đang giữ cổng; rỗng nếu không ai giữ.
# Alpine/BusyBox không có ss — lùi về netstat.
ai_giu_cong() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | grep ":$PORT " || true
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltnp 2>/dev/null | grep ":$PORT " || true
  fi
}

pm2_biet_app() {
  pm2 describe "$APP_NAME" >/dev/null 2>&1
}

pm2_dang_online() {
  pm2 jlist 2>/dev/null | grep -q "\"name\":\"$APP_NAME\"[^}]*\"status\":\"online\"" 2>/dev/null && return 0
  # Định dạng jlist đổi giữa các phiên bản pm2 — lùi về cách đọc thô hơn.
  pm2 list 2>/dev/null | grep "$APP_NAME" | grep -q online
}

canh_bao_cong_bi_chiem() {
  # Chỉ lo khi pm2 KHÔNG phải tiến trình đang giữ cổng: lúc đó gần như chắc chắn là
  # một `node server.js` mồ côi.
  pm2_dang_online && return 0
  giu=$(ai_giu_cong)
  [ -n "$giu" ] || return 0
  echo "CANH BAO: cong $PORT dang bi mot tien trinh NGOAI pm2 giu:" >&2
  echo "  $giu" >&2
  echo "" >&2
  echo "Bat them bay gio thi app pm2 se quay vong chet vi EADDRINUSE, ma web van" >&2
  echo "tra 200 nen rat kho nhan ra. Lay dung PID o dong tren roi:  kill <pid>" >&2
  echo "Dung pkill theo duong dan - tien trinh khoi dong bang 'cd ... && node" >&2
  echo "server.js' co dong lenh chi la 'node server.js' nen pattern khong khop." >&2
  exit 1
}

bat() {
  thoat_neu_thieu_pm2
  canh_bao_cong_bi_chiem
  if [ -n "$MA" ]; then
    # LƯU Ý: bảo tàng thì LUÔN đi qua ecosystem.config.js — DATA_DIR nằm ở đó.
    # `pm2 restart --update-env` lấy môi trường của shell này, không có DATA_DIR.
    pm2 startOrRestart ecosystem.config.js --only "$APP_NAME" --update-env
  elif pm2_biet_app; then
    pm2 restart "$APP_NAME" --update-env
  else
    # pm2 quên app (reboot chưa save, hoặc lỡ delete) — dựng lại từ file cấu hình.
    pm2 start ecosystem.config.js --only "$APP_NAME"
  fi
  # LUÔN save sau khi bật: thiếu bước này thì lần reboot sau pm2 lại quên app.
  pm2 save >/dev/null
  echo ""
  trang_thai
}

bat_het() {
  thoat_neu_thieu_pm2
  pm2 startOrRestart ecosystem.config.js --update-env
  pm2 save >/dev/null
  echo ""
  danh_sach
}

tat() {
  thoat_neu_thieu_pm2
  pm2_biet_app || { echo "pm2 khong quan ly app '$APP_NAME' - khong co gi de tat."; exit 0; }
  pm2 stop "$APP_NAME"
  # CỐ Ý không pm2 save: lưu lúc đang tắt thì máy reboot xong máy chủ vẫn nằm im.
  echo ""
  echo "Da tat. Luu y: danh sach luu cua pm2 khong doi, nen may REBOOT thi server"
  echo "se tu bat lai. Muon tat han ca sau reboot: pm2 stop $APP_NAME && pm2 save"
}

trang_thai() {
  thoat_neu_thieu_pm2
  pm2 list 2>/dev/null | grep -E "id|$APP_NAME" || echo "pm2 chua biet app '$APP_NAME'."
  echo ""
  echo "Du lieu: $DATA_DIR"
  giu=$(ai_giu_cong)
  if [ -n "$giu" ]; then
    echo "Cong $PORT: dang co tien trinh nghe"
    echo "  $giu"
  else
    echo "Cong $PORT: KHONG ai nghe"
  fi
  echo ""
  if command -v curl >/dev/null 2>&1; then
    # BẮT BUỘC gửi X-Forwarded-Proto: ở production thiếu header này thì bị 301 sang
    # https (bình thường nginx thêm hộ). Không thêm `|| echo 000` vì curl đã tự in
    # "000" khi không kết nối được.
    ma=$(curl -s -o /dev/null -w '%{http_code}' -m 5 \
      -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$PORT/version.json" 2>/dev/null) || true
    [ -n "$ma" ] || ma='000'
    case "$ma" in
      200) echo "Goi thu /version.json: 200 - server tra loi binh thuong" ;;
      000) echo "Goi thu /version.json: KHONG KET NOI DUOC - server chua len hoac dang khoi dong" ;;
      503) echo "Goi thu /version.json: 503 - noi dung co loi nen server tu choi phat hanh goi." ;;
      *)   echo "Goi thu /version.json: $ma" ;;
    esac
    # Phải dùng `if`, không dùng `[ ... ] && echo`: đây là lệnh CUỐI của hàm, điều
    # kiện sai sẽ trả 1 và `set -e` dừng cả script.
    if [ "$ma" = "503" ]; then echo "  Xem chi tiet: sh scripts/beacon.sh nhat-ky $MA"; fi
  fi
}

danh_sach() {
  node -e '
    const fs = require("fs"), path = require("path");
    let ds = [];
    try { ds = JSON.parse(fs.readFileSync("bao-tang.json", "utf8")).baoTang || []; } catch {}
    const cong = (d) => {
      try { return (fs.readFileSync(path.join(d, ".env"), "utf8").match(/^\s*PORT\s*=\s*(\d+)/m) || [])[1] || "3000"; }
      catch { return "?"; }
    };
    if (fs.existsSync("content/manifest.json")) console.log(`beacon-server\tcong ${cong(".")}\t(du lieu canh server.js)`);
    for (const b of ds) console.log(`beacon-${b.ma}\tcong ${cong(b.thuMuc)}\t${b.ten}\t${path.resolve(b.thuMuc)}`);
    if (!ds.length) console.log("Chua co bao tang nao trong bao-tang.json. Tao: node scripts/tao-bao-tang.js <ma> --ten \"...\" --cong 3001");'
  echo ""
  if command -v pm2 >/dev/null 2>&1; then pm2 list 2>/dev/null | grep -E "id|beacon-" || true; fi
}

nhat_ky() {
  thoat_neu_thieu_pm2
  pm2 logs "$APP_NAME" --lines "${1:-40}"
}

case "$LENH" in
  bat|start)                bat ;;
  tat|stop)                 tat ;;
  khoi-dong-lai|restart)    bat ;;
  trang-thai|status)        trang_thai ;;
  nhat-ky|logs)             nhat_ky "$SO_DONG" ;;
  danh-sach|list)           danh_sach ;;
  bat-het)                  bat_het ;;
  *)
    cat <<HET
Cach dung:  sh scripts/beacon.sh <lenh> [ma-bao-tang]

  bat              Bat server (dang chay thi khoi dong lai). Tu xu ly ca truong
                   hop pm2 da quen app, va tu 'pm2 save' sau khi bat.
  tat              Tat server.
  khoi-dong-lai    Y het 'bat' - de sau khi sua code trong routes/ middleware/
                   server.js (nhung file do KHONG tu nap lai, xem CLAUDE.md 5.3).
  trang-thai       pm2 + ai dang giu cong $PORT + goi thu vao server xem con song.
  nhat-ky [so]     Xem log (mac dinh 40 dong cuoi).
  danh-sach        Moi bao tang: ten app pm2, cong, thu muc du lieu.
  bat-het          Bat/khoi dong lai TAT CA bao tang.

Nhieu bao tang: them ma sau lenh, vd  sh scripts/beacon.sh bat baotang-a
Sua file trong public/ thi KHONG can khoi dong lai - chi can tai lai trang.
HET
    exit 1 ;;
esac
