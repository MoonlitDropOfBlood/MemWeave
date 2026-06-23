#!/usr/bin/env bash
# MemWeave Mavis plugin -- PreToolUse hook (Unix thin wrapper).
# The actual logic lives in file-pack.mjs (cross-platform Node) so
# the plugin has no jq/curl dependency on Windows hosts.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/file-pack.mjs" < /dev/stdin
