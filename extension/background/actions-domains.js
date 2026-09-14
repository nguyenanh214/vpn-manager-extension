// Các thao tác trên danh sách domain của tab chính.

import { getState, patchState, makeId } from '../lib/storage.js';
import { validateDomain } from '../lib/domain-validator.js';
import { reconcile } from './reconciler.js';

export const domainActions = {
  async 'add-domain'(payload) {
    const state = await getState();
    const check = validateDomain(payload.domain, state.domains.map((d) => d.domain));
    if (!check.ok) return { ok: false, error: check.error };

    const domains = [...state.domains, {
      id: makeId('dom'),
      domain: check.domain,
      vpnId: payload.vpnId || null,
      enabled: false,
    }];
    await patchState({ domains });
    return { ok: true, domain: check.domain };
  },

  async 'delete-domain'(payload) {
    const state = await getState();
    await patchState({ domains: state.domains.filter((d) => d.id !== payload.id) });
    return reconcile();
  },

  async 'set-domain-vpn'(payload) {
    const state = await getState();
    await patchState({
      domains: state.domains.map((d) =>
        d.id === payload.id ? { ...d, vpnId: payload.vpnId || null } : d),
    });
    return reconcile();
  },

  async 'toggle-domain'(payload) {
    const state = await getState();
    const target = state.domains.find((d) => d.id === payload.id);
    if (!target) return { ok: false, error: 'Domain không tồn tại' };

    // Yêu cầu rõ ràng: bật mà chưa chọn VPN thì báo lỗi, không bật.
    if (payload.enabled && !target.vpnId) {
      return { ok: false, error: 'Chọn VPN trước', needsVpn: true };
    }

    await patchState({
      domains: state.domains.map((d) =>
        d.id === payload.id ? { ...d, enabled: Boolean(payload.enabled) } : d),
    });
    return { ok: true, ...(await reconcile()) };
  },
};
