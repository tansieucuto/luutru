# Node 24 (khớp máy dev, nơi mọi phép thử đã chạy). KHÔNG hạ xuống 20:
# turntableRenderer.js dùng WebSocket CÓ SẴN, chỉ bật mặc định từ Node 22.
FROM node:24-bookworm-slim

WORKDIR /app

# ffmpeg: CMS dùng để kiểm tra và chuẩn hóa ảnh/audio tải lên.
# chromium: dựng dải ảnh xoay 360 + ảnh giữ chỗ cho mô hình 3D (turntableRenderer.js).
# Thiếu chromium thì mô hình vẫn chạy, chỉ không có lớp xoay — xem CLAUDE.md §5.22c.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg inotify-tools chromium \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node . .

# Dữ liệu lúc chạy được mount ở /var/lib/beacon. Giữ đúng quyền sở hữu khi
# Docker khởi tạo named volume mới từ image này.
RUN mkdir -p /app/downloads /app/tmp_import /var/lib/beacon \
    && chown -R node:node /app /var/lib/beacon \
    && chmod +x /app/docker-entrypoint.sh

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/index.html', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
