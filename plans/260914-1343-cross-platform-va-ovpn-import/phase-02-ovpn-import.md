# Phase 02 — Import file `.ovpn`

**Ưu tiên:** Cao · **Trạng thái:** ⬜ Chưa làm · **Verify:** Linux, tự động
**Phụ thuộc:** [Phase 01](phase-01-docker-cp.md)

Liên quan: [plan.md](plan.md) · [tab-vpns.js](../../extension/popup/tab-vpns.js)

## Vì sao

Điền tay 4 đường dẫn cert + cipher + auth + verify-x509 vừa lâu vừa dễ sai. File
`.ovpn` do `openvpn` sinh ra đã chứa đủ mọi thứ. Import xong là dùng được ngay.

## Nhận định quan trọng

**Chrome không cho extension biết đường dẫn thật của file người dùng chọn.**
`<input type="file">` chỉ trả về `File` object; `file.path` không tồn tại trong
extension (khác Electron). Nên bắt buộc phải đọc nội dung rồi gửi cho native host ghi
ra đĩa. Không có cách nào chỉ lấy đường dẫn.

**File `.ovpn` thường chứa private key inline** trong khối `<key>...</key>`. Nó là
secret hoàn chỉnh, phải ghi với quyền 0600 và **không bao giờ** vào `chrome.storage`.
Extension chỉ giữ đường dẫn file đã lưu — đúng nguyên tắc hiện có.

**Hai chế độ profile phải tách bạch.** Profile import từ `.ovpn` dùng thẳng file đó;
profile điền tay giữ nguyên luồng sinh config từ env. Không trộn hai đường.

## File mẫu thực tế (`andy-home-server.ovpn`)

175 dòng, 8.2 KB, **tự chứa hoàn toàn** — 4 khối inline `<ca>`, `<cert>`, `<key>`,
`<tls-crypt>`. Không có `auth-user-pass`. Directive ngoài khối inline:

```
client / dev tun / proto udp
remote vpn.example.net 1194 udp
resolv-retry infinite / nobind / persist-key / persist-tun
remote-cert-tls server / auth SHA512
ignore-unknown-option block-outside-dns / verb 3
```

Ba điều rút ra:

1. **`remote` có dạng 3 tham số** `host port proto`, không phải 2. Parser phải xử lý cả hai.
2. **Không có `cipher`** — OpenVPN đời mới tự thương lượng. Chế độ file không được
   tự chèn `data-ciphers` như chế độ điền tay, cứ để nguyên file.
3. **`ignore-unknown-option`** cho thấy file có thể chứa directive lạ. Đây chính là lý
   do dùng thẳng file tốt hơn parse rồi dựng lại: không mất thông tin nào.

## Vấn đề phát sinh: `remote` là hostname DDNS

Killswitch xoá default route qua `eth0` sau khi tunnel lên, chỉ giữ host route tới
**IP đã resolve** của server. Kết nối lần đầu không sao vì OpenVPN resolve trước khi
tunnel lên. Nhưng khi `ping-restart` kích hoạt và IP của DDNS đã đổi, OpenVPN phải
resolve lại — mà DNS lúc đó đi qua `tun0` đang chết.

**Không sửa bằng cách route DNS qua `eth0`**: `resolv.conf` trỏ `1.1.1.1`, làm vậy là
toàn bộ DNS rò ra ngoài VPN — phá đúng thứ killswitch bảo vệ.

Đường thoát đã có sẵn: `health()` phát hiện tunnel không truyền được gói tin, extension
dừng và dựng lại container, OpenVPN resolve lại từ đầu. Chỉ cần **ghi rõ giới hạn**:
khi IP DDNS đổi giữa phiên, tunnel không tự hồi mà phải mở popup để extension sửa.

Nếu sau này thấy phiền, hướng xử lý là cho container định kỳ resolve lại hostname và
cập nhật host route qua `eth0` — để dành, chưa làm (YAGNI).

## Yêu cầu

- Nút `Import từ file .ovpn` ở tab VPN, mở hộp thoại chọn file
- Nội dung được native host ghi ra `~/.config/vpn-manager/profiles/<id>.ovpn`, quyền 0600
- Từ chối rõ ràng khi file cần thứ chưa hỗ trợ: `auth-user-pass`, hoặc trỏ tới cert
  bên ngoài mà không inline
- Profile import vẫn dùng được nút Test, vẫn gán được cho domain và forward
- Luồng điền tay không đổi hành vi

## Kiến trúc

```
popup: <input type="file" accept=".ovpn,.conf">
   -> FileReader.readAsText
   -> sendMessage('import-ovpn', { name, content })
        -> native host 'save-ovpn':
             kiểm tra nội dung (auth-user-pass? cert ngoài?)
             ghi ~/.config/vpn-manager/profiles/<id>.ovpn  chmod 0600
             trả { configPath, remote, proto, warnings }
        -> lưu profile { mode: 'ovpn', configPath, gateway, socksPort }
```

Trong container:

```
mode 'ovpn'   -> docker cp <configPath> <c>:/config/client.ovpn
                 env VPN_CONFIG_FILE=/config/client.ovpn
                 entrypoint: openvpn --config /config/client.ovpn + các override của ta
mode 'manual' -> luồng cũ, entrypoint tự sinh config từ env
```

Các override vẫn phải áp trong chế độ ovpn: `pull-filter ignore "ping-restart"`,
`ping-restart 30`, và `explicit-exit-notify 1` **chỉ khi** file dùng `proto udp`
(thêm vào lúc proto tcp sẽ làm OpenVPN báo lỗi cấu hình).

Killswitch, sockd, socat forward, watchdog giữ nguyên, không phụ thuộc chế độ.

## File đụng tới

Tạo:
- `native-host/lib/ovpn-parser.js` — đọc `remote`, `proto`, phát hiện inline block và
  các directive chưa hỗ trợ
- `native-host/lib/ovpn-store.js` — ghi/xoá file config, quản lý quyền 0600

Sửa:
- `extension/popup/tab-vpns.js` — nút + input file + hiển thị cảnh báo từ parser
- `extension/popup/popup.html` — thêm `<input type="file">` ẩn
- `extension/background/actions-vpns.js` — action `import-ovpn`
- `native-host/vpn-manager-host.js` — action `save-ovpn`, `delete-ovpn`
- `native-host/lib/container-spec.js` — nhánh mode ovpn, signature băm nội dung .ovpn
- `docker/entrypoint.sh` — dùng `VPN_CONFIG_FILE` nếu có
- `extension/lib/storage.js` — xoá profile ovpn thì xoá luôn file config

## Các bước

1. `ovpn-parser.js`: trả `{ remote, proto, hasInlineCa, hasInlineKey, unsupported[] }`.
   `unsupported` gồm `auth-user-pass`, `pkcs12`, và tham chiếu cert ngoài.
2. `ovpn-store.js`: `save(id, content)` ghi 0600 và trả đường dẫn; `remove(id)`.
3. Action `save-ovpn` ở native host: parse → nếu có `unsupported` thì trả lỗi kèm
   danh sách, **không** ghi file.
4. `import-ovpn` ở service worker: gọi native host, tạo profile `mode: 'ovpn'`,
   cấp cổng SOCKS như profile thường.
5. UI: nút + input ẩn + hiển thị lỗi parser dạng danh sách dễ đọc.
6. `container-spec.js`: mode ovpn thì cp file config, bỏ qua các env cert.
7. `entrypoint.sh`: có `VPN_CONFIG_FILE` thì dùng thẳng, chỉ thêm override.
8. Xoá profile ovpn thì gọi `delete-ovpn` để không bỏ lại file secret.

## Todo

- [ ] Tạo fixture test **đã thay key giả** từ file mẫu; không đưa file thật của user
      vào repo (đã bị `.gitignore` chặn, giữ nguyên như vậy)
- [ ] `ovpn-parser.js` xử lý `remote host port [proto]`, phát hiện khối inline
- [ ] Không chèn `data-ciphers`/`auth` ở chế độ file — giữ nguyên nội dung
- [ ] `ovpn-store.js` ghi 0600, có test kiểm tra quyền file
- [ ] Action `save-ovpn` / `delete-ovpn`
- [ ] UI nút import + báo lỗi parser
- [ ] `container-spec` nhánh ovpn, signature băm nội dung file
- [ ] `entrypoint.sh` chế độ config file, `explicit-exit-notify` chỉ khi udp
- [ ] Test: import → bật domain → traffic ra IP VPN
- [ ] Test: xoá profile ovpn → file config biến mất khỏi đĩa
- [ ] Test: file có `auth-user-pass` bị từ chối, không ghi file nào
- [ ] Luồng điền tay vẫn pass 18 test forward + 19 test popup

## Tiêu chí hoàn thành

- Import file `.ovpn` mẫu → bật domain → curl qua SOCKS ra đúng IP VPN
- File config trên đĩa quyền `0600`, `chrome.storage` không chứa nội dung nào
- File không hỗ trợ bị từ chối kèm lý do cụ thể
- Không hồi quy luồng điền tay

## Rủi ro

| Rủi ro | Xử lý |
|---|---|
| `.ovpn` trỏ cert ngoài, import xong mới lỗi lúc kết nối | Parser chặn ngay lúc import |
| `explicit-exit-notify` thêm nhầm vào proto tcp | Parse `proto` từ file, chỉ thêm khi udp |
| Sửa file `.ovpn` bên ngoài mà container không dựng lại | Signature băm nội dung file |
| Xoá profile để lại file chứa private key | `delete-ovpn` gọi trong `delete-vpn` |
| Native messaging giới hạn 1MB | `.ovpn` thường vài KB; vẫn kiểm tra và báo lỗi nếu vượt |
| `remote` là hostname, IP đổi giữa phiên | Không tự hồi; health check + dựng lại khi mở popup. Ghi rõ trong README |

## Bảo mật

`.ovpn` có inline key là secret hoàn chỉnh. Ba ràng buộc:
1. Nội dung chỉ tồn tại trong RAM của extension đúng lúc import, không vào storage.
2. Ghi ra đĩa với `0600` trong `~/.config/vpn-manager/profiles/` (thư mục đã `0700`).
3. Xoá profile phải xoá file; không để lại secret mồ côi.

## Tiếp theo

Chờ file `.ovpn` mẫu của user để chốt danh sách directive mà parser cần nhận diện.
