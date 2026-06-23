@echo off
REM MemWeave Mavis plugin -- PreToolUse hook (Windows thin wrapper).
REM The actual logic lives in file-pack.mjs (cross-platform Node) so
REM the plugin has no jq/curl dependency on Windows hosts.
node "%~dp0file-pack.mjs"
