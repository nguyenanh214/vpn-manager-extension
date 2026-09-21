// Nút Import mở một TAB riêng, không tự mở hộp thoại chọn file trong popup.
//
// Chrome huỷ popup của extension ngay khi nó mất focus, mà mở hộp thoại chọn file
// của hệ điều hành chính là làm nó mất focus. Kết quả: người dùng chọn file xong
// thì popup đã chết, sự kiện `change` không bao giờ chạy, và không có gì xảy ra.
// Trang trong tab không bị vậy.

export function setupOvpnImport() {
  document.getElementById('btn-import-ovpn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('import/import.html') });
    // Đóng popup cho gọn; tab vừa mở đã giành focus nên Chrome sắp đóng nó rồi.
    window.close();
  });
}
