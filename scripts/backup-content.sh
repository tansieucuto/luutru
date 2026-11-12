#!/bin/sh
# Sao lưu content/ (manifest + ảnh + âm thanh + mô hình 3D + thống kê) và users.json.
# Các bản sao lưu nội bộ .import-backups/.language-backups nằm NGAY TRONG content/
# nên hỏng ổ đĩa là mất chung — script này là lớp bảo vệ riêng.
#
# Chạy tay:   sh scripts/backup-content.sh
# Chạy cron:  0 2 * * * sh /root/beacon_server/scripts/backup-content.sh >> /var/log/beacon-backup.log 2>&1
# Nhiều bảo tàng: mỗi bảo tàng một dòng cron, thêm DATA_DIR=<thư mục> TEN=<mã> trước lệnh.
#
# Biến môi trường (đều có mặc định):
#   APP_DIR  thư mục chứa server.js          (mặc định /root/beacon_server)
#   DATA_DIR thư mục dữ liệu của bảo tàng    (mặc định = APP_DIR)
#   TEN      tiền tố tên file sao lưu        (mặc định content; nhiều bảo tàng thì đặt = mã)
#   DEST     nơi lưu file .tar.gz            (mặc định /root/beacon-backups)
#   KEEP     giữ bao nhiêu bản gần nhất      (mặc định 7)
#   REMOTE   đích scp để đẩy ra NGOÀI máy    (mặc định trống = chỉ lưu cục bộ)
#
# LƯU Ý: REMOTE trống thì bản sao nằm CÙNG Ổ ĐĨA với dữ liệu gốc — chỉ chống được
# xóa/ghi đè nhầm, KHÔNG chống được hỏng ổ. Đặt REMOTE (vd. "user@nas:/backup/beacon")
# để có bản sao thật sự ở ngoài.

set -e

APP_DIR=${APP_DIR:-/root/beacon_server}
DATA_DIR=${DATA_DIR:-$APP_DIR}
TEN=${TEN:-content}
DEST=${DEST:-/root/beacon-backups}
KEEP=${KEEP:-7}
REMOTE=${REMOTE:-}

# Kết quả lần chạy gần nhất, để Trang chủ CMS báo đỏ khi cron hỏng (CLAUDE.md §5.28).
# Lên VPS rồi thì không ai đọc /var/log/beacon-backup.log; file này là cách duy nhất
# một lần sao lưu thất bại lọt vào mắt người quản trị.
STATUS_FILE="$DATA_DIR/backup-status.json"
KET_QUA=loi
LOI="script dung giua chung (xem log cron)"
ARCHIVE_OK=""
SIZE_BYTES=0
REMOTE_KQ=khong
ghi_trang_thai() {
  [ -d "$DATA_DIR" ] || return 0
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  # Giữ mốc thành công gần nhất khi lần này hỏng — nhìn vào là biết đã bao lâu không có bản mới.
  last_ok=""
  [ -f "$STATUS_FILE" ] && last_ok=$(sed -n 's/.*"lanThanhCongCuoi"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STATUS_FILE" | head -1)
  [ "$KET_QUA" = ok ] && last_ok="$now"
  loi_json=$(printf '%s' "$LOI" | tr -d '"\\\n\r')
  printf '{\n  "lanChayCuoi": "%s",\n  "ketQua": "%s",\n  "lanThanhCongCuoi": "%s",\n  "file": "%s",\n  "bytes": %s,\n  "dayRaNgoai": "%s",\n  "loi": "%s"\n}\n' \
    "$now" "$KET_QUA" "$last_ok" "$ARCHIVE_OK" "$SIZE_BYTES" "$REMOTE_KQ" "$loi_json" > "$STATUS_FILE.tmp" \
    && mv "$STATUS_FILE.tmp" "$STATUS_FILE"
}
trap ghi_trang_thai EXIT

CONTENT_DIR="$DATA_DIR/content"
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$DEST/$TEN-$STAMP.tar.gz"

if [ ! -f "$CONTENT_DIR/manifest.json" ]; then
  echo "[$(date)] LOI: khong thay $CONTENT_DIR/manifest.json - dung lai, khong tao backup rong"
  LOI="khong thay manifest.json"
  exit 1
fi

mkdir -p "$DEST"

# Chỉ đóng gói dữ liệu THẬT. Cố ý BỎ QUA .import-backups/ và .language-backups/:
# chúng là bản sao nội bộ (có thể rất nặng).
ITEMS="manifest.json"
[ -d "$CONTENT_DIR/images" ]     && ITEMS="$ITEMS images"
[ -d "$CONTENT_DIR/audio" ]      && ITEMS="$ITEMS audio"
[ -d "$CONTENT_DIR/.analytics" ] && ITEMS="$ITEMS .analytics"
# Mô hình 3D không đi vào bundle nhưng vẫn phải sao lưu — mất file .glb là mất hẳn,
# không dựng lại được từ bundle như ảnh/âm thanh.
[ -d "$CONTENT_DIR/models" ]     && ITEMS="$ITEMS models"
[ -d "$CONTENT_DIR/turntable" ]  && ITEMS="$ITEMS turntable"
[ -f "$CONTENT_DIR/.version-sequence.json" ] && ITEMS="$ITEMS .version-sequence.json"

# users.json và mail.json nằm NGOÀI content/ (cạnh .env) nên phải thêm riêng vào lệnh
# tar — mất users.json là cả bảo tàng không đăng nhập được.
EXTRA=""
for f in users.json mail.json account-audit.ndjson devices.json cms-settings.json; do
  if [ -f "$DATA_DIR/$f" ]; then EXTRA="$EXTRA -C $DATA_DIR $f"; fi
done

# shellcheck disable=SC2086
tar -czf "$ARCHIVE.tmp" -C "$CONTENT_DIR" $ITEMS $EXTRA

# Kiểm tra file nén đọc được TRƯỚC khi coi là thành công — backup hỏng mà tưởng
# lành còn tệ hơn không có backup.
if ! gzip -t "$ARCHIVE.tmp" 2>/dev/null; then
  rm -f "$ARCHIVE.tmp"
  echo "[$(date)] LOI: file nen bi hong, da xoa - KHONG co backup moi"
  LOI="file nen bi hong"
  exit 1
fi
mv "$ARCHIVE.tmp" "$ARCHIVE"

SIZE=$(du -h "$ARCHIVE" | cut -f1)
VER=$(sed -n 's/.*"bundleVersion"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CONTENT_DIR/manifest.json" | head -1)
echo "[$(date)] OK: $ARCHIVE ($SIZE, bundleVersion=$VER)"
KET_QUA=ok
LOI=""
ARCHIVE_OK="$ARCHIVE"
SIZE_BYTES=$(wc -c < "$ARCHIVE" | tr -d ' ')

# Xóa bản cũ, giữ KEEP bản gần nhất.
COUNT=$(ls -1 "$DEST"/"$TEN"-[0-9]*.tar.gz 2>/dev/null | wc -l)
if [ "$COUNT" -gt "$KEEP" ]; then
  ls -1t "$DEST"/"$TEN"-[0-9]*.tar.gz | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old"
    echo "[$(date)] da xoa ban cu: $old"
  done
fi

# Đẩy ra ngoài máy nếu có cấu hình REMOTE.
if [ -n "$REMOTE" ]; then
  if scp -q "$ARCHIVE" "$REMOTE/"; then
    echo "[$(date)] da day ra ngoai: $REMOTE"
    REMOTE_KQ=ok
  else
    REMOTE_KQ=loi
    echo "[$(date)] CANH BAO: khong day duoc ra $REMOTE - ban sao chi con nam cuc bo"
  fi
fi
