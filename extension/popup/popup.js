// Vỏ popup: chuyển tab, nạp state, và khôi phục đúng trạng thái lần mở trước.
// MV3 huỷ DOM popup khi đóng, nên mọi thứ phải rehydrate từ storage lúc mở.

import { call, showBanner, hideBanner, closeModal } from './ui-helpers.js';
import { renderDomains, setupAddDomain, bindRefresh as bindDomainRefresh } from './tab-domains.js';
import { renderVpns, setupVpnControls, bindRefresh as bindVpnRefresh } from './tab-vpns.js';
import { renderForwards, setupForwardControls, bindRefresh as bindForwardRefresh } from './tab-forwards.js';

let current = { state: null, tunnels: {} };

function switchTab(tab, persist = true) {
  for (const btn of document.querySelectorAll('.tab')) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  }
  for (const name of ['domains', 'forwards', 'vpns']) {
    document.getElementById(`panel-${name}`).hidden = tab !== name;
  }
  if (persist) call('set-ui', { ui: { activeTab: tab } });
}

/** Cảnh báo khi extension khác chiếm quyền proxy, vì khi đó PAC của ta vô hiệu. */
function renderBanner(control, state) {
  if (control && !control.controllable) {
    return showBanner('danger',
      `Extension khác đang chiếm quyền proxy (${control.level}). Tắt extension đó để VPN Manager hoạt động.`);
  }
  const broken = Object.values(current.tunnels).filter((t) => t.status === 'error');
  if (broken.length > 0) {
    return showBanner('danger',
      broken[0].error || `${broken.length} tunnel đang lỗi — domain và forward liên quan sẽ không dùng được.`);
  }
  const domains = state.domains.filter((d) => d.enabled && d.vpnId).length;
  const forwards = (state.forwards || []).filter((f) => f.enabled && f.vpnId).length;
  if (domains || forwards) {
    const parts = [];
    if (domains) parts.push(`${domains} domain`);
    if (forwards) parts.push(`${forwards} forward`);
    return showBanner('ok', `${parts.join(' · ')} đang đi qua VPN.`);
  }
  hideBanner();
}

async function refresh() {
  const res = await call('get-state');
  if (!res.ok) return showBanner('danger', res.error || 'Không kết nối được background');

  current = { state: res.state, tunnels: res.tunnels || {} };
  renderDomains(res.state, current.tunnels);
  renderForwards(res.state, current.tunnels);
  renderVpns(res.state, current.tunnels);
  renderBanner(res.control, res.state);
  return current;
}

async function init() {
  bindDomainRefresh(refresh);
  bindForwardRefresh(refresh);
  bindVpnRefresh(refresh);

  for (const btn of document.querySelectorAll('.tab')) {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  }
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });

  await refresh();
  if (!current.state) return;

  switchTab(current.state.ui.activeTab || 'domains', false);
  setupAddDomain(() => current.state.ui);
  setupForwardControls(() => current.state);
  setupVpnControls(() => current.state);

  // Native host hoặc image thiếu thì báo ngay, đừng để user bật domain rồi mới thấy lỗi.
  const prereq = await call('check-prereqs');
  if (!prereq.ok) {
    showBanner('danger', `Native host chưa sẵn sàng: ${prereq.error}. Chạy lại script cài đặt.`);
  } else if (prereq.errors?.length) {
    // Không mượn được TUN là lỗi chặn hẳn, không phải cảnh báo nhẹ
    const blocking = prereq.tun && !prereq.tun.ok;
    showBanner(blocking ? 'danger' : 'warn', prereq.errors.join(' · '));
  }

  // Container vẫn chạy không có nghĩa tunnel còn sống — kiểm tra thật rồi vẽ lại.
  const health = await call('tunnel-health');
  if (health.ok && health.tunnels) {
    current.tunnels = health.tunnels;
    renderDomains(current.state, current.tunnels);
    renderForwards(current.state, current.tunnels);
    renderVpns(current.state, current.tunnels);
    renderBanner(null, current.state);
  }

  // Tunnel có thể đã chết ngoài tầm kiểm soát của service worker; đồng bộ lại khi mở popup.
  const hasActive = current.state.domains.some((d) => d.enabled && d.vpnId)
    || (current.state.forwards || []).some((f) => f.enabled && f.vpnId);
  if (hasActive) {
    await call('reconcile');
    await refresh();
  }
}

document.addEventListener('DOMContentLoaded', init);
