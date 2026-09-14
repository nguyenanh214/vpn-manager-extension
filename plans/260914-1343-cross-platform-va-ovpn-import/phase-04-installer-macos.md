# Phase 04 — Installer macOS

**Ưu tiên:** Trung bình · **Trạng thái:** ⬜ Chưa làm · **Verify:** macOS (user chạy)
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

- [ ] `detect_os()` + thoát sớm nếu OS không hỗ trợ
- [ ] Sửa mảng rỗng cho bash 3.2 — **kiểm chứng bằng `docker run --rm -v ... bash:3.2`**
- [ ] Thư mục manifest theo OS trong cả install lẫn uninstall
- [ ] Smoke test TUN thay cho `[ -c /dev/net/tun ]`
- [ ] Thông báo lỗi hướng dẫn được cho 4 tình huống: thiếu Docker, Docker chưa chạy,
      thiếu node, không mượn được TUN
- [ ] User chạy trên macOS: install → load extension → import `.ovpn` → bật domain → kiểm IP

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
