# Release and Versioning Policy

## Versioning Model
- Semantic Versioning (`MAJOR.MINOR.PATCH`) is used.
- Version numbers are managed by `release-please`.

Bump policy from Conventional Commits:
- `feat:` -> MINOR
- `fix:` -> PATCH
- `!` suffix or `BREAKING CHANGE:` footer -> MAJOR
- `docs:`, `chore:`, `test:`, `ci:` do not bump unless configured otherwise

## Release Flow
1. Contributors merge PRs into `main` using Conventional Commits.
2. `release-please` opens or updates a release PR that includes:
   - `package.json` version bump
   - `CHANGELOG.md` update
3. Merge the release PR.
4. GitHub release and tag are created automatically.
5. `release-artifact` workflow builds `plc-emu-<tag>.vsix` and uploads it to the release.

## Hotfix Flow
1. Create hotfix branch from `main`.
2. Apply fix with `fix:` commit.
3. Merge PR to `main` with CI green.
4. Let `release-please` generate patch release PR.

## Commit Message Requirements
Use Conventional Commits:
- `feat(runtime): add ...`
- `fix(plcopen): handle ...`
- `docs: update ...`

Include breaking notes when needed:

```text
feat!: replace runtime API

BREAKING CHANGE: runtime.start now requires scanTimeMs.
```

## Manual Recovery
If automated release metadata drifts:
- correct `.release-please-manifest.json` and `package.json` in a dedicated `chore:` PR
- re-run `Release Please` workflow
