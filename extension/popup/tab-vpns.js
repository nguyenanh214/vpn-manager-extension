// Tab phụ: quản lý VPN profile, import từ NetworkManager, test kết nối.

import { call, el, clear, flashError, showModal, closeModal, TUNNEL_LABEL } from './ui-helpers.js';
import { setupOvpnImport } from './ovpn-import.js';

const FORM_FIELDS = ['name', 'gateway', 'ca', 'cert', 'key', 'tlsCrypt', 'cipher', 'auth'];

let refresh = () => {};
export function bindRefresh(fn) { refresh = fn; }

/** Hiện kết quả test: IP thật vs IP qua tunnel. Trùng nhau nghĩa là traffic không qua VPN. */
function showTestResult(profile, res) {
  if (!res.ok) {
    return showModal(`Test ${profile.name} — thất bại`, el('div', {}, [
      el('p', { class: 'error', text: res.error || 'Không rõ lỗi' }),
      res.logs ? el('div', { class: 'mono', text: res.logs }) : null,
    ]));
  }

  const verdict = res.leaked
    ? el('p', { class: 'error', text: '⚠ Traffic KHÔNG đi qua VPN — hai IP giống nhau.' })
    : el('p', { style: 'color:var(--ok);margin:6px 0 0', text: '✓ Traffic đi đúng qua VPN.' });

  showModal(`Test ${profile.name}`, el('div', {}, [
    el('div', { class: 'row-sub', text: `IP thật:      ${res.directIp || res.directError || '?'}` }),
    el('div', { class: 'row-sub', text: `IP qua VPN:   ${res.tunnelIp}` }),
    el('div', { class: 'row-sub', text: `Độ trễ:       ${res.latencyMs} ms` }),
    verdict,
  ]));
}

function vpnRow(profile, tunnels, errorSlot) {
  const tunnel = tunnels[profile.id] || { status: 'off' };

  const testBtn = el('button', {
    class: 'btn btn-sm', text: 'Test',
    onclick: async (e) => {
      e.target.disabled = true;
      e.target.textContent = '…';
      const res = await call('test-vpn', { id: profile.id });
      e.target.disabled = false;
      e.target.textContent = 'Test';
      showTestResult(profile, res);
      refresh();
    },
  });

  return el('div', { class: 'row' + (tunnel.status === 'error' ? ' is-error' : '') }, [
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title' }, [
        el('span', { class: `dot ${tunnel.status}` }),
        el('span', { class: 'row-name', title: profile.name, text: profile.name }),
        profile.mode === 'ovpn'
          ? el('span', { class: 'badge', text: '.ovpn' })
          : (profile.source === 'nm' ? el('span', { class: 'badge', text: 'NM' }) : null),
      ]),
      el('div', { class: 'row-sub', text: `${profile.gateway} · SOCKS ${profile.socksPort} · ${TUNNEL_LABEL[tunnel.status]}` }),
      tunnel.error ? el('div', { class: 'row-sub error', text: tunnel.error }) : null,
    ]),
    testBtn,
    el('button', {
      class: 'icon-btn', title: 'Xoá VPN',
      onclick: async () => {
        let res = await call('delete-vpn', { id: profile.id });
        if (!res.ok && res.domains) {
          const msg = `VPN này đang được dùng bởi:\n\n${res.domains.join('\n')}\n\nXoá luôn và gỡ khỏi các domain đó?`;
          if (!confirm(msg)) return;
          res = await call('delete-vpn', { id: profile.id, force: true });
        }
        if (!res.ok) flashError(errorSlot, res.error);
        refresh();
      },
    }, '✕'),
  ]);
}

export function renderVpns(state, tunnels) {
  const list = document.getElementById('vpn-list');
  const errorSlot = document.getElementById('vpn-error');
  clear(list);

  if (state.vpnProfiles.length === 0) {
    list.append(el('div', { class: 'empty', text: 'Chưa có VPN nào. Import từ NetworkManager hoặc thêm thủ công.' }));
    return;
  }
  for (const profile of state.vpnProfiles) list.append(vpnRow(profile, tunnels, errorSlot));
}

/** Danh sách connection OpenVPN đọc được từ NetworkManager; cái hỏng thì chặn import. */
function importModal(profiles, existingNames) {
  const body = el('div', {});
  if (profiles.length === 0) {
    body.append(el('div', { class: 'empty', text: 'NetworkManager không có connection OpenVPN nào.' }));
    return body;
  }

  for (const profile of profiles) {
    const blocked = profile.broken || profile.unsupported;
    const already = existingNames.includes(profile.name);

    body.append(el('div', { class: 'row' + (blocked ? ' is-error' : '') }, [
      el('div', { class: 'row-main' }, [
        el('div', { class: 'row-title' }, [
          el('span', { class: 'row-name', title: profile.name, text: profile.name }),
          blocked ? el('span', { class: 'badge danger', text: 'lỗi' }) : null,
        ]),
        el('div', { class: 'row-sub', text: profile.gateway || 'thiếu gateway' }),
        blocked ? el('div', { class: 'row-sub error', text: blocked }) : null,
      ]),
      el('button', {
        class: 'btn btn-sm',
        text: already ? 'Đã có' : 'Import',
        disabled: Boolean(blocked) || already,
        onclick: async (e) => {
          e.target.disabled = true;
          const res = await call('add-vpn', { profile });
          if (!res.ok) {
            e.target.disabled = false;
            return alert(res.error);
          }
          e.target.textContent = 'Đã có';
          refresh();
        },
      }),
    ]));
  }
  return body;
}

export function setupVpnControls(getState) {
  const addBtn = document.getElementById('btn-add-vpn');
  const form = document.getElementById('form-add-vpn');
  const errorSlot = document.getElementById('vpn-error');
  const fieldOf = (name) => form.querySelector(`[data-field="${name}"]`);

  setupOvpnImport(errorSlot, () => refresh());

  const nmBtn = document.getElementById('btn-import-nm');
  nmBtn.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const res = await call('import-nm');
    e.target.disabled = false;
    if (!res.ok) return flashError(errorSlot, res.error);
    if (res.unsupported) {
      nmBtn.hidden = true;
      return flashError(errorSlot, res.unsupported);
    }
    showModal('Import từ NetworkManager',
      importModal(res.profiles || [], getState().vpnProfiles.map((p) => p.name)));
  });

  // Ẩn hẳn nút ở OS không có NetworkManager, thay vì để user bấm rồi nhận lỗi.
  call('check-prereqs').then((r) => {
    if (r.ok && r.os && r.os !== 'linux') nmBtn.hidden = true;
  });

  const setOpen = (open) => { form.hidden = !open; addBtn.hidden = open; if (open) fieldOf('name').focus(); };
  addBtn.addEventListener('click', () => setOpen(true));
  document.getElementById('btn-cancel-vpn').addEventListener('click', () => {
    for (const f of FORM_FIELDS) fieldOf(f).value = '';
    errorSlot.hidden = true;
    setOpen(false);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const profile = Object.fromEntries(FORM_FIELDS.map((f) => [f, fieldOf(f).value.trim()]));
    const res = await call('add-vpn', { profile });
    if (!res.ok) return flashError(errorSlot, res.error, 6000);
    for (const f of FORM_FIELDS) fieldOf(f).value = '';
    setOpen(false);
    refresh();
  });

  document.getElementById('modal-close').addEventListener('click', closeModal);
}
