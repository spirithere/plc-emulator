---
name: plc-runtime-mcp-control
description: Control and verify the plc-emu runtime through MCP tools and REST endpoints. Use this skill when you need to start/stop/step scans, load a project model, write variables or inputs, read state/metrics, or run repeatable runtime smoke checks in local development, CI, or agent-driven debugging workflows.
---

# PLC Runtime MCP Control

## Overview

Use this skill to operate `plc-emu` runtime as an external service without VS Code UI interaction.  
Prefer MCP tools for agent control, and use REST as a deterministic fallback for scripts and smoke checks.

## Quick Start

1. Start runtime server.
   - MCP-only: `npm run host:mcp`
   - JSON-RPC + MCP + REST: `npm run host:all`
2. Verify health with `GET /api/v1/health`.
3. Load project model using MCP tool `plc_runtime_project_load` or REST `POST /api/v1/project/load`.
4. Drive state with:
   - `plc_runtime_start` / `plc_runtime_stop`
   - `plc_runtime_step`
   - `plc_runtime_write_variable`, `plc_runtime_set_input`
5. Read outcomes with:
   - `plc_runtime_get_state`
   - `plc_runtime_get_metrics`

## Workflow

1. Confirm server mode and endpoint.
   - MCP endpoint default: `http://127.0.0.1:8124/mcp`
   - REST base default: `http://127.0.0.1:8124/api/v1`
2. Load runtime model before scan execution.
   - Always provide both `pous` and `ladder` arrays.
3. Choose execution mode.
   - Use continuous scan: `start/stop`.
   - Use deterministic checks: `step` with explicit cycles.
4. Apply writes.
   - Use `set_input(s)` for X-domain input behavior.
   - Use `write_variable(s)` for memory/output variables and direct overrides.
5. Validate and report.
   - Compare expected values against `runtime state`.
   - Include `metrics.totalScans`, `metrics.lastScanDurationMs`, and key variable values in the report.
6. Reset state at the end of scenarios.
   - Call `plc_runtime_reset` or `POST /runtime/reset` to avoid cross-test contamination.

## Resources

- API map and payload examples:
  - `references/runtime-api.md`
- REST smoke script:
  - `scripts/rest_smoke.sh`

## Operating Rules

1. Prefer MCP tools when an LLM agent is the caller.
2. Fall back to REST for reproducible shell-based diagnostics.
3. Do not start scans before loading a project model.
4. Use `step` instead of `start` for deterministic assertion tasks.
5. Include absolute endpoint, request body, and observed state in failure reports.

## Troubleshooting

1. If `runtime.state` does not change, verify `project.load` was called and `step/start` executed.
2. If `step` fails with running-state errors, stop runtime first.
3. If MCP is unavailable, call REST endpoints directly and capture raw JSON responses.
