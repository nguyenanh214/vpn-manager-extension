// Lớp truy cập chrome.storage.local. Đây là nơi DUY NHẤT đụng vào storage.
// LƯU Ý BẢO MẬT: storage.local là plaintext trên đĩa. Chỉ lưu ĐƯỜNG DẪN cert,
// tuyệt đối không lưu nội dung private key.

import { DEFAULT_STATE, SCHEMA_VERSION, SOCKS_PORT_BASE, SOCKS_PORT_MAX } from './constants.js';

export async function getState() {
  const stored = await chrome.storage.local.get(null);
  if (!stored || !stored.schemaVersion) {
    await chrome.storage.local.set(DEFAULT_STATE);
    return structuredClone(DEFAULT_STATE);
  }
  return {
    ...structuredClone(DEFAULT_STATE),
    ...stored,
    ui: { ...DEFAULT_STATE.ui, ...(stored.ui || {}) },
  };
}

export async function patchState(patch) {
  await chrome.storage.local.set(patch);
  return getState();
}

export async function patchUi(uiPatch) {
  const state = await getState();
  const ui = { ...state.ui, ...uiPatch };
  await chrome.storage.local.set({ ui });
  return ui;
}

/** Cấp cổng SOCKS5 chưa ai dùng trong dải cho phép. */
export function allocateSocksPort(profiles) {
  const used = new Set(profiles.map((p) => Number(p.socksPort)));
  for (let port = SOCKS_PORT_BASE; port <= SOCKS_PORT_MAX; port++) {
    if (!used.has(port)) return port;
  }
  throw new Error(`Hết cổng trống trong dải ${SOCKS_PORT_BASE}-${SOCKS_PORT_MAX}`);
}

export function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Domain đang thực sự cần tunnel: đã bật VÀ đã gán VPN còn tồn tại. */
export function activeDomains(state) {
  const byId = new Map(state.vpnProfiles.map((p) => [p.id, p]));
  return state.domains.filter((d) => d.enabled && d.vpnId && byId.has(d.vpnId));
}

/** Forward đang thực sự cần tunnel: đã bật VÀ đã gán VPN còn tồn tại. */
export function activeForwards(state) {
  const byId = new Map(state.vpnProfiles.map((p) => [p.id, p]));
  return (state.forwards || []).filter((f) => f.enabled && f.vpnId && byId.has(f.vpnId));
}

/**
 * Tập VPN profile cần chạy tunnel, suy ra từ domain VÀ forward đang bật.
 * Mỗi profile được đính kèm danh sách forward của nó — native host dùng nó để
 * publish cổng và sinh signature; đổi forward sẽ khiến container được dựng lại.
 */
export function requiredProfiles(state) {
  const byId = new Map(state.vpnProfiles.map((p) => [p.id, p]));
  const forwards = activeForwards(state);
  const ids = new Set([
    ...activeDomains(state).map((d) => d.vpnId),
    ...forwards.map((f) => f.vpnId),
  ]);

  return [...ids]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((profile) => ({
      ...profile,
      forwards: forwards
        .filter((f) => f.vpnId === profile.id)
        .map((f) => ({ localPort: f.localPort, remoteHost: f.remoteHost, remotePort: f.remotePort })),
    }));
}

export { SCHEMA_VERSION };
