'use strict';
// Mô tả một container tunnel: tham số `docker run` và vân tay cấu hình.
// Tách khỏi docker-driver để driver chỉ lo việc chạy lệnh docker.

const crypto = require('crypto');
const guard = require('./path-guard');

const IMAGE = 'vpn-manager-socks';
const NAME_PREFIX = 'vpnmgr-';

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
 * Vân tay cấu hình. Đổi gateway, cert, cổng SOCKS hay danh sách forward đều làm
 * signature đổi -> start() biết phải dựng lại container thay vì dùng lại cái cũ.
 */
function signatureOf(profile) {
  const material = JSON.stringify({
    gateway: profile.gateway,
    socksPort: Number(profile.socksPort),
    ca: profile.ca, cert: profile.cert, key: profile.key,
    tlsCrypt: profile.tlsCrypt, tlsAuth: profile.tlsAuth,
    cipher: profile.cipher, auth: profile.auth,
    verifyX509: profile.verifyX509, tlsVersionMin: profile.tlsVersionMin,
    proto: profile.proto, dns: profile.dns,
    forwards: (profile.forwards || [])
      .map((f) => `${f.localPort}:${f.remoteHost}:${f.remotePort}`)
      .sort(),
  });
  return crypto.createHash('sha1').update(material).digest('hex').slice(0, 16);
}

/** Build danh sách tham số `docker run` từ profile đã validate. */
function buildRunArgs(profile) {
  const name = containerName(profile.id);
  const port = guard.assertSafeSocksPort(profile.socksPort);
  const gateway = guard.assertSafeGateway(profile.gateway);

  const args = [
    'run', '-d', '--name', name,
    '--cap-add=NET_ADMIN', '--device', '/dev/net/tun',
    '--dns', /^[0-9.]{7,15}$/.test(profile.dns || '') ? profile.dns : '1.1.1.1',
    '-p', `127.0.0.1:${port}:${port}`,
    '-e', `SOCKS_PORT=${port}`,
    '-e', `VPN_GATEWAY=${gateway}`,
  ];

  for (const [field, fileName, envVar] of CERT_FIELDS) {
    if (!profile[field]) continue;
    const real = guard.assertSafeCertPath(profile[field], field);
    args.push('-v', `${real}:/certs/${fileName}:ro`);
    args.push('-e', `${envVar}=/certs/${fileName}`);
  }
  if (!profile.ca) throw new Error('Thiếu CA certificate');

  // Các tuỳ chọn chỉ nhận giá trị khớp whitelist, tránh chèn directive lạ vào .ovpn
  const opts = [
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
  return { args, name, port, rules };
}


module.exports = { buildRunArgs, signatureOf, containerName, IMAGE, NAME_PREFIX };
