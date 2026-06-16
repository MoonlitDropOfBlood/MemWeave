# MemWeave OpenCode integration — self-debug guide

> If `memweave-diag.ps1` returns `FAIL: N` (N > 0), or OpenCode shows
> errors after restart, work through this guide in order.

## Step 0: Run the diag and see what fails

```powershell
& "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -ExecutionPolicy Bypass -File "C:\Users\wwhby\AppData\Local\Temp\memweave-diag.ps1"
```

Note which section fails:

| Section | What it means |
|---|---|
| 1. Server health | Server is down, wrong version, or health endpoint broken |
| 2. MCP endpoint | `/mcp` returning errors or wrong tool list |
| 3. opencode.json | `mcp.memweave` block missing or `type` is wrong |
| 4. OpenCode cache | Cache has the old 0.2.1 plugin still installed |

---

## Step 1: Look at OpenCode log for the exact error

```powershell
# Last 30 memweave/MCP-related lines
Select-String -Path "C:\Users\wwhby\.local\share\opencode\log\opencode.log" -Pattern "memweave|MCP|mcp" | Select-Object -Last 30

# Or dump the last 200 lines
Get-Content "C:\Users\wwhby\.local\share\opencode\log\opencode.log" | Select-Object -Last 200
```

### Common log patterns and what they mean

| Log line | Root cause | Fix |
|---|---|---|
| `key=memweave type=local status=failed` | OpenCode treated mcp.memweave as a stdio MCP server. The Zod schema rejected `type: "http"` (only `"local"` or `"remote"` are valid). | **Fix opencode.json**: change `"type": "http"` to `"type": "remote"` in mcp.memweave |
| `Loaded plugin MCP server: @mem-weave/opencode-plugin:memweave` (not present) | oh-my-openagent's `transformMcpServer` rejected the plugin's `.mcp.json` (most likely because `type: "remote"` is not recognized — only `"http"` / `"sse"` are). The error is caught silently. | **Expected for most users** (oh-my-openagent needs Claude Code's plugin DB which most don't have). The user's hand-added `mcp.memweave` in opencode.json is the main path. |
| `MCP error -32000: Connection closed` when LLM calls a memory_* tool | Server 0.5.0 was strict about Accept headers. Server 0.5.1 has the Accept fallback. If you see this with 0.5.1, the server is not actually 0.5.1 (stale process). | Restart memweave server: `Get-NetTCPConnection -LocalPort 3131 -ErrorAction SilentlyContinue \| Select-Object -ExpandProperty OwningProcess \| ForEach-Object { Stop-Process -Id $_ -Force }` then `Start-Process -FilePath "C:\Users\wwhby\AppData\Roaming\npm\memweave.cmd" -ArgumentList "start" -WindowStyle Hidden` |
| `server unavailable key=memweave` (no type in the log) | The mcp.memweave entry was completely missing from the config. | Re-check opencode.json has the mcp.memweave block |

---

## Step 2: Run the simulator (independent of OpenCode)

```powershell
& "D:\Application\nodejs\node.exe" "C:\Users\wwhby\AppData\Local\Temp\memweave-opencode-simulator.cjs"
```

Expected: `PASS: 17  FAIL: 0`

If this PASSES, the server side is 100% working. Any OpenCode-side issue is a config / cache problem, not a server bug.

If this FAILS, the server is broken. Reinstall:
```powershell
npm install -g @mem-weave/server@0.5.1
Start-Process -FilePath "C:\Users\wwhby\AppData\Roaming\npm\memweave.cmd" -ArgumentList "start" -WindowStyle Hidden
```

---

## Step 3: Clean OpenCode cache (if Step 0 section 4 fails)

The OpenCode cache at `C:\Users\wwhby\.cache\opencode\packages\@mem-weave\` may have a stale 0.2.1 install of the plugin that OpenCode loads instead of the global 0.4.2:

```powershell
# Backup then remove
Copy-Item "C:\Users\wwhby\.cache\opencode\packages\@mem-weave" "C:\Users\wwhby\AppData\Local\Temp\opencode-plugin-cache-$(Get-Date -Format yyyyMMdd-HHmmss).bak" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "C:\Users\wwhby\.cache\opencode\packages\@mem-weave" -Recurse -Force
```

Then restart OpenCode. OpenCode will reinstall the plugin from global npm (0.4.2).

---

## Step 4: Verify opencode.json has the correct mcp.memweave

```powershell
Get-Content "C:\Users\wwhby\.config\opencode\opencode.json" | Select-String -Pattern "memweave" -Context 0,2
```

Expected output (with type = "remote", url, enabled):
```json
"mcp": {
  "codegraph": { "type": "local", "command": [...] },
  "memweave": {
    "type": "remote",
    "url": "http://127.0.0.1:3131/mcp",
    "enabled": true
  }
}
```

**Only `"remote"` works for OpenCode.** NOT `"http"`, NOT `"sse"`.

If wrong:
```powershell
# Manually edit the mcp.memweave block in:
# C:\Users\wwhby\.config\opencode\opencode.json
```

---

## Step 5: Check global npm versions

```powershell
# Plugin
Get-Content "C:\Users\wwhby\AppData\Roaming\npm\node_modules\@mem-weave\opencode-plugin\package.json" | Select-String "version"
# Should print: "version": "0.4.2",

# Server
Get-Content "C:\Users\wwhby\AppData\Roaming\npm\node_modules\@mem-weave\server\package.json" | Select-String "version"
# Should print: "version": "0.5.1",
```

If wrong, reinstall:
```powershell
npm install -g @mem-weave/opencode-plugin@0.4.2
npm install -g @mem-weave/server@0.5.1
```

---

## Step 6: Restart memweave server

The server may have stale state. Restart it:
```powershell
# Kill existing
Get-NetTCPConnection -LocalPort 3131 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }

# Start new
Start-Process -FilePath "C:\Users\wwhby\AppData\Roaming\npm\memweave.cmd" -ArgumentList "start" -WindowStyle Hidden

# Wait + verify
Start-Sleep -Seconds 4
Invoke-RestMethod http://127.0.0.1:3131/api/v1/health
# Should print: {"ok":true,"service":"memweave-server","version":"0.5.1"}
```

---

## Step 7: OpenCode restart in correct directory

OpenCode reads opencode.json from the directory it was started in. Always start OpenCode in the project workspace:

```powershell
# In PowerShell
Set-Location "D:\ai-projects\memory"
Start-Process -FilePath "C:\Users\wwhby\AppData\Roaming\npm\opencode.cmd" -WorkingDirectory "D:\ai-projects\memory" -WindowStyle Hidden
# Or use the opencode TUI directly in that directory
```

---

## Step 8: Tail the log AFTER restart

```powershell
# Clear the log so we only see post-restart entries
# (don't actually delete it; just use Select-String with timestamp)
Get-Content "C:\Users\wwhby\.local\share\opencode\log\opencode.log" -Tail 100 | Select-String -Pattern "memweave|mcp|MCP|server unavailable|loaded plugin" | Select-Object -Last 50
```

---

## What to do if everything passes but tools still don't show

This would mean the LLM tools are loaded but not surfaced in OpenCode's tool palette. This is a client-side rendering issue, not a server or config issue. Workaround:
1. Open OpenCode's web UI (it usually shows all MCP tools regardless of TUI rendering)
2. Check `http://127.0.0.1:3131/ui/memories` to verify memory was saved
3. Use a direct MCP client like `claude-desktop` with the same `mcp.memweave` block

---

## Final escalation

If nothing in this guide works, collect and paste:
1. Full output of `memweave-diag.ps1`
2. Last 50 lines of OpenCode log (run `Select-String ... | Select-Object -Last 50`)
3. Output of `memweave-opencode-simulator.cjs`
4. Output of `Get-Content opencode.json` (full file)
