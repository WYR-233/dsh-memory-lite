@echo off
REM 隔离实例启动器（抄 .temp\start-whale-2234.bat 的环境设置）；端口由参数决定，默认 2299
set "PORT=%~1"
if "%PORT%"=="" set "PORT=2299"
set "DSH_HOME=G:\deepseek\deepseek-harness\home"
set "HOME=G:\deepseek\deepseek-harness\home"
set "npm_config_cache=G:\deepseek\deepseek-harness\.npm-cache"
set "npm_config_store_dir=G:\.pnpm-store"
set "TEMP=G:\deepseek\deepseek-harness\.temp"
set "TMP=G:\deepseek\deepseek-harness\.temp"
cd /d G:\deepseek\deepseek-harness\app
"F:\node\node.exe" "G:\deepseek\deepseek-harness\app\node_modules\@deepseek-ai\dsh\lib\bin.js" web --host 127.0.0.1 --port %PORT% --no-open >> "G:\deepseek\deepseek-harness\.temp\memory-lite-test-%PORT%.log" 2>&1
