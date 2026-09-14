# Windows — smoke test trước khi viết installer

Mục đích: biết Windows có chạy được kiến trúc hiện tại không, **trước khi** viết
`install.ps1`. Chạy trong **PowerShell** (không phải cmd). Không cần quyền Administrator.

Nếu hỏng, chỉ cần báo "hỏng ở bước N" kèm output.

> **Bước 2 và bước 4 là hai bước quyết định.**
> Bước 2 hỏng → Windows không dùng được kiến trúc này, phải thiết kế lại.
> Bước 4 hỏng → phải quay lại dùng bind-mount kèm lớp dịch đường dẫn.

---

## 1. Docker có chạy không, backend nào

```powershell
docker version --format "{{.Server.Version}}"
docker info --format "{{.OperatingSystem}} | {{.OSType}} | {{.Architecture}}"
wsl -l -v
```

**Kỳ vọng:** in ra version, `OSType` là `linux`.

`wsl -l -v` liệt kê `docker-desktop` → backend **WSL2**. Không có → **Hyper-V**.
Hai backend xử lý `--device` khác nhau nên cần ghi rõ đang dùng cái nào.

**Nếu lỗi `failed to connect ... docker.sock`:** Docker Desktop chưa chạy. Mở app,
chờ icon cá voi ở khay hệ thống hết nhấp nháy, chạy lại.

---

## 2. TUN device — bước quyết định

```powershell
docker run --rm --cap-add=NET_ADMIN --device /dev/net/tun alpine ls -l /dev/net/tun
```

**Kỳ vọng:** `crw-rw-rw-    1 root     root       10, 200 ... /dev/net/tun`

Lệnh này mới chỉ chứng minh **nhìn thấy** device. Thứ OpenVPN thật sự cần là tạo được
interface, nên chạy tiếp:

```powershell
docker run --rm --cap-add=NET_ADMIN --device /dev/net/tun alpine sh -c "apk add -q iproute2 && ip tuntap add dev tuntest mode tun && ip link del tuntest && echo TUN_OK"
```

**Kỳ vọng:** in ra `TUN_OK`

**Hỏng ở bước này thì DỪNG LẠI**, các bước sau không cần chạy nữa.

---

## 3. Publish cổng về 127.0.0.1

```powershell
docker run --rm -d --name porttest -p 127.0.0.1:18080:80 nginx:alpine
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:18080
docker rm -f porttest
```

**Kỳ vọng:** `200`

Đây là đường đi của SOCKS5 (cho trình duyệt) và port-forward (cho Navicat). Không có
nó thì cả hai đều vô dụng.

---

## 4. `docker cp` với đường dẫn Windows — bước quyết định

```powershell
"hello" | Out-File -Encoding ascii "$env:TEMP\cptest.txt"
docker create --name cptest alpine cat /tmp/cptest.txt
docker cp "$env:TEMP\cptest.txt" cptest:/tmp/cptest.txt
docker start -a cptest
docker rm -f cptest
```

**Kỳ vọng:** in ra `hello`

Kiểm đúng thứ Phase 01 dựa vào: Docker CLI tự đọc file bằng API của Windows rồi đẩy
vào container, không phải dịch `C:\Users\...` sang đường dẫn Linux. Chạy được thì toàn
bộ vấn đề bind-mount trên Windows biến mất.

---

## 5. Node

```powershell
node -v
where.exe node
```

**Kỳ vọng:** version >= 18

Đường dẫn quan trọng hơn version. Nếu node nằm trong `%APPDATA%\nvm\...` thì đang dùng
nvm-windows, và Chrome sẽ **không** thấy nó khi spawn native host — đúng lỗi đã gặp
trên Linux. Phần dò node trong `.bat` phải xử lý trường hợp này.

---

## 6. Trình duyệt nào có trên máy

```powershell
@("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ }
```

**Kỳ vọng:** ít nhất một dòng (Chrome)

Quyết định installer cần ghi những khoá registry nào.

---

## 7. PowerShell và ExecutionPolicy

```powershell
$PSVersionTable.PSVersion
Get-ExecutionPolicy -List
```

Nếu policy là `Restricted`, `install.ps1` sẽ cần chạy kèm `-ExecutionPolicy Bypass`.
Sẽ ghi sẵn trong README thay vì bắt đổi policy toàn hệ thống.

---

## 8. Thư mục state

```powershell
echo $env:APPDATA
echo $env:LOCALAPPDATA
```

Để `stateDir()` trả đúng chỗ lưu file `.ovpn` và registry pid trên Windows.

---

## Ghi kết quả

| Bước | Kết quả | Ghi chú |
|---|---|---|
| 1. Docker + backend | | WSL2 / Hyper-V ? |
| 2. TUN_OK | | **quyết định** |
| 3. Publish cổng 200 | | |
| 4. docker cp → hello | | **quyết định** |
| 5. Node version + đường dẫn | | có phải nvm-windows? |
| 6. Trình duyệt | | |
| 7. PowerShell + policy | | |
| 8. APPDATA | | |

## Dọn dẹp nếu có bước nào dừng giữa chừng

```powershell
docker rm -f porttest cptest 2>$null
Remove-Item "$env:TEMP\cptest.txt" -ErrorAction SilentlyContinue
```
