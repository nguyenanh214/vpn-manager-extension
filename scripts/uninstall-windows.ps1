# Gỡ VPN Manager trên Windows: dừng tunnel, xoá registry, xoá image, xoá state.
#
# Chạy bằng:
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall-windows.ps1
#
# Viết cho Windows PowerShell 5.1. Không cần quyền Administrator.

$ErrorActionPreference = 'Continue'

$HostName = 'com.andy.vpn_manager'
$Image    = 'vpn-manager-socks'
$StateDir = Join-Path $env:APPDATA 'vpn-manager'
$ManifestDir = Join-Path $env:LOCALAPPDATA 'vpn-manager'

$RegistryKeys = @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts',
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts',
    'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts',
    'HKCU:\Software\Chromium\NativeMessagingHosts'
)

function Write-Ok { param($m) Write-Host "  $m" -ForegroundColor Green }

Write-Host '=== VPN Manager — gỡ cài đặt (Windows) ==='

Write-Host '[1/4] Dừng mọi tunnel'
$ids = docker ps -aq --filter 'name=^vpnmgr-' 2>$null
if ($ids) {
    docker rm -f $ids *> $null
    Write-Ok "✓ đã xoá $(@($ids).Count) container"
} else {
    Write-Ok '✓ không có container nào'
}

Write-Host '[2/4] Xoá đăng ký native host'
$removed = 0
foreach ($root in $RegistryKeys) {
    $key = Join-Path $root $HostName
    if (Test-Path $key) {
        Remove-Item -Path $key -Recurse -Force
        Write-Ok "✓ $key"
        $removed++
    }
}
if ($removed -eq 0) { Write-Host '  - không có khoá registry nào' }

if (Test-Path $ManifestDir) {
    Remove-Item -Path $ManifestDir -Recurse -Force
    Write-Ok "✓ $ManifestDir"
}

Write-Host '[3/4] Xoá image Docker'
docker rmi $Image *> $null
if ($LASTEXITCODE -eq 0) { Write-Ok "✓ $Image" } else { Write-Host '  - image không tồn tại' }

Write-Host '[4/4] Xoá state'
# Thư mục này chứa file .ovpn user import — có private key inline.
if (Test-Path $StateDir) {
    $profiles = Join-Path $StateDir 'profiles'
    $count = 0
    if (Test-Path $profiles) { $count = @(Get-ChildItem $profiles -File).Count }
    Remove-Item -Path $StateDir -Recurse -Force
    Write-Ok "✓ $StateDir (kèm $count file .ovpn đã lưu)"
} else {
    Write-Host '  - không có thư mục state'
}

Write-Host ''
Write-Host 'Xong. Gỡ nốt extension trong chrome://extensions.'
