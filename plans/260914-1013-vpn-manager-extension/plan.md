# Trạng thái: ✅ Hoàn thành (2026-09-14)

Plan gốc giữ nguyên bên dưới. Tiến độ thực tế và các thay đổi so với plan:

| Mục | Kết quả |
|---|---|
| Phase 1-5 theo plan | Hoàn thành |
| Phase 6 — Port-forward | **Thêm ngoài plan** (tab Forward cho Navicat/DBeaver) |
| Phase 7 — Độ bền tunnel | **Thêm ngoài plan** (health check, killswitch, watchdog) |

**Lệch so với plan:**
- `dante-server` thay cho `microsocks` — Alpine không có microsocks.
- Bỏ `native-host/lib/port-allocator.js`; logic cấp cổng gộp vào `extension/lib/storage.js`,
  validate vào `path-guard.js`.
- Thêm `native-host/vpn-manager-host.sh` — Chrome spawn với PATH tối thiểu nên shebang
  `#!/usr/bin/env node` không thấy node cài qua nvm.
- Thêm `native-host/lib/container-spec.js` — tách ra khi `docker-driver.js` vượt 200 dòng.
- Lock file đơn thay bằng registry pid (`~/.config/vpn-manager/hosts/`) để chịu được
  nhiều trình duyệt chạy song song.

Chi tiết từng thay đổi: [docs/project-changelog.md](../../docs/project-changelog.md).
Tiến độ theo phase: [docs/development-roadmap.md](../../docs/development-roadmap.md).

---

# VPN Manager Chrome Extension — Implementation Plan

## Context

Máy Ubuntu có OpenVPN cert-based qua NetworkManager (profile `MyVPN` → `203.0.113.10:11194`, cert tại `~/.cert/nm-openvpn/*.pem`). Vấn đề: chỉ vài domain cần đi qua VPN, nhưng bật VPN bằng NetworkManager sẽ **đổi default route của toàn máy** → mọi traffic (dev server, docker, apt, git...) đều chui qua tunnel. Rất phiền.

Mục tiêu: một Chrome extension cá nhân (không publish store) cho phép khai báo `domain → VPN`, bật/tắt từng domain, và **chỉ những domain đó** đi qua tunnel. Phần còn lại của máy và của trình duyệt hoàn toàn không bị ảnh hưởng.

### Ràng buộc kỹ thuật (đã xác minh)

| Điều | Thực tế |
|---|---|
| Extension tạo VPN tunnel | **Không thể.** Không có API TUN/raw socket. `chrome.vpnProvider` chỉ có trên ChromeOS. |
| Proxy per-tab | **Không thể.** `chrome.proxy` là per-profile. |
| Proxy per-domain | **Được** — PAC script, `FindProxyForURL(url, host)` chạy cho mỗi request. |
| Điều khiển process trên máy | Chỉ qua **Native Messaging**. |
| Docker không cần sudo | ✅ `andy` thuộc group `docker`, daemon 28.5.1 |
| `/dev/net/tun` | ✅ `crw-rw-rw-` |

### Kiến trúc

```
┌─ Chrome ────────────────────────────────┐
│  popup (2 tab)                          │
│  service worker ── chrome.proxy(PAC) ───┼──> domain trong list?
│        │                                │      ├ có  → SOCKS5 127.0.0.1:108N
│        │ native messaging (stdio)       │      └ không → DIRECT (mạng thường)
└────────┼────────────────────────────────┘
         ▼
   native host (Node, không dependency)
         │ docker CLI
         ▼
   container vpnmgr-<id>  [NET_ADMIN + /dev/net/tun]
   ├─ openvpn client ──> tun0, default route  ← CHỈ TỒN TẠI TRONG CONTAINER
   ├─ microsocks :1080
   └─ /certs (bind-mount ro từ ~/.cert/nm-openvpn)
```

**Điểm mấu chốt:** `tun0` và `default via tun0` nằm trong network namespace của container. Routing table của host **không bị đụng**. Đây chính là thứ thay thế việc bật VPN toàn máy.

### Quyết định đã chốt với user

1. Backend: **Docker** (không cần sudo, không đụng sudoers).
2. Cert: **chỉ lưu đường dẫn file**. Không có private key nào đi vào `chrome.storage.local`. Cert bind-mount read-only lúc chạy container.
3. Scope: **full stack** — extension + native host + docker image + installer.
4. Test connection: **full** — tunnel up + IP thoát + so sánh IP thật + DNS leak check.
5. Thêm VPN: **import từ NetworkManager** (`nmcli`) + cho nhập thủ công.
6. Lifecycle: **tự tắt tunnel** khi Chrome đóng.

---

## Cấu trúc repo

```
/var/www/vpn-manager-extension/
├── docker/
│   ├── Dockerfile                        # alpine + openvpn + microsocks (~15MB)
│   └── entrypoint.sh                     # dựng .ovpn, chạy openvpn, chờ tunnel, spawn microsocks
├── extension/
│   ├── manifest.json                     # MV3
│   ├── background/
│   │   ├── service-worker.js             # orchestrator, message router
│   │   ├── native-bridge.js              # connectNative + reconnect + request/response
│   │   ├── pac-builder.js                # domains[] -> PAC string
│   │   └── proxy-controller.js           # chrome.proxy.settings apply/clear
│   ├── lib/
│   │   ├── storage.js                    # đọc/ghi chrome.storage.local, schema + migration
│   │   ├── domain-validator.js           # validate hostname + wildcard
│   │   └── constants.js
│   ├── popup/
│   │   ├── popup.html / popup.css / popup.js   # shell + tab switching + rehydrate
│   │   ├── tab-domains.js                # list, toggle, add form
│   │   └── tab-vpns.js                   # list VPN, import NM, form thủ công, nút test
│   └── icons/  (16/32/48/128)
├── native-host/
│   ├── vpn-manager-host.js               # entrypoint: stdio framing + dispatch
│   ├── lib/
│   │   ├── protocol.js                   # 4-byte LE length prefix framing
│   │   ├── docker-driver.js              # build/run/stop/status container
│   │   ├── nm-importer.js                # nmcli -> profile objects
│   │   ├── connection-tester.js          # tunnel up + IP thoát + DNS leak
│   │   ├── lifecycle-lock.js             # grace shutdown, phân biệt SW restart vs Chrome exit
│   │   └── port-allocator.js             # 1080 + n
│   └── com.andy.vpn_manager.json.template
├── scripts/
│   ├── install.sh                        # build image, ghi native host manifest, chmod
│   └── uninstall.sh
├── docs/                                 # system-architecture, code-standards, changelog, roadmap
└── plans/260914-1013-vpn-manager-extension/
```

Mọi file code giữ **< 200 dòng** (rule dự án). Kebab-case.

---

## Phase 1 — Docker tunnel (làm trước, validate bằng tay)

Không viết JS cho tới khi tunnel + SOCKS5 chứng minh chạy được. Đây là phần rủi ro nhất.

**`docker/Dockerfile`**
```dockerfile
FROM alpine:3.20
RUN apk add --no-cache openvpn microsocks
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

**`docker/entrypoint.sh`** — nhận config qua env (`VPN_GATEWAY`, `VPN_CA`, `VPN_CERT`, `VPN_KEY`, `VPN_TLS_CRYPT`, `VPN_CIPHER`, `VPN_AUTH`, `VPN_VERIFY_X509`, `SOCKS_PORT`):
1. Sinh `/tmp/client.ovpn` từ env, trỏ tới các path trong `/certs`.
2. `openvpn --config /tmp/client.ovpn --daemon-ish` (foreground, log ra stdout).
3. Poll tới khi thấy `Initialization Sequence Completed` **hoặc** `ip link show tun0` up → in marker `VPNMGR_READY`.
4. `microsocks -i 0.0.0.0 -p $SOCKS_PORT` foreground.
5. `trap` SIGTERM → kill cả hai.

**DNS:** truyền `--dns` lúc `docker run` (mặc định `1.1.1.1`, cho phép override per-profile). Resolver này được với tới **qua tun0** vì default route trong container đã là tunnel → DNS đi trong tunnel, không leak. Verify ở Phase 5.

**Validate thủ công trước khi qua Phase 2:**
```bash
docker build -t vpn-manager-socks ./docker
docker run --rm -d --name vpnmgr-test \
  --cap-add=NET_ADMIN --device /dev/net/tun --dns 1.1.1.1 \
  -v $HOME/.cert/nm-openvpn:/certs:ro \
  -p 127.0.0.1:1080:1080 \
  -e VPN_GATEWAY=203.0.113.10:11194 \
  -e VPN_CA=/certs/MyVPN-ca.pem -e VPN_CERT=/certs/MyVPN-cert.pem \
  -e VPN_KEY=/certs/MyVPN-key.pem -e VPN_TLS_CRYPT=/certs/MyVPN-tls-crypt.pem \
  -e VPN_CIPHER=AES-128-GCM -e VPN_AUTH=SHA256 \
  -e VPN_VERIFY_X509=server_xxxxxxxx -e SOCKS_PORT=1080 \
  vpn-manager-socks

docker logs -f vpnmgr-test          # chờ VPNMGR_READY
curl -s https://api.ipify.org       # IP thật
curl -s --socks5-hostname 127.0.0.1:1080 https://api.ipify.org   # PHẢI khác
ip route | grep default             # route host PHẢI không đổi
```

Gate: hai IP khác nhau **và** route host không đổi → mới đi tiếp.

---

## Phase 2 — Native messaging host

Node thuần, **zero dependency**.

- **`protocol.js`** — native messaging framing: 4-byte little-endian length + JSON UTF-8 trên stdin/stdout. Buffer tích luỹ, xử lý message bị chẻ qua nhiều chunk. Giới hạn 1MB/message.
- **`vpn-manager-host.js`** — dispatch theo `{id, action, payload}`, trả `{id, ok, data|error}`. Actions:
  - `list-nm-profiles` → `nm-importer`
  - `start-tunnel {profile}` / `stop-tunnel {profileId}` / `tunnel-status {profileId}`
  - `test-connection {profile}` → `connection-tester`
  - `stop-all`
- **`docker-driver.js`** — `child_process.execFile('docker', [...])`, không dùng shell (tránh injection từ tên profile / path). Container đặt tên `vpnmgr-<profileId>`. Start = chờ `VPNMGR_READY` trong `docker logs --follow`, timeout 45s; fail thì `docker logs --tail 50` trả về UI làm error message.
- **`nm-importer.js`** — `nmcli -t -f NAME,TYPE con show` lọc `:vpn`, rồi `nmcli -t con show <name>` parse `vpn.data` (định dạng `key = value, key = value`) → `{name, gateway, ca, cert, key, tlsCrypt, cipher, auth, verifyX509}`. **Kiểm tra file tồn tại + readable** trước khi trả về; profile hỏng (như `VPN nhà` đang trỏ tới `~/Documents/VPN/` đã bị xoá) đánh dấu `broken: true` để UI hiện cảnh báo thay vì import câm lặng.
- **`connection-tester.js`** —
  1. Start container (nếu chưa chạy).
  2. `curl -s --max-time 10 https://api.ipify.org` → `directIp`
  3. `curl -s --max-time 15 --socks5-hostname 127.0.0.1:<port> https://api.ipify.org` → `tunnelIp` (+ đo latency)
  4. `--socks5-hostname` ép DNS resolve **phía proxy** → đồng thời là DNS leak check.
  5. Trả `{ok, directIp, tunnelIp, latencyMs, leaked: directIp === tunnelIp}`. `leaked: true` → UI báo đỏ "traffic KHÔNG đi qua VPN".
  6. Nếu tunnel vốn không chạy trước khi test → stop lại sau khi test.
- **`lifecycle-lock.js`** — **giải quyết vấn đề MV3 service worker bị kill sau ~30s idle**, làm port native messaging đứt dù Chrome vẫn mở:
  - Lúc start: ghi `~/.config/vpn-manager/host.lock` = `{pid, startedAt}`.
  - stdin EOF → đợi **15s grace** → đọc lại lock file. Nếu `pid` đã bị process mới chiếm → thoát im lặng (SW chỉ restart). Nếu vẫn là pid mình → Chrome đã đóng thật → `docker stop $(docker ps -q --filter name=vpnmgr-)` rồi xoá lock, thoát.

---

## Phase 3 — Extension core

**`manifest.json`** (MV3): `permissions: ["proxy", "storage", "nativeMessaging"]`. Không cần `host_permissions` — PAC không yêu cầu. `background.service_worker` type module.

**Schema `chrome.storage.local`:**
```js
{
  schemaVersion: 1,
  vpnProfiles: [{ id, name, gateway, ca, cert, key, tlsCrypt, cipher, auth,
                  verifyX509, dns, socksPort, source: "nm"|"manual" }],
  domains:     [{ id, domain, vpnId: string|null, enabled: boolean }],
  ui:          { activeTab, addDomainOpen, addDomainDraft, scrollTop }
}
```
Private key **chỉ là đường dẫn**. Không có nội dung cert nào được lưu.

**`pac-builder.js`** — sinh PAC từ domains đang `enabled && vpnId`:
```js
function FindProxyForURL(url, host) {
  if (host === "example.com" || dnsDomainIs(host, ".example.com"))
    return "SOCKS5 127.0.0.1:1080";
  return "DIRECT";
}
```
- Nhóm domain theo `vpnId` → mỗi VPN một port riêng.
- Dùng `dnsDomainIs` cho subdomain, so sánh `===` cho exact. Wildcard `*.x.com` → chỉ `dnsDomainIs`.
- **Cố ý KHÔNG có fallback `; DIRECT`.** Nếu tunnel chết, request fail rõ ràng thay vì âm thầm đi ra mạng thường làm lộ traffic. Đây là quyết định bảo mật, ghi rõ trong docs.
- Không có domain nào bật → `chrome.proxy.settings.clear()`, trả Chrome về proxy hệ thống.

**`native-bridge.js`** — `chrome.runtime.connectNative('com.andy.vpn_manager')`, map `id → Promise`, timeout 60s/request, tự reconnect khi `onDisconnect`, expose `send(action, payload)`.

**`service-worker.js`** — điều phối:
- `onStartup`: **clear proxy trước**, rehydrate storage, start tunnel cho các VPN đang được dùng, rồi mới apply PAC. (Tránh tình huống Chrome khởi động lại còn giữ PAC cũ trỏ tới SOCKS đã chết.)
- `onInstalled`: khởi tạo schema.
- Message từ popup: `toggle-domain`, `add-domain`, `delete-domain`, `set-domain-vpn`, `add-vpn`, `import-nm`, `test-vpn`, `get-state`.
- Mỗi lần domains đổi: tính lại tunnel nào cần chạy → start/stop qua native host → rebuild PAC → apply. Thứ tự bắt buộc: **tunnel ready trước, PAC sau.**

---

## Phase 4 — Popup UI

Vanilla JS + CSS, không framework (YAGNI). 380×560px.

**Shell:** 2 tab `Domains` / `VPNs`. Tab đang mở lưu vào `ui.activeTab` → **mở lại popup vẫn đúng tab, đúng scroll, đúng nội dung form đang gõ dở** (MV3 huỷ DOM popup khi đóng, nên phải rehydrate từ storage lúc mở — đây chính là yêu cầu "giữ trạng thái" của user).

**Tab Domains:**
- Mỗi dòng: `tên domain` · `<select> VPN` · `toggle switch` · nút xoá.
- List `max-height: 320px; overflow-y: auto` → thấy ~7 dòng, dài hơn thì scroll.
- Nút `+ Thêm domain` → hiện inline input + nút Save. Validate:
  - regex hostname, chấp nhận `*.example.com`
  - từ chối scheme/path/khoảng trắng/port, tự strip `https://` và `/...` nếu user paste nguyên URL
  - từ chối trùng
- **Bật toggle khi `vpnId === null`** → toggle bật rồi tự trả về off, hiện lỗi inline đỏ `"Chọn VPN trước"`, highlight select. (Yêu cầu rõ ràng của user.)
- Trạng thái mỗi dòng: `off` / `connecting…` (spinner) / `on` (chấm xanh) / `error` (chấm đỏ + tooltip log).

**Tab VPNs:**
- List profile: tên · gateway · badge trạng thái · nút `Test` · nút xoá.
- `Import từ NetworkManager` → gọi native `list-nm-profiles` → modal chọn → import. Profile `broken` hiện xám + lý do (thiếu file cert).
- `Thêm thủ công` → form: name, gateway, 4 đường dẫn file (ca/cert/key/tls-crypt), cipher, auth, DNS. Có nút "Kiểm tra file tồn tại" gọi native host.
- Nút `Test` → hiện `IP thật: x.x.x.x` / `IP qua VPN: y.y.y.y` / `latency: N ms`. Trùng nhau → đỏ `"Traffic KHÔNG đi qua VPN"`.
- Không xoá được VPN đang có domain dùng → cảnh báo liệt kê domain.

---

## Phase 5 — Installer, docs, verification

**`scripts/install.sh`**
1. Kiểm tra prereq: `docker` chạy được không sudo, `/dev/net/tun`, `curl`, `node >= 18`, `nmcli`.
2. `docker build -t vpn-manager-socks ./docker`
3. Nhắc user load unpacked extension → nhập **Extension ID**.
4. Sinh `~/.config/google-chrome/NativeMessagingHosts/com.andy.vpn_manager.json`:
   ```json
   { "name": "com.andy.vpn_manager", "type": "stdio",
     "path": "/var/www/vpn-manager-extension/native-host/vpn-manager-host.js",
     "allowed_origins": ["chrome-extension://<ID>/"] }
   ```
   `chmod +x` host script, shebang `#!/usr/bin/env node`.
5. `mkdir -p ~/.config/vpn-manager && chmod 700`

**`scripts/uninstall.sh`** — stop mọi container `vpnmgr-*`, xoá manifest, xoá image, xoá `~/.config/vpn-manager`.

**Verification end-to-end** (chạy thật, không mock):
1. Phase 1 gate ở trên đã pass.
2. `./scripts/install.sh`, load unpacked, mở popup.
3. Tab VPNs → Import từ NM → thấy `MyVPN` (và `VPN nhà` bị đánh dấu broken).
4. Nút Test trên `MyVPN` → hai IP khác nhau.
5. Tab Domains → thêm domain test → bật toggle **khi chưa chọn VPN** → phải thấy lỗi "Chọn VPN trước".
6. Chọn `MyVPN` → bật → mở domain đó trong tab mới → kiểm tra qua site echo IP rằng nó ra IP VPN.
7. Mở đồng thời một domain **không** trong list → phải ra IP thật.
8. `ip route | grep default` trên host → **không đổi**.
9. Kiểm DNS leak: `docker exec vpnmgr-<id> ip route` xác nhận default qua tun0.
10. Đóng popup, mở lại → đúng tab, đúng state, form draft còn nguyên.
11. Đóng hẳn Chrome → sau ~15s `docker ps` → không còn container `vpnmgr-*`.
12. Mở lại Chrome → domain đã bật tự reconnect, PAC apply lại.
13. Thêm 10+ domain → list scroll đúng, không vỡ layout.
14. Kill container thủ công khi đang bật → request tới domain đó phải **fail rõ ràng**, không âm thầm đi direct.

**Docs** (`docs/`): `system-architecture.md` (sơ đồ + luồng dữ liệu + native messaging protocol), `code-standards.md`, `project-changelog.md`, `development-roadmap.md`.

---

## Bảo mật — trả lời câu hỏi của user

**Extension bảo vệ được gì:**
- `chrome.storage.local` isolate theo extension ID — extension khác không đọc được.
- Native messaging `allowed_origins` khoá cứng theo extension ID — trang web hay extension khác không gọi được native host.
- Không có `host_permissions`, không content script → extension không đọc được nội dung trang nào.

**Extension KHÔNG bảo vệ được gì (quan trọng):**
- `chrome.storage.local` là **plaintext trên đĩa** (LevelDB trong profile dir). Không mã hoá. Process nào chạy dưới user `andy` cũng đọc được. → Đây là lý do plan **chỉ lưu đường dẫn cert**, không lưu nội dung key. Cert giữ nguyên ở `~/.cert/nm-openvpn/` với quyền `0600` sẵn có.
- Native messaging host **không có sandbox** — nó chạy full quyền user `andy`. Vì vậy `docker-driver.js` dùng `execFile` chứ **không dùng shell**, và mọi path từ extension phải validate là absolute + tồn tại + nằm trong whitelist thư mục trước khi bind-mount.
- Container chạy `--cap-add=NET_ADMIN`. Cần thiết để tạo tun. Không dùng `--privileged`.
- SOCKS5 publish ở `127.0.0.1` (không phải `0.0.0.0`) → máy khác trong LAN không dùng ké được tunnel.

---

## Rủi ro đã biết

| Rủi ro | Xử lý |
|---|---|
| MV3 service worker bị kill → native port đứt → tunnel bị stop oan | `lifecycle-lock.js`, grace 15s + kiểm tra pid claim |
| Chrome restart còn giữ PAC cũ trỏ SOCKS đã chết | `onStartup` clear proxy trước, start tunnel xong mới apply PAC |
| Extension khác cũng set proxy → xung đột | Kiểm `chrome.proxy.settings.get().levelOfControl`, không phải `controlled_by_this_extension` thì cảnh báo trong popup |
| OpenVPN handshake chậm → user tưởng treo | Trạng thái `connecting…` + timeout 45s + trả `docker logs --tail 50` làm error |
| Profile NM hỏng (`VPN nhà`) | `nm-importer` check file tồn tại, đánh dấu `broken` |
| Domain có port hoặc là IP | Validator strip port, hỗ trợ IP literal riêng (PAC dùng `===` cho IP) |

## Câu chưa chốt

- Muốn hỗ trợ nhiều VPN **chạy song song** cùng lúc không? Plan hiện tại đã thiết kế được (mỗi profile 1 port 1080+n) nhưng có thể giới hạn 1 tunnel tại 1 thời điểm cho đơn giản.
- VPN có cần username/password ngoài cert không? Cả 2 profile NM hiện tại đều `connection-type = tls` thuần nên plan bỏ qua phần auth-user-pass.
