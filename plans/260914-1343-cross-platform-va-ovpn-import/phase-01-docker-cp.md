# Phase 01 — `docker cp` thay `bind-mount`

**Ưu tiên:** Cao (chặn mọi phase sau) · **Trạng thái:** ✅ Xong (2026-09-14) · **Verify:** Linux, tự động

Liên quan: [plan.md](plan.md) · [docs/system-architecture.md](../../docs/system-architecture.md)

## Vì sao

Hiện tại cert được đưa vào container bằng `-v /host/path/ca.pem:/certs/ca.pem:ro`.
Trên Windows, Docker Desktop phải dịch `C:\Users\andy\...` sang đường dẫn Linux; quy
tắc dịch khác nhau giữa backend WSL2 và Hyper-V, và `path-guard` đang kiểm tra
`$HOME` theo kiểu POSIX.

`docker create` → `docker cp` → `docker start` bỏ hoàn toàn khâu dịch: Docker CLI đọc
file bằng API của OS rồi đẩy vào container qua stream.

## Nhận định quan trọng

**Signature phải băm NỘI DUNG cert, không phải đường dẫn.** Với bind-mount, sửa file
cert có hiệu lực ngay vì container đọc trực tiếp. Với `docker cp`, nội dung được sao
vào container lúc tạo — nếu signature vẫn chỉ băm đường dẫn thì đổi cert sẽ **không**
làm container dựng lại, và tunnel chạy tiếp bằng cert cũ. Đây là bug âm thầm, phải xử
lý ngay trong phase này.

## Yêu cầu

- Bỏ mọi `-v` khỏi `buildRunArgs`
- `signatureOf` băm SHA-1 nội dung từng file cert thay vì đường dẫn
- Container không bao giờ start trước khi cp xong file
- `start()` vẫn idempotent, vẫn dựng lại khi signature đổi
- 60 test hiện có pass nguyên

## Kiến trúc

```
start(profile)
  ├─ đang chạy + signature khớp   -> dùng lại
  ├─ đang chạy + signature lệch   -> stop mềm, dựng lại
  └─ dựng mới:
       docker create ...          (không -v, có nhãn signature)
       docker cp ca.pem  <c>:/config/ca.pem
       docker cp cert.pem <c>:/config/cert.pem   (nếu có)
       ...
       docker start <c>
       chờ marker VPNMGR_READY
```

Đổi thư mục trong container từ `/certs` sang `/config` cho khớp ngữ nghĩa mới
(file được sao vào, không còn là mount).

## File đụng tới

Sửa:
- `native-host/lib/container-spec.js` — bỏ `-v`, đổi `/certs` → `/config`, `signatureOf` băm nội dung
- `native-host/lib/docker-driver.js` — `start()` tách thành create → cp → start
- `docker/entrypoint.sh` — đọc cert ở `/config`
- `native-host/lib/path-guard.js` — vẫn validate path, vì host vẫn phải đọc file để cp

Không tạo file mới.

## Các bước

1. `container-spec.js`: `buildRunArgs` → `buildCreateArgs`, bỏ `-v`, trả thêm
   `copies: [{ src, dest }]`.
2. `signatureOf`: đọc từng file cert, băm nội dung. Ném lỗi rõ ràng nếu không đọc được.
3. `docker-driver.start()`: `docker create` → lặp `docker cp` → `docker start`.
   Nếu bất kỳ bước nào lỗi thì `docker rm -f` container dở dang rồi ném lỗi.
4. `entrypoint.sh`: `/certs` → `/config`.
5. Chạy lại toàn bộ 5 bộ test.

## Todo

- [x] `buildCreateArgs` bỏ `-v`, trả danh sách file cần cp
- [x] `signatureOf` băm nội dung cert
- [x] `start()` theo luồng create → cp → start, dọn sạch khi lỗi giữa chừng
- [x] `entrypoint.sh` đọc `/config`
- [x] Test: đổi NỘI DUNG cert (giữ nguyên tên file) phải làm container dựng lại
- [x] 60 test cũ pass

## Tiêu chí hoàn thành

- Không còn `-v` nào trong lệnh docker
- Sửa nội dung file cert → `start()` dựng lại container (test tự động chứng minh)
- Tunnel vẫn lên, traffic vẫn ra IP VPN
- 60 test pass

## Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Container tạo rồi nhưng cp lỗi → container rác giữ cổng | `docker rm -f` trong khối catch |
| Băm nội dung làm `start()` chậm khi nhiều file | Cert chỉ vài KB, chi phí không đáng kể |
| Quên đổi `/certs` ở đâu đó | `grep -rn "/certs"` trước khi kết thúc phase |

## Bảo mật

Cert đi qua `docker cp` tức là qua Docker daemon (chạy bằng root). Tương đương
bind-mount về mức độ tin cậy — daemon vốn đã đọc được mọi file. Không lưu thêm bản
sao nào trên host.

## Kết quả (2026-09-14)

- Không còn `-v` nào: `buildCreateArgs` trả 0 tham số `-v`, 4 file đi bằng `docker cp`
- Tunnel lên bình thường, traffic ra `203.0.113.10` trong khi IP thật `198.51.100.20`
- Cert trong container giữ nguyên quyền `0600` (docker cp bảo toàn mode)
- **Bug âm thầm đã chặn**: sửa nội dung cert làm signature đổi
  `4ccb4cd30c38e7f2` → `f68a66a757981a4e`, container sẽ được dựng lại
- 60/60 test pass

`entrypoint.sh` không phải sửa — nó đọc đường dẫn từ biến env chứ không hardcode `/certs`.
Thêm `RUN mkdir -p /config` vào Dockerfile vì `docker cp` cần thư mục đích tồn tại sẵn.
