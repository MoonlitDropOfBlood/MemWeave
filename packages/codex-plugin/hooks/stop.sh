#!/usr/bin/env bash
# MemWeave Codex plugin — Stop hook (Unix thin wrapper).
# The actual logic lives in stop.mjs (cross-platform Node) so the
# plugin has no jq/curl dependency on Windows hosts.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stop.mjs" < /dev/stdin

