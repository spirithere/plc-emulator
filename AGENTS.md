# Repository Guidelines

## Project Structure & Module Organization
- VS Code activation is in `src/extension.ts`; core modules sit in `src/services` (PLCopen), `src/runtime` (emulator + host), `src/io` (I/O sim), `src/hmi` (designer/runtime), and `src/views` (tree + webviews).
- Webview assets live in `media/` (e.g., `media/ladder`, `media/runtime-controls`) and should mirror their controller names.
- ST language support is defined in `syntaxes/`, `language-configuration.json`, and `snippets/`. Examples and sample PLCopen/HMI files are under `examples/`; JSON schemas in `schemas/`.
- Tests reside in `test/` with fixtures in `test/fixtures/`; TypeScript output goes to `out/` (generated—avoid manual edits).

## Build, Test, and Development Commands
- `npm install` — install dependencies.
- `npm run compile` — strict TypeScript build to `out/`; required before packaging/host runs.
- `npm run watch` — incremental rebuild while developing.
- `npm test` — Vitest suite (unit + light integration).
- `npm run host` — start the external runtime host for `plcEmu.runtimeMode: "external"`.
- `npm run plcrun -- <cmd>` — send ad-hoc JSON-RPC to a running host.
- Debugging: open in VS Code and press `F5` to launch the Extension Development Host.

## Coding Style & Naming Conventions
- Language: strict TypeScript, CommonJS modules; 2-space indentation; prefer `const`/`let` and async/await.
- Exports: prefer named exports; minimize module-level state.
- Naming: `PascalCase` for types/classes, `camelCase` for functions/vars, descriptive file names matching the main export (`plcopenService.ts`, `emulator.ts`).
- Webview code-behind in `src/...` should align with the sibling `media/` folder; keep UI strings and IDs centralized.

## Testing Guidelines
- Tests are `*.test.ts` mirroring source areas (e.g., `test/plcopenService.test.ts`).
- Use or extend `test/fixtures/` for PLCopen/HMI samples; keep fixtures minimal.
- For runtime/host flows, avoid timers when possible; stub VS Code APIs via `test/vscodeMock.ts`.
- Run `npm test` pre-push; remove temporary `it.only`/`vi.only`.

## Commit & Pull Request Guidelines
- Use Conventional Commits (`feat:`, `fix:`, `chore:`, scope optional such as `feat(hmi): …`).
- PRs should summarize behavior changes, list test commands run, and attach screenshots/gifs for webview or UI updates.
- Link related issues, call out config impacts (`plcEmu.*`), and do not commit generated `.plc` mirrors or other workspace artifacts.

## Security & Configuration Tips
- `.plc/` holds mirrored ST/HMI files; treat as ephemeral and git-ignored.
- Key settings: `plcEmu.projectFile`, `plcEmu.scanTimeMs`, `plcEmu.profileId`, `plcEmu.runtimeMode`, `plcEmu.hmiFile`; document default changes in PRs.
- External host binds `127.0.0.1:8123` by default—avoid widening without review.
