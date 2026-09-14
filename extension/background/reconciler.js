// Giữ trạng thái tunnel trong RAM và đồng bộ tunnel thật về đúng tập domain đang bật.
// Trạng thái không persist: service worker chết là mất, đúng với thực tế
// vì native host cũng dọn tunnel khi Chrome đóng.

import * as bridge from './native-bridge.js';
import * as proxy from './proxy-controller.js';
import { getState, requiredProfiles } from '../lib/storage.js';
import { TUNNEL_STATE } from '../lib/constants.js';

const tunnelState = new Map();

export const setTunnel = (id, status, error = null) => tunnelState.set(id, { status, error });
export const getTunnel = (id) => tunnelState.get(id) || { status: TUNNEL_STATE.OFF, error: null };
export const dropTunnel = (id) => tunnelState.delete(id);

/** Hạ trạng thái một tunnel đang "on" xuống lỗi khi health check thất bại. */
export const markUnhealthy = (id, reason) =>
  setTunnel(id, TUNNEL_STATE.ERROR, reason || 'Tunnel không truyền được gói tin');
export const serializeTunnels = () => Object.fromEntries(tunnelState);

/**
 * Thứ tự BẮT BUỘC: tunnel ready TRƯỚC, apply PAC SAU.
 * Ngược lại Chrome sẽ trỏ request vào cổng SOCKS chưa ai nghe.
 */
export async function reconcile() {
  const state = await getState();
  const needed = requiredProfiles(state);

  for (const p of needed) {
    if (getTunnel(p.id).status !== TUNNEL_STATE.ON) setTunnel(p.id, TUNNEL_STATE.CONNECTING);
  }

  let result;
  try {
    result = await bridge.send('sync-tunnels', { profiles: needed });
  } catch (err) {
    for (const p of needed) setTunnel(p.id, TUNNEL_STATE.ERROR, err.message);
    await proxy.clearProxy();
    return { ok: false, error: err.message, tunnels: serializeTunnels() };
  }

  for (const id of result.stopped || []) dropTunnel(id);
  for (const p of needed) setTunnel(p.id, TUNNEL_STATE.ON);
  for (const f of result.failed || []) setTunnel(f.id, TUNNEL_STATE.ERROR, f.error);

  // FAIL-CLOSED: tunnel hỏng thì domain vẫn phải nằm trong PAC, trỏ vào cổng đã chết.
  // Request sẽ fail bằng ERR_PROXY_CONNECTION_FAILED — đúng như mong muốn.
  // Nếu loại domain khỏi PAC, nó sẽ âm thầm đi ra mạng thường, tức là LỘ traffic.
  const failedIds = new Set((result.failed || []).map((f) => f.id));
  await proxy.applyPac(state);

  return { ok: failedIds.size === 0, failed: result.failed || [], tunnels: serializeTunnels() };
}
