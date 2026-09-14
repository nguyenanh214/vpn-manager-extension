# Roadmap

## Phase 1 — Docker tunnel — ✅ Hoàn thành
Image alpine + openvpn + dante-server + socat. Xác minh thủ công: IP thoát đổi từ
`198.51.100.25` sang `203.0.113.10`, routing table host không đổi.

## Phase 2 — Native messaging host — ✅ Hoàn thành
Node zero-dependency. Protocol framing, docker driver, container spec,
NetworkManager importer, connection tester, lifecycle registry, path guard.

## Phase 3 — Extension core — ✅ Hoàn thành
Storage, domain validator, forward validator, PAC builder, proxy controller,
native bridge, reconciler, service worker router.

## Phase 4 — Popup UI — ✅ Hoàn thành
Ba tab (Domains, Forward, VPN), giữ trạng thái giữa các lần mở, validate inline,
modal test/import.

## Phase 5 — Installer + docs — ✅ Hoàn thành
`install.sh` tự phát hiện `credsStore` hỏng, đăng ký native host cho
Chrome/Chromium/Brave, ghi đường dẫn node tuyệt đối (nvm), và tự thử spawn host
bằng `env -i` đúng như Chrome. `uninstall.sh` đã chạy thử end-to-end.

## Phase 6 — Port-forward — ✅ Hoàn thành
Tab Forward với CRUD. `socat` trong container mở cổng TCP trên `127.0.0.1` chuyển
tiếp qua tunnel, phục vụ client không hỗ trợ SOCKS5 (Navicat, DBeaver, psql).
Nhãn `vpnmgr.signature` phát hiện cấu hình đổi để dựng lại container.

## Phase 7 — Độ bền tunnel — ✅ Hoàn thành
Xử lý tunnel chết im lặng khi bị client khác cùng cert đá:
`explicit-exit-notify`, `ping-restart 30`, dừng mềm trước khi xoá container,
watchdog thoát khi mất `tun0`, `health()` kiểm tra thật + tự dựng lại,
killswitch chặn rò rỉ.

## Kiểm thử
Bộ test nằm trong `tests/`, chạy bằng `tests/run-all.sh`.
60 test tự động, chạy với Chrome khởi động bằng `env -i` (PATH tối thiểu, đúng
môi trường Chrome thật spawn native host):

| Bộ | Số test | Phạm vi |
|---|---|---|
| popup/native/PAC | 19 | Render, native host, import NM, validate domain, áp PAC |
| routing thật | 5 | Traffic trình duyệt: trong list ra IP VPN, ngoài list ra IP thật, tunnel chết thì fail |
| forward | 18 | CRUD, validate, traffic thật qua forward, dựng lại khi đổi cổng |
| UI/lifecycle | 9 | Giữ trạng thái popup, cuộn danh sách, tự tắt tunnel khi đóng Chrome |
| multi-host | 9 | Nhiều trình duyệt: chỉ host cuối cùng mới được dọn tunnel |

## Phase 8 — docker cp thay bind-mount — ✅ Hoàn thành
Cert vào container bằng `docker create` → `docker cp` → `docker start`, bỏ hẳn
bind-mount. Chuẩn bị cho Windows (không còn dịch đường dẫn `C:\Users\...`).
`signatureOf` băm nội dung cert thay vì đường dẫn — nếu không, đổi cert sẽ không
dựng lại container và tunnel chạy tiếp bằng cert cũ.

## Có thể làm tiếp (chưa cần)
- Hỗ trợ OpenVPN xác thực user/password (hiện chỉ hỗ trợ certificate).
- Import file `.ovpn` rời.
- Nút mở log tunnel ngay trong popup (`tunnel-logs` đã có ở native host, UI chưa dùng).
- Nút Test cho từng forward, giống nút Test ở tab VPN.
- Tuỳ chọn giữ tunnel chạy sau khi đóng Chrome (cho Navicat dùng độc lập).
