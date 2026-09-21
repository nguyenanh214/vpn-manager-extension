// Trang import chạy trong TAB.
//
// Vì sao tách khỏi popup: mở hộp thoại chọn file từ popup của extension làm popup
// mất focus, Chrome huỷ popup ngay, và sự kiện `change` không bao giờ chạy — người
// dùng chọn file xong thì không có gì xảy ra. Bộ `ovpn` không bắt được vì nó gọi
// thẳng action `import-ovpn`, bỏ qua lớp giao diện.
//
// Bộ này nạp file vào <input type="file"> bằng DataTransfer rồi submit form thật,
// nên phủ đúng đoạn từ chọn file tới kết quả hiện ra.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { openPage } from './lib/cdp.js';
import { counter, openPopup, messenger, resetState, EXT_ID, sleep } from './lib/harness.js';

const { ok, done } = counter();
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const fixture = (n) => readFileSync(join(FIXTURES, `${n}.ovpn`), 'utf8');

// Dọn state qua popup trước, rồi mới làm việc với trang import.
const popup = await openPopup();
await resetState(popup);
const msg = messenger(popup);

console.log('--- 1. Nút trong popup trỏ tới trang import ---');
const wiring = await popup.eval(`(() => {
  const btn = document.getElementById('btn-import-ovpn');
  return JSON.stringify({
    hasButton: !!btn,
    // Input file trong popup phải bị gỡ: để lại là còn đường chết cũ
    stillHasFileInput: !!document.getElementById('file-ovpn'),
    importUrl: chrome.runtime.getURL('import/import.html'),
  });
})()`).then(JSON.parse);
ok(wiring.hasButton, 'popup còn nút Import');
ok(wiring.stillHasFileInput === false, 'input file đã gỡ khỏi popup — không còn đường chết');
popup.close();

console.log('\n--- 2. Trang import mở được trong tab ---');
const page = await openPage(`chrome-extension://${EXT_ID}/import/import.html`);
await sleep(1200);
const dom = await page.eval(`JSON.stringify({
  file: !!document.getElementById('file'),
  name: !!document.getElementById('name'),
  submit: !!document.getElementById('submit'),
  css: getComputedStyle(document.body).backgroundColor,
})`).then(JSON.parse);
ok(dom.file && dom.name && dom.submit, 'có đủ input file, ô tên và nút Import');
ok(dom.css !== 'rgba(0, 0, 0, 0)', 'popup.css nạp được từ trang import', dom.css);

console.log('\n--- 3. Chọn file rồi submit: file hợp lệ ---');
// Nạp file vào input y như người dùng chọn, rồi submit form thật.
const loadAndSubmit = (name, content) => page.eval(`(async () => {
  const dt = new DataTransfer();
  dt.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)},
    { type: 'text/plain' }));
  const input = document.getElementById('file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('form').requestSubmit();

  const box = document.getElementById('result');
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (!box.hidden && box.textContent.trim()) break;
  }
  return JSON.stringify({
    suggestedName: document.getElementById('name').value,
    text: box.textContent.replace(/\\s+/g, ' ').trim(),
  });
})()`).then(JSON.parse);

const good = await loadAndSubmit('VPN nhà.ovpn', fixture('sample-inline'));
ok(good.text.includes('Đã import'), 'báo import thành công', good.text.slice(0, 90));

const st = await (async () => {
  const p2 = await openPopup();
  const m = messenger(p2);
  const s = await m('get-state');
  p2.close();
  return s;
})();
ok(st.state.vpnProfiles.length === 1, 'profile thật sự vào storage', String(st.state.vpnProfiles.length));
ok(st.state.vpnProfiles[0]?.mode === 'ovpn', 'profile ở chế độ ovpn');

console.log('\n--- 4. File chưa hỗ trợ: nêu lý do, không tạo profile ---');
const bad = await loadAndSubmit('ngoai.ovpn', fixture('external-refs'));
ok(bad.text.includes('chưa dùng được'), 'báo file chưa dùng được', bad.text.slice(0, 70));
ok(bad.text.includes('file bên ngoài'), 'liệt kê đúng lý do cụ thể');

const st2 = await (async () => {
  const p3 = await openPopup();
  const m = messenger(p3);
  const s = await m('get-state');
  p3.close();
  return s;
})();
ok(st2.state.vpnProfiles.length === 1, 'file bị từ chối KHÔNG tạo thêm profile',
   String(st2.state.vpnProfiles.length));

page.close();
done();
