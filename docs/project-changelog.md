# Changelog

## 1.8.0 — 2026-09-15

### Chuẩn bị publish
- **LICENSE (GPL-3.0)**, sao chép nguyên văn. Không có license thì mặc định là
  *all rights reserved* — code công khai nhưng về pháp lý không ai được fork.
- **SECURITY.md** — mô hình đe doạ, tách rõ "bảo vệ được gì" và "KHÔNG bảo vệ được gì",
  cách báo lỗ hổng riêng tư.
- Thông báo giấy phép gắn vào 7 điểm vào chính, không rải khắp 35 file.

### README viết lại cho ba hệ điều hành
README đang hướng dẫn chạy `./scripts/install.sh` — **file đó không còn tồn tại** từ
lúc tách installer theo OS. Ai clone về làm theo là hỏng ngay bước đầu.

- Bảng yêu cầu theo từng OS. Bỏ `/dev/net/tun` khỏi yêu cầu chung: trên macOS/Windows
  Docker chạy trong VM nên host không có device đó, ghi vào đây chỉ làm người ta hoang
  mang. Kèm cảnh báo `brew install docker` chỉ cài CLI, không có daemon.
- Ba bước cài chung cho mọi OS, chỉ khác lệnh ở bước 2. Nhắc `-ExecutionPolicy Bypass`
  là bắt buộc trên Windows, và Extension ID khác nhau giữa các máy.
- Bảng **đã kiểm chứng tới đâu**, trung thực từng ô: macOS vẫn ⬜ vì chưa ai chạy thật.
- Mục Sử dụng viết lại: bổ sung **`Import từ file .ovpn`** — tính năng chính thêm ở
  1.4.0 nhưng README chưa hề nhắc tới — và ghi rõ Import từ NetworkManager chỉ có
  trên Linux.
- Thêm mục cho người fork, chính sách đóng góp, và giấy phép.

## 1.8.0 — 2026-09-15

### Test chạy được trên Windows, và tám lỗi của chính bộ test

`prune-ovpn` và `host-registry` viết từ máy Linux, chưa chạy trên Windows lần nào.
Chạy thử thì lộ ra tám lỗi — **tất cả nằm trong bộ test**. Code sản phẩm qua hết mà
không phải sửa một dòng nào trong `native-host/` hay `extension/`. Có đúng một điểm
đáng ngờ ở `path-guard.js` được ghi lại bên dưới, chưa sửa.

Hai lỗi nguy hiểm, cùng một gốc: **test dùng state dir THẬT của user.**

- `prune-ovpn` spawn host với `HOME` thật rồi bước cuối gọi `prune-ovpn` với
  `keepIds: []` — tức là xoá sạch mọi `.ovpn` của chính người chạy test. Private key
  inline, mất là mất hẳn. Sửa: trỏ `APPDATA`/`HOME` vào thư mục tạm, và dừng hẳn nếu
  `PROFILE_DIR` tính ra lại nằm ngoài sandbox.
- `host-registry` **không có chốt chặn nào cả**, mà bước cuối của nó cố ý kích hoạt
  `stopAll()` — lệnh này xoá mọi container `vpnmgr-*` chứ không riêng container của
  test. Chạy lúc user đang bật tunnel là tunnel bay, im lặng.

Một lỗi khiến `host-registry` kiểm sai chứ không chỉ kiểm hụt: registry không sandbox
nên host thật do Chrome spawn cũng nằm trong `hosts/`. `2 host đăng ký` đọc ra 3, và B
không bao giờ là host cuối cùng nên **nhánh dọn tunnel không bao giờ được kiểm**.
Trước đây phải đóng hẳn Chrome mới chạy được bộ này; giờ thì không cần.

Ba lỗi còn lại đều là giả định Linux bị bê nguyên sang Windows:

- **`execSync` với nháy đơn kiểu POSIX.** `cmd.exe` không coi `'` là dấu nháy, nên
  `docker ps --filter 'name=^vpnmgr-'` thành `invalid filter ''name'`. Chốt chặn của
  `prune-ovpn` chết ngay ở đó — may là chết trước khi kịp phá, nhưng đó là tai nạn
  chứ không phải thiết kế. Sửa: `execFileSync` với mảng tham số.
- **`child.pid` là pid của `cmd.exe`, không phải của node.** Launcher Windows là
  `.bat` nên chạy dưới `cmd.exe`, mà registry lưu pid của tiến trình node. Assert
  `registered()[0] === String(b.pid)` không bao giờ khớp được. Sửa: hỏi thẳng host
  qua `ping`, nó trả `process.pid` của chính nó.
- **Giết host phải giết cả cây.** Cùng gốc: `child.kill()` chỉ hạ `cmd.exe`, còn
  `node.exe` sống tiếp, thấy stdin EOF rồi `stopAll()` sau 15s — đúng thứ chốt chặn
  cố tránh. Mỗi lần chạy test để lại một host mồ côi có 15 giây vũ trang sẵn. Sửa:
  `taskkill /PID <pid> /T /F`.

Còn một lỗi chỉ lộ khi chạy thật: host báo `spawn docker ENOENT`. Nguyên nhân là
**"PATH tối thiểu" của Chrome không giống nhau giữa các OS.** Trên Linux Chrome đúng
là cho `/usr/bin:/bin` và `docker` nằm sẵn ở đó, nên test giả lập được. Trên Windows
Chrome truyền nguyên PATH của user, mà `docker.exe` nằm trong thư mục cài Docker
Desktop — cắt PATH kiểu Linux là host tưởng như Docker chưa chạy.

Và một lỗi macOS tìm ra khi rà lại nhánh chưa chạy được: `path-guard` so
`realpathSync(file)` với `HOME` **chưa resolve**. macOS trỏ `/tmp` và `/var` qua
symlink sang `/private`, nên cert nằm ngay trong sandbox vẫn bị báo `phải nằm trong
thư mục home`. Sửa: `realpathSync()` quanh thư mục sandbox ngay khi tạo.

Lưu ý cho phiên macOS: bản vá trên chỉ né vấn đề trong test, **`path-guard.js` vẫn
giữ nguyên thế bất đối xứng** — nó realpath đường dẫn cert nhưng không realpath
`HOME`. Home tiêu chuẩn của macOS (`/Users/<tên>`) không có symlink nên user thường
không dính, nhưng home nằm trên ổ ngoài hay qua symlink là cert hợp lệ bị từ chối với
thông báo khó hiểu. Chưa sửa vì chưa có máy macOS để dựng lại tình huống.

### Bộ test mới: `traffic` (7 test)

`ovpn.test.mjs` đã kiểm traffic thật đi qua tunnel, nhưng đi qua Chrome for Testing
nên chỉ chạy được trên Linux — khoảng trống lớn nhất còn lại của Windows. Bộ mới bỏ
lớp trình duyệt: dựng tunnel qua native host thật rồi so IP giữa `curl` trực tiếp và
`curl` qua cổng SOCKS.

Kết quả trên Windows 11: qua SOCKS ra `203.0.113.10` đúng IP máy chủ VPN, trực tiếp
vẫn `198.51.100.20` không bị đổi đường, DNS phân giải trong tunnel cùng lối ra.

Bộ này **không** phủ lớp PAC của `chrome.proxy` — chọn đúng domain nào đi tunnel vẫn
là việc của `routing.test.mjs` và vẫn chỉ chạy trên Linux.

### Kiểm chứng

Chạy thật trên Windows 11 Pro 26200, Node v24.21.0, Docker Desktop WSL2:
`platform` 24/24, `ovpn-store` 9/9, `prune-ovpn` 8/8, `host-registry` 9/9,
`traffic` 7/7. Tổng **130 test**, 57 trong số đó nay có bằng chứng trên Windows.

Nhánh POSIX của ba file này vẫn **chưa chạy** — kể cả bản vá `realpath`. Phiên macOS
chạy `tests/run-all.sh prune-ovpn host-registry traffic` sẽ đóng nốt.

## 1.7.1 — 2026-09-15

### Kiểm chứng
- Chạy lại toàn bộ test trên Linux sau các thay đổi từ phiên Windows: **122/122 pass**.
  Các file dùng chung bị đụng (`ovpn-store.js`, `vpn-manager-host.js`,
  `extension/background/*`) không gây hồi quy.
- Đóng gap phiên Windows để lại: `prune-ovpn` **đi qua native host thật** giờ đã có
  test (7 test). Đây là đường code xoá file của user nên cần chốt chặn ở cả khâu nối
  dây qua native messaging, không chỉ ở hàm `pruneExcept`:
  - payload thiếu `keepIds` bị từ chối và **không xoá file nào**
  - file còn profile trỏ tới được giữ, file mồ côi bị xoá
  - tên file không phải id hợp lệ bị bỏ qua thay vì xoá bừa
  - `keepIds: []` tường minh thì dọn sạch

  Bộ test tự bỏ qua nếu đang có tunnel chạy, vì spawn native host là hẹn giờ 15s
  rồi `stopAll()`.

## Chưa phát hành

### Rò rỉ file .ovpn khi xoá VPN (2026-09-14)

File `.ovpn` chứa private key inline, nên rơi một file là rơi nguyên một secret mà
UI không còn chỗ nào trỏ tới để user xoá. Hai chỗ để rơi:

- **`delete-vpn` nuốt lỗi.** Lời gọi `delete-ovpn` bọc trong `.catch(() => {})`, nên
  khi native host không trả lời (Docker chưa chạy, host vừa bị kill) thì profile vẫn
  biến mất khỏi `chrome.storage` còn file vẫn nằm trên đĩa — user tin là đã xoá xong.
  Sửa: xoá file **trước** khi gỡ profile, hụt thì dừng hẳn và báo rõ, chưa đụng gì để
  user thử lại.

- **Không ai dọn file mồ côi.** `ovpn-store.list()` có sẵn kèm comment "dùng để dọn
  file mồ côi" nhưng grep cả repo không chỗ nào gọi. Thêm `pruneExcept(keepIds)` và
  action `prune-ovpn`, service worker gọi lúc `onStartup` và `onInstalled`. Bắt hai
  trường hợp luồng xoá không lo được: `save-ovpn` ghi file xong thì service worker
  MV3 bị Chrome kill trước khi kịp lưu profile, và storage của extension bị xoá sạch.

`pruneExcept` **ném lỗi** khi thiếu `keepIds` thay vì coi như mảng rỗng — để mặc định
rỗng ở một hàm xoá file nghĩa là xoá sạch config của user. Chỉ extension biết id nào
còn sống, host chỉ nhìn thấy file, nên danh sách giữ lại bắt buộc do bên gọi đưa vào.
Tên file không phải id hợp lệ thì bỏ qua chứ không xoá bừa.

Bộ test mới `ovpn-store` (9 test) chạy trong sandbox bằng cách trỏ `APPDATA`/`HOME`
vào thư mục tạm, kèm chốt chặn dừng ngay nếu sandbox không ăn. Không cần trình duyệt
lẫn Docker nên chạy được trên cả ba OS.

### Text danh sách VPN rỗng nhắc NetworkManager ngoài Linux (2026-09-14)

Nút "Import từ NetworkManager" đã tự ẩn ngoài Linux từ Phase 03, nhưng text lúc danh
sách rỗng vẫn bảo user "Import từ NetworkManager hoặc thêm thủ công" — trên Windows là
chỉ tới một nút không tồn tại. Cho nó dùng chung đúng một nguồn dữ liệu với nút, giữ
dạng tri-state: `check-prereqs` phải chạy `docker run` cho `tunProbe` nên mất một hai
giây, trong lúc chờ mà đã nhắc NetworkManager rồi rút lại thì còn tệ hơn là không
nhắc. Chưa biết OS thì chỉ nói tới hai đường có ở mọi OS.

### Windows — chạy installer lần đầu (2026-09-14)

Bốn lỗi, tất cả đều chặn ngay từ những dòng đầu. Nguyên nhân gốc đều nằm ở chỗ
Windows PowerShell 5.1 và Chrome xử lý **encoding** và **stderr của native exe**
khác với những gì code viết từ máy Linux giả định.

- **`.ps1` lưu UTF-8 không BOM → script chết lúc parse.** PS 5.1 không đoán encoding
  của file `.ps1`: không có BOM thì nó đọc bằng codepage ANSI của máy. Mọi ký tự
  tiếng Việt vỡ thành chuỗi byte lạ, trong đó có byte mà parser hiểu là dấu nháy,
  nên báo một loạt "Unexpected token" và "string is missing the terminator" ở những
  dòng hoàn toàn bình thường. Sửa: thêm BOM cho cả hai `.ps1`. (PS 7 mặc định coi
  file không BOM là UTF-8 nên lỗi này không xuất hiện nếu chỉ test bằng `pwsh`.)
  Kèm theo phải đặt `[Console]::OutputEncoding` sang UTF-8, vì console mặc định là
  codepage 437/1258 — parse đúng rồi thì chữ in ra màn hình vẫn là rác.

- **`node -p` báo sai phiên bản Node.** PowerShell bóc một lớp dấu nháy kép trong
  đối số trước khi giao cho `node.exe`, nên `process.versions.node.split(".")[0]`
  tới nơi thành `split(.)[0]` và hỏng cú pháp. `node -p` in lỗi rồi trả chuỗi rỗng,
  `[int]''` thành 0, script kết luận "Cần Node >= 18" trên máy đang chạy v24. Sửa:
  lấy version bằng `node -v` rồi tách chuỗi trong PowerShell, không đẩy biểu thức JS
  qua ranh giới dấu nháy.

- **`docker build ... *> $null` làm script chết dù docker thành công.** PS 5.1 bọc
  **từng dòng** stderr của native exe thành `ErrorRecord`; `$ErrorActionPreference =
  'Stop'` biến một dòng tiến trình bình thường (`#0 building with "desktop-linux"`)
  thành lỗi kết thúc, ngay cả khi exit code là 0. Sửa: thêm `Invoke-Native` hạ
  preference xuống `'Continue'` quanh mỗi lệnh native rồi trả lại; người gọi vẫn tự
  kiểm `$LASTEXITCODE` như cũ.

- **Manifest native messaging ghi kèm BOM.** `Set-Content -Encoding UTF8` của PS 5.1
  **luôn** thêm BOM, mà bộ đọc JSON của Chrome từ chối BOM — Chrome sẽ coi như không
  có native host nào và báo "Specified native messaging host not found", một triệu
  chứng không hề gợi tới encoding. Sửa: ghi bằng
  `[System.IO.File]::WriteAllText(..., UTF8Encoding($false))`.

Đã kiểm chứng chạy thật sau khi sửa: cài → gỡ → cài lại trọn vẹn; registry Chrome và
Edge đúng; native host trả lời `ping`/`check-prereqs` qua đúng giao thức khi bị spawn
y như Chrome spawn; `docker cp` từ đường dẫn Windows vào container chạy được; `icacls`
khoá file `.ovpn` về đúng một user; Chrome thật nối được tới host qua popup.

**Import `.ovpn` rồi kết nối chạy thành công trên Windows** — user xác nhận. Lần thử
đầu thất bại vì file `.ovpn` mẫu trỏ tới một tên miền không có bản ghi A, không phải
lỗi của extension: cùng container ấy resolve tên khác bình thường.

Phase 05 xong. Còn lại macOS, vẫn là code chưa chạy thử lần nào.

## 1.6.0 — 2026-09-14

### Installer cho ba hệ điều hành
`install.sh` tách thành ba entry point rõ ràng. Hai script bash dùng chung
`scripts/lib/install-common.sh`: Linux và macOS chỉ khác đường dẫn manifest và
thông báo lỗi Docker, tách hẳn thành hai file sẽ lệch dần mỗi lần sửa.

- **macOS**: `install.sh` cũ **vỡ ngay** vì `DOCKER_ENV=()` + `set -u` — macOS vẫn
  ship bash 3.2 từ 2007. Đã bỏ mảng, kiểm chứng bằng cách chạy thật trong container
  `bash:3.2`. Thư mục manifest chuyển sang `~/Library/Application Support/`.
- **Kiểm TUN**: bỏ `[ -c /dev/net/tun ]` trên host (luôn sai trên macOS/Windows vì
  Docker chạy trong VM), thay bằng chạy container thật với `ip tuntap add`.
- **Ba tình huống Docker, ba hướng dẫn**: chưa cài / chỉ có CLI do
  `brew install docker` / daemon chưa chạy. Gộp chung thành "Docker không dùng được"
  là bắt user tự mò.
- **Windows**: `install-windows.ps1` viết cho PowerShell 5.1 (bản ship sẵn), đăng ký
  bằng registry HKCU nên không cần quyền Administrator, dùng `.bat` launcher vì Chrome
  không thực thi được `.js`. `icacls` khoá thư mục state về đúng user.
- `.gitattributes` ép `.bat`/`.ps1` dùng CRLF, `.sh` dùng LF.

### Trạng thái kiểm chứng
Linux chạy thật. macOS chạy trong container bash 3.2 với `uname` giả. Windows
**chưa chạy lần nào** — chờ verify trên máy thật.

## 1.5.0 — 2026-09-14

### Trừu tượng hoá OS
Chuẩn bị nền cho installer macOS và Windows. `native-host/lib/platform.js` là nơi duy
nhất biết khác biệt giữa các hệ điều hành.

- Thư mục state: `~/.config/vpn-manager` trên Linux/macOS, `%APPDATA%\vpn-manager`
  trên Windows.
- Thư mục manifest native messaging khác nhau từng OS; Windows dùng **registry** nên
  trả về rỗng và có bảng khoá riêng cho Chrome/Chromium/Brave/Edge.
- Nơi dò node: macOS ưu tiên `/opt/homebrew/bin` (Apple Silicon) trước `/usr/local`;
  Windows dò `%ProgramFiles%\nodejs` và nvm-windows.
- Dùng `path.win32` khi nhắm Windows để giả lập từ Linux vẫn sinh đúng dấu `\`.
- `check-prereqs` thay `[ -c /dev/net/tun ]` bằng `tunProbe()` chạy container thật
  (`ip tuntap add`). Trên macOS/Windows host không có device này vì Docker chạy trong
  VM, kiểm tra file sẽ luôn sai. `ls /dev/net/tun` cũng không đủ — nó chỉ chứng minh
  node thiết bị nhìn thấy được.
- `ovpn-store` dùng `icacls` trên Windows thay `chmod`: file kế thừa ACL thư mục cha
  nên mặc định user khác trên máy đọc được private key.
- Nút Import NetworkManager tự ẩn ngoài Linux.

Tách `tunnel-health.js` và `prereq-check.js` để không file nào vượt 200 dòng.

## 1.4.0 — 2026-09-14

### Import file .ovpn
Nút `Import từ file .ovpn` ở tab VPN. Import xong là dùng được ngay, không phải điền
gateway và 4 đường dẫn cert như trước.

- Chrome **không** cho extension biết đường dẫn thật của file người dùng chọn
  (`File` object không có `.path`), nên bắt buộc đọc nội dung rồi nhờ native host ghi
  ra đĩa. Nội dung không bao giờ vào `chrome.storage` — chỉ đường dẫn được lưu.
- File lưu ở `~/.config/vpn-manager/profiles/<id>.ovpn` quyền `0600`. Xoá profile thì
  xoá luôn file, không để lại private key mồ côi.
- Container **dùng thẳng file**, không parse rồi dựng lại config. File .ovpn có thể
  chứa directive lạ (mẫu thật có `ignore-unknown-option block-outside-dns`) mà dựng
  lại sẽ làm mất. Các override của extension truyền qua tham số dòng lệnh.
- `explicit-exit-notify` chỉ thêm khi `proto udp` — thêm vào lúc TCP là OpenVPN báo lỗi.
- Parser từ chối ngay lúc import, kèm lý do cụ thể: file trỏ cert bên ngoài,
  cần `auth-user-pass`, private key mã hoá bằng passphrase.
- `signatureOf` băm nội dung file .ovpn, nên sửa file bên ngoài cũng làm container dựng lại.

### Đã kiểm chứng
82/82 test pass, gồm kết nối thật bằng file .ovpn và kiểm tra `chrome.storage` không
chứa chuỗi `BEGIN` nào.

## 1.3.0 — 2026-09-14

### Thay đổi
- Cert vào container bằng `docker cp` thay vì bind-mount. Docker CLI tự đọc file bằng
  API của OS nên không còn khâu dịch đường dẫn — điều kiện cần để chạy trên Windows.
- `signatureOf` băm **nội dung** cert thay vì đường dẫn. Với bind-mount, sửa cert có
  hiệu lực ngay; với `docker cp`, nội dung được sao lúc tạo container nên nếu vẫn băm
  đường dẫn thì đổi cert sẽ không dựng lại container và tunnel chạy tiếp bằng cert cũ.
- Thư mục cert trong container đổi `/certs` → `/config`.
- Bộ test chuyển vào `tests/` trong repo, chạy bằng `tests/run-all.sh`.

### Đã kiểm chứng
- 60/60 test pass
- Sửa nội dung cert (giữ nguyên tên file) làm signature đổi → container dựng lại
- `docker cp` hoạt động với đường dẫn Windows (`C:\Users\...`), đã test trên máy thật

## 1.2.0 — 2026-09-14

Xử lý tunnel chết im lặng. Triệu chứng người dùng gặp: Navicat connect lần đầu OK,
lần hai lỗi `2013 - Lost connection at 'handshake: reading initial communication
packet', system error: 110`.

### Nguyên nhân
Một máy khác dùng **cùng certificate**. Server không bật `duplicate-cn` nên đá phiên
cũ. Client bị đá vẫn giữ `tun0` up và route đúng, không hay biết gì cho tới khi
`ping-restart` (server push 120s) kích hoạt. Trong 2 phút đó UI báo chấm xanh còn
mọi kết nối thì timeout.

### Sửa
- `explicit-exit-notify 1` — client thoát thì server giải phóng session ngay.
- `pull-filter ignore "ping-restart"` + `ping-restart 30` — tự hồi sau 30s thay vì 120s.
- `docker stop -t 5` trước `rm -f` — SIGTERM cho OpenVPN thoát sạch; trước đây
  `rm -f` SIGKILL khiến dựng lại container tự đụng session cũ của chính mình.
- `watchdog()` trong entrypoint — thoát container khi `tun0` biến mất. Đã quan sát:
  OpenVPN kẹt vòng lặp `TUN/TAP: File descriptor in bad state` vô hạn, container mãi
  "Up" nhưng chết bên trong.
- `docker-driver.health()` + action `tunnel-health` — kiểm tra thật thay vì chỉ
  `docker ps`. Popup gọi mỗi lần mở, tunnel hỏng thì dừng và dựng lại tự động.
- **Killswitch**: xoá default route qua `eth0` sau khi tunnel lên. Không có nó,
  `socat` (khác `sockd`, không ràng buộc interface) sẽ forward ra mạng thường trong
  lúc tunnel sập — đã kiểm chứng là rò thật.

### Đã kiểm chứng
- Xoá `tun0` thủ công → forward và SOCKS đều thất bại, không lọt ra IP thật lần nào.
- Watchdog thoát container trong ~10s.
- `health()` không bị đánh lừa khi `tun0` mất mà `eth0` vẫn có internet.

## 1.1.0 — 2026-09-14

Tab **Forward**: mở cổng TCP trên `127.0.0.1` chuyển tiếp qua tunnel, cho ứng dụng
desktop không hỗ trợ SOCKS5 (Navicat, DBeaver, psql...) dùng chung VPN với trình duyệt.

### Tính năng
- Tab thứ 3 với CRUD forward: thêm, sửa, xoá, bật/tắt, gán VPN.
- Validate: cổng cục bộ 1024-65535, chặn dải SOCKS 1080-1179, chặn trùng cổng,
  host đích phải là hostname/IPv4 hợp lệ.
- Bật khi chưa chọn VPN → báo "Chọn VPN trước", giống tab Domains.
- `socat` trong container thực hiện forward; `VPN_FORWARDS` truyền danh sách quy tắc.
- Nhãn `vpnmgr.signature` cho phép phát hiện cấu hình đổi và dựng lại container.
- Xoá VPN đang được forward dùng sẽ cảnh báo, liệt kê cả domain lẫn forward.

### Ghi chú kỹ thuật
- Server VPN không bật `duplicate-cn` (đã đo: hai container cùng cert → cùng IP
  10.8.0.4, cái đầu hỏng). Nên forward và domain dùng chung một tunnel cho mỗi profile.
- Navicat không hỗ trợ SOCKS5 cho kết nối DB — chỉ có `CURLPROXY_SOCKS5` cho HTTP.
  Đó là lý do chọn port-forward thay vì proxy.

### Lỗi đã sửa
- `update-forward` nhận nguyên object từ payload nên một object cũ mang `vpnId: null`
  âm thầm gỡ VPN khỏi forward, khiến reconcile dừng tunnel. Giới hạn còn 4 field
  được sửa, `vpnId`/`enabled` chỉ đổi qua action riêng.
- Route forward xuống nhiều dòng làm hàng quá cao; ép một dòng cắt bằng ellipsis.

## 1.0.0 — 2026-09-14

Phiên bản đầu. Định tuyến từng domain qua OpenVPN tunnel cô lập, không đụng
routing table của máy.

### Tính năng
- Popup 2 tab, giữ nguyên trạng thái (tab đang mở, form đang gõ dở) giữa các lần mở.
- Tab Domains: danh sách domain + chọn VPN + công tắc bật/tắt, cuộn khi dài.
  Bật khi chưa chọn VPN → báo "Chọn VPN trước", công tắc tự trả về off.
- Tab VPN: import từ NetworkManager (`nmcli`), thêm thủ công, nút test kết nối.
  Test so IP thật với IP qua tunnel, phát hiện trường hợp traffic không qua VPN.
- Validate domain: bóc scheme/path/port/`*.`/dấu chấm cuối, từ chối trùng và sai định dạng.
- Tunnel tự tắt khi Chrome đóng (grace 15s để không nhầm với service worker restart).

### Quyết định kỹ thuật
- **PAC script thay vì per-tab proxy** — `chrome.proxy` là per-profile, không có API per-tab.
- **OpenVPN trong Docker container** — `tun0` và default route bị giới hạn trong
  network namespace của container, host không bị ảnh hưởng.
- **dante-server (sockd)** thay cho microsocks — microsocks không có trong repo Alpine.
  `external: tun0` còn ép egress đi đúng tunnel kể cả khi route trong container đổi.
- **Chỉ lưu đường dẫn cert**, không lưu nội dung — `chrome.storage.local` là plaintext trên đĩa.

### Lỗi đã sửa trong quá trình phát triển
- `set -eu` + `[ -n "$X" ] && echo` trong entrypoint làm script thoát khi biến rỗng.
- `docker ps -q --format '{{.Names}}'` — `-q` ghi đè `--format`, trả về ID thay vì tên,
  khiến container mồ côi không bao giờ được dọn và giữ cổng SOCKS.
- `reconcile` loại domain khỏi PAC khi tunnel lỗi → domain âm thầm đi ra mạng thường.
  Chuyển sang fail-closed: giữ trong PAC để request fail rõ ràng.
- CSS `display:flex` đè `[hidden]{display:none}` → cả hai tab và modal rỗng hiện cùng lúc.
- `.panel` thiếu `min-width:0` → flex item không co được dưới chiều rộng nội dung,
  tràn ngang 71px làm mất công tắc và nút xoá.
- `text-overflow: ellipsis` đặt trên flex container không có tác dụng, phải đặt trên phần tử con.
- `#!/usr/bin/env node` chết với exit 127 khi Chrome spawn host: Chrome cấp PATH tối thiểu
  và không nạp shell profile, nên không thấy node cài qua nvm. Chrome chỉ báo
  "Native host has exited" không kèm lý do. Sửa bằng wrapper `.sh` tự dò node,
  cộng bước tự kiểm tra spawn trong `install.sh`.
- Lock file toàn cục không chịu được nhiều host cùng lúc (2 trình duyệt / 2 Chrome profile):
  host thoát trước bỏ qua dọn dẹp vì tưởng bị host khác chiếm lock, còn host thoát sau
  thì giết tunnel của trình duyệt vẫn đang mở. Thay bằng registry pid — chỉ host cuối
  cùng còn sống mới được dọn.
