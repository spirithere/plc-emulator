# CI/CD Pipeline

## Overview
This repository uses GitHub Actions for CI and release automation.

## Workflows

### 1. CI (`.github/workflows/ci.yml`)
Trigger:
- pull requests
- pushes to `main`
- manual dispatch

Checks:
- `npm ci`
- `npm run verify` (`compile` + `test`)

### 2. PR Title Lint (`.github/workflows/pr-title.yml`)
Trigger:
- PR open/edit/synchronize/reopen

Rule:
- PR title must follow Conventional Commits style (for example `feat: ...`, `fix: ...`, `docs: ...`).

### 3. Release Please (`.github/workflows/release-please.yml`)
Trigger:
- pushes to `main`
- manual dispatch

Behavior:
- reads commit history (Conventional Commits)
- opens/updates a release PR with version bump and changelog update
- after release PR merge, creates GitHub release/tag

### 4. Release Artifact (`.github/workflows/release-artifact.yml`)
Trigger:
- GitHub release published
- manual dispatch

Behavior:
- installs dependencies
- runs `npm run verify`
- builds VSIX package
- uploads VSIX to the GitHub release assets

## Required Repository Settings
- Enable GitHub Actions.
- Protect `main` branch and require CI checks.
- Keep `GITHUB_TOKEN` default permissions sufficient for contents and pull requests write (used by release workflows).

## Failure Handling
- CI failures block merge.
- Release workflow failures should be fixed on the release branch or by re-running workflow after corrective commit.
- Artifact workflow failures do not roll back the tag; re-run after fixing packaging issues.
