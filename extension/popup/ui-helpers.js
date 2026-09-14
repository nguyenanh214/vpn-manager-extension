// Tiện ích dùng chung cho hai tab.

/** Gọi service worker; luôn trả object, không bao giờ ném. */
export function call(action, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, payload }, (res) => {
      if (chrome.runtime.lastError) {
        return resolve({ ok: false, error: chrome.runtime.lastError.message });
      }
      resolve(res || { ok: false, error: 'Không có phản hồi từ background' });
    });
  });
}

/** Tạo element gọn: el('div', {class:'x'}, [child, 'text']) */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'disabled' || k === 'checked' || k === 'hidden') node[k] = Boolean(v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function showBanner(kind, message) {
  const banner = document.getElementById('banner');
  banner.className = `banner ${kind}`;
  banner.textContent = message;
  banner.hidden = false;
}

export function hideBanner() {
  document.getElementById('banner').hidden = true;
}

export function showModal(title, bodyNode) {
  document.getElementById('modal-title').textContent = title;
  const body = document.getElementById('modal-body');
  clear(body);
  body.append(bodyNode);
  document.getElementById('modal').hidden = false;
}

export function closeModal() {
  document.getElementById('modal').hidden = true;
}

/** Hiện lỗi tạm thời trên một element rồi tự ẩn. */
export function flashError(node, message, ms = 3500) {
  node.textContent = message;
  node.hidden = false;
  clearTimeout(node._flashTimer);
  node._flashTimer = setTimeout(() => { node.hidden = true; }, ms);
}

export const TUNNEL_LABEL = {
  off: 'Tắt',
  connecting: 'Đang kết nối…',
  on: 'Đang chạy',
  error: 'Lỗi',
};
