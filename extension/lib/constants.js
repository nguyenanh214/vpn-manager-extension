// Hằng số dùng chung cho service worker và popup.

export const NATIVE_HOST_NAME = 'com.andy.vpn_manager';
export const SCHEMA_VERSION = 1;

// Mỗi VPN profile chiếm một cổng SOCKS5 riêng -> chạy song song được nhiều tunnel.
export const SOCKS_PORT_BASE = 1080;
export const SOCKS_PORT_MAX = 1179;

// Cổng forward do user tự chọn, nhưng không được lấn dải SOCKS ở trên.
export const FORWARD_PORT_MIN = 1024;
export const FORWARD_PORT_MAX = 65535;

export const TUNNEL_STATE = {
  OFF: 'off',
  CONNECTING: 'connecting',
  ON: 'on',
  ERROR: 'error',
};

export const DEFAULT_STATE = {
  schemaVersion: SCHEMA_VERSION,
  vpnProfiles: [],
  domains: [],
  forwards: [],
  ui: {
    activeTab: 'domains',
    addDomainOpen: false,
    addDomainDraft: '',
    addVpnOpen: false,
    addVpnDraft: null,
    addForwardOpen: false,
    editingForwardId: null,
    domainsScrollTop: 0,
  },
};
