// Tab chính: danh sách domain + select VPN + công tắc bật/tắt.

import { call, el, clear, flashError, TUNNEL_LABEL } from './ui-helpers.js';

let refresh = () => {};
export function bindRefresh(fn) { refresh = fn; }

/** Select chọn VPN cho một domain. Tô đỏ khi bật mà chưa chọn. */
function vpnSelect(domain, profiles) {
  const select = el('select', {
    class: 'vpn-select' + (domain.enabled && !domain.vpnId ? ' needs-vpn' : ''),
    title: 'Chọn VPN cho domain này',
    onchange: async (e) => {
      const res = await call('set-domain-vpn', { id: domain.id, vpnId: e.target.value || null });
      if (!res.ok && res.error) alert(res.error);
      refresh();
    },
  }, [el('option', { value: '', text: profiles.length ? '— chọn VPN —' : '— chưa có VPN —' })]);

  for (const p of profiles) {
    select.append(el('option', { value: p.id, text: p.name, selected: p.id === domain.vpnId }));
  }
  select.value = domain.vpnId || '';
  return select;
}

function domainRow(domain, profiles, tunnels, errorSlot) {
  const tunnel = domain.vpnId ? (tunnels[domain.vpnId] || { status: 'off' }) : { status: 'off' };
  const status = domain.enabled ? tunnel.status : 'off';

  const checkbox = el('input', {
    type: 'checkbox',
    checked: domain.enabled,
    onchange: async (e) => {
      const wanted = e.target.checked;
      e.target.disabled = true;

      const res = await call('toggle-domain', { id: domain.id, enabled: wanted });
      if (!res.ok) {
        e.target.checked = false; // trả công tắc về vị trí cũ
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

  const subtitle = status === 'error'
    ? el('div', { class: 'row-sub', text: tunnel.error || 'Tunnel lỗi' })
    : el('div', { class: 'row-sub', text: domain.enabled ? TUNNEL_LABEL[status] : 'Tắt' });

  return el('div', { class: 'row' + (status === 'error' ? ' is-error' : '') }, [
    el('div', { class: 'row-main' }, [
      el('div', { class: 'row-title' }, [
        el('span', { class: `dot ${status}` }),
        el('span', { class: 'row-name', title: domain.domain, text: domain.domain }),
      ]),
      subtitle,
    ]),
    vpnSelect(domain, profiles),
    el('label', { class: 'switch' }, [checkbox, el('span')]),
    el('button', {
      class: 'icon-btn', title: 'Xoá domain',
      onclick: async () => {
        await call('delete-domain', { id: domain.id });
        refresh();
      },
    }, '✕'),
  ]);
}

export function renderDomains(state, tunnels) {
  const list = document.getElementById('domain-list');
  const errorSlot = document.getElementById('domain-error');
  const scrollTop = list.scrollTop;
  clear(list);

  if (state.domains.length === 0) {
    list.append(el('div', { class: 'empty', text: 'Chưa có domain nào. Nhấn "Thêm domain" để bắt đầu.' }));
    return;
  }

  for (const domain of state.domains) {
    list.append(domainRow(domain, state.vpnProfiles, tunnels, errorSlot));
  }
  list.scrollTop = scrollTop;
}

/** Form thêm domain; nội dung đang gõ dở được lưu để mở lại popup không mất. */
export function setupAddDomain(getUi) {
  const btn = document.getElementById('btn-add-domain');
  const form = document.getElementById('form-add-domain');
  const input = document.getElementById('input-domain');
  const errorSlot = document.getElementById('domain-error');

  const setOpen = async (open) => {
    form.hidden = !open;
    btn.hidden = open;
    await call('set-ui', { ui: { addDomainOpen: open } });
    if (open) input.focus();
  };

  btn.addEventListener('click', () => setOpen(true));

  document.getElementById('btn-cancel-domain').addEventListener('click', async () => {
    input.value = '';
    input.classList.remove('invalid');
    errorSlot.hidden = true;
    await call('set-ui', { ui: { addDomainDraft: '' } });
    setOpen(false);
  });

  input.addEventListener('input', () => {
    input.classList.remove('invalid');
    errorSlot.hidden = true;
    clearTimeout(input._draftTimer);
    input._draftTimer = setTimeout(
      () => call('set-ui', { ui: { addDomainDraft: input.value } }), 250);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await call('add-domain', { domain: input.value });
    if (!res.ok) {
      input.classList.add('invalid');
      flashError(errorSlot, res.error);
      return;
    }
    input.value = '';
    await call('set-ui', { ui: { addDomainDraft: '' } });
    setOpen(false);
    refresh();
  });

  // Khôi phục trạng thái form từ lần mở popup trước
  const ui = getUi();
  input.value = ui.addDomainDraft || '';
  form.hidden = !ui.addDomainOpen;
  btn.hidden = Boolean(ui.addDomainOpen);
}
