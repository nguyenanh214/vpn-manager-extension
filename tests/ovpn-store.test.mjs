// Dọn file .ovpn mồ côi. File .ovpn chứa private key inline nên đây là đường xoá
// secret — sai một chiều là để lộ, sai chiều kia là mất cấu hình của user.
//
// Không cần trình duyệt lẫn Docker: trỏ APPDATA/HOME vào thư mục tạm rồi chạy thật
// trên đĩa. Chạy được ở bất cứ đâu có Node, giống bộ `platform`.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'vpnmgr-store-'));
process.env.APPDATA = sandbox; // Windows
process.env.HOME = sandbox; // Linux/macOS

const require = createRequire(import.meta.url);
const store = require('../native-host/lib/ovpn-store.js');

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  PASS', msg); }
  else { fail++; console.log('  FAIL', msg); }
};

// Chốt chặn: lỡ sandbox không ăn thì dừng ngay, đừng xoá file thật của người chạy test.
if (!store.PROFILE_DIR.startsWith(sandbox)) {
  console.error(`DỪNG: PROFILE_DIR (${store.PROFILE_DIR}) nằm ngoài sandbox`);
  process.exit(1);
}

const cfg = (n) => [
  'client', 'dev tun', 'proto udp', `remote ${n}.example.com 1194`,
  '<ca>', 'x', '</ca>', '<cert>', 'x', '</cert>', '<key>', 'x', '</key>', '',
].join('\n');

/** Chỉ các id hợp lệ, bỏ qua file rác cố tình đặt vào thư mục. */
const ids = () => store.list().filter((i) => i.startsWith('vpn-')).sort().join(',');

console.log('--- dọn file .ovpn mồ côi ---');

store.save('vpn-aaa', cfg('a'));
store.save('vpn-bbb', cfg('b'));
store.save('vpn-ccc', cfg('c'));
ok(ids() === 'vpn-aaa,vpn-bbb,vpn-ccc', 'lưu được 3 config');

// Tên file không phải id hợp lệ: prune phải bỏ qua, không được xoá bừa
fs.writeFileSync(path.join(store.PROFILE_DIR, '..bad..ovpn'), 'rác');

let threw = false;
try { store.pruneExcept(undefined); } catch { threw = true; }
ok(threw, 'thiếu keepIds thì ném lỗi thay vì coi như rỗng');
ok(ids() === 'vpn-aaa,vpn-bbb,vpn-ccc', 'sau lỗi vẫn còn nguyên 3 config');

ok(store.pruneExcept(['vpn-aaa', 'vpn-ccc']).removed.join(',') === 'vpn-bbb',
  'xoá đúng cái không còn profile trỏ tới');
ok(ids() === 'vpn-aaa,vpn-ccc', 'hai cái còn profile vẫn nguyên');
ok(fs.existsSync(path.join(store.PROFILE_DIR, '..bad..ovpn')),
  'file tên rác không bị đụng tới');

ok(store.pruneExcept(['vpn-aaa', 'vpn-ccc']).removed.length === 0,
  'chạy lại lần hai không xoá thêm gì');

ok(store.pruneExcept([]).removed.sort().join(',') === 'vpn-aaa,vpn-ccc',
  'không còn profile nào thì dọn sạch');

console.log('\n--- quyền file ---');
const saved = store.save('vpn-perm', cfg('p'));
if (process.platform === 'win32') {
  // Windows không có chmod: phải chắc ACL chỉ còn đúng user hiện tại, kế thừa đã gỡ.
  const acl = require('child_process').execFileSync('icacls', [saved], { encoding: 'utf8' });
  const grants = acl.split('\n').filter((l) => l.includes(':('));
  ok(grants.length === 1 && grants[0].includes(process.env.USERNAME || ''),
    `chỉ đúng một tài khoản đọc được file (thấy ${grants.length} ACE)`);
} else {
  ok((fs.statSync(saved).mode & 0o777) === 0o600, 'quyền 0600');
}

fs.rmSync(sandbox, { recursive: true, force: true });

console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);
