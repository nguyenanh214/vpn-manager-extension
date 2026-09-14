# Phase 05 — Installer Windows

**Ưu tiên:** Trung bình · **Trạng thái:** ✅ Xong — chạy thật trên Windows 11, kết nối VPN thành công · **Verify:** Windows 11 Pro 26200, PowerShell 5.1, 2026-09-14
**Phụ thuộc:** [Phase 03](phase-03-os-abstraction.md)

## Vì sao Windows cần file cài riêng

Ba khác biệt không thể gói vào `install.sh`:

1. **Không chạy được `.sh`** trừ khi cài Git Bash/WSL. Không thể coi là có sẵn.
2. **Native messaging đăng ký bằng registry**, không phải thả file vào thư mục:
   `HKCU\Software\Google\Chrome\NativeMessagingHosts\<tên>` với giá trị mặc định là
   đường dẫn tuyệt đối tới file manifest.
3. **Chrome không thực thi được `.js` trực tiếp.** Phải có `.bat` làm launcher.

Nên: `scripts/install.ps1` + `scripts/uninstall.ps1` bằng PowerShell — có sẵn trên
mọi bản Windows 10/11, không cần cài thêm gì.

## Môi trường đã khảo sát (2026-09-14)

| Mục | Giá trị | Ảnh hưởng |
|---|---|---|
| Docker | 29.8.0, Docker Desktop, backend **WSL2** | `--device` hoạt động ở backend này |
| TUN | `ls` thấy device **và** `ip tuntap add` → `TUN_OK` ✅ | Kiến trúc dùng được |
| Publish `127.0.0.1` | HTTP 200 ✅ | SOCKS5 và port-forward dùng được |
| `docker cp` | `hello` ✅ | **Phase 01 dùng được trên Windows, không cần lớp dịch đường dẫn** |
| Node | v24.21.0 tại `C:\Program Files\nodejs\node.exe` | Không phải nvm-windows — đường dẫn chuẩn |
| Trình duyệt | Chrome + **Edge** (không có Brave/Chromium) | Cần ghi registry cho cả Edge |
| PowerShell | **5.1** (Windows PowerShell, không phải PS7) | Xem mục bên dưới |
| ExecutionPolicy | mọi scope `Undefined` | Mặc định client là `Restricted` → **bắt buộc** `-ExecutionPolicy Bypass` |
| `%APPDATA%` | `C:\Users\<user>\AppData\Roaming` | `stateDir()` trỏ vào đây |

## Ràng buộc: PowerShell 5.1, không phải 7

Máy test dùng **Windows PowerShell 5.1** — bản ship sẵn với Windows, không phải
PowerShell 7 (`pwsh`). `install.ps1` phải viết cho 5.1, nghĩa là **không** dùng:

- Toán tử ternary `? :` và null-coalescing `??` `??=`
- `ForEach-Object -Parallel`
- `Test-Json`, `ConvertFrom-Json -AsHashtable`
- Chuỗi nội suy kiểu `$($x ?? 'default')`

Viết cho 5.1 thì chạy được trên cả 7; viết cho 7 thì 5.1 báo lỗi cú pháp ngay dòng đầu.
Không được giả định user cài PowerShell 7.

## Yêu cầu

- Chạy được bằng PowerShell mặc định, không đòi cài Git Bash hay WSL
- Ghi registry ở `HKCU` (không cần quyền Administrator)
- Sinh `.bat` launcher tự dò `node`
- Thông báo lỗi hướng dẫn từng bước như bản Linux/macOS
- `uninstall.ps1` xoá sạch registry, container, image, thư mục state

## Kiến trúc

```
scripts/install.ps1
  ├─ kiểm tra: docker, node, docker daemon đang chạy, smoke test TUN
  ├─ dựng image
  ├─ hỏi Extension ID
  ├─ ghi manifest ra %LOCALAPPDATA%\vpn-manager\com.andy.vpn_manager.json
  ├─ ghi registry cho từng trình duyệt tìm thấy
  └─ thử spawn native host giống cách Chrome spawn
```

Registry theo trình duyệt:

| Trình duyệt | Khoá |
|---|---|
| Chrome | `HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.andy.vpn_manager` |
| Chromium | `HKCU:\Software\Chromium\NativeMessagingHosts\com.andy.vpn_manager` |
| Brave | `HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.andy.vpn_manager` |
| Edge | `HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.andy.vpn_manager` |

Giá trị `(Default)` = đường dẫn tuyệt đối tới file manifest. Trong manifest, `path`
trỏ tới `vpn-manager-host.bat`.

## `vpn-manager-host.bat`

Cùng vai trò với `vpn-manager-host.sh`: dò node rồi exec. Hai ràng buộc riêng:

- **Không được in gì ra stdout** ngoài giao thức native messaging. `@echo off` là bắt
  buộc — thiếu nó, Chrome nhận rác ở đầu stream và ngắt kết nối ngay.
- Dò node theo thứ tự: `PATH` → `%ProgramFiles%\nodejs\node.exe` →
  `%LOCALAPPDATA%\Programs\nodejs\node.exe` → nvm-windows
  (`%APPDATA%\nvm\<version>\node.exe`).

## Điểm cần chú ý

**Thư mục state.** Linux/macOS dùng `~/.config/vpn-manager`. Windows nên dùng
`%APPDATA%\vpn-manager`. Đã trừu tượng hoá bằng `stateDir()` ở Phase 03 — Phase này
chỉ việc dùng, không được hardcode lại.

**Quyền file thay cho `chmod 0600`.** Windows không có chmod. File `.ovpn` chứa
private key phải được đặt ACL chỉ cho user hiện tại đọc:
`icacls <file> /inheritance:r /grant:r "%USERNAME%:(R,W)"`. Nếu bỏ qua bước này,
file secret sẽ kế thừa quyền của thư mục cha — mọi user trên máy đọc được.

**Backend Docker.** WSL2 và Hyper-V xử lý `--device` khác nhau. Smoke test TUN ở
Phase 03 phải chạy trên đúng backend user đang dùng; installer in ra backend nào đang
hoạt động để khi báo lỗi còn biết đường lần.

**Xuống dòng.** `.bat` nên dùng CRLF. Thêm `.gitattributes` ép `*.bat text eol=crlf`
để tránh git chuẩn hoá sai khi clone trên Linux rồi copy sang.

## File đụng tới

Tạo:
- `scripts/install.ps1`
- `scripts/uninstall.ps1`
- `native-host/vpn-manager-host.bat`
- `.gitattributes`

Sửa:
- `native-host/lib/platform.js` — `stateDir()` trả `%APPDATA%` trên Windows,
  `hostLauncher()` trả `.bat`
- `native-host/lib/ovpn-store.js` — dùng `icacls` thay `chmod` trên Windows

## Các bước

1. `vpn-manager-host.bat` + kiểm tra spawn thủ công bằng `cmd /c`.
2. `platform.js` bổ sung nhánh Windows cho `stateDir()` và `hostLauncher()`.
3. `ovpn-store.js` đặt ACL bằng `icacls` khi ở Windows.
4. `install.ps1`: kiểm tra điều kiện → dựng image → hỏi ID → ghi manifest → ghi
   registry → thử spawn.
5. `uninstall.ps1`: xoá khoá registry, container `vpnmgr-*`, image, thư mục state.
6. `.gitattributes` ép CRLF cho `.bat`.

## Todo

- [x] Smoke test TUN trên Windows — `TUN_OK`, backend WSL2 (2026-09-14)
- [x] `vpn-manager-host.bat` có `@echo off`, dò được node, không in rác ra stdout
- [x] `install.ps1` chạy không cần quyền Administrator (2026-09-14, sau khi sửa 4 lỗi)
- [x] Registry ghi đúng cho các trình duyệt có mặt trên máy — Chrome + Edge
- [x] ACL file `.ovpn` — `icacls` trả về đúng một ACE `Admin\Andy:(R,W)`, đã gỡ kế thừa
- [x] `uninstall.ps1` xoá sạch registry, image, state; cài lại được ngay sau đó
- [x] Native host trả lời đúng giao thức khi bị spawn như Chrome spawn
- [x] `docker create` → `docker cp` từ đường dẫn `C:\...` → `docker start` chạy được
- [x] Chrome thật nối được tới native host qua popup — nút Import NetworkManager
      ẩn đúng trên Windows, mà nó chỉ ẩn khi `check-prereqs` trả về `ok:true` kèm `os:windows`
- [x] Import `.ovpn` → kết nối — **user xác nhận chạy được trên Windows (2026-09-14)**

## Tiêu chí hoàn thành

- `install.ps1` chạy trọn vẹn bằng PowerShell mặc định, không quyền admin
- Chrome spawn được native host qua `.bat`
- Import `.ovpn` và bật domain hoạt động, traffic ra đúng IP VPN
- File `.ovpn` trên đĩa chỉ user hiện tại đọc được
- `uninstall.ps1` dọn sạch cả registry

## Rủi ro

| Rủi ro | Xử lý |
|---|---|
| **Docker Desktop không cho mượn `/dev/net/tun`** | Smoke test Phase 03 phải pass trước, nếu không thì dừng |
| `.bat` in rác ra stdout làm hỏng giao thức | `@echo off`, mọi thông báo chuyển sang stderr |
| ExecutionPolicy chặn `.ps1` | Hướng dẫn `powershell -ExecutionPolicy Bypass -File install.ps1`, không bảo user đổi policy toàn hệ thống |
| Quên đặt ACL, file secret lộ cho user khác | Có mục kiểm chứng riêng trong Todo |
| Node cài bằng nvm-windows không nằm trong PATH của Chrome | `.bat` dò thêm `%APPDATA%\nvm` |

## Bảo mật

Windows là nơi dễ sai nhất về quyền file. Trên Linux/macOS `chmod 0600` là đủ; trên
Windows file kế thừa ACL của thư mục cha, nghĩa là **mặc định có thể user khác đọc
được**. Bước `icacls` không phải tuỳ chọn — thiếu nó là private key trong `.ovpn` bị
lộ cho mọi tài khoản trên máy.

## Kết quả

### Viết xong, kiểm từ máy Linux (2026-09-14)

- `.bat` dòng đầu là `@echo off`; 0 lệnh `echo` ra stdout, 2 thông báo đều `>&2`.
- `.bat` dùng ASCII không dấu: cmd chạy codepage 437/1258, tiếng Việt có dấu sẽ thành
  ký tự rác.
- Không có cú pháp PowerShell 7 nào trong `.ps1`.
- `.gitattributes` ép `*.bat` và `*.ps1` dùng CRLF, `*.sh` dùng LF.
- Registry chỉ ghi cho trình duyệt thật sự có mặt.

### Chạy thật trên Windows (2026-09-14)

Máy: Windows 11 Pro 26200, Windows PowerShell 5.1.26100.6584, Node v24.21.0,
Docker Desktop backend WSL2.

**4 lỗi chặn ngay từ đầu, đã sửa** (chi tiết nguyên nhân gốc trong
[docs/project-changelog.md](../../docs/project-changelog.md)):

1. `.ps1` thiếu BOM → PS 5.1 đọc bằng codepage ANSI, tiếng Việt thành rác, chết lúc parse.
2. `node -p '...".."...'` → PowerShell bóc mất dấu nháy kép, script báo thiếu Node dù có v24.
3. `docker build ... *> $null` → PS 5.1 bọc stderr native thành ErrorRecord, gặp
   `$ErrorActionPreference = 'Stop'` là chết dù exit code 0.
4. Manifest ghi kèm BOM → bộ đọc JSON của Chrome từ chối.

**Đã kiểm chứng hoạt động:**

| Việc | Bằng chứng |
|---|---|
| `install.ps1` chạy trọn 6 bước, không cần admin | Cả 6 bước in ✓ |
| Registry Chrome + Edge | `reg query` thấy `(Default)` trỏ đúng file manifest |
| Manifest không BOM, backslash escape đúng | 4 byte đầu là `7B 0D 0A 20`, path dạng `C:\Users\...` |
| `.bat` không in gì ra stdout | `cmd /c ... < NUL`: stdout dài 0 byte, marker khởi động ra stderr |
| Native messaging framing | `ping` trả `{"pong":true,...}`, `check-prereqs` trả `os:windows, docker:true, image:true, tun:{ok:true}, nmcli:null` |
| `tunProbe` trong container | `TUN_OK` |
| ACL file `.ovpn` | `icacls` trả đúng một ACE `Admin\Andy:(R,W)`, kế thừa đã gỡ |
| Import `.ovpn` thật | `save-ovpn` ghi vào `%APPDATA%pn-manager\profiles\`, parser lấy đúng remote/proto/khối inline |
| `docker cp` từ đường dẫn Windows | Container nhận `/config/client.ovpn`, OpenVPN đọc được |
| Chrome thật nối được tới native host | Popup ẩn nút Import NetworkManager — chỉ xảy ra khi `check-prereqs` về tới popup với `os:windows`; `call()` hỏng thì nút vẫn hiện |
| Dọn dẹp khi lỗi | Tunnel hỏng → không còn container `vpnmgr-*` mồ côi |
| `uninstall.ps1` | Xoá sạch registry, image, state; cài lại ngay sau đó thành công |

**Kết nối thật:** user xác nhận import `.ovpn` rồi **kết nối thành công trên Windows**
(2026-09-14).

Lần thử đầu trong phiên này thất bại, nhưng không phải lỗi phía mình: file `.ovpn` mẫu
trỏ tới `vpn.example.net`, tên đó **không có bản ghi A** — cả resolver của Windows lẫn
1.1.1.1 đều trả lời rỗng, trong khi cùng container ấy resolve `one.one.one.one` bình
thường. File user import qua popup trỏ thẳng IP nên không vướng DNS.

### Bổ sung: test tự động chạy trên Windows (2026-09-15)

Ba bộ test trước đây chỉ chạy được trên Linux, nay chạy thật trên chính máy Windows
này. Không sửa một dòng nào trong `native-host/` hay `extension/` — lỗi nằm ở bộ test,
không phải ở tính năng.

| Bộ | Kết quả | Phủ cái gì |
|---|---|---|
| `platform` | 24/24 | Đường dẫn và hành vi theo OS |
| `ovpn-store` | 9/9 | Dọn file .ovpn mồ côi, ACL Windows |
| `prune-ovpn` | 8/8 | Đường xoá file đi qua native messaging thật |
| `host-registry` | 9/9 | Chỉ host CUỐI CÙNG thoát mới được dọn tunnel, tunnel thật |
| `traffic` | 7/7 | Traffic thật sự đi qua tunnel |

`traffic` là bộ mới, dựng để đóng đúng khoảng trống traffic chưa kiểm mà không cần
Chrome for Testing:

| Đo | Giá trị |
|---|---|
| IP trực tiếp trước khi bật | `198.51.100.20` |
| Qua SOCKS `127.0.0.1:1099` | `203.0.113.10` — đúng IP máy chủ VPN |
| IP trực tiếp trong lúc tunnel bật | `198.51.100.20` — không bị đổi đường |
| DNS phân giải trong tunnel | Cùng lối ra `203.0.113.10`, không rò ra resolver máy |

**Vẫn CHƯA kiểm trên Windows:** lớp PAC của `chrome.proxy` — đúng domain đã bật mới đi
qua tunnel, còn lại đi thẳng. Đó là `routing.test.mjs`, cần Chrome for Testing nên vẫn
chỉ chạy trên Linux. Đường ống bên dưới PAC thì đã có bằng chứng đầy đủ.

Tám lỗi của bộ test lộ ra trong phiên này, chi tiết nguyên nhân gốc
trong [docs/project-changelog.md](../../docs/project-changelog.md).

Phase 05 đến đây là **xong**.
