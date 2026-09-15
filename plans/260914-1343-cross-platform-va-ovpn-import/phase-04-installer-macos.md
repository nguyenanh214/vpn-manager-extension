# Phase 04 — Installer macOS

**Ưu tiên:** Trung bình · **Trạng thái:** ✅ Đã chạy thật trên macOS, sửa 5 lỗi + 6 lỗi review bắt được · **Verify:** macOS 26, Apple Silicon (2026-09-15)
**Phụ thuộc:** [Phase 03](phase-03-os-abstraction.md)

## Vì sao

`install.sh` hiện tại **vỡ ngay trên macOS**, không phải lỗi vặt:

```bash
DOCKER_ENV=()                 # mảng rỗng
"${DOCKER_ENV[@]}" docker ...
```

macOS vẫn ship **bash 3.2** (2007, vì lý do giấy phép GPLv3). Ở bản đó, mảng rỗng kết
hợp `set -u` báo `unbound variable` và script chết ngay bước dựng image.

Ngoài ra `[ -c /dev/net/tun ]` luôn fail trên macOS — Docker chạy trong VM, host
không hề có device này.

## Quyết định: một script cho cả Linux và macOS

Không tách `install-macos.sh` riêng. Khác biệt chỉ nằm ở vài đường dẫn và phép kiểm
tra, đã gom vào `platform.js` ở Phase 03. Hai file gần giống hệt nhau sẽ lệch nhau
dần theo thời gian — vi phạm DRY.

`install.sh` tự nhận diện OS bằng `uname -s`.

## Yêu cầu

- Chạy được trên bash 3.2 (không dùng tính năng bash 4+)
- Không kiểm tra `/dev/net/tun` trên host; kiểm tra bằng smoke test container
- Thư mục manifest đúng chuẩn macOS
- Dò được node cài bằng Homebrew trên cả Apple Silicon lẫn Intel
- Báo lỗi kèm hướng dẫn khắc phục cụ thể, không chỉ báo "thiếu X"

## Khác biệt cụ thể

| Mục | Linux | macOS |
|---|---|---|
| Thư mục manifest Chrome | `~/.config/google-chrome/NativeMessagingHosts` | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts` |
| Brave | `~/.config/BraveSoftware/Brave-Browser/...` | `~/Library/Application Support/BraveSoftware/Brave-Browser/...` |
| Node qua Homebrew | — | `/opt/homebrew/bin/node` (ARM), `/usr/local/bin/node` (Intel) |
| Kiểm tra TUN | `[ -c /dev/net/tun ]` | smoke test container |
| Cách cài Docker | apt/dnf | Docker Desktop từ docker.com |

## Ba tình huống Docker phải phân biệt

Kiểm chứng thực tế trên macOS cho thấy `command -v docker` thành công **không** đảm
bảo dùng được. Ba trường hợp, ba cách sửa khác nhau, phải báo lỗi khác nhau:

| Tình huống | Dấu hiệu | Hướng dẫn |
|---|---|---|
| Chưa cài gì | `command -v docker` fail | Tải Docker Desktop, chọn đúng bản chip |
| Chỉ có CLI, thiếu daemon | Có `docker` nhưng không có `/Applications/Docker.app`; thường do `brew install docker` | `brew install --cask docker` rồi mở app một lần |
| Có daemon nhưng chưa chạy | `docker info` báo `failed to connect ... docker.sock: no such file` | Mở Docker Desktop, chờ icon cá voi hết nhấp nháy |

Trường hợp giữa là bẫy hay gặp nhất trên macOS: `brew install docker` chỉ cài CLI.

## Sửa bash 3.2

```bash
# Hỏng trên bash 3.2
DOCKER_ENV=()
"${DOCKER_ENV[@]}" docker ...

# Chạy được mọi phiên bản — giữ mảng nhưng có phòng vệ
"${DOCKER_ENV[@]+"${DOCKER_ENV[@]}"}" docker ...
```

Rà thêm: `declare -A`, `mapfile`, `readarray`, `${var,,}`, `${var^^}` — đều là bash 4+.
Đã kiểm tra: hiện chưa chỗ nào dùng, chỉ cần giữ nguyên tắc khi viết thêm.

## Thông báo lỗi phải hướng dẫn được

Ví dụ khi thiếu Docker trên macOS:

```
✗ Không tìm thấy Docker.
  1. Tải Docker Desktop: https://www.docker.com/products/docker-desktop/
     - Apple Silicon (M1/M2/M3): bản "Mac with Apple chip"
     - Intel: bản "Mac with Intel chip"
  2. Mở Docker Desktop, chờ icon cá voi trên thanh menu hết nhấp nháy
  3. Chạy lại script này
```

Khi Docker có nhưng chưa chạy thì hướng dẫn mở app, không phải cài lại. Phân biệt hai
tình huống này bằng `command -v docker` và `docker info`.

## File đụng tới

Sửa:
- `scripts/install.sh` — nhận diện OS, sửa bash 3.2, thông báo lỗi theo OS
- `scripts/uninstall.sh` — thư mục manifest theo OS
- `native-host/vpn-manager-host.sh` — kiểm tra lại thứ tự ưu tiên khi dò node,
  `/opt/homebrew/bin` phải đứng trước `/usr/local/bin` trên máy ARM

## Các bước

1. Thêm `detect_os()` trả `linux` / `macos`, thoát kèm thông báo rõ nếu OS khác.
2. `browser_dirs()` trả danh sách thư mục manifest theo OS.
3. Thay kiểm tra TUN bằng smoke test container, thông báo lỗi riêng từng OS.
4. Sửa mọi chỗ mảng rỗng cho hợp bash 3.2.
5. Viết lại các thông báo lỗi thành hướng dẫn từng bước.
6. `uninstall.sh` dùng chung `browser_dirs()`.

## Todo

- [x] `detect_os()` + thoát sớm nếu OS không hỗ trợ
- [x] Sửa mảng rỗng cho bash 3.2 — **kiểm chứng bằng `docker run --rm -v ... bash:3.2`**
- [x] Thư mục manifest theo OS trong cả install lẫn uninstall
- [x] Smoke test TUN thay cho `[ -c /dev/net/tun ]`
- [x] Thông báo lỗi hướng dẫn được cho 4 tình huống: thiếu Docker, Docker chưa chạy,
      thiếu node, không mượn được TUN
- [x] Chạy thật trên macOS: install → host do Chrome spawn → tunnel thật → traffic ra đúng IP VPN
- [x] Luồng bấm tay trong popup: import qua UI, gạt công tắc domain, port-forward

## Tiêu chí hoàn thành

- `install.sh` chạy trọn vẹn trên macOS, không lỗi bash
- Native host spawn được từ Chrome trên macOS
- Import `.ovpn` và bật domain hoạt động, traffic ra đúng IP VPN
- `uninstall.sh` dọn sạch trên macOS

## Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Còn bash-ism lọt lưới | Chạy script trong container `bash:3.2` trước khi giao user |
| Thư mục có dấu cách (`Application Support`) | Bọc ngoặc kép mọi biến đường dẫn |
| Docker Desktop chưa khởi động | `docker info` fail → hướng dẫn mở app, không bảo cài lại |
| macOS chặn script chưa ký | Chạy bằng `bash script.sh` chứ không phải app bundle, Gatekeeper không can thiệp |

## Bảo mật

Không khác Linux. Thư mục state vẫn `0700`, file `.ovpn` vẫn `0600`. macOS không thêm
ràng buộc nào cho native messaging ngoài đường dẫn manifest.

## Kết quả (2026-09-14)

**Đổi cấu trúc theo yêu cầu user:** ba entry point riêng thay vì một script tự dò OS.
Nhưng KHÔNG copy logic thành hai file bash — Linux và macOS chỉ khác vài chỗ (đường
dẫn manifest, thông báo lỗi Docker), hai file gần giống hệt nhau sẽ lệch dần mỗi lần
sửa. Logic chung nằm ở `scripts/lib/install-common.sh`.

```
scripts/
├── install-linux.sh        entry mỏng, đặt OS=linux
├── install-macos.sh        entry mỏng, đặt OS=macos
├── install-windows.ps1     implementation riêng (PowerShell)
├── uninstall-*.sh / .ps1
└── lib/install-common.sh, lib/uninstall-common.sh
```

Entry point chặn khi chạy nhầm máy, chỉ luôn script đúng cần dùng.

**Đã kiểm chứng trên bash 3.2 thật** (container `bash:3.2`, đúng bản macOS ship):
- Chạy trọn vẹn bước 1-5, không lỗi runtime — vấn đề mảng rỗng + `set -u` đã hết.
  `bash -n` không bắt được lỗi này vì nó chỉ lộ lúc chạy.
- Giả lập macOS bằng `uname` giả: ghi đúng vào
  `~/Library/Application Support/.../NativeMessagingHosts`, xử lý được dấu cách
  trong đường dẫn, chỉ ghi cho trình duyệt thật sự có mặt.
- Ba tình huống Docker ra ba hướng dẫn khác nhau: chưa cài / chỉ có CLI
  (`brew install docker`) / daemon chưa chạy.
- `uninstall-macos.sh` dọn sạch, báo rõ số file `.ovpn` bị xoá theo.

Linux không hồi quy: installer thật chạy đủ 6 bước, 106 test pass.


## Kết quả chạy thật trên macOS (2026-09-15)

**Máy:** macOS 26 (Darwin 25.3), Apple Silicon M1, bash 3.2.57, Docker Desktop 29.7.2,
node v22.23.0 qua **nvm**, chỉ cài Chrome. Extension id `jopcdlgobhaaaoaoplegfdeoidengnoa`.

Dự đoán lớn nhất của phase này — bash 3.2 làm vỡ installer — **đã sai**: `install-macos.sh`
chạy trọn 6 bước ngay lần đầu, không một lỗi bash nào. Công kiểm chứng trong container
`bash:3.2` ở vòng trước có tác dụng thật.

Năm lỗi tìm được, không cái nào là lỗi bash:

### 1. Host không tìm thấy `docker` khi Chrome spawn — lỗi chặn đứng

Đúng bài học Windows lặp lại ở dạng khác. Bằng chứng đọc thẳng từ tiến trình Chrome
đang chạy (`ps -p <pid> -E`): `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. Đó là PATH mặc định
của launchd, và `launchctl getenv PATH` rỗng nên không có gì bù vào. Docker Desktop đặt
symlink ở `/usr/local/bin/docker` — **ngoài PATH đó**. Kết quả:
`{"docker":false,"errors":["Docker không dùng được: spawn docker ENOENT"]}`.

Triệu chứng người dùng thấy sẽ là "Docker không dùng được", dễ hiểu nhầm thành Docker
chưa chạy, trong khi Docker hoàn toàn khoẻ.

Sửa: thêm `dockerSearchPaths()` + `resolveExecutable()` vào `platform.js`,
`docker-driver.js` dò một lần rồi dùng đường dẫn tuyệt đối. Giữ đúng quy ước "mọi khác
biệt OS đi qua platform.js".

### 2. Bước 6 của installer không đủ sức bắt lỗi trên

Nó chỉ kiểm host *khởi động được*, mà host khởi động được thật — nó chết sau đó, lúc
gọi docker. Đã thêm phép thử gọi `docker info` bằng đúng PATH tối thiểu, và sửa PATH
giả lập cho macOS thành 4 thư mục của launchd thay vì 2 của Linux.

### 3. `uninstall-macos.sh` thoát giữa chừng, im lặng, để lại state

Bước 4 in tiêu đề rồi **không in gì nữa**, `~/.config/vpn-manager` còn nguyên, exit 1.
Gốc: entry point bật `set -e`, còn `uninstall-common.sh` viết theo kiểu best-effort
(`set -uo pipefail`, cố ý không `-e`). Máy chưa import `.ovpn` nào nên `profiles/`
không tồn tại → `ls` fail → `pipefail` → `-e` giết script **ngay trước `rm -rf`**.

Linux dính y hệt, chỉ là ở đó `profiles/` thường đã có sẵn nên chưa ai gặp.
Sửa: `set +e` tường minh trong `uninstall-common.sh`, kèm lý do.

### 4. `tests/run-all.sh` không chạy được trên macOS

`timeout` là coreutils GNU, macOS không có → mọi bộ test báo THẤT BẠI mà chưa hề chạy.
Sửa: dùng `timeout`, `gtimeout`, hoặc chạy thẳng kèm cảnh báo.

### 5. Ba lỗi trong chính bộ test, lộ ra nhờ Docker Desktop

Docker Desktop trên macOS **không tạo `/var/run/docker.sock`**; endpoint thật là
`~/.docker/run/docker.sock`, chọn qua "context" lưu trong `$HOME/.docker`. Các bộ test
sandbox `HOME` nên mất context, mọi lệnh docker ném lỗi:

- `prune-ovpn`: chốt chặn "bỏ qua nếu đang có tunnel chạy" **im lặng tắt ngóm** — nó
  nuốt lỗi và kết luận không có tunnel nào. Đúng chốt chặn dựng ra để khỏi giết tunnel
  thật của user.
- `host-registry` + `traffic`: `dockerOut`/`run` cũng nuốt lỗi, nên mọi phép kiểm
  container thấy "trống" — vừa FAIL sai vừa **PASS sai** ở bước "tunnel đã được dọn".

Sửa: `tests/lib/host-sandbox.js` gom env sandbox (trước đó lặp ở ba file) và trả kèm
`DOCKER_CONFIG` trỏ về HOME thật. Dùng `os.userInfo().homedir` chứ không `os.homedir()`
vì hàm sau đọc `$HOME` mà test vừa trỏ sang sandbox.

Thêm hai chỗ nữa trong `run-all.sh`:
- Host đóng stdin còn chờ grace 15s rồi `stopAll()` — xoá mọi container `vpnmgr-*`,
  kể cả tunnel của bộ TIẾP THEO. Chạy `host-registry` sát `traffic` là `traffic` vỡ
  (tái hiện được). Thứ tự mặc định thoát nạn chỉ nhờ `prune-ovpn` chen giữa đủ lâu.
  Nay chờ đúng những host bộ vừa rồi sinh ra, so PID trước/sau — không đếm tổng, vì
  host của Chrome người dùng sống suốt phiên.
- `stop-chrome.sh` xoá `~/.config/vpn-manager/hosts` và `docker rm -f` mọi container
  `vpnmgr-*` của user. Nó chỉ cần cho các bộ dùng trình duyệt (chạy với HOME thật);
  gọi nó trước năm bộ tự sandbox là **xoá đăng ký của host Chrome đang sống và giết
  tunnel thật**. Đã giới hạn lại đúng phạm vi.

### Bằng chứng

| Kiểm | Kết quả |
|---|---|
| `install-macos.sh` 6 bước | ✅ ngay lần đầu, không lỗi bash 3.2 |
| `uninstall-macos.sh` → cài lại | ✅ sau khi sửa lỗi 3; dọn sạch, exit 0 |
| Native host do **Chrome thật** spawn | ✅ tiến trình sống, PPID = Google Chrome |
| Tunnel OpenVPN thật | ✅ dựng được, container chạy |
| Traffic ra đúng IP VPN | ✅ qua SOCKS: `203.0.113.10` — trực tiếp: `198.51.100.20` |
| Traffic ngoài tunnel | ✅ không bị đổi đường |
| 5 bộ test chạy được trên mọi OS | ✅ **69 PASS / 0 FAIL** (36+9+8+9+7) |

User xác nhận luồng bấm tay trong popup chạy được trên macOS: import `.ovpn` qua UI,
gạt công tắc domain, và port-forward. Phase đóng.

Còn lại ngoài phạm vi phase: các bộ test tự động cần trình duyệt vẫn chỉ chạy trên
Linux — `launch-chrome.sh` hardcode `chrome-linux64`, `DISPLAY` và extension id của
Linux, `harness.js` giữ `EXT_ID` cố định trong khi id sinh theo đường dẫn.

### Code review sau đó bắt thêm 6 lỗi, một trong số đó do chính đợt sửa này gây ra

Nghiêm trọng nhất: bỏ `stop-chrome.sh` trước các bộ không cần trình duyệt đã giết mất
sự cô lập giữa các bộ. Thứ tự mặc định có `lifecycle` (dùng Chrome) ngay trước
`host-registry`; Chrome sống xuyên ba bộ cuối, service worker rụng sau ~30s idle rồi
host `stopAll()` xoá tunnel của bộ đang chạy — và ba bộ đó `bail()` rồi `exit 0`, runner
báo **TẤT CẢ PASS** dù chưa chạy dòng nào. Sửa bằng cách tách `stop-chrome.sh` thành
phần giết Chrome (sau MỌI bộ) và phần dọn state thật (`--purge-state`, chỉ bộ browser).

Năm lỗi còn lại: thư mục lọt qua `canExec`; `resolveExecutable` bỏ qua PATH hoàn toàn
trên Windows vì không tự thêm `.exe`; probe docker mới có thể chặn nhầm cài đặt trên
Linux rootless; `DOCKER_CONFIG` bơm thừa cho Linux kéo theo `credsStore`; `os.userInfo()`
ném lỗi khi uid không có trong passwd. Chi tiết trong changelog 1.9.0.

Sau khi sửa: **69 PASS / 0 FAIL**, kể cả thứ tự `host-registry` → `traffic` từng làm vỡ.
