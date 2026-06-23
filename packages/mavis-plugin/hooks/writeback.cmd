@echo off
REM MemWeave Mavis plugin -- Stop hook (Windows thin wrapper).
REM The actual logic lives in writeback.mjs (cross-platform Node) so
REM the plugin has no jq/curl dependency on Windows hosts.
node "%~dp0writeback.mjs"
