#!/bin/sh
set -eu

# Tạo thư mục + file nén phát hành cho máy có Docker nhưng không có mã nguồn.
# KHÔNG bao giờ gói .env hay Docker volume: chúng chứa bí mật và dữ liệu thật.
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=${1:-$(date +%Y.%m.%d)}
OUTPUT_DIR="$APP_DIR/dist/beacon-cms-docker-$VERSION"
ARCHIVE="$APP_DIR/dist/beacon-cms-docker-$VERSION.tar.gz"

if ! command -v docker >/dev/null 2>&1; then
  echo "Khong tim thay Docker. Cai Docker Engine roi chay lai script nay." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "[1/3] Build Docker image..."
docker build --tag beacon-cms:local "$APP_DIR"

echo "[2/3] Export image..."
docker image save beacon-cms:local | gzip -c > "$OUTPUT_DIR/beacon-cms-image.tar.gz"

echo "[3/3] Package deployment files..."
cp "$APP_DIR/docker-compose.bundle.yml" "$OUTPUT_DIR/docker-compose.yml"
cp "$APP_DIR/.env.example" "$OUTPUT_DIR/.env.example"
cp "$APP_DIR/DOCKER.md" "$OUTPUT_DIR/README.md"

tar -czf "$ARCHIVE" -C "$APP_DIR/dist" "beacon-cms-docker-$VERSION"

echo ""
echo "Da tao: $ARCHIVE"
echo "Gui DUY NHAT file .tar.gz nay. Khong gui file .env hay Docker volume."
