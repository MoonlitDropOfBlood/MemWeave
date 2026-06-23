@echo off
REM MemWeave Mavis plugin -- UserPromptSubmit hook (Windows thin wrapper).
REM The actual logic lives in prompt-inject.mjs (cross-platform Node) so
REM the plugin has no jq/curl dependency on Windows hosts.
node "%~dp0prompt-inject.mjs"
