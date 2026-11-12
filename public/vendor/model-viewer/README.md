# `model-viewer` tự host — không lấy từ CDN

Thư mục này là bản sao **cố định** của thư viện dựng 3D, phục vụ khung xem mô hình trong trang
quản trị (tab "Mô hình 3D").

## Vì sao tự host thay vì gọi CDN

`server.js` đặt `script-src 'self'`. CSP đó được bật lại **có chủ đích** sau khi từng bị tắt
hoàn toàn (xem `CLAUDE.md` mục 5.14) — tắt CSP để cho qua inline *style* thì đồng thời cho qua
inline *script*, tức bỏ đúng lớp phòng vệ lẽ ra đã chặn được một chuỗi tấn công có thật. Thêm
một CDN vào danh sách nguồn script là nới lại đúng lớp ấy, cho một tính năng dùng vài tháng một
lần. Tự host thì `script-src 'self'` giữ nguyên, không đổi một chữ nào trong CSP.

Kèm theo: trang quản trị không phụ thuộc vào một máy chủ ngoài còn sống hay không.

## Vì sao có cả `draco/` và `basis/`

`model-viewer` **không** đóng gói sẵn bộ giải nén; mặc định nó tải chúng từ
`https://www.gstatic.com` **lúc chạy**, và chỉ khi gặp một mô hình thật sự dùng tới. Nghĩa là
nếu không đặt lại đường dẫn thì:

- mô hình thường: chạy tốt, không ai thấy vấn đề gì;
- mô hình nén DRACO hoặc texture KTX2: **im lặng không hiện ra**, vì CSP chặn `www.gstatic.com`.

Mà bảng ngân sách trong `models3d.js` lại **khuyến nghị KTX2** — tức là đúng loại mô hình mà bảo
tàng nên dùng lại là loại sẽ hỏng. Nên hai bộ giải nén được tải về đây, và `admin.js` trỏ
`ModelViewerElement.dracoDecoderLocation` / `ktx2TranscoderLocation` vào thư mục này.

## Nguồn và phiên bản (ghim, đừng tự nâng)

| Thứ | Phiên bản | Lấy từ |
|---|---|---|
| `model-viewer.min.js` | `@google/model-viewer` 4.0.0 | `npm pack @google/model-viewer@4.0.0` → `package/dist/` |
| `draco/` | Draco 1.5.6 | `https://www.gstatic.com/draco/versioned/decoders/1.5.6/` |
| `basis/` | Basis Universal 2021-04-15-ba1c3e4 | `https://www.gstatic.com/basis-universal/versioned/2021-04-15-ba1c3e4/` |

Hai đường gstatic ở trên **do chính `model-viewer.min.js` khai** — nâng thư viện thì phải mở file
đó ra `grep https://www.gstatic.com` lấy lại đúng phiên bản decoder tương ứng, đừng giữ bản cũ.

⚠ Máy này hỏng IPv6: tải lại phải ép IPv4 (`curl -4`, hoặc `npm` với
`NODE_OPTIONS=--dns-result-order=ipv4first`).
