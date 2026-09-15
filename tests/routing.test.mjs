// Traffic THẬT của trình duyệt: domain trong list ra IP VPN, ngoài list ra IP thật,
// tunnel chết thì fail chứ không rơi ra mạng thường.
import { execSync } from 'child_process';
import { openPage } from './lib/cdp.js';
import { counter, openPopup, messenger, resetState, sleep } from './lib/harness.js';

const { ok, done } = counter();
const popup = await openPopup();
const msg = messenger(popup);
await resetState(popup);

const nm = await msg('import-nm');
const vpn = (await msg('add-vpn', { profile: nm.profiles.find((p) => p.id === 'anhnt') })).profile;

// CHỈ api.ipify.org đi VPN. icanhazip.com cố tình để ngoài danh sách.
await msg('add-domain', { domain: 'api.ipify.org' });
const st = await msg('get-state');
const dom = st.state.domains.find((d) => d.domain === 'api.ipify.org');
await msg('set-domain-vpn', { id: dom.id, vpnId: vpn.id });

const on = await msg('toggle-domain', { id: dom.id, enabled: true });
ok(on.ok && on.tunnels[vpn.id]?.status === 'on', 'tunnel đã lên', JSON.stringify(on).slice(0, 150));
console.log('  PAC:\n' + (await msg('preview-pac')).pac.split('\n').slice(1, 3)
  .map((l) => '    ' + l.trim()).join('\n'));

// Request đầu qua tunnel vừa dựng có thể chậm; chờ tới khi body có nội dung.
async function visit(url, { retries = 3 } = {}) {
  for (let i = 0; i < retries; i++) {
    const p = await openPage(url);
    let text = '';
    for (let w = 0; w < 12; w++) {
      await sleep(1000);
      text = (await p.eval(`document.body ? document.body.innerText.trim() : ''`)) || '';
      if (text) break;
    }
    p.close();
    if (text) return text.split('\n')[0].slice(0, 60);
  }
  return '';
}

const EXPECT_EXIT_IP = process.env.VPNMGR_TEST_EXIT_IP || '';

console.log('\n--- Traffic thật của trình duyệt ---');
const viaVpn = await visit('https://api.ipify.org');
const direct = await visit('https://icanhazip.com');
console.log(`  api.ipify.org  (trong list) -> ${viaVpn}`);
console.log(`  icanhazip.com  (ngoài list) -> ${direct}`);

// Xem chú thích cùng chủ đề trong forwards.test.mjs: IP lối ra đi qua env.
ok(viaVpn !== '' && viaVpn !== direct, 'domain trong list thoát bằng IP khác', viaVpn);
if (EXPECT_EXIT_IP) {
  ok(viaVpn === EXPECT_EXIT_IP, 'đúng IP VPN mong đợi', `${viaVpn} vs ${EXPECT_EXIT_IP}`);
}
ok(direct !== '' && direct !== viaVpn, 'domain ngoài list đi thẳng, KHÔNG qua VPN', direct);
ok(viaVpn !== direct, 'hai domain thoát bằng hai IP khác nhau');

console.log('\n--- Tunnel chết thì phải fail rõ ràng, không âm thầm đi direct ---');
execSync(`docker rm -f vpnmgr-${vpn.id} 2>/dev/null || true`);
await sleep(1500);
const afterKill = await visit('https://api.ipify.org', { retries: 1 });
console.log(`  sau khi giết tunnel -> ${JSON.stringify(afterKill)}`);
ok(afterKill !== viaVpn && afterKill !== direct,
   'không rơi ra mạng thường (fail thay vì leak)', afterKill);

popup.close();
done();
