// Import file .ovpn từ hộp thoại chọn file của Chrome.
//
// Chrome KHÔNG cho extension biết đường dẫn thật của file người dùng chọn — `File`
// object không có `.path`. Nên bắt buộc đọc nội dung rồi nhờ native host ghi ra đĩa
// với quyền 0600. Nội dung không bao giờ vào chrome.storage, chỉ đường dẫn được lưu.

import { call, el, flashError, showModal, closeModal } from './ui-helpers.js';

/** Đọc file người dùng chọn thành text. */
function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không đọc được file'));
    reader.readAsText(file);
  });
}

/** Tên gợi ý lấy từ tên file, bỏ đuôi. */
const nameFromFile = (fileName) =>
  fileName.replace(/\.(ovpn|conf|txt)$/i, '').slice(0, 40) || 'VPN';

/** Liệt kê các vấn đề parser tìm thấy, thay vì chỉ báo "file không hợp lệ". */
function showParseErrors(errors) {
  showModal('File .ovpn chưa dùng được', el('div', {}, [
    el('p', { class: 'row-sub', text: 'Các vấn đề tìm thấy trong file:' }),
    el('ul', { class: 'error', style: 'margin:6px 0 0 16px;padding:0' },
      errors.map((e) => el('li', { text: e }))),
  ]));
}

/**
 * Hỏi tên rồi import. Dùng modal thay cho prompt() vì prompt() không đáng tin
 * trong popup của extension.
 */
function askNameThenImport(suggested, content, errorSlot, refresh) {
  const input = el('input', { class: 'input', value: suggested, placeholder: 'Tên VPN' });
  const error = el('p', { class: 'error', hidden: true });

  const submit = async () => {
    const name = input.value.trim() || suggested;
    const res = await call('import-ovpn', { name, content });
    if (!res.ok) {
      if (res.errors?.length) return showParseErrors(res.errors);
      error.textContent = res.error;
      error.hidden = false;
      return;
    }
    closeModal();
    refresh();
  };

  showModal('Đặt tên cho VPN này', el('div', {}, [
    input,
    el('p', { class: 'row-sub', text: 'Tên này hiện trong dropdown ở tab Domains và Forward.' }),
    error,
    el('div', { style: 'margin-top:10px' }, [
      el('button', { class: 'btn btn-primary btn-block', text: 'Import', onclick: submit }),
    ]),
  ]));

  input.focus();
  input.select();
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

/** Nối nút Import và input file ẩn. */
export function setupOvpnImport(errorSlot, refresh) {
  const fileInput = document.getElementById('file-ovpn');

  document.getElementById('btn-import-ovpn')
    .addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // cho phép chọn lại đúng file đó lần nữa
    if (!file) return;

    let content;
    try {
      content = await readFileText(file);
    } catch (err) {
      return flashError(errorSlot, err.message);
    }
    askNameThenImport(nameFromFile(file.name), content, errorSlot, refresh);
  });
}
