// Router giữa popup và các module nghiệp vụ, cộng với vòng đời extension.

import * as bridge from './native-bridge.js';
import * as proxy from './proxy-controller.js';
import { buildPac } from './pac-builder.js';
import { reconcile, serializeTunnels, markUnhealthy } from './reconciler.js';
import { domainActions } from './actions-domains.js';
import { vpnActions } from './actions-vpns.js';
import { forwardActions } from './actions-forwards.js';
import { getState, patchUi } from '../lib/storage.js';
import { DEFAULT_STATE } from '../lib/constants.js';

const ACTIONS = {
  ...domainActions,
  ...vpnActions,
  ...forwardActions,

  async 'get-state'() {
    return {
      state: await getState(),
      tunnels: serializeTunnels(),
      control: await proxy.checkControl(),
    };
  },

  async 'set-ui'(payload) {
    return { ui: await patchUi(payload.ui || {}) };
  },

  async 'check-paths'(payload) {
    return bridge.send('check-paths', { paths: payload.paths || {} });
  },

  async 'check-prereqs'() {
    return bridge.send('check-prereqs');
  },

  // Container chạy không đồng nghĩa tunnel còn sống. Popup gọi cái này để
  // không hiển thị chấm xanh cho một tunnel đã im lặng.
  async 'tunnel-health'() {
    const state = await getState();
    const running = Object.entries(serializeTunnels())
      .filter(([, t]) => t.status === 'on')
      .map(([id]) => id);
    if (running.length === 0) return { health: {} };

    const { health } = await bridge.send('tunnel-health', { profileIds: running });
    const broken = [];
    for (const [id, h] of Object.entries(health || {})) {
      if (!h.healthy) { markUnhealthy(id, h.reason); broken.push(id); }
    }

    // Tunnel chết thường không tự hồi (OpenVPN có thể kẹt ở TUN fd hỏng).
    // Dựng lại là cách chắc chắn. Chỉ chạy khi user mở popup nên không thành vòng lặp.
    if (broken.length) {
      for (const id of broken) {
        await bridge.send('stop-tunnel', { profileId: id }).catch(() => {});
      }
      const repaired = await reconcile();
      return { health, repaired: broken, tunnels: repaired.tunnels };
    }
    return { health, tunnels: serializeTunnels(), profiles: state.vpnProfiles.length };
  },

  async 'tunnel-logs'(payload) {
    return bridge.send('tunnel-logs', { profileId: payload.id, tail: 60 });
  },

  async 'preview-pac'() {
    return { pac: buildPac(await getState()) };
  },

  async reconcile() {
    return reconcile();
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = ACTIONS[msg.action];
  if (!handler) {
    sendResponse({ ok: false, error: `Action không tồn tại: ${msg.action}` });
    return false;
  }
  handler(msg.payload || {})
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // giữ kênh mở cho phản hồi bất đồng bộ
});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get('schemaVersion');
  if (!stored.schemaVersion) await chrome.storage.local.set(DEFAULT_STATE);
  await proxy.clearProxy();
});

// Chrome khởi động lại vẫn giữ PAC cũ trỏ tới cổng SOCKS đã chết.
// Phải xoá trước, dựng lại tunnel, rồi mới áp PAC mới.
chrome.runtime.onStartup.addListener(async () => {
  await proxy.clearProxy();
  await reconcile().catch(() => {});
});
