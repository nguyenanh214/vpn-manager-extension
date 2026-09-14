// Tiện ích dùng chung cho các bộ test: đếm pass/fail và nói chuyện với extension.

import { openPage, sleep } from './cdp.js';

// Chrome sinh ID của extension unpacked từ đường dẫn thư mục, nên nó cố định.
export const EXT_ID = 'fkmekgedgclilahepbobamfabndfnjfh';
export const POPUP_URL = `chrome-extension://${EXT_ID}/popup/popup.html`;

export function counter() {
  const state = { pass: 0, fail: 0 };
  const ok = (cond, msg, extra = '') => {
    if (cond) { state.pass++; console.log('  PASS ' + msg); }
    else { state.fail++; console.log('  FAIL ' + msg + (extra ? '  <- ' + extra : '')); }
  };
  const done = () => {
    console.log(`\n=== ${state.pass} PASS / ${state.fail} FAIL ===`);
    process.exit(state.fail ? 1 : 0);
  };
  return { ok, done, state };
}

/** Mở popup, chờ tới khi các API của extension sẵn sàng. */
export async function openPopup({ retries = 15 } = {}) {
  let page;
  for (let i = 0; i < retries; i++) {
    page = await openPage(POPUP_URL);
    await sleep(1000);
    if (await page.eval(`typeof chrome !== 'undefined' && !!chrome.storage`)) return page;
    page.close();
  }
  throw new Error('Extension không sẵn sàng sau nhiều lần thử');
}

/** Gửi message tới service worker, trả object đã parse. */
export function messenger(page) {
  return (action, payload = {}) => page.eval(
    `new Promise(r => chrome.runtime.sendMessage(` +
    `{action:${JSON.stringify(action)},payload:${JSON.stringify(payload)}},` +
    `x => r(JSON.stringify(x))))`
  ).then(JSON.parse);
}

/** Xoá sạch storage và proxy để mỗi bộ test chạy từ trạng thái trắng. */
export async function resetState(page) {
  await page.eval(
    `chrome.storage.local.clear()` +
    `.then(() => chrome.proxy.settings.clear({scope:'regular'}))` +
    `.then(() => 'ok')`
  );
  await sleep(400);
}

export { sleep };
