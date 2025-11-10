# PLC Emulator VS Code Extension (Prototype)

This repository hosts an early PLC emulator prototype built as a VS Code extension. It focuses on:

- Editing PLCopen XML projects while keeping Structured Text (ST) and ladder diagrams synchronized with a single source of truth.
- Visual ladder editing inside a webview.
- A lightweight IEC-style scan cycle emulator for rapid feedback.

## Getting Started

```bash
npm install
npm run compile
npm test
```

### External Runtime Host (experimental)

Set `"plcEmu.runtimeMode": "external"` in your VS Code settings to run the IEC scan cycle in a standalone Runtime Host process. The extension will spawn the host automatically, but you can also run it manually via `npm run host`. The host exposes both stdio and a TCP socket (default `127.0.0.1:8123`), so VS Code and external agents can connect simultaneously. For quick ad‑hoc commands use `npm run plcrun -- <command>` (e.g., `npm run plcrun -- ping`). See `docs/runtime-host-cli.md` for the JSON-RPC protocol and automation tips.

Open the folder in VS Code and press `F5` to launch the extension host. Once running:

1. Run **PLC Emulator: Open PLCopen Project** to select or initialize a PLCopen XML file.
2. Use **PLC Emulator: Edit Structured Text Block** to mirror an ST block into `.plc/st/<POU>.st` for editing.
3. Open the ladder editor via **PLC Emulator: Open Ladder Editor** and edit rungs visually.
4. Use the **PLC Emulator** activity bar view to browse POUs and trigger runtime controls (run/stop, open ladder/I/O panels, switch profiles).
5. Simulate field I/O with **PLC Emulator: Open I/O Simulator** and toggle digital inputs feeding the emulator.
6. Switch dialect behavior via **PLC Emulator: Switch Dialect Profile** (IEC baseline or sample vendor variants).
7. Start/stop execution with **PLC Emulator: Run Program** / **Stop Program**. Output streams to the *PLC Emulator* channel and a status-bar item shows scan timing.

## Folder Structure

- `src/extension.ts` — activation entry point and command wiring.
- `src/services/plcopenService.ts` — PLCopen XML parsing/serialization with default models.
- `src/ladder/ladderPanel.ts` & `media/ladder` — ladder editor webview assets.
- `src/runtime/emulator.ts` — simple scan-cycle interpreter for ST + ladder plus I/O hooks.
- `src/io/` — digital I/O simulation service + panel webview assets under `media/io-sim`.
- `src/runtime/profileManager.ts` — prototype profile abstraction for vendor dialects.
- `src/views/` & `media/runtime-controls` — sidebar tree + runtime control views.
- `media/ladder` — ladder editor webview with IEC-style preview + editing controls.
- `test/` — Vitest unit tests for the PLCopen service and emulator controller.
- `syntaxes/` & `language-configuration.json` — syntax highlighting for ST files.
- `.plc/` — generated mirror files for ST editing (ignored by git).
- `examples/` — PLCopen XML samples including `self-hold.plcopen.xml` for latch testing.

## Limitations

- The PLCopen conversion layer currently supports a simplified schema subset.
- The ladder editor models series contacts/coils only.
- The emulator executes straight-line assignments and basic ladder logic. Complex instructions/function blocks are placeholders for future milestones.

Track implementation progress via `docs/implementation-plan.md`.

## HMI (Designer & Runtime)

An experimental HMI editor and runtime are included:

- Open the HMI Launcher from the activity bar under the PLC Emulator view named `HMI`, or run commands:
  - `PLC Emulator: Open HMI Designer`
  - `PLC Emulator: Open HMI Runtime`
- HMI layout and bindings are stored in a workspace-relative JSON file controlled by the `plcEmu.hmiFile` setting (defaults to `.plc/hmi.json`).
- JSON Schema validation is bundled and auto-applies to `hmi.json` files. See `schemas/hmi.schema.json` and the design notes in `docs/hmi-implementation-plan.md`.
- A starter `examples/sample-hmi.json` is provided. Use the HMI launcher’s “Open hmi.json” to create one from the sample if missing.

HMI MVP widgets: button, switch, slider, numeric, lamp, text, motor, cylinder. Designer supports drag, snap-to-grid, resize; Runtime binds to IO and variables.
