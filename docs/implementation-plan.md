# PLC Emulator VS Code Extension Implementation Plan

## 1. Goal & Scope
- Build a VS Code extension that lets users author PLC programs using Structured Text (ST) and ladder diagrams (LD) stored in PLCopen XML.
- Provide a visual ladder editor, ST editing via native VS Code text capabilities, and an emulator that executes IEC 61131-3 compliant logic (extensible for vendor dialects later).

## 2. Guiding Principles & Assumptions
1. PLCopen XML is the single source of truth; editors read/write to it.
2. First release targets IEC 61131-3 baseline behavior; dialect-specific behavior is pluggable via profiles.
3. Extension should run fully offline, using WebAssembly/Node runtime for execution when possible.
4. Modular architecture to swap parsers, renderers, and runtime backends without rewriting the UI shell.

## 3. High-Level Architecture
| Layer | Responsibilities |
| --- | --- |
| VS Code Extension Host | Activation, commands, tree/views, message routing between UI and backend. |
| Data Layer | PLCopen XML parser/serializer, project graph, validation. |
| Editors | ST text editor enhancements + Ladder visual editor (Webview). |
| Runtime/Emulator | IEC execution engine, I/O simulation, debugging hooks. |
| Integration | Sync between editors and runtime; file watching; profile management. |

### 3.1 Module Breakdown
- `extension-core`: activation, command registration, configuration management, PLC project workspace handling.
- `plcopen-service`: parse/generate PLCopen XML, maintain in-memory model, diffing, validation.
- `st-language-support`: syntax highlighting, snippets, diagnostics, go-to-definition via language server features if needed.
- `ladder-webview`: webview panel leveraging canvas/SVG React app for ladder editing.
- `emulator-engine`: interpreter or compiled runtime for ST + LD, built around IEC execution model with scan cycles.
- `profile-manager`: manage IEC default vs vendor dialect overrides (future).

## 4. Detailed Feature Plan
### 4.1 Workspace & Project Handling
- Detect PLC projects (folder with `project.plcopen.xml`).
- Provide commands to create/open PLC projects.
- Watch filesystem changes to keep in-memory model synced.

### 4.2 PLCopen XML Management
- Use XML DOM + schema validation.
- Maintain AST-like model for POUs, tasks, programs, resources.
- Expose model services to editors/runtime.
- Provide import/export commands.

### 4.3 Structured Text Support
- Reuse VS Code text capabilities; add syntax grammar (tmLanguage) and color theme contributions.
- Provide snippets/templates for common ST constructs.
- Diagnostics: parse ST blocks from PLCopen XML; surface via Problems panel.
- Optional: language server (later) for semantic features.

### 4.4 Ladder Editor (Webview)
- React + TypeScript front-end rendered in VS Code webview.
- Canvas/SVG grid supporting drag/drop of contacts, coils, function blocks.
- Serialization to/from PLCopen XML LD sections.
- Editing affordances: rung insert/delete, copy/paste, undo/redo.
- Zoom/pan, alignment helpers.

### 4.5 Emulator & Execution Flow
- Runtime engine processes PLCopen model -> builds execution graph.
- Implements deterministic scan cycle (initialize, input processing, execution, output update).
- Provide watch window, breakpoints, step/scan controls via VS Code UI.
- I/O simulation: digital/analog channels, timers, counters.
- Execution runs inside Node worker/WebAssembly for isolation.

### 4.6 Extensibility for Vendor Dialects
- Abstract instruction set definitions; IEC profile as default JSON descriptor.
- Plugin mechanism to register vendor add-ons (custom function blocks, timing behaviors).
- Configuration UI to switch dialect profiles per workspace.

### 4.7 Testing & Tooling
- Unit tests for PLCopen parser, runtime, ladder serialization.
- Integration tests for extension activation and command flow (using `vscode-test`).
- Snapshot tests for ladder editor UI (Storybook or Jest + jsdom).

## 5. Milestones & Deliverables
 1. **Foundation (Week 1-2)**
   - Scaffold VS Code extension project.
   - Basic command palette entries; hello-world activation.
   - PLCopen file detection + simple parser prototype.
2. **Editing Core (Week 3-5)**
   - ST grammar/snippets + PLCopen serialization.
   - Ladder webview skeleton with load/save of simple rungs.
3. **Execution Engine (Week 6-8)**
   - Implement IEC scan cycle interpreter for ST + LD subset.
   - Provide run/stop controls, live variable watch.
 4. **Polish & Extensibility (Week 9-10)**
   - Improve ladder UX, undo/redo, validation, and add branching/parallel logic editing.
   - Add profile manager scaffolding for vendor dialects and a control-side bar for execution tooling.
   - Documentation + packaging for marketplace preview with sample PLCopen projects.

## 6. Risks & Mitigations
- **Complex ladder editing UX**: start with minimal feature set and gather feedback; leverage existing open-source ladder renderers for reference.
- **PLCopen schema complexity**: adopt existing schema validation libraries; keep converters well-tested.
- **Performance of emulator**: optimize data structures; consider WebAssembly backend if JS interpreter is slow.
- **Keeping ST & LD in sync**: enforce single source of truth (PLCopen) with change events + validation before writes.

## 7. Progress Checklist
- [x] Extension scaffolding created (Yo Code or manual setup)
- [x] Command palette flows for project detection implemented
- [x] PLCopen XML parser and serializer (tests pending)
- [x] Structured Text grammar and snippets wired into VS Code
- [x] Ladder webview renders and edits basic rungs
- [x] Data synchronization between PLCopen model and editors
- [x] Emulator executes IEC scan cycle for ST + LD
- [x] I/O simulation panel and runtime controls
- [x] Vendor profile abstraction layer stub
- [x] Packaging + documentation for preview release
- [ ] Activity side bar with POU tree + runtime controls
- [ ] Ladder editor branching/parallel rail editing

## 8. Next Steps
- Confirm tooling stack (TypeScript + React + testing frameworks).
- Decide on persistence model for ladder diagrams (direct PLCopen vs intermediate model).
- Begin milestone 1 tasks and keep checklist updated per commit.
