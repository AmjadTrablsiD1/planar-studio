@echo off
rem Planar Studio on Windows. UNTESTED on Windows: written from documentation.
rem Needs Node 22.18+ on PATH (nodejs.org). The first start builds the interface.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node is not on PATH. Install it from https://nodejs.org and try again. & pause & exit /b 1)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)" || (echo Node 22.18 or newer is needed. & pause & exit /b 1)
if not exist ui\dist\index.html (
  pushd ui && call npm install && call npm run build && popd
)
node main.ts %*
if errorlevel 1 pause
