// Import file .ovpn: parse, từ chối file chưa hỗ trợ, quyền file, kết nối thật.
import { execSync } from 'child_process';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { counter, openPopup, messenger, resetState, sleep } from './lib/harness.js';

const { ok, done } = counter();
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const PROFILE_DIR = join(homedir(), '.config', 'vpn-manager', 'profiles');

const fixture = (n) => readFileSync(join(FIXTURES, `${n}.ovpn`), 'utf8');

const page = await openPopup();
const msg = messenger(page);
await resetState(page);

console.log('--- 1. Từ chối file chưa hỗ trợ, nêu rõ lý do ---');
const ext = await msg('import-ovpn', { name: 'ngoai', content: fixture('external-refs') });
ok(ext.ok === false, 'file trỏ cert bên ngoài bị từ chối');
ok(ext.errors?.some((e) => e.includes('file bên ngoài')), 'nêu đúng lý do', JSON.stringify(ext.errors));

const auth = await msg('import-ovpn', { name: 'userpass', content: fixture('auth-user-pass') });
ok(auth.ok === false, 'file cần user/password bị từ chối');
ok(auth.errors?.some((e) => e.includes('username/password')), 'nêu đúng lý do', JSON.stringify(auth.errors));

const st0 = await msg('get-state');
ok(st0.state.vpnProfiles.length === 0, 'file bị từ chối không tạo profile nào');

console.log('\n--- 2. Import file tự chứa ---');
const good = await msg('import-ovpn', { name: 'Fixture VPN', content: fixture('sample-inline') });
ok(good.ok, 'import được', good.error || JSON.stringify(good.errors));
ok(good.profile?.mode === 'ovpn', 'profile ở chế độ ovpn');
ok(good.profile?.gateway === 'vpn.example.com:1194', 'gateway lấy từ dòng remote', good.profile?.gateway);
ok(good.profile?.proto === 'udp', 'proto lấy đúng');
ok(good.profile?.socksPort === 1080, 'được cấp cổng SOCKS');

console.log('\n--- 3. Nội dung nằm trên đĩa, không nằm trong storage ---');
const saved = join(PROFILE_DIR, `${good.profile.id}.ovpn`);
ok(existsSync(saved), 'file .ovpn đã ghi ra đĩa', saved);
ok((statSync(saved).mode & 0o777) === 0o600, 'quyền file là 0600',
   (statSync(saved).mode & 0o777).toString(8));

const dump = await page.eval(`chrome.storage.local.get(null).then(s => JSON.stringify(s))`);
ok(!dump.includes('BEGIN'), 'chrome.storage KHÔNG chứa nội dung certificate');
ok(dump.includes(good.profile.id), 'chrome.storage chỉ giữ đường dẫn và metadata');

console.log('\n--- 4. Trùng tên bị chặn ---');
const dup = await msg('import-ovpn', { name: 'Fixture VPN', content: fixture('sample-inline') });
ok(dup.ok === false, 'tên trùng bị từ chối', dup.error);

console.log('\n--- 5. Xoá profile phải xoá luôn file secret ---');
ok((await msg('delete-vpn', { id: good.profile.id })).ok, 'xoá profile được');
await sleep(500);
ok(!existsSync(saved), 'file .ovpn đã bị xoá khỏi đĩa, không để lại secret mồ côi');

// Kết nối thật: dùng thẳng file .ovpn có sẵn của người chạy test thay vì tự dựng một
// file từ các PEM rời. Mục này kiểm luồng import + kết nối, nên file nào chạy được
// cũng phục vụ đúng mục đích — mà lại không phải nhét gateway, tên profile hay CN cert
// của ai vào repo công khai. Cùng nguồn với host-registry và traffic.
let livePath = process.env.VPNMGR_TEST_OVPN || '';
if (!livePath) {
  try {
    const first = readdirSync(PROFILE_DIR).filter((f) => f.endsWith('.ovpn')).sort()[0];
    if (first) livePath = join(PROFILE_DIR, first);
  } catch { /* chưa import gì bao giờ */ }
}
if (!livePath || !existsSync(livePath)) {
  console.log(`\n--- 6. Kết nối thật: BỎ QUA (không có .ovpn nào trong ${PROFILE_DIR},`
    + ' đặt VPNMGR_TEST_OVPN để chỉ định) ---');
  done();
}

console.log(`\n--- 6. Kết nối thật bằng file .ovpn (${livePath}) ---`);
const live = readFileSync(livePath, 'utf8');

const imported = await msg('import-ovpn', { name: 'Live OVPN', content: live });
ok(imported.ok, 'import file .ovpn thật', imported.error || JSON.stringify(imported.errors));

await msg('add-domain', { domain: 'api.ipify.org' });
const st = await msg('get-state');
const dom = st.state.domains[0];
await msg('set-domain-vpn', { id: dom.id, vpnId: imported.profile.id });
const on = await msg('toggle-domain', { id: dom.id, enabled: true });
ok(on.ok && on.tunnels[imported.profile.id]?.status === 'on', 'tunnel lên từ file .ovpn',
   JSON.stringify(on).slice(0, 160));

const logs = await msg('tunnel-logs', { id: imported.profile.id });
ok(logs.logs?.includes('dùng file .ovpn do user import'),
   'container dùng thẳng file, không sinh lại config');

const real = execSync('curl -s --max-time 10 https://api.ipify.org').toString().trim();
let viaVpn = '';
for (let i = 0; i < 8 && !viaVpn; i++) {
  await sleep(1500);
  try {
    viaVpn = execSync(
      `curl -s --max-time 10 --socks5-hostname 127.0.0.1:${imported.profile.socksPort} https://api.ipify.org`
    ).toString().trim();
  } catch { /* tunnel chưa sẵn sàng */ }
}
console.log(`   IP thật    : ${real}`);
console.log(`   qua tunnel : ${viaVpn}`);
ok(viaVpn !== '' && viaVpn !== real, 'traffic thoát bằng IP khác IP thật', viaVpn || '(rỗng)');
if (process.env.VPNMGR_TEST_EXIT_IP) {
  ok(viaVpn === process.env.VPNMGR_TEST_EXIT_IP, 'đúng IP VPN mong đợi', viaVpn);
}

page.close();
done();
