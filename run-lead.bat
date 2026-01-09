@echo off
REM Run Claude Code as Team Lead (Windows)

set CLAUDE_CODE_TEAM_NAME=dev-team
set CLAUDE_CODE_AGENT_TYPE=team-lead
set CLAUDE_CODE_AGENT_NAME=lead
set CLAUDE_CODE_COLLAB_URL=http://localhost:3847

echo.
echo Claude Code Team Lead
echo =====================
echo.
echo   Team:   %CLAUDE_CODE_TEAM_NAME%
echo   Agent:  %CLAUDE_CODE_AGENT_NAME% (%CLAUDE_CODE_AGENT_TYPE%)
echo   Server: %CLAUDE_CODE_COLLAB_URL%
echo.

REM Check if server is running
curl -s %CLAUDE_CODE_COLLAB_URL%/health >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Server not running at %CLAUDE_CODE_COLLAB_URL%
    echo Start it with: npm start
    exit /b 1
)

REM Try to find Claude Code CLI
if exist "%USERPROFILE%\.npm\_npx" (
    for /d %%i in ("%USERPROFILE%\.npm\_npx\*") do (
        if exist "%%i\node_modules\@anthropic-ai\claude-code\cli.js" (
            node "%%i\node_modules\@anthropic-ai\claude-code\cli.js" %*
            exit /b
        )
    )
)

REM Try global claude command
where claude >nul 2>&1
if %errorlevel% equ 0 (
    claude %*
    exit /b
)

echo ERROR: Claude Code CLI not found
echo Run: npm run patch
exit /b 1
