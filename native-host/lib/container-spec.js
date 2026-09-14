'use strict';
// Mô tả một container tunnel: tham số `docker create` và vân tay cấu hình.
// Tách khỏi docker-driver để driver chỉ lo việc chạy lệnh docker.
//
// Cert được đưa vào bằng `docker cp` chứ không bind-mount. Lý do: bind-mount buộc
// Docker phải dịch đường dẫn host sang đường dẫn trong VM, mà quy tắc dịch khác nhau
// giữa Linux, macOS và Windows (C:\Users\... ). `docker cp` để CLI tự đọc file bằng
// API của OS rồi đẩy qua stream — giống hệt nhau trên cả ba nền.

const crypto = require('crypto');
const fs = require('fs');
const guard = require('./path-guard');

const IMAGE = 'vpn-manager-socks';
const NAME_PREFIX = 'vpnmgr-';
const CONFIG_DIR = '/config';
const OVPN_IN_CONTAINER = `${CONFIG_DIR}/client.ovpn`;

// Ánh xạ field profile -> tên file trong container + biến env OpenVPN
const CERT_FIELDS = [
  ['ca', 'ca.pem', 'VPN_CA'],
  ['cert', 'cert.pem', 'VPN_CERT'],
  ['key', 'key.pem', 'VPN_KEY'],
  ['tlsCrypt', 'tls-crypt.pem', 'VPN_TLS_CRYPT'],
  ['tlsAuth', 'tls-auth.pem', 'VPN_TLS_AUTH'],
];

const containerName = (profileId) => NAME_PREFIX + guard.assertSafeProfileId(profileId);

/**
 * Băm NỘI DUNG file, không phải đường dẫn.
 *
 * Với bind-mount, container đọc thẳng file trên host nên sửa cert có hiệu lực ngay.
 * Với `docker cp`, nội dung được sao vào container lúc tạo — nếu signature chỉ băm
 * đường dẫn thì đổi cert sẽ KHÔNG dựng lại container và tunnel chạy tiếp bằng cert cũ
 * mà không báo gì.
 */
function hashFile(filePath) {
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Vân tay cấu hình. Đổi gateway, nội dung cert, cổng SOCKS hay danh sách forward đều
 * làm signature đổi -> start() biết phải dựng lại container thay vì dùng lại cái cũ.
 */
const isOvpnMode = (profile) => profile.mode === 'ovpn' && !!profile.configPath;

function signatureOf(profile) {
  const certHashes = {};
  if (isOvpnMode(profile)) {
    // Sửa file .ovpn bên ngoài cũng phải làm container dựng lại
    certHashes.ovpn = hashFile(guard.assertSafeCertPath(profile.configPath, 'configPath'));
  } else {
    for (const [field] of CERT_FIELDS) {
      if (!profile[field]) continue;
      const real = guard.assertSafeCertPath(profile[field], field);
      certHashes[field] = hashFile(real);
    }
  }

  const material = JSON.stringify({
    mode: isOvpnMode(profile) ? 'ovpn' : 'manual',
    gateway: profile.gateway,
    socksPort: Number(profile.socksPort),
    certHashes,
    cipher: profile.cipher, auth: profile.auth,
    verifyX509: profile.verifyX509, tlsVersionMin: profile.tlsVersionMin,
    proto: profile.proto, dns: profile.dns,
    forwards: (profile.forwards || [])
      .map((f) => `${f.localPort}:${f.remoteHost}:${f.remotePort}`)
      .sort(),
  });
  return crypto.createHash('sha1').update(material).digest('hex').slice(0, 16);
}

/**
 * Tham số `docker create` + danh sách file cần `docker cp` vào container sau đó.
 * Container được tạo nhưng chưa start, nên entrypoint chắc chắn thấy đủ file.
 */
function buildCreateArgs(profile) {
  const name = containerName(profile.id);
  const port = guard.assertSafeSocksPort(profile.socksPort);
  const gateway = guard.assertSafeGateway(profile.gateway);

  const args = [
    'create', '--name', name,
    '--cap-add=NET_ADMIN', '--device', '/dev/net/tun',
    '--dns', /^[0-9.]{7,15}$/.test(profile.dns || '') ? profile.dns : '1.1.1.1',
    '-p', `127.0.0.1:${port}:${port}`,
    '-e', `SOCKS_PORT=${port}`,
    '-e', `VPN_GATEWAY=${gateway}`,
  ];

  const copies = [];

  if (isOvpnMode(profile)) {
    // Chế độ file: dùng thẳng .ovpn user import, không sinh lại config.
    // File có thể chứa directive lạ mà parse lại sẽ làm mất.
    const real = guard.assertSafeCertPath(profile.configPath, 'configPath');
    copies.push({ src: real, dest: OVPN_IN_CONTAINER });
    args.push('-e', `VPN_CONFIG_FILE=${OVPN_IN_CONTAINER}`);
    // entrypoint cần biết proto để quyết định có thêm explicit-exit-notify không
    // (thêm vào lúc proto tcp sẽ làm OpenVPN báo lỗi cấu hình)
    if (/^(udp|tcp)$/.test(profile.proto || '')) {
      args.push('-e', `VPN_PROTO=${profile.proto}`);
    }
  } else {
    if (!profile.ca) throw new Error('Thiếu CA certificate');
    for (const [field, fileName, envVar] of CERT_FIELDS) {
      if (!profile[field]) continue;
      const real = guard.assertSafeCertPath(profile[field], field);
      copies.push({ src: real, dest: `${CONFIG_DIR}/${fileName}` });
      args.push('-e', `${envVar}=${CONFIG_DIR}/${fileName}`);
    }
  }

  // Các tuỳ chọn chỉ nhận giá trị khớp whitelist, tránh chèn directive lạ vào .ovpn
  const opts = isOvpnMode(profile) ? [] : [
    ['VPN_CIPHER', profile.cipher, /^[A-Za-z0-9-]{1,32}$/],
    ['VPN_AUTH', profile.auth, /^[A-Za-z0-9-]{1,32}$/],
    ['VPN_VERIFY_X509', profile.verifyX509, /^[A-Za-z0-9._-]{1,128}$/],
    ['VPN_TLS_VERSION_MIN', profile.tlsVersionMin, /^1\.[0-3]$/],
    ['VPN_PROTO', profile.proto, /^(udp|tcp)$/],
  ];
  for (const [envVar, value, re] of opts) {
    if (value && re.test(String(value))) args.push('-e', `${envVar}=${value}`);
  }

  // Mỗi forward mở thêm một cổng TCP publish ở 127.0.0.1.
  // Docker chỉ đặt được cổng LÚC TẠO container -> đổi forward là phải dựng lại.
  const rules = [];
  for (const f of profile.forwards || []) {
    const localPort = guard.assertSafeForwardPort(f.localPort);
    const remoteHost = guard.assertSafeRemoteHost(f.remoteHost);
    const remotePort = guard.assertSafeRemotePort(f.remotePort);
    args.push('-p', `127.0.0.1:${localPort}:${localPort}`);
    rules.push(`${localPort}:${remoteHost}:${remotePort}`);
  }
  if (rules.length) args.push('-e', `VPN_FORWARDS=${rules.join(',')}`);

  // Nhãn signature cho phép phát hiện cấu hình đã đổi so với container đang chạy.
  args.push('--label', `vpnmgr.signature=${signatureOf(profile)}`);
  args.push(IMAGE);
  return { args, name, port, rules, copies };
}

module.exports = {
  buildCreateArgs, signatureOf, containerName, isOvpnMode,
  IMAGE, NAME_PREFIX, CONFIG_DIR,
};
