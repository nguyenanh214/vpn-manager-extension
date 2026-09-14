# Phase 03 — Trừu tượng hoá OS trong native host

**Ưu tiên:** Cao (chặn Phase 04, 05) · **Trạng thái:** ⬜ Chưa làm
**Verify:** Linux tự động + smoke test thủ công trên cả 3 OS
**Phụ thuộc:** [Phase 01](phase-01-docker-cp.md), [Phase 02](phase-02-ovpn-import.md)

## Việc đầu tiên phải làm, trước khi viết bất cứ dòng nào

Toàn bộ kiến trúc dựa vào `--device /dev/net/tun`. Trên macOS/Windows, Docker chạy
trong VM chứ không phải kernel host. **Chưa kiểm chứng VM đó có cho mượn device này
không.** Chạy trên từng máy:

```bash
docker run --rm --cap-add=NET_ADMIN --device /dev/net/tun alpine ls -l /dev/net/tun
```

- Ra `crw-rw-rw- ... /dev/net/tun` → đi tiếp.
- Lỗi → **dừng lại**, báo tôi. Phải đổi hướng chứ không phải sửa vặt.

**Kết quả đã có:**

| OS | Kết quả |
|---|---|
| Linux | ✅ chạy thật, tunnel lên |
| macOS | ✅ `ls` thấy device **và** `ip tuntap add` thành công → `TUN_OK` (2026-09-14) |
| Windows | ✅ `ls` thấy device **và** `ip tuntap add` thành công → `TUN_OK` (WSL2, 2026-09-14) |

`ls` chỉ chứng minh **node thiết bị nhìn thấy được**. Thứ OpenVPN thật sự cần là tạo
được interface tun. Phép thử mạnh hơn, chạy trên cả macOS và Windows:

```bash
docker run --rm --cap-add=NET_ADMIN --device /dev/net/tun alpine sh -c \
  'apk add -q iproute2 && ip tuntap add dev tuntest mode tun && \
   ip link show tuntest && ip link del tuntest && echo TUN_OK'
```

In ra `TUN_OK` mới thật sự an toàn.

Với Windows còn phải ghi rõ đang dùng backend nào (WSL2 hay Hyper-V) vì hành vi khác nhau.

## Vì sao

Native host đang giả định Linux ở nhiều chỗ: thư mục manifest, `nmcli`, cách dò node,
`/dev/net/tun` trên host. Cần gom về một chỗ để installer của từng OS chỉ việc hỏi.

## Yêu cầu

- Một module duy nhất biết mọi khác biệt theo OS
- `check-prereqs` kiểm tra đúng thứ cần kiểm tra trên từng OS
- Chức năng chỉ có ở Linux (import NetworkManager) tự ẩn ở nơi khác
- `path-guard` hoạt động đúng với đường dẫn Windows

## Kiến trúc

`native-host/lib/platform.js` xuất:

| Hàm | Trả về |
|---|---|
| `osKind()` | `'linux'` / `'macos'` / `'windows'` |
| `stateDir()` | Linux/macOS: `~/.config/vpn-manager` · Windows: `%APPDATA%\vpn-manager` |
| `nativeHostDirs()` | Danh sách thư mục manifest theo trình duyệt (rỗng trên Windows — dùng registry) |
| `nodeSearchPaths()` | Bổ sung `/opt/homebrew/bin` (macOS ARM), `%ProgramFiles%\nodejs` (Windows) |
| `supportsNetworkManager()` | Chỉ `true` trên Linux |
| `hostLauncher()` | `.sh` trên Linux/macOS, `.bat` trên Windows |

Thư mục manifest:

| OS | Chrome |
|---|---|
| Linux | `~/.config/google-chrome/NativeMessagingHosts/` |
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` |
| Windows | **Registry** `HKCU\Software\Google\Chrome\NativeMessagingHosts\<name>` trỏ tới file manifest |

`check-prereqs` đổi:
- Bỏ kiểm tra `/dev/net/tun` trên host (chỉ đúng với Linux)
- Thay bằng **smoke test thật**: chạy container alpine thử mượn `/dev/net/tun`.
  Đúng thứ cần biết, và đúng trên cả 3 OS.
- `nmcli` chỉ kiểm tra khi `supportsNetworkManager()`

## File đụng tới

Tạo:
- `native-host/lib/platform.js`
- `native-host/vpn-manager-host.bat` (Windows, Phase 05 dùng)

Sửa:
- `native-host/vpn-manager-host.js` — `check-prereqs` dùng smoke test + platform
- `native-host/lib/lifecycle-lock.js` — `stateDir()` thay vì hardcode `~/.config`
- `native-host/lib/ovpn-store.js` — như trên
- `native-host/lib/path-guard.js` — so sánh đường dẫn không phân biệt hoa thường trên Windows
- `native-host/lib/nm-importer.js` — trả danh sách rỗng khi OS không hỗ trợ
- `extension/popup/tab-vpns.js` — ẩn nút Import NetworkManager khi không hỗ trợ

## Các bước

1. Viết `platform.js`, phủ test bằng cách giả lập `process.platform`.
2. Thay mọi chỗ hardcode `~/.config/vpn-manager` bằng `stateDir()`.
3. `path-guard`: Windows so sánh đường dẫn lowercase; giữ nguyên hành vi POSIX ở nơi khác.
4. `check-prereqs`: thêm smoke test tun, trả `{ tun: bool, reason }`.
5. `nm-importer`: `supportsNetworkManager()` false thì trả `{ profiles: [], unsupported: true }`.
6. UI ẩn nút Import NM khi `unsupported`.

## Todo

- [ ] Smoke test `/dev/net/tun` trên Linux, macOS, Windows — **làm trước tiên**
- [ ] `platform.js` + test giả lập 3 giá trị `process.platform`
- [ ] Mọi đường dẫn state đi qua `stateDir()`
- [ ] `path-guard` xử lý đường dẫn Windows
- [ ] `check-prereqs` dùng smoke test container
- [ ] Ẩn Import NetworkManager ngoài Linux
- [ ] 60 test cũ vẫn pass trên Linux

## Tiêu chí hoàn thành

- `grep -rn "\.config/vpn-manager"` chỉ còn trong `platform.js`
- `check-prereqs` trả kết quả đúng trên cả 3 OS
- Tab VPN trên macOS/Windows không hiện nút Import NetworkManager

## Rủi ro

| Rủi ro | Xử lý |
|---|---|
| **Docker Desktop không cho mượn `/dev/net/tun`** | Smoke test ngay bước đầu; fail thì dừng và thiết kế lại |
| Đường dẫn macOS có dấu cách (`Application Support`) | Luôn bọc ngoặc kép, dùng `path.join` |
| Windows phân biệt hoa thường khác POSIX | So sánh lowercase trong `path-guard` |
| `%APPDATA%` khác `os.homedir()` | `stateDir()` là nguồn duy nhất, không suy diễn chỗ khác |
