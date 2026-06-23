#!/usr/bin/env bash
# MemWeave Mavis plugin -- Stop hook (Unix thin wrapper).
# The actual logic lives in writeback.mjs (cross-platform Node) so
# the plugin has no jq/curl dependency on Windows hosts.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/writeback.mjs" < /dev/stdin
