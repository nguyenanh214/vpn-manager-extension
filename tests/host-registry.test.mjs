// Quy tắc "chỉ host CUỐI CÙNG thoát mới được dọn tunnel".
// Nếu sai, đóng một trình duyệt sẽ giết tunnel của trình duyệt vẫn đang mở.
//
// Bộ nặng nhất repo: dựng tunnel THẬT nên cần Docker, image đã build và một cấu hình
// VPN chạy được. Bốn ràng buộc:
//   1. Registry chạy trong sandbox APPDATA/HOME. Không thì host thật do Chrome spawn
//      cũng nằm trong `hosts/`: "2 host đăng ký" thành 3, và B không bao giờ là host
//      cuối cùng nên bước dọn tunnel không bao giờ chạy. Trước đây phải đóng Chrome
//      mới chạy được bộ này.
//   2. `stopAll()` liệt container theo tiền tố tên chứ không theo state dir, nên
//      sandbox KHÔNG cứu được tunnel thật. Đang có tunnel chạy thì bỏ qua.
//   3. Cấu hình lấy từ .ovpn user đã import, copy vào sandbox vì path-guard bắt cert
//      phải nằm trong home. Đừng hardcode cert của một người vào test.
//   4. So pid phải hỏi host, đừng lấy `child.pid`: trên Windows launcher là .bat chạy
//      dưới cmd.exe nên `child.pid` là pid của cmd.exe, không phải của node.
import { spawn, execFileSync } from 'child_process';
import { readdirSync, readFileSync, copyFileSync, rmSync, mkdtempSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { counter, sleep } from './lib/harness.js';

const { ok, state } = counter();
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const platform = require('../native-host/lib/platform.js');
const { parseOvpn } = require('../native-host/lib/ovpn-parser.js');

const CONTAINER = 'vpnmgr-registrytest';
// realpath: macOS trỏ /tmp và /var qua symlink sang /private. path-guard so
// realpath của file với HOME chưa resolve, nên không realpath là cert nằm ngay
// trong sandbox vẫn bị báo "phải nằm trong thư mục home".
const SANDBOX = realpathSync(mkdtempSync(join(tmpdir(), 'vpnmgr-registry-')));
const cleanup = () => rmSync(SANDBOX, { recursive: true, force: true });
const bail = (msg) => { console.log(msg); cleanup(); process.exit(0); };

const dockerOut = (args) => {
  try { return execFileSync('docker', args, { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};
const containers = () => dockerOut(['ps', '--filter', 'name=^vpnmgr-', '--format', '{{.Names}}']);

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

// Chốt chặn: B thoát sẽ stopAll(), xoá mọi container vpnmgr-* kể cả tunnel thật.
const running = containers();
if (running) bail(`  BỎ QUA: đang có tunnel chạy (${running}). Bước cuối sẽ dọn mất nó.`);

// Sandbox phải đặt SAU khi đã đọc xong đường dẫn thật ở trên.
process.env.APPDATA = SANDBOX; // Windows
process.env.HOME = SANDBOX; // Linux/macOS
const HOSTS_DIR = join(platform.stateDir(), 'hosts');
if (!HOSTS_DIR.startsWith(SANDBOX)) {
  console.error(`DỪNG: hosts/ (${HOSTS_DIR}) nằm ngoài sandbox.`);
  cleanup();
  process.exit(1);
}

// path-guard bắt cert nằm trong home; trên Linux home giờ LÀ sandbox nên phải copy vào.
const CONFIG = join(SANDBOX, 'registrytest.ovpn');
copyFileSync(source, CONFIG);
const parsed = parseOvpn(readFileSync(CONFIG, 'utf8'));
if (!parsed.ok) bail(`  BỎ QUA: ${source} không parse được — ${parsed.errors.join('; ')}`);

const PROFILE = {
  id: 'registrytest', mode: 'ovpn', configPath: CONFIG, socksPort: 1099,
  gateway: parsed.info.gateway, proto: parsed.info.proto,
};
console.log(`  cấu hình: ${source} -> ${PROFILE.gateway} (${PROFILE.proto})`);

const registered = () => { try { return readdirSync(HOSTS_DIR); } catch { return []; } };

const isWin = process.platform === 'win32';
const sysRoot = process.env.SystemRoot || process.env.windir || 'C:/Windows';
const LAUNCHER = join(REPO, 'native-host', platform.hostLauncher());
// Linux: Chrome spawn host đúng với PATH này, và docker nằm sẵn trong /usr/bin.
// Windows: Chrome truyền nguyên PATH của user chứ không cắt bớt, mà docker.exe nằm
// trong thư mục cài Docker Desktop — cắt PATH là host báo "spawn docker ENOENT".
// Thư mục node đứng trước vì APPDATA sandbox không có file node-path.
const childEnv = isWin
  ? {
    APPDATA: SANDBOX, HOME: SANDBOX, SystemRoot: sysRoot,
    USERNAME: process.env.USERNAME || '', USERPROFILE: process.env.USERPROFILE || '',
    PATH: [dirname(process.execPath), process.env.PATH || ''].join(';'),
  }
  : { HOME: SANDBOX, PATH: '/usr/bin:/bin' };

function spawnHost() {
  // Node từ chối spawn .bat trực tiếp; đi qua cmd.exe bằng mảng tham số.
  const [cmd, args] = isWin
    ? [process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', LAUNCHER]]
    : [LAUNCHER, []];
  const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'ignore'], env: childEnv });
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

  p.send = (action, payload = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, res);
    const body = Buffer.from(JSON.stringify({ id: i, action, payload }), 'utf8');
    const h = Buffer.alloc(4);
    h.writeUInt32LE(body.length, 0);
    p.stdin.write(Buffer.concat([h, body]));
    setTimeout(() => { if (pending.delete(i)) rej(new Error(`quá hạn: ${action}`)); }, 90000);
  });
  return p;
}

// Giết cả cây: trên Windows hạ cmd.exe không hạ node.exe, host sống tiếp rồi stopAll().
function killTree(p) {
  if (p.exitCode !== null) return;
  if (isWin) {
    try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); }
    catch { p.kill(); }
  } else {
    p.kill('SIGKILL');
  }
}

let a; let b;
try {
  console.log('\n--- Hai host cùng chạy, A dựng tunnel ---');
  a = spawnHost();
  b = spawnHost();
  // Hỏi chính host pid của nó; child.pid là cmd.exe trên Windows.
  const aPid = String((await a.send('ping')).data.pid);
  const bPid = String((await b.send('ping')).data.pid);
  ok(registered().sort().join(',') === [aPid, bPid].sort().join(','),
    '2 host đăng ký', registered().join(','));

  const started = await a.send('start-tunnel', { profile: PROFILE });
  ok(started.ok, 'A dựng được tunnel', JSON.stringify(started).slice(0, 200));
  ok(containers().includes(CONTAINER), 'container đang chạy', containers() || '(trống)');

  console.log('\n--- A thoát, B còn sống: tunnel PHẢI sống sót ---');
  a.stdin.end();
  await sleep(18000); // qua hết grace 15s của A
  ok(a.exitCode !== null, 'A đã thoát', String(a.exitCode));
  ok(registered().join(',') === bPid, 'chỉ còn B đăng ký', registered().join(','));
  ok(containers().includes(CONTAINER),
    'tunnel VẪN chạy (không bị A giết)', containers() || '(trống)');

  console.log('\n--- B là host cuối cùng: giờ mới được dọn ---');
  b.stdin.end();
  await sleep(18000);
  ok(b.exitCode !== null, 'B đã thoát', String(b.exitCode));
  ok(containers() === '', 'tunnel đã được dọn', containers());
  ok(registered().length === 0, 'registry sạch', registered().join(','));
} catch (err) {
  state.fail++;
  console.log('  FAIL bộ test chết giữa chừng <- ' + err.message);
} finally {
  if (a) killTree(a);
  if (b) killTree(b);
  dockerOut(['rm', '-f', CONTAINER]); // chỉ container của bộ này, không stopAll
  cleanup();
}

console.log(`\n=== ${state.pass} PASS / ${state.fail} FAIL ===`);
process.exit(state.fail ? 1 : 0);
