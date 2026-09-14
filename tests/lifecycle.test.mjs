// Giữ trạng thái popup giữa các lần mở, layout danh sách dài, tunnel tự tắt khi đóng Chrome.
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { counter, openPopup, messenger, sleep } from './lib/harness.js';

const { ok, done } = counter();
const runDir = process.env.VPNMGR_TEST_DIR || new URL('.run', import.meta.url).pathname;
const ps = () => execSync(`docker ps --filter 'name=^vpnmgr-' --format '{{.Names}}'`)
  .toString().trim();

let page = await openPopup();
let msg = messenger(page);

console.log('--- 1. Giữ trạng thái popup giữa các lần mở ---');
await msg('set-ui', { ui: { activeTab: 'vpns', addDomainOpen: true, addDomainDraft: 'dang-go-do.com' } });
page.close();
await sleep(500);

page = await openPopup();
msg = messenger(page);
ok(await page.eval(`document.querySelector('.tab.active').dataset.tab`) === 'vpns',
   'mở lại đúng tab VPN');
ok(await page.eval(`document.getElementById('input-domain').value`) === 'dang-go-do.com',
   'giữ nguyên nội dung đang gõ dở');
ok(await page.eval(`document.getElementById('form-add-domain').hidden === false`),
   'form thêm domain vẫn đang mở');
await msg('set-ui', { ui: { activeTab: 'domains', addDomainOpen: false, addDomainDraft: '' } });

console.log('\n--- 2. Danh sách dài thì cuộn, không vỡ layout ---');
const nm = await msg('import-nm');
if (!(await msg('get-state')).state.vpnProfiles.length) {
  await msg('add-vpn', { profile: nm.profiles.find((x) => x.id === 'anhnt') });
}
await msg('add-domain', { domain: 'api.ipify.org' });
for (let i = 0; i < 12; i++) await msg('add-domain', { domain: `test-${i}.example.com` });

await page.eval(`location.reload()`);
await sleep(1800);
const box = JSON.parse(await page.eval(`(() => {
  const l = document.getElementById('domain-list');
  const rows = [...l.querySelectorAll('.row')];
  return JSON.stringify({
    rows: rows.length,
    scrollable: l.scrollHeight > l.clientHeight,
    listOverflowX: l.scrollWidth - l.clientWidth,
    widestRow: Math.max(0, ...rows.map(r => r.scrollWidth - r.clientWidth)),
    appW: document.querySelector('.app').getBoundingClientRect().width,
  });
})()`));
console.log('  ', JSON.stringify(box));
ok(box.rows === 13, '13 dòng được render', String(box.rows));
ok(box.scrollable === true, 'danh sách cuộn được');
ok(box.listOverflowX <= 0 && box.widestRow <= 0, 'không tràn ngang trong danh sách',
   `list=${box.listOverflowX} row=${box.widestRow}`);
ok(box.appW <= 380, 'khung app rộng đúng 380px', String(box.appW));

console.log('\n--- 3. Tunnel tự tắt khi đóng Chrome ---');
const st = await msg('get-state');
const dom = st.state.domains.find((d) => d.domain === 'api.ipify.org');
await msg('set-domain-vpn', { id: dom.id, vpnId: st.state.vpnProfiles[0].id });
await msg('toggle-domain', { id: dom.id, enabled: true });
await sleep(1000);
ok(ps().includes('vpnmgr-'), 'tunnel đang chạy trước khi đóng Chrome', ps() || '(không có)');
console.log('   containers:', ps());

process.kill(Number(readFileSync(`${runDir}/chrome.pid`, 'utf8').trim()), 'SIGTERM');
console.log('   đã đóng Chrome, chờ grace period 15s...');
await sleep(19000);
console.log('   containers sau đó:', JSON.stringify(ps()));
ok(ps() === '', 'tunnel đã được dọn sạch', ps());

done();
