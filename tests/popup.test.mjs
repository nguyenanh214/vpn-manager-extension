// Popup render, native host, import NetworkManager, validate domain, áp PAC.
import { counter, openPopup, messenger, resetState, sleep } from './lib/harness.js';

const { ok, done } = counter();
const page = await openPopup();
await resetState(page);
await page.eval(`location.reload()`).catch(() => {});
await sleep(1600);
const msg = messenger(page);

console.log('--- 1. Popup render + native host ---');
ok(await page.eval(`document.querySelectorAll('.tab').length`) === 3, '3 tab hiển thị');
ok(await page.eval(`document.querySelector('.tab.active').dataset.tab`) === 'domains',
   'mặc định mở tab Domains');

const prereq = await msg('check-prereqs');
console.log('  check-prereqs ->', JSON.stringify(prereq));
ok(prereq.ok === true, 'native host trả lời được', prereq.error);
ok(prereq.image === true, 'docker image tồn tại');

console.log('\n--- 2. Import VPN từ NetworkManager ---');
const nm = await msg('import-nm');
ok(nm.ok, 'gọi được import-nm', nm.error);
const anhnt = nm.profiles?.find((p) => p.id === 'anhnt');
ok(!!anhnt && !anhnt.broken, 'profile cert hợp lệ import được');
ok(!!nm.profiles?.find((p) => p.broken), 'profile thiếu cert bị đánh dấu broken');

const added = await msg('add-vpn', { profile: anhnt });
ok(added.ok, 'thêm VPN vào storage', added.error);
ok(added.profile?.socksPort === 1080, 'cấp cổng SOCKS 1080');

console.log('\n--- 3. Thêm domain + validate ---');
const addDomain = (d) => msg('add-domain', { domain: d });
ok((await addDomain('https://EXAMPLE.com/path?x=1')).domain === 'example.com',
   'URL đầy đủ được chuẩn hoá về example.com');
ok((await addDomain('không hợp lệ')).ok === false, 'domain rác bị từ chối');
ok((await addDomain('example.com')).ok === false, 'domain trùng bị từ chối');

console.log('\n--- 4. Bật domain khi CHƯA chọn VPN ---');
const st = await msg('get-state');
const domId = st.state.domains[0].id;
const noVpn = await msg('toggle-domain', { id: domId, enabled: true });
ok(noVpn.ok === false && noVpn.needsVpn === true, 'bị chặn với cờ needsVpn');
ok(noVpn.error === 'Chọn VPN trước', 'báo đúng thông điệp "Chọn VPN trước"', noVpn.error);

console.log('\n--- 5. Gán VPN rồi bật -> dựng tunnel + áp PAC ---');
await msg('set-domain-vpn', { id: domId, vpnId: added.profile.id });
const t0 = Date.now();
const on = await msg('toggle-domain', { id: domId, enabled: true });
console.log(`  toggle mất ${Date.now() - t0}ms`);
ok(on.ok === true, 'bật thành công', on.error);
ok(on.tunnels?.[added.profile.id]?.status === 'on', 'tunnel ở trạng thái on');

const pac = await msg('preview-pac');
ok(pac.pac?.includes('SOCKS5 127.0.0.1:1080'), 'PAC chứa SOCKS5 127.0.0.1:1080');

const cfg = JSON.parse(await page.eval(
  `new Promise(r => chrome.proxy.settings.get({}, c =>` +
  ` r(JSON.stringify({mode: c.value.mode, level: c.levelOfControl}))))`));
console.log('  chrome.proxy ->', JSON.stringify(cfg));
ok(cfg.mode === 'pac_script', 'Chrome đang dùng pac_script');
ok(cfg.level === 'controlled_by_this_extension', 'extension đang nắm quyền proxy');

page.close();
done();
