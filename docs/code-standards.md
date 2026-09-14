# Quy ước code

## Chung
- Mọi file code giữ **dưới 200 dòng**. Vượt thì tách module theo trách nhiệm.
- Tên file kebab-case, mô tả đúng mục đích (`connection-tester.js`, không phải `utils.js`).
- YAGNI / KISS / DRY. Không thêm abstraction cho nhu cầu chưa có.
- Comment giải thích **tại sao**, không mô tả lại code.

## Extension (MV3)
- ES module (`"type": "module"` trong manifest).
- `lib/storage.js` là nơi **duy nhất** đụng `chrome.storage`.
- `background/proxy-controller.js` là nơi **duy nhất** đụng `chrome.proxy`.
- Popup không gọi thẳng native host, luôn đi qua service worker.
- Popup DOM bị huỷ khi đóng → mọi trạng thái UI cần giữ phải nằm trong `state.ui`.

## Native host
- **Zero dependency.** Chỉ dùng thư viện chuẩn của Node.
- Luôn dùng `execFile`, **không bao giờ** `exec`/shell — mọi giá trị từ extension
  là input không tin cậy.
- Mọi path nhận từ extension phải qua `path-guard.js`: tuyệt đối, resolve symlink,
  nằm trong `$HOME`, là file thường, đọc được.
- Mọi tuỳ chọn OpenVPN phải khớp regex whitelist trước khi ghi vào `.ovpn`.

## Bảo mật
- **Không bao giờ** lưu nội dung private key vào `chrome.storage` — chỉ lưu đường dẫn.
- Container dùng `--cap-add=NET_ADMIN`, **không** `--privileged`.
- SOCKS5 publish ở `127.0.0.1`, không phải `0.0.0.0`.
- PAC không có fallback `DIRECT` (xem system-architecture.md → Fail-closed).
