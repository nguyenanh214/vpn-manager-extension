# VPN Manager Extension

Chrome extension định tuyến **từng domain** qua OpenVPN tunnel riêng, phần còn lại của
máy đi mạng bình thường. Extension không tự chạy VPN được (Chrome không có API đó) —
nó điều khiển một native messaging host bằng Node, host này quản lý container Docker
chạy OpenVPN client + SOCKS5 + port-forward.

Kiến trúc đầy đủ: [docs/system-architecture.md](docs/system-architecture.md)

## Việc tiếp theo

Cả ba hệ điều hành đã chạy thật: cài, gỡ, dựng tunnel, traffic ra đúng IP VPN, và luồng
bấm tay trong popup (import `.ovpn`, bật domain, port-forward). Không còn việc nào chặn
người dùng. Còn lại hai việc kỹ thuật:

1. **Chạy lại `tests/run-all.sh` đầy đủ trên Linux.** Đợt sửa macOS có đụng file dùng
   chung: `platform.js`, `docker-driver.js`, `scripts/lib/*.sh`, `tests/run-all.sh`,
   `tests/stop-chrome.sh` và bốn file test. Chưa ai chạy lại bộ cần trình duyệt.
2. **Port các bộ test cần trình duyệt sang macOS/Windows** — `tests/launch-chrome.sh`
   hardcode `chrome-linux64` và `DISPLAY`, còn `harness.js` giữ `EXT_ID` cố định trong
   khi Chrome sinh id theo đường dẫn nên mỗi máy một khác.

Máy Windows đang cài sẵn, extension id `jjjlompfphjoakhblebcifjpliigghhf`.
Máy macOS đang cài sẵn, extension id `jopcdlgobhaaaoaoplegfdeoidengnoa`.

## Trạng thái

| Phase | Trạng thái |
|---|---|
| 01 `docker cp` thay bind-mount | ✅ Linux |
| 02 Import file `.ovpn` | ✅ Linux |
| 03 Trừu tượng hoá OS | ✅ Linux |
| 04 Installer macOS | ✅ macOS 26 Apple Silicon, sửa 11 lỗi, kết nối thật chạy được |
| 05 Installer Windows | ✅ Windows 11 + PS 5.1, kết nối thật chạy được |
| 06 Tài liệu | ✅ README + LICENSE + SECURITY, bảng kiểm chứng đủ ba OS |

Kế hoạch: [plans/260914-1343-cross-platform-va-ovpn-import/plan.md](plans/260914-1343-cross-platform-va-ovpn-import/plan.md)

## Kiểm thử

142 test tự động, **phần lớn chỉ chạy được trên Linux** (cần bash + Chrome for Testing):

```bash
tests/run-all.sh              # tất cả
tests/run-all.sh platform     # một bộ
```

### 🔴 Trước khi chạy test: kiểm `.env`

Các bộ dựng tunnel THẬT cần một file `.ovpn` chạy được. Đường dẫn đó và IP lối ra là
dữ liệu riêng của từng máy nên **không nằm trong repo**.

**Nếu bạn là session mới và sắp chạy test:** kiểm `.env` ở gốc repo trước.

```bash
ls .env    # không có -> HỎI USER, đừng tự tạo
```

Không có `.env` thì **báo user và dừng lại**, đừng tự điền: chỉ user mới biết đường
dẫn `.ovpn` và IP lối ra của máy họ. Bảo họ chạy `cp .env.example .env` rồi điền, xong
mới chạy test.

Thiếu `.env` thì test **vẫn chạy và vẫn in "TẤT CẢ PASS"** — vì các bộ nặng tự bỏ qua
khi không có `.ovpn`. Đó là cái bẫy: xanh nhưng chưa kiểm gì. `run-all.sh` in trạng
thái cấu hình ngay dòng đầu, đọc nó trước khi tin kết quả.

| Biến | Bắt buộc | Dùng ở đâu |
|---|---|---|
| `VPNMGR_TEST_OVPN` | gần như | `ovpn`, `routing`, `forwards`, `host-registry`, `traffic` — file `.ovpn` tự chứa. Bỏ trống thì tự lấy file đầu tiên trong thư mục profiles |
| `VPNMGR_TEST_EXIT_IP` | không | so ĐÚNG IP lối ra. Bỏ trống thì chỉ kiểm traffic CÓ đổi lối ra |

`.env` đã nằm trong `.gitignore`. **Không bao giờ commit nó**, cũng không chép nội dung
nó vào báo cáo hay commit message.

- `platform` (36 test) — giả lập cả ba OS
- `ovpn-store` (9 test) — dọn file .ovpn mồ côi, chạy trong sandbox bằng cách trỏ
  `APPDATA`/`HOME` vào thư mục tạm
- `prune-ovpn` (8 test) — cùng chức năng nhưng đi qua native host thật, spawn đúng
  wrapper của OS. Host cũng chạy trong sandbox `APPDATA`/`HOME` nên không đụng
  profile thật. Tự bỏ qua nếu đang có tunnel chạy; không có Docker vẫn chạy được
- `host-registry` (9 test) — chỉ host CUỐI CÙNG thoát mới được dọn tunnel. Nặng
  nhất repo: dựng tunnel THẬT nên cần Docker, image đã build và một .ovpn chạy được
  (tự lấy file đầu tiên trong `profiles/`, hoặc chỉ định bằng `VPNMGR_TEST_OVPN`).
  Registry chạy trong sandbox nên **không cần đóng Chrome** nữa. Mất ~1 phút
- `traffic` (7 test) — traffic có thật sự đi qua tunnel không: so IP giữa `curl`
  trực tiếp và `curl` qua cổng SOCKS, và kiểm traffic ngoài tunnel không bị đổi
  đường. Cùng yêu cầu như `host-registry`. KHÔNG phủ lớp PAC của `chrome.proxy`
  — chọn đúng domain nào đi tunnel vẫn là việc của `routing`

## 🔴 Không bao giờ commit dữ liệu cá nhân

Repo này **public**. Lịch sử git là vĩnh viễn: sửa sau khi push nghĩa là phải viết lại
lịch sử, và GitHub vẫn giữ object cũ truy cập được qua SHA.

**Tuyệt đối không commit:**

| Loại | Ví dụ |
|---|---|
| Certificate, private key | `*.pem`, `*.key`, `*.crt`, `*.p12`, `*.ovpn` |
| Cấu hình riêng của máy | `.env` |
| IP công khai thật | IP máy chủ VPN, IP nhà của user |
| Định danh máy chủ thật | CN certificate, hostname DDNS, tên connection |
| Đường dẫn home của một người | `/home/<tên>`, `/Users/<tên>`, `C:\Users\<tên>` |

**Trong tài liệu và ví dụ, dùng dải dành riêng (RFC 5737 / RFC 2606):**
`203.0.113.10` cho máy chủ, `198.51.100.25` cho máy người dùng, `vpn.example.com`
cho hostname, `$HOME` hoặc `~` thay cho đường dẫn thật.

**Cũng đừng chép nội dung nhạy cảm vào nơi khác:** commit message, báo cáo, file trong
`plans/` hay `docs/`. Nội dung `.env` không bao giờ được in ra hay trích dẫn lại.

### Hook chặn sẵn

`scripts/githooks/pre-commit` chặn commit khi phát hiện file bí mật (kể cả khi bị
`git add -f` xuyên qua `.gitignore`), khối PEM trong nội dung đã stage, hoặc IP công
khai ngoài dải tài liệu. Đường dẫn home chỉ cảnh báo, không chặn.

```bash
git config core.hooksPath scripts/githooks    # bật một lần cho mỗi bản clone
```

Hook **không phải lớp bảo vệ duy nhất** — nó chỉ bắt được các mẫu đã biết. Trước khi
commit vẫn phải tự đọc `git diff --cached`. Nếu hook chặn nhầm thì sửa mẫu trong hook,
đừng quen tay `--no-verify`.

## Quy ước

- File code giữ **dưới 200 dòng**; bash script được miễn
- Tên file kebab-case
- Comment giải thích **tại sao**, không mô tả lại code
- Native host **zero dependency**, chỉ dùng thư viện chuẩn của Node
- Luôn `execFile`, **không bao giờ** `exec`/shell — mọi giá trị từ extension là input
  không tin cậy
- **Không bao giờ** lưu nội dung private key vào `chrome.storage`, chỉ lưu đường dẫn
- Commit theo conventional commits, tiếng Việt, không tham chiếu AI
- Chi tiết: [docs/code-standards.md](docs/code-standards.md)

## Bài học đã trả giá — đừng lặp lại

- **Chrome cache module service worker trong profile.** Sửa code rồi tái dùng profile
  cũ sẽ chạy bản CŨ dù file trên đĩa đã mới. `tests/launch-chrome.sh` xoá profile mỗi
  lần vì lý do này. Mất rất lâu mới tìm ra.
- **Chrome spawn native host với PATH tối thiểu**, không nạp shell profile. Node cài
  qua nvm sẽ không thấy được. Đó là lý do có wrapper `.sh`/`.bat` thay vì trỏ thẳng
  vào `.js`.
- **`pkill -f <pattern>` tự giết chính shell đang chạy** nếu pattern nằm trong command
  line của nó. Lọc theo tên process thay vì pattern.
- **Server VPN không bật `duplicate-cn`.** Hai client cùng certificate sẽ đá nhau; bên
  bị đá vẫn tưởng mình đang kết nối tới tận `ping-restart`. Đừng chạy hai tunnel cùng
  cert song song khi test.
- **PowerShell 5.1 đọc `.ps1` không BOM bằng codepage ANSI**, không đoán UTF-8. Chữ
  tiếng Việt vỡ thành byte mà parser hiểu nhầm là dấu nháy, script chết ngay lúc parse
  với lỗi trỏ vào những dòng hoàn toàn bình thường. PS 7 không dính, nên test bằng
  `pwsh` sẽ không thấy. Mọi `.ps1` trong repo phải giữ BOM.
- **PS 5.1 bọc từng dòng stderr của native exe thành `ErrorRecord`.** Gặp
  `$ErrorActionPreference = 'Stop'` thì một dòng tiến trình bình thường của `docker`
  cũng giết script dù exit code là 0. Mọi lệnh native trong `.ps1` phải đi qua
  `Invoke-Native`.
- **Bộ đọc JSON của Chrome từ chối BOM.** Manifest native messaging ghi bằng
  `Set-Content -Encoding UTF8` (PS 5.1 luôn kèm BOM) làm Chrome báo "Specified native
  messaging host not found" — triệu chứng không gợi gì tới encoding.
- **Spawn native host là hẹn giờ dọn tunnel.** Host đóng stdin sẽ chờ grace 15s rồi
  `stopAll()`. Đừng spawn host để thử nghiệm khi user đang có tunnel chạy thật.
- **Giết native host trên Windows phải giết cả cây process.** Launcher là `.bat` nên
  nó chạy dưới `cmd.exe`; `child.kill()` chỉ hạ `cmd.exe`, còn `node.exe` sống tiếp,
  thấy stdin EOF rồi `stopAll()` sau 15s — đúng thứ mình tưởng đã tránh được. Dùng
  `taskkill /PID <pid> /T /F`.
- **Test spawn host phải sandbox `APPDATA`/`HOME`.** Host tính `stateDir()` từ env
  lúc nạp module, nên truyền env tạm là đủ tách khỏi profile thật. Không làm thế thì
  `prune-ovpn` với `keepIds: []` xoá sạch file `.ovpn` của chính người chạy test.
- **macOS: Docker Desktop KHÔNG tạo `/var/run/docker.sock`.** Endpoint thật là
  `~/.docker/run/docker.sock`, chọn qua "context" nằm trong `$HOME/.docker`. Test nào
  sandbox `HOME` là mất context, mọi lệnh docker ném lỗi — mà helper trong test lại
  nuốt lỗi, nên hậu quả là chốt an toàn im lặng tắt ngóm và có bước **PASS sai**.
  Truyền `DOCKER_CONFIG` trỏ về HOME thật. Lấy HOME thật bằng `os.userInfo().homedir`,
  **không** phải `os.homedir()` — hàm sau đọc `$HOME` mà test vừa trỏ đi chỗ khác.
- **`timeout` là coreutils GNU, macOS không có.** `tests/run-all.sh` báo mọi bộ THẤT
  BẠI mà chưa hề chạy — trông y hệt test hỏng thật. Homebrew cài nó thành `gtimeout`.
- **`set -e` của entry point đè lên giả định của file được source.**
  `uninstall-common.sh` cố ý viết best-effort (`set -uo pipefail`, không `-e`), nhưng
  `uninstall-macos.sh` bật `-e` trước khi source. Một `ls` fail + `pipefail` là script
  chết giữa chừng, **không in chữ nào**, state còn nguyên. Tắt lại `set +e` tường minh.
- **Chạy `host-registry` sát `traffic` thì `traffic` vỡ.** Host đóng stdin còn chờ
  grace 15s rồi `stopAll()` — xoá container `vpnmgr-*` theo tiền tố tên, kể cả tunnel
  của bộ SAU. Thứ tự mặc định thoát nạn chỉ nhờ `prune-ovpn` chen giữa đủ lâu. Chờ host
  thoát thì so PID trước/sau, đừng đếm tổng: host của Chrome người dùng sống suốt phiên.
- **"PATH tối thiểu" của Chrome không giống nhau giữa các OS.** Trên Linux Chrome
  đúng là cho `/usr/bin:/bin`, và `docker` nằm sẵn ở đó nên test giả lập được. Trên
  Windows Chrome truyền nguyên PATH của user, mà `docker.exe` nằm trong thư mục cài
  Docker Desktop — bê nguyên PATH tối thiểu kiểu Linux sang là host báo
  `spawn docker ENOENT`, triệu chứng trông như Docker chưa chạy. **Trên macOS Chrome
  nhận PATH của launchd** (`/usr/bin:/bin:/usr/sbin:/sbin`), không có `/usr/local/bin`
  nơi Docker Desktop đặt symlink — cùng triệu chứng `spawn docker ENOENT`. Muốn biết
  PATH thật thì đọc thẳng tiến trình Chrome: `ps -p <pid> -E`, đừng đoán.
