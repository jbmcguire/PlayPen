# Plan 005: Add public-repo contributor scaffolding and tidy internal docs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5857287..HEAD -- .github CONTRIBUTING.md README.md PLAN.md OPENAI_SUBMISSION.md`
> If these changed since this plan was written, re-read them before proceeding.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx / docs
- **Planned at**: commit `5857287`, 2026-06-12
- **Issue**: —

## Why this matters

The repo just went public at github.com/jbmcguire/PlayPen. External contributors
can now open issues and PRs, but `.github/` contains only `ci.yml` — there are no
issue or PR templates to guide them, so reports will arrive without the
environment details (storage driver, Node version, deployment context) that make
them actionable, and PRs won't be reminded to run the verification commands.
Separately, `CONTRIBUTING.md` omits two checks contributors should know about
(`npm run doctor`, `npm run verify`), and several internal planning documents sit
in the public root reading as internal roadmap. None of this is a defect, but all
of it shapes the first impression of a public project and the quality of inbound
contributions. This plan is pure additive scaffolding plus small doc edits — no
code behavior changes.

## Current state

- `.github/` contains only `workflows/ci.yml`. No `ISSUE_TEMPLATE/`, no
  `PULL_REQUEST_TEMPLATE.md`.
- `SECURITY.md` and `CODE_OF_CONDUCT.md` **already exist** at the repo root — do
  not recreate them.
- `CONTRIBUTING.md` "Development Setup" lists `npm run check`, `npm test`,
  `npm run smoke`, `npm run start` but not `npm run doctor`; "Before Opening a
  PR" lists check/test/smoke/demo and `git diff --check` but not `npm run verify`.
- The canonical verification commands (verified during recon, all run from
  `PlayPen/Hosted`): `npm run check`, `npm test`, `npm run smoke`, `npm run demo`,
  `npm run doctor`, `npm run verify -- --service <url>`.
- Internal-leaning docs in the public root: `PLAN.md` (implementation plan),
  `OPENAI_SUBMISSION.md` (submission narrative). The untracked `playpen-plan.html`
  is already git-ignored (see `.gitignore`) — do **not** add it to git.

**Repo conventions to honor**: Markdown docs, plain and concise. Conventional
commits. Do not introduce dependencies or CI changes.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Confirm templates parse as files | `ls .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE.md` | both listed |
| Confirm CI still valid (no edit, just sanity) | `cat .github/workflows/ci.yml` | unchanged |

> This plan changes only Markdown/template files; there is no build or test gate.
> Do not run `npm` installs.

## Scope

**In scope** (create/edit only these):
- `.github/PULL_REQUEST_TEMPLATE.md` (create)
- `.github/ISSUE_TEMPLATE/bug_report.md` (create)
- `.github/ISSUE_TEMPLATE/feature_request.md` (create)
- `.github/ISSUE_TEMPLATE/config.yml` (create — routes security reports to SECURITY.md)
- `CONTRIBUTING.md` (small edits: add `doctor` and `verify`)
- `PLAN.md` and `OPENAI_SUBMISSION.md` (add a one-line "internal/reference"
  preamble each — see Step 5; do NOT move or delete them)

**Out of scope** (do NOT touch):
- `.github/workflows/ci.yml` — CI is correct; no changes.
- `SECURITY.md`, `CODE_OF_CONDUCT.md` — already exist.
- `README.md` — its content was reviewed separately and is in good shape; this
  plan does not edit it.
- `playpen-plan.html` — git-ignored on purpose; leave untracked.
- Any source code.

## Git workflow

- Branch: `advisor/005-public-repo-scaffolding`
- Commit style: conventional commits. Suggested:
  `docs: add issue/PR templates and contributor verification commands`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: PR template

Create `.github/PULL_REQUEST_TEMPLATE.md` with a summary section and a checklist
that mirrors `CONTRIBUTING.md`'s "Before Opening a PR" (run from
`PlayPen/Hosted`): `npm run check`, `npm test`, `npm run smoke`,
`npm run demo` (when CLI/verifier/sample/handoff behavior changes), `git diff --check`,
and a reminder to update `README`/`openapi.json`/`verify-host.js` when external
routes change, and the native Xcode build when Swift changes. Keep it short.

**Verify**: `test -f .github/PULL_REQUEST_TEMPLATE.md` → exit 0.

### Step 2: Bug report template

Create `.github/ISSUE_TEMPLATE/bug_report.md` with YAML front matter
(`name`, `about`, `title`, `labels: bug`) and fields prompting for: which surface
(hosted service / CLI / native app), storage driver (filesystem / S3) and Node
version if hosted, deployment context (local / reverse proxy / S3 host), steps to
reproduce, expected vs actual, and relevant logs.

**Verify**: `test -f .github/ISSUE_TEMPLATE/bug_report.md` → exit 0.

### Step 3: Feature request template

Create `.github/ISSUE_TEMPLATE/feature_request.md` with front matter
(`labels: enhancement`) prompting for: problem/motivation, proposed surface
(API route / CLI / native), and whether it affects the agent contract in
`AGENTS.md`.

**Verify**: `test -f .github/ISSUE_TEMPLATE/feature_request.md` → exit 0.

### Step 4: Issue template config routing security reports

Create `.github/ISSUE_TEMPLATE/config.yml` that disables blank issues and adds a
contact link pointing security reports to the existing policy:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Security vulnerability
    url: https://github.com/jbmcguire/PlayPen/security/advisories/new
    about: Please report security issues privately. See SECURITY.md — do not open a public issue.
```

**Verify**: `test -f .github/ISSUE_TEMPLATE/config.yml` → exit 0.

### Step 5: CONTRIBUTING edits

In `CONTRIBUTING.md`:
- Under "Development Setup" → "Hosted service", add `npm run doctor` to the
  command list (it validates environment defaults).
- Under "Before Opening a PR", add a bullet:
  `Run \`npm run verify -- --service http://127.0.0.1:4177\` against a local host (optional but encouraged).`

**Verify**: `grep -c "npm run doctor" CONTRIBUTING.md` → ≥1 and
`grep -c "npm run verify" CONTRIBUTING.md` → ≥1.

### Step 6: Mark the internal docs as reference (do not move them)

Add a single italicized preamble line at the very top of `PLAN.md` and
`OPENAI_SUBMISSION.md` so readers understand they are working/reference documents,
not user-facing guarantees. Example for `PLAN.md`:

```markdown
> _Internal implementation plan and progress log — reference material, not a user-facing roadmap. See [README.md](README.md) for current capabilities._
```

And for `OPENAI_SUBMISSION.md`:

```markdown
> _Submission narrative for an agent-tooling program — reference context, not product documentation. See [README.md](README.md) for current capabilities._
```

Do NOT relocate or delete these files — a relocation would break existing links
from `README.md` ("Repository Layout" references `PLAN.md` and
`OPENAI_SUBMISSION.md`).

**Verify**: `head -1 PLAN.md | grep -c "Internal"` → 1 and
`head -1 OPENAI_SUBMISSION.md | grep -c "Submission narrative"` → 1.

## Test plan

No automated tests apply (Markdown/templates only). Verification is the
file-existence and `grep` checks in each step. For the human reviewer: after
merge and push, GitHub renders the templates when opening a new issue/PR — confirm
the security contact link routes away from public issues.

## Done criteria

ALL must hold:

- [ ] `.github/PULL_REQUEST_TEMPLATE.md` exists
- [ ] `.github/ISSUE_TEMPLATE/bug_report.md`, `feature_request.md`, and `config.yml` exist
- [ ] `grep -c "npm run doctor" CONTRIBUTING.md` ≥ 1 and `grep -c "npm run verify" CONTRIBUTING.md` ≥ 1
- [ ] `head -1 PLAN.md` and `head -1 OPENAI_SUBMISSION.md` each show the reference preamble
- [ ] `.github/workflows/ci.yml` is unchanged (`git diff --stat` shows it not modified)
- [ ] No source files modified (`git status` shows only docs/.github/plans)
- [ ] `plans/README.md` status row for 005 updated

## STOP conditions

Stop and report if:

- `SECURITY.md` or `CODE_OF_CONDUCT.md` turn out **not** to exist (they should) —
  report rather than authoring them here; their content is a maintainer decision.
- `README.md` does not actually link `PLAN.md`/`OPENAI_SUBMISSION.md` and you were
  about to move them anyway — don't; moving is out of scope regardless.
- The repo URL in the security contact link differs from
  `github.com/jbmcguire/PlayPen` (check `git remote -v`) — use the actual remote.

## Maintenance notes

- If the project later adds GitHub issue **forms** (YAML `.github/ISSUE_TEMPLATE/*.yml`
  with structured fields), they supersede the Markdown templates here.
- Reviewer: verify the `config.yml` security link points at the repo's real
  advisories endpoint so vulnerability reports never land in public issues.
- Deferred: deciding whether `PLAN.md`/`OPENAI_SUBMISSION.md` belong in a
  `docs/internal/` folder long-term — left as a maintainer call; this plan only
  labels them.
