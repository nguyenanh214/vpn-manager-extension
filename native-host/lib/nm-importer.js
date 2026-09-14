'use strict';
// Đọc các VPN connection có sẵn trong NetworkManager để user khỏi gõ tay đường dẫn cert.

const { execFile } = require('child_process');
const guard = require('./path-guard');
const platform = require('./platform');

function nmcli(args) {
  return new Promise((resolve, reject) => {
    execFile('nmcli', args, { timeout: 10000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

// nmcli -t escape dấu ':' và '\' bằng backslash. Phải unescape trước khi parse.
const unescapeTerse = (s) => s.replace(/\\(.)/g, '$1');

/** Tách dòng terse thành [field, value] tại dấu ':' đầu tiên chưa bị escape. */
function splitTerseLine(line) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line[i] === ':') return [line.slice(0, i), line.slice(i + 1)];
  }
  return [line, ''];
}

/** vpn.data có dạng "ca = /p/a.pem, cert = /p/b.pem, cipher = AES-128-GCM" */
function parseVpnData(raw) {
  const out = {};
  for (const part of unescapeTerse(raw).split(/,\s*/)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

const slugify = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'vpn';

/** Kiểm tra các file cert còn tồn tại không; profile hỏng vẫn trả về nhưng đánh dấu broken. */
function checkCertFiles(profile) {
  const missing = [];
  for (const field of ['ca', 'cert', 'key', 'tlsCrypt', 'tlsAuth']) {
    if (!profile[field]) continue;
    const info = guard.describePath(profile[field]);
    if (!info.ok) missing.push(`${field}: ${info.error}`);
  }
  return missing;
}

/** Liệt kê mọi connection type=vpn dùng plugin OpenVPN. */
async function listProfiles() {
  // NetworkManager chỉ có trên Linux; ở nơi khác trả rỗng để UI ẩn nút đi,
  // thay vì để user bấm rồi nhận lỗi khó hiểu.
  if (!platform.supportsNetworkManager()) {
    return { profiles: [], unsupported: 'NetworkManager chỉ có trên Linux' };
  }
  const listing = await nmcli(['-t', '-f', 'NAME,TYPE', 'con', 'show']);
  const names = listing.split('\n')
    .map((l) => l.trim()).filter(Boolean)
    .map((l) => splitTerseLine(l))
    .filter(([, type]) => unescapeTerse(type) === 'vpn')
    .map(([name]) => unescapeTerse(name));

  const profiles = [];
  for (const name of names) {
    let detail;
    try {
      detail = await nmcli(['-t', 'con', 'show', name]);
    } catch {
      continue;
    }

    const fields = {};
    for (const line of detail.split('\n')) {
      if (!line.trim()) continue;
      const [k, v] = splitTerseLine(line);
      fields[k] = v;
    }

    if (!String(fields['vpn.service-type'] || '').includes('openvpn')) continue;

    const d = parseVpnData(fields['vpn.data'] || '');
    const profile = {
      id: slugify(name),
      name,
      source: 'nm',
      gateway: d.remote || '',
      ca: d.ca || '',
      cert: d.cert || '',
      key: d.key || '',
      tlsCrypt: d['tls-crypt'] || '',
      tlsAuth: d['tls-auth'] || '',
      cipher: d.cipher || '',
      auth: d.auth || '',
      verifyX509: (d['verify-x509-name'] || '').replace(/^name:/, ''),
      tlsVersionMin: d['tls-version-min'] || '',
      proto: d.proto || (d['proto-tcp'] === 'yes' ? 'tcp' : 'udp'),
      connectionType: d['connection-type'] || '',
    };

    // Plan chỉ hỗ trợ auth bằng certificate (tls), không hỗ trợ user/pass
    profile.unsupported = profile.connectionType && profile.connectionType !== 'tls'
      ? `Chỉ hỗ trợ xác thực certificate, connection này dùng "${profile.connectionType}"`
      : null;

    const missing = checkCertFiles(profile);
    profile.broken = missing.length > 0 ? missing.join('; ') : null;
    if (!profile.gateway) profile.broken = 'Thiếu gateway';

    profiles.push(profile);
  }
  return { profiles, unsupported: null };
}

module.exports = { listProfiles, parseVpnData, splitTerseLine, slugify };
