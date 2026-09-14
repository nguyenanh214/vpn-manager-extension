// Tab Forward: mở một cổng TCP trên 127.0.0.1, chuyển tiếp qua tunnel tới host:port
// bên trong VPN. Dành cho client không nói được SOCKS5 — Navicat, DBeaver, psql...
// Client chỉ cần trỏ tới 127.0.0.1:<cổng cục bộ>, không cấu hình proxy gì.

import { call, el, clear, flashError, TUNNEL_LABEL } from './ui-helpers.js';

const FIELDS = ['label', 'localPort', 'remoteHost', 'remotePort'];

let refresh = () => {};
export function bindRefresh(fn) { refresh = fn; }

const fieldOf = (name) => document.querySelector(`[data-fwd="${name}"]`);

function vpnSelect(forward, profiles) {
  const select = el('select', {
    class: 'vpn-select' + (forward.enabled && !forward.vpnId ? ' needs-vpn' : ''),
    title: 'Chọn VPN cho forward này',
    onchange: async (e) => {
      await call('set-forward-vpn', { id: forward.id, vpnId: e.target.value || null });
      refresh();
    },
  }, [el('option', { value: '', text: profiles.length ? '— chọn VPN —' : '— chưa có VPN —' })]);

  for (const p of profiles) {
    select.append(el('option', { value: p.id, text: p.name, selected: p.id === forward.vpnId }));
  }
  select.value = forward.vpnId || '';
  return select;
}

function forwardRow(forward, profiles, tunnels, errorSlot) {
  const tunnel = forward.vpnId ? (tunnels[forward.vpnId] || { status: 'off' }) : { status: 'off' };
  const status = forward.enabled ? tunnel.status : 'off';

  const checkbox = el('input', {
    type: 'checkbox',
    checked: forward.enabled,
    onchange: async (e) => {
      const wanted = e.target.checked;
      e.target.disabled = true;
      const res = await call('toggle-forward', { id: forward.id, enabled: wanted });
      if (!res.ok) {
        e.target.checked = false;
        flashError(errorSlot, res.error || 'Không bật được');
        if (res.needsVpn) {
          const sel = e.target.closest('.row').querySelector('.vpn-select');
          sel?.classList.add('needs-vpn');
          sel?.focus();
        }
      }
      e.target.disabled = false;
      refresh();
    },
  });

  // Bỏ tiền tố 127.0.0.1 cho gọn — cổng cục bộ luôn bind ở localhost.
  // Tooltip giữ dạng đầy đủ để copy.
  const route = `:${forward.localPort} → ${forward.remoteHost}:${forward.remotePort}`;
  const routeFull = `127.0.0.1:${forward.localPort} → ${forward.remoteHost}:${forward.remotePort}`;
  const subtitle = status === 'error'
    ? el('div', { class: 'row-sub error', text: tunnel.error || 'Tunnel lỗi' })
    : el('div', { class: 'row-sub mono-sm', title: routeFull, text: route });

  return el('div', { class: 'row' + (status === 'error' ? ' is-error' : '') }, [
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title' }, [
        el('span', { class: `dot ${status}` }),
        el('span', { class: 'row-name', title: `${forward.label} · ${routeFull}`, text: forward.label }),
      ]),
      subtitle,
      forward.enabled && status === 'on'
        ? el('div', { class: 'row-sub', text: TUNNEL_LABEL.on }) : null,
    ]),
    vpnSelect(forward, profiles),
    el('label', { class: 'switch' }, [checkbox, el('span')]),
    el('button', {
      class: 'icon-btn', title: 'Sửa forward',
      onclick: () => openForm(forward),
    }, '✎'),
    el('button', {
      class: 'icon-btn', title: 'Xoá forward',
      onclick: async () => {
        await call('delete-forward', { id: forward.id });
        refresh();
      },
    }, '✕'),
  ]);
}

export function renderForwards(state, tunnels) {
  const list = document.getElementById('forward-list');
  const errorSlot = document.getElementById('forward-error');
  const scrollTop = list.scrollTop;
  clear(list);

  if ((state.forwards || []).length === 0) {
    list.append(el('div', { class: 'empty' },
      'Chưa có forward nào. Dùng khi ứng dụng không hỗ trợ proxy SOCKS5 — ' +
      'ví dụ Navicat: thêm forward rồi trỏ connection tới 127.0.0.1.'));
    return;
  }

  for (const forward of state.forwards) {
    list.append(forwardRow(forward, state.vpnProfiles, tunnels, errorSlot));
  }
  list.scrollTop = scrollTop;
}

/** Mở form; truyền forward để sửa, bỏ trống để thêm mới. */
function openForm(forward = null) {
  const form = document.getElementById('form-add-forward');
  const btn = document.getElementById('btn-add-forward');

  form.dataset.editingId = forward?.id || '';
  for (const f of FIELDS) fieldOf(f).value = forward ? forward[f] : '';
  form.querySelector('button[type="submit"]').textContent = forward ? 'Cập nhật' : 'Lưu';

  form.hidden = false;
  btn.hidden = true;
  document.getElementById('forward-error').hidden = true;
  call('set-ui', { ui: { addForwardOpen: true, editingForwardId: forward?.id || null } });
  fieldOf(forward ? 'localPort' : 'label').focus();
}

function closeForm() {
  const form = document.getElementById('form-add-forward');
  form.hidden = true;
  form.dataset.editingId = '';
  document.getElementById('btn-add-forward').hidden = false;
  document.getElementById('forward-error').hidden = true;
  for (const f of FIELDS) fieldOf(f).value = '';
  call('set-ui', { ui: { addForwardOpen: false, editingForwardId: null } });
}

export function setupForwardControls(getState) {
  const form = document.getElementById('form-add-forward');
  const errorSlot = document.getElementById('forward-error');

  document.getElementById('btn-add-forward').addEventListener('click', () => openForm());
  document.getElementById('btn-cancel-forward').addEventListener('click', closeForm);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = Object.fromEntries(FIELDS.map((f) => [f, fieldOf(f).value.trim()]));
    const editingId = form.dataset.editingId;

    const res = editingId
      ? await call('update-forward', { id: editingId, forward: input })
      : await call('add-forward', { forward: input });

    if (!res.ok) {
      for (const f of FIELDS) fieldOf(f).classList.remove('invalid');
      if (res.field) fieldOf(res.field)?.classList.add('invalid');
      return flashError(errorSlot, res.error, 5000);
    }
    closeForm();
    refresh();
  });

  // Khôi phục form đang mở dở từ lần mở popup trước
  const ui = getState().ui;
  if (ui.addForwardOpen) {
    const editing = (getState().forwards || []).find((f) => f.id === ui.editingForwardId);
    openForm(editing || null);
  }
}
