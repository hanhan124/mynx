@echo off
rem Double-click to run every check for the chat-next work.
rem Output goes to verify-chat-next.log in the project root.
chcp 65001 >nul
cd /d "%~dp0.."
set LOG=verify-chat-next.log
echo Mynx chat-next verification %date% %time% > %LOG%

for %%C in ("npm run test:rust" "npx vitest run src/features/chat-next" "npm test" "npm run typecheck" "npm run lint" "npm run build" "npm run branding:check") do (
  echo.
  echo ===== %%~C
  echo. >> %LOG%
  echo ===== %%~C >> %LOG%
  call %%~C >> %LOG% 2>&1
  if errorlevel 1 (
    echo FAILED
    echo ===== RESULT: FAILED >> %LOG%
  ) else (
    echo OK
    echo ===== RESULT: OK >> %LOG%
  )
)

echo.
echo Done. Results saved to %CD%\%LOG%
pause
