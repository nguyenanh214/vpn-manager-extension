# Cài đặt VPN Manager trên Windows.
#
# Chạy bằng:
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 <extension-id>
#
# Viết cho Windows PowerShell 5.1 (bản ship sẵn với Windows), KHÔNG dùng cú pháp
# chỉ có ở PowerShell 7: toán tử ternary `? :`, null-coalescing `??`,
# `ForEach-Object -Parallel`, `ConvertFrom-Json -AsHashtable`.
# Viết cho 5.1 thì chạy được cả trên 7; ngược lại thì 5.1 báo lỗi ngay dòng đầu.
#
# Không cần quyền Administrator: mọi thứ ghi vào HKCU và thư mục của user.

param([string]$ExtensionId = '')

$ErrorActionPreference = 'Stop'

# File nay PHAI luu kem BOM UTF-8: PowerShell 5.1 doc .ps1 khong BOM bang codepage
# ANSI cua may, moi ky tu tieng Viet bien thanh rac va script hong ngay khi parse.
# Console mac dinh lai la codepage 437/1258 nen con phai doi encoding dau ra nua,
# khong thi thong bao in ra man hinh van la rac.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$RepoDir   = Split-Path -Parent $PSScriptRoot
$HostName  = 'com.andy.vpn_manager'
$HostBat   = Join-Path $RepoDir 'native-host\vpn-manager-host.bat'
$HostJs    = Join-Path $RepoDir 'native-host\vpn-manager-host.js'
$Image     = 'vpn-manager-socks'
$StateDir  = Join-Path $env:APPDATA 'vpn-manager'
$ManifestDir = Join-Path $env:LOCALAPPDATA 'vpn-manager'
$ManifestPath = Join-Path $ManifestDir "$HostName.json"

function Write-Ok   { param($m) Write-Host "  $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "  $m" -ForegroundColor Yellow }
function Write-Err  { param($m) Write-Host "  $m" -ForegroundColor Red }
function Fail { param($m) Write-Host "LỖI: $m" -ForegroundColor Red; exit 1 }

# PowerShell 5.1 boc TUNG DONG stderr cua native exe thanh ErrorRecord; gap
# $ErrorActionPreference = 'Stop' thi chi mot dong tien trinh cua docker cung lam
# script chet oan du lenh tra ve exit code 0. Moi lenh native phai di qua day:
# ham gop stderr vao output roi tra ve, nguoi goi tu kiem $LASTEXITCODE.
function Invoke-Native {
    param([Parameter(Mandatory)][string]$Exe, [string[]]$Arguments = @())
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try   { & $Exe @Arguments 2>&1 | ForEach-Object { "$_" } }
    finally { $ErrorActionPreference = $prev }
}

# Khoá registry native messaging, kèm cách nhận biết trình duyệt có trên máy không.
$Browsers = @(
    @{ Name = 'Chrome';   Key = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts';
       Exe = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
               "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
               "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") },
    @{ Name = 'Edge';     Key = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts';
       Exe = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
               "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") },
    @{ Name = 'Brave';    Key = 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts';
       Exe = @("$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
               "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe") },
    @{ Name = 'Chromium'; Key = 'HKCU:\Software\Chromium\NativeMessagingHosts';
       Exe = @("$env:LOCALAPPDATA\Chromium\Application\chrome.exe") }
)

Write-Host '=== VPN Manager — cài đặt (Windows) ==='
Write-Host "Repo: $RepoDir"
Write-Host "PowerShell: $($PSVersionTable.PSVersion)"
Write-Host ''

# --- 1. Điều kiện ---
Write-Host '[1/6] Kiểm tra môi trường'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Err '✗ Không tìm thấy Docker.'
    Write-Host '    1. Tải Docker Desktop: https://www.docker.com/products/docker-desktop/'
    Write-Host '    2. Cài xong mở Docker Desktop, chờ icon cá voi ở khay hệ thống hết nhấp nháy'
    Write-Host '    3. Chạy lại script này'
    exit 1
}

Invoke-Native docker @('info') | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Err '✗ Docker đã cài nhưng daemon chưa chạy.'
    Write-Host '    Mở Docker Desktop, chờ icon cá voi ở khay hệ thống hết nhấp nháy,'
    Write-Host '    rồi chạy lại script này.'
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail 'Chưa cài Node.js. Tải bản LTS tại https://nodejs.org (cần >= 18).'
}
# Khong dung `node -p` de lay version: PowerShell boc tach dau nhay trong doi so
# truoc khi giao cho node.exe, bieu thuc JS toi noi thi da hong cu phap.
$NodeMajor = [int](((node -v) -replace '^v', '').Split('.')[0])
if ($NodeMajor -lt 18) { Fail "Cần Node >= 18, đang có $(node -v)" }

$NodeExe = (Get-Command node).Source
Write-Ok "✓ docker, node $(node -v)"

# --- 2. Dựng image + kiểm TUN ---
Write-Host ''
Write-Host '[2/6] Dựng image Docker'
Invoke-Native docker @('build', '-t', $Image, (Join-Path $RepoDir 'docker')) | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'Dựng image thất bại. Chạy lại lệnh docker build để xem chi tiết.' }
Write-Ok "✓ image $Image đã sẵn sàng"

# Host Windows không có /dev/net/tun vì Docker chạy trong VM — phải thử trong container.
Write-Host ''
Write-Host '  Thử tạo interface tun trong container... ' -NoNewline
$TunOut = Invoke-Native docker @(
    'run', '--rm', '--cap-add=NET_ADMIN', '--device', '/dev/net/tun',
    '--entrypoint', 'sh', $Image, '-c',
    'ip tuntap add dev tunprobe mode tun && ip link del tunprobe && echo TUN_OK')
if ($TunOut -match 'TUN_OK') {
    Write-Host 'OK' -ForegroundColor Green
} else {
    Write-Host ''
    Write-Err '✗ Container không tạo được interface tun:'
    $TunOut | ForEach-Object { Write-Host "      $_" }
    Write-Host '    Không có nó thì không dựng được tunnel.'
    Write-Host '    Thử khởi động lại Docker Desktop; nếu vẫn lỗi, kiểm tra backend đang dùng'
    Write-Host '    (Settings > General > Use WSL 2 based engine).'
    exit 1
}

# --- 3. Extension ID ---
Write-Host ''
Write-Host '[3/6] Đăng ký extension'
Write-Host '  Nếu chưa load extension:'
Write-Host '    1. Mở chrome://extensions'
Write-Host '    2. Bật "Developer mode" (góc trên bên phải)'
Write-Host '    3. "Load unpacked" -> chọn thư mục:'
Write-Host "         $RepoDir\extension"
Write-Host '    4. Copy Extension ID hiện ra trên thẻ extension'
Write-Host ''

if ([string]::IsNullOrWhiteSpace($ExtensionId)) {
    $ExtensionId = Read-Host '  Dán Extension ID'
}
$ExtensionId = $ExtensionId.Trim()
if ($ExtensionId -notmatch '^[a-p]{32}$') {
    Fail "Extension ID phải là 32 chữ cái a-p, nhận được: '$ExtensionId'"
}

# --- 4. Manifest + registry ---
Write-Host ''
Write-Host '[4/6] Cài native messaging host'

New-Item -ItemType Directory -Force -Path $ManifestDir | Out-Null
$Template = Get-Content (Join-Path $RepoDir "native-host\$HostName.json.template") -Raw
# JSON đòi backslash phải escape, nên đường dẫn Windows thành \\
$Template = $Template.Replace('__HOST_PATH__', $HostBat.Replace('\', '\\'))
$Template = $Template.Replace('__EXTENSION_ID__', $ExtensionId)
# `Set-Content -Encoding UTF8` cua PS 5.1 luon dinh kem BOM, ma bo doc JSON cua
# Chrome tu choi BOM -> Chrome coi nhu khong co host nao. Phai ghi UTF-8 khong BOM.
[System.IO.File]::WriteAllText($ManifestPath, $Template,
    (New-Object System.Text.UTF8Encoding($false)))
Write-Ok "✓ manifest: $ManifestPath"

$Installed = 0
foreach ($b in $Browsers) {
    $found = $false
    foreach ($exe in $b.Exe) { if ($exe -and (Test-Path $exe)) { $found = $true; break } }
    if (-not $found) { continue }

    $key = Join-Path $b.Key $HostName
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name '(Default)' -Value $ManifestPath
    Write-Ok "✓ registry $($b.Name): $key"
    $Installed++
}
if ($Installed -eq 0) { Fail 'Không tìm thấy trình duyệt nào được hỗ trợ. Đã cài Chrome chưa?' }

# --- 5. Thư mục state ---
Write-Host ''
Write-Host '[5/6] Tạo thư mục state'
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

# Windows không có chmod: file kế thừa ACL thư mục cha nên mặc định user khác đọc được.
# Thư mục này chứa file .ovpn có private key inline, phải khoá về đúng user hiện tại.
Invoke-Native icacls @($StateDir, '/inheritance:r', '/grant:r',
    "$($env:USERNAME):(OI)(CI)F") | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Warn '! Không đặt được ACL cho thư mục state — file .ovpn có thể bị user khác trên máy đọc'
} else {
    Write-Ok "✓ $StateDir (chỉ $env:USERNAME truy cập được)"
}

# Script này chạy trong shell có đủ PATH, Chrome thì không. Ghi lại để .bat dùng thẳng.
Set-Content -Path (Join-Path $StateDir 'node-path') -Value $NodeExe -NoNewline -Encoding ASCII
Write-Ok "✓ node: $NodeExe"

# --- 6. Thử spawn đúng như Chrome ---
Write-Host ''
Write-Host '[6/6] Thử spawn native host giống hệt Chrome'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $HostBat
$psi.UseShellExecute = $false
$psi.RedirectStandardError = $true
$psi.RedirectStandardInput = $true
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)
$proc.StandardInput.Close()

$marker = $false
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
    $line = $proc.StandardError.ReadLine()
    if ($null -eq $line) { break }
    if ($line -match 'khởi động pid=' -or $line -match 'khoi dong pid=') { $marker = $true; break }
    if ($line -match 'Khong tim thay Node') { Write-Err "  $line"; break }
}
if (-not $proc.HasExited) { $proc.Kill() }

if ($marker) {
    Write-Ok '✓ host khởi động được như Chrome sẽ spawn'
} else {
    Write-Err '✗ host KHÔNG khởi động được. Kiểm tra lại đường dẫn node ở bước 5.'
    exit 1
}

Write-Host ''
Write-Host '=== Xong ===' -ForegroundColor Green
Write-Host 'Vào chrome://extensions bấm Reload trên VPN Manager, rồi mở popup.'
