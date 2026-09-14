// prune-ovpn đi qua native host THẬT.
//
// Đây là đường code xoá file của user nên cần chốt chặn: `ovpn-store.test.mjs` chỉ
// kiểm hàm `pruneExcept` trong sandbox, bộ này kiểm cả khâu nối dây qua giao thức
// native messaging — nơi một payload thiếu field có thể thành lệnh xoá sạch.
//
// Bộ này spawn native host. Host đóng stdin là hẹn giờ 15s rồi `stopAll()`, nên
// `run-all.sh` phải dọn container trước khi chạy (stop-chrome.sh làm việc đó).
import { spawn } from 'child_process';
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';

import { dirname, join as pjoin } from 'path';
import { fileURLToPath } from 'url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const HOST = pjoin(REPO, 'native-host', 'vpn-manager-host.sh');
const DIR = pjoin(homedir(), '.config', 'vpn-manager', 'profiles');
let pass = 0, fail = 0;
const ok = (c, m, extra='') => { c ? (pass++, console.log('  PASS ' + m)) : (fail++, console.log('  FAIL ' + m + (extra ? '  <- ' + extra : ''))); };
const files = () => { try { return readdirSync(DIR).filter(f => f.endsWith('.ovpn')).sort(); } catch { return []; } };

// Chốt chặn: spawn host khi đang có tunnel thật là hẹn giờ giết nó.
import { execSync } from 'child_process';
const running = execSync("docker ps --filter 'name=^vpnmgr-' --format '{{.Names}}'")
  .toString().trim();
if (running) {
  console.log(`  BỎ QUA: đang có tunnel chạy (${running}). Spawn host sẽ dọn mất nó.`);
  process.exit(0);
}

const p = spawn(HOST, [], { stdio: ['pipe','pipe','ignore'], env: { HOME: homedir(), PATH: '/usr/bin:/bin' } });
const pending = new Map(); let id = 0; let buf = Buffer.alloc(0);
p.stdout.on('data', c => {
  buf = Buffer.concat([buf, c]);
  for (;;) {
    if (buf.length < 4) return;
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) return;
    const m = JSON.parse(buf.subarray(4, 4+len).toString('utf8'));
    buf = buf.subarray(4+len);
    const r = pending.get(m.id); pending.delete(m.id); if (r) r(m);
  }
});
const send = (action, payload={}) => new Promise(res => {
  const i = ++id; pending.set(i, res);
  const body = Buffer.from(JSON.stringify({ id: i, action, payload }), 'utf8');
  const h = Buffer.alloc(4); h.writeUInt32LE(body.length, 0);
  p.stdin.write(Buffer.concat([h, body]));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(1200);

mkdirSync(DIR, { recursive: true, mode: 0o700 });
for (const n of ['keep1','keep2','orphan1','orphan2']) {
  writeFileSync(pjoin(DIR, `${n}.ovpn`), 'x', { mode: 0o600 });
}
writeFileSync(pjoin(DIR, 'ten file rac.ovpn'), 'x', { mode: 0o600 }); // id không hợp lệ
console.log('  trước khi prune:', files().join(', '));

console.log('\n--- thiếu keepIds phải bị từ chối, KHÔNG xoá gì ---');
const bad = await send('prune-ovpn', {});
ok(bad.ok === false, 'từ chối khi thiếu keepIds', JSON.stringify(bad));
ok(files().length === 5, 'không file nào bị xoá', files().join(','));

console.log('\n--- prune với danh sách giữ lại ---');
const r = await send('prune-ovpn', { keepIds: ['keep1','keep2'] });
ok(r.ok === true, 'prune chạy được', JSON.stringify(r));
const after = files();
console.log('  sau khi prune:', after.join(', '));
ok(after.includes('keep1.ovpn') && after.includes('keep2.ovpn'), 'file còn profile trỏ tới được giữ');
ok(!after.includes('orphan1.ovpn') && !after.includes('orphan2.ovpn'), 'file mồ côi đã xoá');
ok(after.includes('ten file rac.ovpn'), 'tên file không hợp lệ bị BỎ QUA, không xoá bừa', after.join(','));

console.log('\n--- keepIds rỗng thật sự thì xoá hết ---');
await send('prune-ovpn', { keepIds: [] });
ok(!files().includes('keep1.ovpn'), 'mảng rỗng tường minh thì dọn sạch');

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
p.stdin.end();
setTimeout(() => { p.kill(); process.exit(fail ? 1 : 0); }, 800);
