# Contributing

## Prerequisites
- Node.js LTS
- npm
- VS Code 1.89+
- GitHub CLI (`gh`) authenticated for PR workflows

## Local Setup
```bash
npm install
npm run verify
```

## Branching and Commit Flow
1. Create a branch from `main`:
```bash
git checkout -b codex/<topic>
```
2. Make one logical change at a time.
3. Commit with Conventional Commits:
```bash
git add <files>
git commit -m "feat(scope): short description"
```
4. Re-run quality checks:
```bash
npm run verify
```
5. Push your branch:
```bash
git push -u origin codex/<topic>
```

## Pull Request Flow (GitHub CLI)
```bash
gh pr create --base main --head codex/<topic> --fill
gh pr checks --watch
gh pr view --web
```

PR checklist:
- CI is green
- change summary is clear
- testing commands are listed
- screenshots attached for UI changes
- configuration impacts (`plcEmu.*`) documented

## Coding and Test Expectations
- Follow strict TypeScript patterns and naming conventions from `AGENTS.md`.
- Add or update tests for behavioral changes.
- Keep fixtures minimal and deterministic.
- Do not commit generated output in `out/` or `.plc/`.

## Release and Versioning
Release and versioning are automated via GitHub Actions and `release-please`.
See:
- `docs/release-versioning.md`
- `docs/ci-cd.md`
