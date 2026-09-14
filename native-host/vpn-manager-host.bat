@echo off
rem Launcher cho Chrome tren Windows. Chrome khong thuc thi duoc .js truc tiep.
rem
rem QUAN TRONG: @echo off la bat buoc. Thieu no, cmd in lai tung lenh ra stdout va
rem Chrome nhan rac o dau stream native messaging roi ngat ket noi ngay.
rem Moi thong bao cua script nay phai di ra stderr (>&2), khong bao gio ra stdout.
rem
rem File nay dung ASCII khong dau: cmd mac dinh chay codepage 437/1258, tieng Viet
rem co dau se hien thanh ky tu rac.

setlocal
set "HOSTDIR=%~dp0"
set "NODEEXE="

rem 1. Duong dan node do install-windows.ps1 ghi lai (chay trong shell co day du PATH)
set "NODEPATHFILE=%APPDATA%\vpn-manager\node-path"
if not exist "%NODEPATHFILE%" goto try_path
set /p NODEEXE=<"%NODEPATHFILE%"
if not defined NODEEXE goto try_path
if exist "%NODEEXE%" goto run
set "NODEEXE="

:try_path
rem 2. PATH hien tai
for %%I in (node.exe) do set "NODEEXE=%%~$PATH:I"
if not defined NODEEXE goto try_progfiles
if exist "%NODEEXE%" goto run
set "NODEEXE="

:try_progfiles
rem 3. Cac vi tri cai dat thuong gap
if not exist "%ProgramFiles%\nodejs\node.exe" goto try_localappdata
set "NODEEXE=%ProgramFiles%\nodejs\node.exe"
goto run

:try_localappdata
if not exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" goto notfound
set "NODEEXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
goto run

:notfound
echo [vpn-manager-host] Khong tim thay Node.js. >&2
echo [vpn-manager-host] Chay lai: powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 >&2
exit /b 1

:run
"%NODEEXE%" "%HOSTDIR%vpn-manager-host.js"
