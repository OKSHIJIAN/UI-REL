@echo off
chcp 65001 >nul 2>&1
echo ============================================
echo   UI-REL Git Push to GitHub
echo ============================================
cd /d "%~dp0"
echo Current directory: %CD%
echo.
git remote -v
echo.
echo Pushing to origin/main...
git push -u origin main
echo.
if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Push completed!
) else (
    echo [FAILED] Push failed with error code %ERRORLEVEL%
)
echo.
pause
