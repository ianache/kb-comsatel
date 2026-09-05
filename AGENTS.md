# AGENTS.md

## Mandatory graphify workflow

Graphify is required for every task involving this workspace, including questions, analysis, edits, reviews, debugging, and documentation work.

Before inspecting, answering about, or modifying workspace content:

1. Run the Graphify workflow against the workspace root:

   ```text
   /graphify .
   ```

2. Use the generated `graphify-out/` knowledge graph and report as the primary context for the task. If an existing graph is present and files have changed, use `/graphify . --update` when appropriate.
3. Do not bypass Graphify because the task appears small or unrelated. If the task does not require workspace context, state that explicitly and continue without scanning unrelated files.

### Installation fallback

If the `graphify` command or Python package is unavailable, install it locally in this workspace before proceeding. Do not rely on a global installation:

```powershell
if (-not (Test-Path .venv)) { python -m venv .venv }
.\.venv\Scripts\python.exe -m pip install graphifyy
```

Then invoke Graphify through the workspace environment:

```powershell
.\.venv\Scripts\python.exe -m graphify .
```

On Unix-like systems, use the equivalent `.venv/bin/python` paths.

If installation fails, report the exact error and do not pretend that Graphify was run.

### `/graphify` requests

When the user explicitly types `/graphify`, invoke the Graphify skill before doing anything else and follow its complete workflow.
