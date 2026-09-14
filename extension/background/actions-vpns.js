// Các thao tác trên danh sách VPN profile của tab phụ.

import * as bridge from './native-bridge.js';
import { getState, patchState, allocateSocksPort, makeId } from '../lib/storage.js';
import { TUNNEL_STATE } from '../lib/constants.js';
import { reconcile, setTunnel, dropTunnel } from './reconciler.js';

const CERT_FIELDS = ['ca', 'cert', 'key', 'tlsCrypt'];

export const vpnActions = {
  async 'import-nm'() {
    return bridge.send('list-nm-profiles');
  },

  async 'add-vpn'(payload) {
    const state = await getState();
    const incoming = payload.profile || {};

    if (!incoming.name) return { ok: false, error: 'Nhập tên VPN' };
    if (!incoming.gateway) return { ok: false, error: 'Nhập gateway' };
    if (!incoming.ca) return { ok: false, error: 'Nhập đường dẫn CA certificate' };
    if (state.vpnProfiles.some((p) => p.name === incoming.name)) {
      return { ok: false, error: 'Tên VPN này đã tồn tại' };
    }

    // Native host xác nhận file có thật ngay lúc thêm, thay vì để lỗi lộ ra lúc bật domain.
    const paths = Object.fromEntries(CERT_FIELDS.map((f) => [f, incoming[f]]));
    const { results } = await bridge.send('check-paths', { paths });
    const bad = Object.entries(results).filter(([, r]) => !r.ok);
    if (bad.length) return { ok: false, error: bad.map(([f, r]) => `${f}: ${r.error}`).join('; ') };

    const profile = {
      ...incoming,
      id: makeId('vpn'),
      socksPort: allocateSocksPort(state.vpnProfiles),
      source: incoming.source || 'manual',
    };
    delete profile.broken;
    delete profile.unsupported;

    await patchState({ vpnProfiles: [...state.vpnProfiles, profile] });
    return { ok: true, profile };
  },

  async 'delete-vpn'(payload) {
    const state = await getState();
    const inUse = [
      ...state.domains.filter((d) => d.vpnId === payload.id).map((d) => d.domain),
      ...(state.forwards || []).filter((f) => f.vpnId === payload.id).map((f) => `:${f.localPort} (${f.label})`),
    ];
    if (inUse.length && !payload.force) {
      return { ok: false, error: 'Đang được dùng', domains: inUse };
    }

    await bridge.send('stop-tunnel', { profileId: payload.id }).catch(() => {});
    dropTunnel(payload.id);
    await patchState({
      vpnProfiles: state.vpnProfiles.filter((p) => p.id !== payload.id),
      domains: state.domains.map((d) =>
        d.vpnId === payload.id ? { ...d, vpnId: null, enabled: false } : d),
      forwards: (state.forwards || []).map((f) =>
        f.vpnId === payload.id ? { ...f, vpnId: null, enabled: false } : f),
    });
    return { ok: true, ...(await reconcile()) };
  },

  async 'test-vpn'(payload) {
    const state = await getState();
    const profile = state.vpnProfiles.find((p) => p.id === payload.id);
    if (!profile) return { ok: false, error: 'VPN không tồn tại' };

    setTunnel(profile.id, TUNNEL_STATE.CONNECTING);
    try {
      const result = await bridge.send('test-connection', { profile });
      setTunnel(profile.id, result.wasAlreadyRunning ? TUNNEL_STATE.ON : TUNNEL_STATE.OFF);
      return result;
    } catch (err) {
      setTunnel(profile.id, TUNNEL_STATE.ERROR, err.message);
      return { ok: false, error: err.message };
    }
  },
};
