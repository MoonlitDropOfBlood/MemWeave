#!/usr/bin/env bash
# MemWeave Mavis plugin -- UserPromptSubmit hook (Unix thin wrapper).
# The actual logic lives in prompt-inject.mjs (cross-platform Node) so
# the plugin has no jq/curl dependency on Windows hosts.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/prompt-inject.mjs" < /dev/stdin
