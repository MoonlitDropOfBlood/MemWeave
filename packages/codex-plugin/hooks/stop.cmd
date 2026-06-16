@echo off
REM MemWeave Codex plugin -- Stop hook (Windows thin wrapper).
REM The actual logic lives in stop.mjs (cross-platform Node) so the
REM plugin has no jq/curl dependency on Windows hosts.
node "%~dp0stop.mjs"
