// Chọn file .ovpn trong một TAB, không phải trong popup.
//
// Mở hộp thoại chọn file từ popup của extension làm popup mất focus, và Chrome huỷ
// popup ngay lúc đó — trang chết trước khi sự kiện `change` kịp chạy, nên người dùng
// chọn file xong thì không có gì xảy ra. Tab thường không bị vậy.

import { call, el, clear } from '../popup/ui-helpers.js';

const fileInput = document.getElementById('file');
const nameInput = document.getElementById('name');
const submitBtn = document.getElementById('submit');
const result = document.getElementById('result');

/** Tên gợi ý lấy từ tên file, bỏ đuôi. */
const nameFromFile = (f) => f.replace(/\.(ovpn|conf|txt)$/i, '').slice(0, 40) || 'VPN';

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không đọc được file'));
    reader.readAsText(file);
  });
}

function show(node) {
  clear(result);
  result.append(node);
  result.hidden = false;
}

const errorBox = (title, lines) => el('div', {}, [
  el('p', { class: 'error', text: title }),
  lines.length
    ? el('ul', { class: 'error' }, lines.map((l) => el('li', { text: l })))
    : null,
]);

// Điền sẵn tên theo file, nhưng đừng đè lên thứ người dùng đã tự gõ.
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f && !nameInput.value.trim()) nameInput.value = nameFromFile(f.name);
});

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files?.[0];
  if (!file) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang import…';
  result.hidden = true;

  try {
    const content = await readFileText(file);
    const name = nameInput.value.trim() || nameFromFile(file.name);
    const res = await call('import-ovpn', { name, content });

    if (!res.ok) {
      show(errorBox(
        res.errors?.length ? 'File .ovpn chưa dùng được:' : (res.error || 'Import thất bại'),
        res.errors || []));
      return;
    }

    show(el('div', {}, [
      el('p', { style: 'color:var(--ok);margin:0', text: `✓ Đã import "${res.profile.name}"` }),
      el('p', { class: 'row-sub', text: `${res.profile.gateway} · SOCKS ${res.profile.socksPort}` }),
      el('p', { class: 'row-sub', text: 'Mở popup của extension để gán VPN này cho domain.' }),
    ]));
    fileInput.value = '';
    nameInput.value = '';
  } catch (err) {
    show(errorBox(err.message, []));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Import';
  }
});
