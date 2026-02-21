# Runtime MCP + REST サーバーガイド

`plc-emu` には JSON-RPC ホストとは別に、FastMCP ベースの MCP/REST サーバー実装があります。  
このサーバーは 1 つのランタイム状態を MCP tools と REST API の両方から操作できます。

## 起動

```bash
npm run host:mcp
```

デフォルト:

- Host: `127.0.0.1`
- Port: `8124`
- MCP endpoint: `/mcp`
- REST base: `/api/v1`

オプション:

```bash
npm run host:mcp -- --port=9000 --host=127.0.0.1 --endpoint=/mcp
```

環境変数でも指定可能です。

- `PLC_MCP_PORT`
- `PLC_MCP_HOST`
- `PLC_MCP_ENDPOINT`

## MCP Tools

- `plc_runtime_project_load`
- `plc_runtime_start`
- `plc_runtime_stop`
- `plc_runtime_step`
- `plc_runtime_reset`
- `plc_runtime_get_state`
- `plc_runtime_get_metrics`
- `plc_runtime_list_variables`
- `plc_runtime_write_variable`
- `plc_runtime_write_variables`
- `plc_runtime_set_input`
- `plc_runtime_set_inputs`

すべての tool は JSON 文字列を返します（エージェント側で JSON として再解釈可能）。

## MCP Resources

- `resource://plc-runtime/state`
- `resource://plc-runtime/metrics`

## REST API

- `GET /api/v1`
- `GET /api/v1/health`
- `GET /api/v1/runtime/state?includeIo=true`
- `GET /api/v1/runtime/variables`
- `GET /api/v1/runtime/metrics`
- `POST /api/v1/runtime/start`
- `POST /api/v1/runtime/stop`
- `POST /api/v1/runtime/step`
- `POST /api/v1/runtime/reset`
- `POST /api/v1/runtime/variables/write`
- `POST /api/v1/runtime/variables/write-batch`
- `POST /api/v1/io/inputs/set`
- `POST /api/v1/io/inputs/set-batch`
- `POST /api/v1/project/load`

## 例

```bash
curl http://127.0.0.1:8124/api/v1/health
curl -X POST http://127.0.0.1:8124/api/v1/runtime/start -H "Content-Type: application/json" -d '{"scanTimeMs":50}'
curl http://127.0.0.1:8124/api/v1/runtime/state
curl -X POST http://127.0.0.1:8124/api/v1/io/inputs/set -H "Content-Type: application/json" -d '{"identifier":"X0","value":true}'
```
