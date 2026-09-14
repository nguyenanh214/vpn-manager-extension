// Các thao tác trên danh sách port-forward của tab Forward.
// Forward cho phép client không nói được SOCKS5 (Navicat, DBeaver...) đi qua tunnel:
// chúng kết nối tới 127.0.0.1:<cổng cục bộ> như thể server nằm ngay trên máy.

import { getState, patchState, makeId } from '../lib/storage.js';

// Chỉ 4 field này được sửa qua update-forward. vpnId và enabled có action riêng —
// nếu cho payload ghi đè chúng, một object cũ từ UI sẽ âm thầm gỡ VPN khỏi forward
// và khiến tunnel bị dừng.
const EDITABLE = ['label', 'localPort', 'remoteHost', 'remotePort'];

function pickEditable(source = {}) {
  const out = {};
  for (const key of EDITABLE) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}
import { validateForward } from '../lib/forward-validator.js';
import { reconcile } from './reconciler.js';

export const forwardActions = {
  async 'add-forward'(payload) {
    const state = await getState();
    const check = validateForward(payload.forward || {}, state.forwards);
    if (!check.ok) return { ok: false, error: check.error, field: check.field };

    const forwards = [...state.forwards, { id: makeId('fwd'), ...check.forward, enabled: false }];
    await patchState({ forwards });
    return { ok: true };
  },

  async 'update-forward'(payload) {
    const state = await getState();
    const target = state.forwards.find((f) => f.id === payload.id);
    if (!target) return { ok: false, error: 'Forward không tồn tại' };

    const check = validateForward(
      { ...target, ...pickEditable(payload.forward) }, state.forwards, payload.id);
    if (!check.ok) return { ok: false, error: check.error, field: check.field };

    // check.forward có cả vpnId (lấy từ target), nhưng ghi lại vpnId/enabled từ f
    // cho chắc chắn — chúng chỉ được đổi qua set-forward-vpn / toggle-forward.
    const forwards = state.forwards.map((f) =>
      f.id === payload.id ? { ...f, ...check.forward, vpnId: f.vpnId, enabled: f.enabled } : f);
    await patchState({ forwards });

    // Cổng publish của Docker chỉ đặt được lúc tạo container -> sửa forward đang
    // bật buộc phải dựng lại tunnel. reconcile lo việc đó qua signature.
    return { ok: true, ...(target.enabled ? await reconcile() : {}) };
  },

  async 'delete-forward'(payload) {
    const state = await getState();
    const target = state.forwards.find((f) => f.id === payload.id);
    await patchState({ forwards: state.forwards.filter((f) => f.id !== payload.id) });
    return { ok: true, ...(target?.enabled ? await reconcile() : {}) };
  },

  async 'toggle-forward'(payload) {
    const state = await getState();
    const target = state.forwards.find((f) => f.id === payload.id);
    if (!target) return { ok: false, error: 'Forward không tồn tại' };

    // Cùng quy tắc với domain: chưa chọn VPN thì không bật được.
    if (payload.enabled && !target.vpnId) {
      return { ok: false, error: 'Chọn VPN trước', needsVpn: true };
    }

    await patchState({
      forwards: state.forwards.map((f) =>
        f.id === payload.id ? { ...f, enabled: Boolean(payload.enabled) } : f),
    });
    return { ok: true, ...(await reconcile()) };
  },

  async 'set-forward-vpn'(payload) {
    const state = await getState();
    const target = state.forwards.find((f) => f.id === payload.id);
    await patchState({
      forwards: state.forwards.map((f) =>
        f.id === payload.id ? { ...f, vpnId: payload.vpnId || null } : f),
    });
    return { ok: true, ...(target?.enabled ? await reconcile() : {}) };
  },
};
