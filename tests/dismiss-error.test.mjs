// Nút × tắt khối lỗi tunnel.
//
// Vì sao cần: lỗi tunnel giờ kèm log OpenVPN, dài vài chục dòng, đủ đẩy cả danh sách
// ra khỏi tầm nhìn của popup cao 560px.
//
// Chạy thẳng `dismissibleError` trong trang thật qua CDP: DOM thật, chrome.runtime
// thật, storage thật. Không dựng được tunnel hỏng theo ý muốn nên gọi trực tiếp hàm
// render thay vì đợi một tunnel chết.

import { counter, openPopup, messenger, resetState, sleep } from './lib/harness.js';

const { ok, done } = counter();
const page = await openPopup();
await resetState(page);
await page.eval(`location.reload()`).catch(() => {});
await sleep(1600);
const msg = messenger(page);

// Log OpenVPN thật: nguyên nhân ở dòng đầu, timestamp đổi sau mỗi lần poll.
const longError = (stamp) =>
  'Certificate của VPN này đã hết hạn ngày 20/09/2026 11:54.\n'
  + `2026-09-21 ${stamp} WARNING: Your certificate has expired!\n`
  + Array.from({ length: 28 }, (_, i) => `2026-09-21 ${stamp} dòng log số ${i}`).join('\n');

// Nạp module một lần, giữ trong window để các bước sau dùng lại.
await page.eval(`(async () => {
  window.__H = await import('./ui-helpers.js');
  window.__box = document.createElement('div');
  document.body.append(window.__box);
})()`);

const build = (key, message, ui) => page.eval(`(() => {
  window.__box.innerHTML = '';
  const node = window.__H.dismissibleError(${JSON.stringify(key)},
    ${JSON.stringify(message)}, ${JSON.stringify(ui)});
  if (node) window.__box.append(node);
  return JSON.stringify({ rendered: !!node });
})()`).then(JSON.parse);

console.log('--- 1. Không có gì để hiện thì không hiện ---');
ok((await build('vpn1', '', {})).rendered === false, 'lỗi rỗng -> không render');
ok((await build('vpn1', null, {})).rendered === false, 'lỗi null -> không render');
ok((await build('', longError('03:00'), {})).rendered === false, 'thiếu key -> không render');

console.log('\n--- 2. Có lỗi thì hiện, kèm nút × góc trên phải ---');
ok((await build('vpn1', longError('03:00'), {})).rendered === true, 'render được khối lỗi');
const btn = await page.eval(`(() => {
  const x = window.__box.querySelector('.err-x');
  const box = window.__box.querySelector('.err-box');
  if (!x || !box) return JSON.stringify({ missing: true });
  const bx = box.getBoundingClientRect(), xr = x.getBoundingClientRect();
  const cs = getComputedStyle(x);
  return JSON.stringify({
    text: x.textContent,
    title: x.getAttribute('title'),
    position: cs.position,
    // Góc TRÊN BÊN PHẢI: mép phải nút sát mép phải khối, mép trên sát mép trên
    towardsRight: xr.right >= bx.right - 6,
    towardsTop: xr.top <= bx.top + 6,
    overlapsText: xr.left < bx.right - 30,
  });
})()`).then(JSON.parse);
ok(btn.text === '×', 'nút mang ký tự ×', btn.text);
ok(btn.title === 'Ẩn lỗi này', 'có tooltip giải thích');
ok(btn.position === 'absolute', 'neo bằng position absolute', btn.position);
ok(btn.towardsRight === true, 'nằm sát mép PHẢI của khối lỗi');
ok(btn.towardsTop === true, 'nằm sát mép TRÊN của khối lỗi');
ok(btn.overlapsText === false, 'không đè lên chữ — khối đã chừa lề phải');

console.log('\n--- 3. Bấm × thì khối biến mất ngay ---');
const afterClick = await page.eval(`(() => {
  window.__box.querySelector('.err-x').click();
  return JSON.stringify({ left: window.__box.querySelectorAll('.err-box').length });
})()`).then(JSON.parse);
ok(afterClick.left === 0, 'khối lỗi bị gỡ khỏi DOM ngay khi bấm');

console.log('\n--- 4. Lựa chọn tắt được ghi nhớ ---');
await sleep(400);
const st = await msg('get-state');
const saved = st.state?.ui?.dismissedErrors || {};
ok(saved.vpn1 === 'Certificate của VPN này đã hết hạn ngày 20/09/2026 11:54.',
   'lưu đúng DÒNG ĐẦU, không lưu cả khối log', JSON.stringify(saved).slice(0, 80));
ok(!JSON.stringify(saved).includes('dòng log số'),
   'không nhét 30 dòng log vào storage');

console.log('\n--- 5. Đã tắt thì im, kể cả khi log đổi timestamp ---');
ok((await build('vpn1', longError('03:00'), st.state.ui)).rendered === false,
   'cùng lỗi -> không hiện lại');
// Đây mới là điểm mấu chốt: OpenVPN in timestamp mới sau mỗi lần poll. Nếu code so
// cả khối thì nút × chỉ dính đúng một nhịp render rồi lỗi nhảy ra lại.
ok((await build('vpn1', longError('09:47'), st.state.ui)).rendered === false,
   'log đổi timestamp nhưng cùng nguyên nhân -> VẪN không hiện lại');

console.log('\n--- 6. Lỗi khác thì phải hiện, đừng nuốt thông tin mới ---');
ok((await build('vpn1', 'Server từ chối xác thực.\nAUTH_FAILED', st.state.ui)).rendered === true,
   'nguyên nhân khác -> hiện lại');
ok((await build('vpn2', longError('03:00'), st.state.ui)).rendered === true,
   'VPN khác -> không ăn theo lựa chọn của vpn1');

console.log('\n--- 7. Map dismiss không phình vô hạn ---');
const capped = await page.eval(`(async () => {
  let ui = { dismissedErrors: {} };
  for (let i = 0; i < 30; i++) {
    window.__box.innerHTML = '';
    const n = window.__H.dismissibleError('k' + i, 'nguyên nhân ' + i, ui);
    window.__box.append(n);
    n.querySelector('.err-x').click();
    await new Promise(r => setTimeout(r, 30));
    const s = await new Promise(r => chrome.runtime.sendMessage({ action: 'get-state', payload: {} }, r));
    ui = s.state.ui;
  }
  return JSON.stringify({ size: Object.keys(ui.dismissedErrors).length, keys: Object.keys(ui.dismissedErrors) });
})()`).then(JSON.parse);
ok(capped.size <= 20, 'giữ tối đa 20 mục', String(capped.size));
ok(capped.keys.includes('k29'), 'mục mới nhất được giữ lại');
ok(!capped.keys.includes('k0'), 'mục cũ nhất bị đẩy ra');

page.close();
done();
