// Tab Forward: CRUD, validate, traffic thật qua port-forward, dựng lại khi đổi cổng.
import { execSync } from 'child_process';
import { counter, openPopup, messenger, resetState, sleep } from './lib/harness.js';

const { ok, done } = counter();
const page = await openPopup();
const msg = messenger(page);
await resetState(page);

console.log('--- 1. Tab thứ 3 hiển thị ---');
await page.eval(`location.reload()`);
await sleep(1600);
ok(await page.eval(`document.querySelectorAll('.tab').length`) === 3, '3 tab');
ok(await page.eval(`[...document.querySelectorAll('.tab')].map(t=>t.dataset.tab).join(',')`)
   === 'domains,forwards,vpns', 'thứ tự tab: Domains, Forward, VPN');

const nm = await msg('import-nm');
const vpn = (await msg('add-vpn', { profile: nm.profiles.find((p) => p.id === 'anhnt') })).profile;

console.log('\n--- 2. Validate ---');
const add = (f) => msg('add-forward', { forward: f });
ok((await add({ localPort: 1080, remoteHost: 'a.com', remotePort: 3306 })).ok === false,
   'chặn cổng trong dải SOCKS');
ok((await add({ localPort: 80, remoteHost: 'a.com', remotePort: 3306 })).ok === false,
   'chặn cổng đặc quyền');
ok((await add({ localPort: 13306, remoteHost: 'a;rm -rf /', remotePort: 3306 })).ok === false,
   'chặn host có ký tự lạ');
ok((await add({ localPort: 13306, remoteHost: 'a.com', remotePort: 99999 })).ok === false,
   'chặn cổng đích ngoài dải');

const created = await add({ label: 'echo', localPort: 15380, remoteHost: 'ifconfig.me', remotePort: 80 });
ok(created.ok, 'thêm forward hợp lệ', created.error);
ok((await add({ localPort: 15380, remoteHost: 'khac.com', remotePort: 3306 })).ok === false,
   'chặn trùng cổng cục bộ');

console.log('\n--- 3. Bật khi chưa chọn VPN ---');
let st = await msg('get-state');
const fwd = st.state.forwards[0];
const noVpn = await msg('toggle-forward', { id: fwd.id, enabled: true });
ok(noVpn.ok === false && noVpn.needsVpn === true, 'bị chặn, báo "Chọn VPN trước"', noVpn.error);

console.log('\n--- 4. Gán VPN, bật, kiểm traffic THẬT ---');
await msg('set-forward-vpn', { id: fwd.id, vpnId: vpn.id });
const on = await msg('toggle-forward', { id: fwd.id, enabled: true });
ok(on.ok && on.tunnels[vpn.id]?.status === 'on', 'tunnel lên', JSON.stringify(on).slice(0, 140));

const ports = () => execSync(`docker ps --filter name=^vpnmgr- --format '{{.Ports}}'`).toString();
ok(ports().includes('15380'), 'cổng 15380 được publish', ports().trim());

const real = execSync(`curl -s --max-time 10 http://ifconfig.me/ip`).toString().trim();
let viaFwd = '';
for (let i = 0; i < 8 && !viaFwd; i++) {
  await sleep(1500);
  try {
    viaFwd = execSync(`curl -s --max-time 10 -H "Host: ifconfig.me" http://127.0.0.1:15380/ip`)
      .toString().trim();
  } catch { /* tunnel chưa sẵn sàng */ }
}
console.log(`   IP thật             : ${real}`);
console.log(`   qua 127.0.0.1:15380 : ${viaFwd}`);
ok(viaFwd === '203.0.113.10', 'forward thoát bằng IP VPN', viaFwd || '(rỗng)');
ok(viaFwd !== real, 'khác IP thật');

console.log('\n--- 5. Sửa forward -> container dựng lại với cổng mới ---');
const upd = await msg('update-forward', {
  id: fwd.id,
  forward: { label: 'echo', localPort: 15381, remoteHost: 'ifconfig.me', remotePort: 80 },
});
ok(upd.ok, 'cập nhật được', upd.error);
await sleep(2500);
ok(ports().includes('15381') && !ports().includes('15380'),
   'cổng đã đổi 15380 -> 15381', ports().trim());

console.log('\n--- 6. Xoá ---');
ok((await msg('delete-forward', { id: fwd.id })).ok, 'xoá được');
st = await msg('get-state');
ok(st.state.forwards.length === 0, 'danh sách rỗng');
await sleep(2500);
ok(execSync(`docker ps -q --filter name=^vpnmgr-`).toString().trim() === '',
   'tunnel dừng vì không còn ai dùng');

page.close();
done();
