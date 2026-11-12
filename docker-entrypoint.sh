#!/bin/sh
set -eu

# Nhiều bảo tàng (docker-compose.nhieu-bao-tang.yml đặt DATA_DIR): mọi dữ liệu, kể cả
# users.json và .env, đã nằm trong volume đó — không cần chép qua lại như bên dưới.
if [ -n "${DATA_DIR:-}" ]; then
  exec "$@"
fi

# users.json nằm cố định trong /app (đường dẫn trong mã nguồn). Sao nó ra volume
# /var/lib/beacon để không mất khi cập nhật image. Ứng dụng ghi file bằng cách đổi
# tên nguyên tử, nên theo dõi cả file lẫn file tạm cạnh nó.
STATE_DIR=/var/lib/beacon
USERS_FILE=/app/users.json
SAVED_USERS_FILE="$STATE_DIR/users.json"

mkdir -p "$STATE_DIR"

sync_users() {
  if [ -f "$USERS_FILE" ]; then
    cp "$USERS_FILE" "$SAVED_USERS_FILE.tmp"
    mv "$SAVED_USERS_FILE.tmp" "$SAVED_USERS_FILE"
  fi
}

if [ -f "$SAVED_USERS_FILE" ]; then
  cp "$SAVED_USERS_FILE" "$USERS_FILE"
fi

watch_users() {
  while :; do
    inotifywait -q -e close_write,moved_to,create /app 2>/dev/null | while read -r _ _ name; do
      case "$name" in
        users.json|users.json.tmp-*) sync_users ;;
      esac
    done
  done
}

watch_users &
watch_pid=$!

"$@" &
app_pid=$!

shutdown() {
  kill -TERM "$app_pid" 2>/dev/null || true
}
trap shutdown INT TERM

set +e
wait "$app_pid"
status=$?
set -e
sync_users
kill "$watch_pid" 2>/dev/null || true
wait "$watch_pid" 2>/dev/null || true
exit "$status"
