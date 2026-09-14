// Quy tắc "chỉ host CUỐI CÙNG thoát mới được dọn tunnel".
// Nếu sai, đóng một trình duyệt sẽ giết tunnel của trình duyệt vẫn đang mở.
import { spawn, execSync } from 'child_process';
import { readdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { counter, sleep } from './lib/harness.js';

const { ok, done } = counter();
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const HOST = join(REPO, 'native-host', 'vpn-manager-host.sh');
const HOSTS_DIR = join(homedir(), '.config', 'vpn-manager', 'hosts');
const CERTS = join(homedir(), '.cert', 'nm-openvpn');

const registered = () => { try { return readdirSync(HOSTS_DIR); } catch { return []; } };
const containers = () => execSync(`docker ps --filter 'name=^vpnmgr-' --format '{{.Names}}'`)
  .toString().trim();

// env -i: giống hệt cách Chrome spawn native host
function spawnHost() {
  const p = spawn(HOST, [], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { HOME: homedir(), PATH: '/usr/bin:/bin' },
  });
  const pending = new Map();
  let id = 0;
  let buf = Buffer.alloc(0);

  p.stdout.on('data', (c) => {
    buf = Buffer.concat([buf, c]);
    for (;;) {
      if (buf.length < 4) return;
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) return;
      const m = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
      buf = buf.subarray(4 + len);
      const r = pending.get(m.id);
      pending.delete(m.id);
      if (r) r(m);
    }
  });

  p.send = (action, payload = {}) => new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    const body = Buffer.from(JSON.stringify({ id: i, action, payload }), 'utf8');
    const h = Buffer.alloc(4);
    h.writeUInt32LE(body.length, 0);
    p.stdin.write(Buffer.concat([h, body]));
  });
  return p;
}

const PROFILE = {
  id: 'registrytest', socksPort: 1099, gateway: '203.0.113.10:11194',
  ca: `${CERTS}/MyVPN-ca.pem`, cert: `${CERTS}/MyVPN-cert.pem`,
  key: `${CERTS}/MyVPN-key.pem`, tlsCrypt: `${CERTS}/MyVPN-tls-crypt.pem`,
  cipher: 'AES-128-GCM', auth: 'SHA256',
  verifyX509: 'server_xxxxxxxx', tlsVersionMin: '1.2',
};

console.log('--- Hai host cùng chạy, A dựng tunnel ---');
const a = spawnHost();
const b = spawnHost();
await sleep(1200);
ok(registered().length === 2, '2 host đăng ký', registered().join(','));

const started = await a.send('start-tunnel', { profile: PROFILE });
ok(started.ok, 'A dựng được tunnel', JSON.stringify(started).slice(0, 140));
ok(containers().includes('vpnmgr-registrytest'), 'container đang chạy');

console.log('\n--- A thoát, B còn sống: tunnel PHẢI sống sót ---');
a.stdin.end();
await sleep(18000); // qua hết grace 15s của A
ok(a.exitCode !== null, 'A đã thoát', String(a.exitCode));
ok(registered().length === 1 && registered()[0] === String(b.pid),
   'chỉ còn B đăng ký', registered().join(','));
ok(containers().includes('vpnmgr-registrytest'),
   'tunnel VẪN chạy (không bị A giết)', containers() || '(trống)');

console.log('\n--- B là host cuối cùng: giờ mới được dọn ---');
b.stdin.end();
await sleep(18000);
ok(b.exitCode !== null, 'B đã thoát', String(b.exitCode));
ok(containers() === '', 'tunnel đã được dọn', containers());
ok(registered().length === 0, 'registry sạch', registered().join(','));

done();
