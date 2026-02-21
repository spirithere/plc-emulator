# Repository Guidelines

## Project Structure & Module Organization
- VS Code activation is in `src/extension.ts`; core modules sit in `src/services` (PLCopen), `src/runtime` (emulator + host), `src/io` (I/O sim), `src/hmi` (designer/runtime), and `src/views` (tree + webviews).
- Webview assets live in `media/` (for example `media/ladder`, `media/runtime-controls`) and should mirror their controller names.
- ST language support is defined in `syntaxes/`, `language-configuration.json`, and `snippets/`.
- Examples and sample PLCopen/HMI files are under `examples/`; JSON schemas in `schemas/`.
- Tests reside in `test/` with fixtures in `test/fixtures/`; TypeScript output goes to `out/` (generated, avoid manual edits).

## Build, Test, and Development Commands
- `npm install` - install dependencies.
- `npm run compile` - strict TypeScript build to `out/`; required before packaging/host runs.
- `npm run watch` - incremental rebuild while developing.
- `npm test` - Vitest suite (unit + light integration).
- `npm run verify` - canonical local quality gate (`compile` + `test`).
- `npm run host` - start the external runtime host for `plcEmu.runtimeMode: "external"`.
- `npm run plcrun -- <cmd>` - send ad-hoc JSON-RPC to a running host.
- Debugging: open in VS Code and press `F5` to launch the Extension Development Host.

## Coding Style & Naming Conventions
- Language: strict TypeScript, CommonJS modules; 2-space indentation; prefer `const`/`let` and async/await.
- Exports: prefer named exports; minimize module-level state.
- Naming: `PascalCase` for types/classes, `camelCase` for functions/vars, descriptive file names matching the main export (`plcopenService.ts`, `emulator.ts`).
- Webview code-behind in `src/...` should align with the sibling `media/` folder; keep UI strings and IDs centralized.

## Testing Guidelines
- Tests are `*.test.ts` mirroring source areas (for example `test/plcopenService.test.ts`).
- Use or extend `test/fixtures/` for PLCopen/HMI samples; keep fixtures minimal and representative.
- For runtime/host flows, avoid timers when possible; stub VS Code APIs via `test/vscodeMock.ts`.
- Run `npm run verify` before pushing.
- Remove temporary `it.only` / `vi.only` before commit.

## Git Branching & Commit Rules
- Branch from `main` using a short topic name.
- Branch naming: `codex/<topic>` for AI-assisted work, otherwise `<type>/<topic>`.
- Keep commits focused and small. Commit logical units separately.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, optional scope like `feat(hmi): ...`).
- Avoid committing generated workspace artifacts such as `.plc/` mirrors.

## GitHub CLI Workflow (`gh`)
1. Check auth and remote once per session:
   - `gh auth status`
   - `git remote -v`
2. Create and switch branch:
   - `git checkout -b codex/<short-topic>`
3. Stage and commit by logical step:
   - `git add <files>`
   - `git commit -m "<conventional-commit-message>"`
4. Push branch:
   - `git push -u origin codex/<short-topic>`
5. Create PR from CLI:
   - `gh pr create --base main --head codex/<short-topic> --fill`
6. Watch CI and review status:
   - `gh pr checks --watch`
   - `gh pr view --web`
7. Address review comments with additional focused commits (no force-push unless explicitly needed).

## Pull Request Expectations
- Summarize behavior changes and operational impact.
- List verification commands that were run (`npm run verify`, and relevant manual checks).
- Attach screenshots/gifs for UI/webview changes.
- Link related issues and note configuration changes (`plcEmu.*`).
- Keep PRs reviewable; split very large work into multiple PRs when possible.

## CI/CD, Release, and Versioning Rules
- CI must pass on every PR and push to `main`.
- Versioning follows SemVer and is automated by `release-please` from Conventional Commit history.
- Human-authored release notes may be added, but `CHANGELOG.md` is source-of-truth in-repo.
- Release artifacts (VSIX) are produced by GitHub Actions on published releases.
- See `docs/ci-cd.md` and `docs/release-versioning.md` for operational details.

## Security & Configuration Tips
- `.plc/` holds mirrored ST/HMI files; treat as ephemeral and git-ignored.
- Key settings: `plcEmu.projectFile`, `plcEmu.scanTimeMs`, `plcEmu.profileId`, `plcEmu.runtimeMode`, `plcEmu.hmiFile`; document default changes in PRs.
- External host binds `127.0.0.1:8123` by default; avoid widening without review.
