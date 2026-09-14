// prune-ovpn đi qua native host THẬT, trên cả Linux, macOS lẫn Windows.
//
// Đây là đường code xoá file của user nên cần chốt chặn: `ovpn-store.test.mjs` chỉ
// kiểm hàm `pruneExcept` trong sandbox, bộ này kiểm cả khâu nối dây qua giao thức
// native messaging — nơi một payload thiếu field có thể thành lệnh xoá sạch.
//
// Hai ràng buộc an toàn, vì bộ này chạy trên chính máy user đang dùng:
//   1. Host chạy với APPDATA/HOME trỏ vào thư mục tạm. Bản trước đưa HOME thật vào
//      rồi prune với `keepIds: []` ở bước cuối — tức là xoá sạch .ovpn thật của
//      người chạy test. File .ovpn có private key inline, mất là mất hẳn.
//   2. Kết thúc bằng cách giết cả cây process của host. Để host tự thoát là kích
//      hoạt stopAll(), mà stopAll liệt container theo tiền tố tên chứ không theo
//      state dir — sandbox không cứu được tunnel thật. Vẫn giữ thêm chốt "đang có
//      tunnel thì bỏ qua" phòng khi test chết giữa chừng và bỏ lại host mồ côi.
import { spawn, execFileSync } from 'child_process';
import { readdirSync, writeFileSync, mkdirSync, rmSync, mkdtempSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join as pjoin } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

// realpath: macOS trỏ /tmp và /var qua symlink sang /private. path-guard so
// realpath của file với HOME chưa resolve, nên không realpath là cert nằm ngay
// trong sandbox vẫn bị báo "phải nằm trong thư mục home".
const SANDBOX = realpathSync(mkdtempSync(pjoin(tmpdir(), 'vpnmgr-prune-')));
process.env.APPDATA = SANDBOX; // Windows
process.env.HOME = SANDBOX; // Linux/macOS

// Tính DIR bằng chính module của host, đừng tự ghép đường dẫn: lệch một chút là
// test soi nhầm thư mục và tưởng prune không chạy.
const platform = require('../native-host/lib/platform.js');
const DIR = pjoin(platform.stateDir(), 'profiles');
if (!DIR.startsWith(SANDBOX)) {
  console.error(`DỪNG: profiles (${DIR}) nằm ngoài sandbox, không chạy tiếp.`);
  process.exit(1);
}

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { c ? (pass++, console.log('  PASS ' + m)) : (fail++, console.log('  FAIL ' + m + (extra ? '  <- ' + extra : ''))); };
const files = () => { try { return readdirSync(DIR).filter(f => f.endsWith('.ovpn')).sort(); } catch { return []; } };
const done = (code) => { rmSync(SANDBOX, { recursive: true, force: true }); process.exit(code); };

// Chốt chặn: host mồ côi sẽ stopAll() sau 15s, giết tunnel thật của user.
// execFileSync chứ không execSync — cmd.exe không coi nháy đơn là dấu nháy, chuỗi
// kiểu shell POSIX vỡ thành "invalid filter" ngay trên Windows.
let running = '';
try {
  running = execFileSync('docker',
    ['ps', '--filter', 'name=^vpnmgr-', '--format', '{{.Names}}'],
    { encoding: 'utf8' }).trim();
} catch { /* không có Docker thì cũng không có tunnel để mất */ }
if (running) {
  console.log(`  BỎ QUA: đang có tunnel chạy (${running}). Host mồ côi sẽ dọn mất nó.`);
  done(0);
}

const LAUNCHER = pjoin(REPO, 'native-host', platform.hostLauncher());
const isWin = process.platform === 'win32';
const sysRoot = process.env.SystemRoot || process.env.windir || 'C:/Windows';
// PATH tối thiểu giống cách Chrome spawn host. Trên Windows phải kèm system32 cho
// cmd.exe, và thư mục node vì APPDATA sandbox không có file node-path.
const childEnv = isWin
  ? {
    APPDATA: SANDBOX, HOME: SANDBOX, SystemRoot: sysRoot,
    USERNAME: process.env.USERNAME || '',
    PATH: [dirname(process.execPath), pjoin(sysRoot, 'system32'), sysRoot].join(';'),
  }
  : { HOME: SANDBOX, PATH: '/usr/bin:/bin' };
// Node từ chối spawn .bat trực tiếp; đi qua cmd.exe bằng mảng tham số, không nội suy.
const [cmd, args] = isWin
  ? [process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', LAUNCHER]]
  : [LAUNCHER, []];
const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'], env: childEnv });

const pending = new Map(); let id = 0; let buf = Buffer.alloc(0);
p.stdout.on('data', c => {
  buf = Buffer.concat([buf, c]);
  for (;;) {
    if (buf.length < 4) return;
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) return;
    const m = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
    buf = buf.subarray(4 + len);
    const r = pending.get(m.id); pending.delete(m.id); if (r) r(m);
  }
});
const send = (action, payload = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, res);
  const body = Buffer.from(JSON.stringify({ id: i, action, payload }), 'utf8');
  const h = Buffer.alloc(4); h.writeUInt32LE(body.length, 0);
  p.stdin.write(Buffer.concat([h, body]));
  setTimeout(() => { if (pending.delete(i)) rej(new Error(`quá hạn: ${action}`)); }, 15000);
});

try {
  console.log('--- host lên được chưa ---');
  const pong = await send('ping');
  ok(pong.ok === true && pong.data.pong === true, 'host trả lời ping', JSON.stringify(pong));

  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  for (const n of ['keep1', 'keep2', 'orphan1', 'orphan2']) {
    writeFileSync(pjoin(DIR, `${n}.ovpn`), 'x', { mode: 0o600 });
  }
  writeFileSync(pjoin(DIR, 'ten file rac.ovpn'), 'x', { mode: 0o600 }); // id không hợp lệ
  console.log('  trước khi prune:', files().join(', '));

  console.log('\n--- thiếu keepIds phải bị từ chối, KHÔNG xoá gì ---');
  const bad = await send('prune-ovpn', {});
  ok(bad.ok === false, 'từ chối khi thiếu keepIds', JSON.stringify(bad));
  ok(files().length === 5, 'không file nào bị xoá', files().join(','));

  console.log('\n--- prune với danh sách giữ lại ---');
  const r = await send('prune-ovpn', { keepIds: ['keep1', 'keep2'] });
  ok(r.ok === true, 'prune chạy được', JSON.stringify(r));
  const after = files();
  console.log('  sau khi prune:', after.join(', '));
  ok(after.includes('keep1.ovpn') && after.includes('keep2.ovpn'), 'file còn profile trỏ tới được giữ');
  ok(!after.includes('orphan1.ovpn') && !after.includes('orphan2.ovpn'), 'file mồ côi đã xoá');
  ok(after.includes('ten file rac.ovpn'), 'tên file không hợp lệ bị BỎ QUA, không xoá bừa', after.join(','));

  console.log('\n--- keepIds rỗng thật sự thì xoá hết ---');
  await send('prune-ovpn', { keepIds: [] });
  ok(!files().includes('keep1.ovpn'), 'mảng rỗng tường minh thì dọn sạch');
} catch (err) {
  fail++;
  console.log('  FAIL bộ test chết giữa chừng <- ' + err.message);
}

// Đừng để host chạy hook dọn dẹp rồi stopAll() tunnel thật của user.
// Trên Windows launcher là .bat chạy dưới cmd.exe: giết p chỉ giết cmd.exe, node.exe
// con sống tiếp, thấy stdin EOF rồi stopAll() sau 15s — đúng thứ chốt chặn ở trên
// cố tránh. Phải giết cả cây process.
if (isWin) {
  try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); }
  catch { p.kill(); }
} else {
  p.kill('SIGKILL');
}
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
done(fail ? 1 : 0);
