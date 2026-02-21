# Runtime API Reference

## Endpoints

- MCP: `http://127.0.0.1:8124/mcp`
- REST base: `http://127.0.0.1:8124/api/v1`

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

## REST Routes

- `GET /health`
- `GET /runtime/state`
- `GET /runtime/variables`
- `GET /runtime/metrics`
- `POST /project/load`
- `POST /runtime/start`
- `POST /runtime/stop`
- `POST /runtime/step`
- `POST /runtime/reset`
- `POST /runtime/variables/write`
- `POST /runtime/variables/write-batch`
- `POST /io/inputs/set`
- `POST /io/inputs/set-batch`

## JSON Examples

Load model:

```json
{
  "pous": [],
  "ladder": [
    {
      "id": "r0",
      "elements": [
        { "id": "c0", "label": "X0", "type": "contact", "variant": "no" },
        { "id": "y0", "label": "Y0", "type": "coil" }
      ]
    }
  ],
  "configurations": []
}
```

Step execution:

```json
{
  "cycles": 1
}
```

Set input:

```json
{
  "identifier": "X0",
  "value": true
}
```

Write variable:

```json
{
  "identifier": "M0",
  "value": true
}
```
