// Traffic có THẬT SỰ đi qua tunnel không, và traffic ngoài tunnel có bị đổi đường không.
//
// `ovpn.test.mjs` cũng kiểm việc này nhưng đi qua Chrome for Testing nên chỉ chạy được
// trên Linux. Bộ này bỏ lớp trình duyệt: dựng tunnel qua native host thật rồi so IP
// giữa `curl` trực tiếp và `curl` qua cổng SOCKS. Nhờ vậy chạy được trên cả ba OS.
//
// KHÔNG kiểm lớp PAC của `chrome.proxy` — tức là "đúng domain đã bật mới đi qua
// tunnel". Đó vẫn là việc của `routing.test.mjs`.
//
// Cấu hình lấy từ .ovpn user đã import, copy vào sandbox rồi xoá khi xong.
// Repo không bao giờ chứa .ovpn; máy nào chưa import thì bộ này tự bỏ qua.
import { spawn, execFileSync } from 'child_process';
import { readdirSync, readFileSync, copyFileSync, rmSync, mkdtempSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { counter } from './lib/harness.js';
import { sandboxEnv, dockerContextEnv } from './lib/host-sandbox.js';

const { ok, state } = counter();
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const platform = require('../native-host/lib/platform.js');
const { parseOvpn } = require('../native-host/lib/ovpn-parser.js');

const PORT = 1099;
const CONTAINER = 'vpnmgr-traffickcheck';
const IP_URL = 'https://api.ipify.org';
const IP_URL_ALT = 'https://ifconfig.me/ip';
const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);

// realpath: macOS trỏ /tmp và /var qua symlink sang /private. path-guard so realpath
// của file với HOME chưa resolve, nên không realpath là cert nằm ngay trong sandbox
// vẫn bị báo "phải nằm trong thư mục home".
const SANDBOX = realpathSync(mkdtempSync(join(tmpdir(), 'vpnmgr-traffic-')));
const cleanupDir = () => rmSync(SANDBOX, { recursive: true, force: true });
const bail = (msg) => { console.log(msg); cleanupDir(); process.exit(0); };

// dockerContextEnv: bên dưới process.env.HOME bị trỏ sang sandbox, mà Docker Desktop
// trên macOS chọn socket qua context nằm trong HOME thật. Thiếu nó thì mọi lệnh
// docker ném lỗi, hàm này nuốt mất và mọi phép kiểm container đều thấy "trống".
const run = (bin, args) => {
  try {
    return execFileSync(bin, args,
      { encoding: 'utf8', env: { ...process.env, ...dockerContextEnv() } }).trim();
  } catch { return ''; }
};
const containers = () => run('docker', ['ps', '--filter', 'name=^vpnmgr-', '--format', '{{.Names}}']);
const curlDirect = (url) => run('curl', ['-s', '--max-time', '15', url]);
const curlViaVpn = (url) => run('curl',
  ['-s', '--max-time', '25', '--socks5-hostname', `127.0.0.1:${PORT}`, url]);

if (!run('curl', ['--version'])) bail('  BỎ QUA: không có curl.');

// Cấu hình: .ovpn user đã import, hoặc chỉ định tường minh qua env.
const realProfiles = join(platform.stateDir(), 'profiles');
let source = process.env.VPNMGR_TEST_OVPN || '';
if (!source) {
  const found = (() => {
    try { return readdirSync(realProfiles).filter((f) => f.endsWith('.ovpn')).sort(); }
    catch { return []; }
  })();
  if (found.length) source = join(realProfiles, found[0]);
}
if (!source) bail(`  BỎ QUA: không có .ovpn nào trong ${realProfiles}. Đặt VPNMGR_TEST_OVPN để chỉ định.`);

// Chốt chặn: bộ này dựng tunnel riêng, đụng vào tunnel thật của user là hỏng cả hai.
const running = containers();
if (running) bail(`  BỎ QUA: đang có tunnel chạy (${running}).`);

// Sandbox phải đặt SAU khi đã đọc xong đường dẫn thật ở trên.
process.env.APPDATA = SANDBOX; // Windows
process.env.HOME = SANDBOX; // Linux/macOS
if (!platform.stateDir().startsWith(SANDBOX)) {
  console.error(`DỪNG: stateDir (${platform.stateDir()}) nằm ngoài sandbox.`);
  cleanupDir();
  process.exit(1);
}

// path-guard bắt cert nằm trong home; trên Linux home giờ LÀ sandbox nên phải copy vào.
const CONFIG = join(SANDBOX, 'traffic.ovpn');
copyFileSync(source, CONFIG);
const parsed = parseOvpn(readFileSync(CONFIG, 'utf8'));
if (!parsed.ok) bail(`  BỎ QUA: ${source} không parse được — ${parsed.errors.join('; ')}`);

const PROFILE = {
  id: 'traffickcheck', mode: 'ovpn', configPath: CONFIG, socksPort: PORT,
  gateway: parsed.info.gateway, proto: parsed.info.proto,
};
console.log(`  cấu hình: ${source}`);
console.log(`  gateway:  ${PROFILE.gateway} (${PROFILE.proto})`);

const isWin = process.platform === 'win32';
const LAUNCHER = join(REPO, 'native-host', platform.hostLauncher());
const childEnv = sandboxEnv(SANDBOX, { docker: true });
// Node từ chối spawn .bat trực tiếp; đi qua cmd.exe bằng mảng tham số.
const [cmd, cmdArgs] = isWin
  ? [process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', LAUNCHER]]
  : [LAUNCHER, []];
const p = spawn(cmd, cmdArgs, { stdio: ['pipe', 'pipe', 'ignore'], env: childEnv });

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
const send = (action, payload = {}) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, res);
  const body = Buffer.from(JSON.stringify({ id: i, action, payload }), 'utf8');
  const h = Buffer.alloc(4);
  h.writeUInt32LE(body.length, 0);
  p.stdin.write(Buffer.concat([h, body]));
  setTimeout(() => { if (pending.delete(i)) rej(new Error(`quá hạn: ${action}`)); }, 90000);
});

try {
  const before = curlDirect(IP_URL);
  console.log(`\n--- IP trực tiếp trước khi bật tunnel: ${before || '(không ra gì)'} ---`);
  if (!isIp(before)) throw new Error('không lấy được IP nền, máy đang mất mạng?');

  console.log('\n--- dựng tunnel ---');
  const started = await send('start-tunnel', { profile: PROFILE });
  ok(started.ok, 'tunnel dựng được', JSON.stringify(started).slice(0, 200));
  if (!started.ok) throw new Error('không dựng được tunnel');
  ok(containers().includes(CONTAINER), 'container đang chạy', containers() || '(trống)');

  console.log('\n--- so IP ---');
  const viaVpn = curlViaVpn(IP_URL);
  const direct = curlDirect(IP_URL);
  console.log(`  qua SOCKS 127.0.0.1:${PORT} : ${viaVpn || '(không ra gì)'}`);
  console.log(`  trực tiếp                   : ${direct || '(không ra gì)'}`);
  ok(isIp(viaVpn), 'traffic qua SOCKS ra được Internet', viaVpn || '(rỗng)');
  ok(isIp(viaVpn) && viaVpn !== direct, 'IP qua tunnel KHÁC IP trực tiếp', `${viaVpn} vs ${direct}`);
  // Đây là lời hứa cốt lõi của extension: chỉ domain được chọn mới đổi đường.
  ok(direct === before, 'traffic ngoài tunnel KHÔNG bị đổi đường', `${before} -> ${direct}`);

  console.log('\n--- DNS trong tunnel ---');
  // --socks5-hostname để container tự resolve; tên rò ra resolver của máy là leak.
  const viaName = curlViaVpn(IP_URL_ALT);
  ok(isIp(viaName), 'resolve tên miền qua tunnel được', viaName || '(rỗng)');
  ok(viaName === viaVpn, 'cùng một IP lối ra', `${viaName} vs ${viaVpn}`);
} catch (err) {
  state.fail++;
  console.log('  FAIL bộ test chết giữa chừng <- ' + err.message);
} finally {
  // Giết cả cây: trên Windows hạ cmd.exe không hạ node.exe, host sống tiếp rồi stopAll().
  if (p.exitCode === null) {
    if (isWin) {
      try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); }
      catch { p.kill(); }
    } else {
      p.kill('SIGKILL');
    }
  }
  run('docker', ['rm', '-f', CONTAINER]); // chỉ container của bộ này, không stopAll
  cleanupDir();
}

console.log(`\n=== ${state.pass} PASS / ${state.fail} FAIL ===`);
process.exit(state.fail ? 1 : 0);
