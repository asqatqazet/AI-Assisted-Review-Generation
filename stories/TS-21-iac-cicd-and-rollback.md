# TS-21 · IaC, CI/CD via OIDC, rollback drill

**Scope:** ops · **Size:** L · **TDD:** not applicable · **Depends on:** TS-01

## Story

As an engineer with four days, I need the system deployed and redeploying on push from day one, so that
deployment is a solved problem on day four instead of the reason the submission is incomplete.

## Context

**Run this on day one, immediately after TS-01.** Late AWS is the most common way this assignment fails.
A walking skeleton on a public URL by the end of day one is worth more than any feature.

## Acceptance criteria

**Infrastructure**
- [ ] `infra/terraform/student/` — the scale-to-zero topology from `01-SYSTEM-DESIGN.md` §10:
      Amplify Hosting for `web`, Lambda + Function URL for `context-service`, Lambda + Function URL with
      response streaming for `generation-service`, scale-to-zero Postgres, SSM Parameter Store for
      secrets, S3 for manifests
- [ ] `infra/terraform/production/` — the same system on RDS `t4g` with provisioned concurrency, applied
      to no environment but **committed and valid** (`terraform validate` in CI)
- [ ] An AWS Budgets alarm at $10, created by Terraform
- [ ] IAM roles least-privilege per service; no shared execution role

**Pipeline**
- [ ] GitHub Actions → **OIDC** to AWS; no long-lived access keys anywhere
- [ ] Pipeline: `pnpm verify` → build → deploy → smoke test against the deployed URL
- [ ] Lambda deployed behind an **alias**; deploy shifts the alias
- [ ] Amplify branch deploys; a preview per pull request if free tier allows

**Rollback**
- [ ] `docs/RUNBOOK.md`: rollback by re-pointing the Lambda alias and reverting the Amplify build; how to
      find a generation by id and reconstruct its inputs; how to disable a tenant; how to rotate a
      provider key; what each alarm means
- [ ] **The drill is performed for real**: deploy a deliberately broken build to the non-production stack,
      observe the smoke test fail, roll back, and record the actual commands and timestamps in the runbook

## Technical notes

- Two Terraform variants is the flex. It shows the student-budget topology is a *choice* under a stated
  constraint rather than the only thing you knew how to build.
- OIDC over stored keys costs twenty minutes and is a real security signal — long-lived AWS keys in
  repository secrets is the single most common finding in submissions like this.
- The rollback drill is the deliverable. A runbook nobody has executed is fiction, and the recorded
  timestamps are what make it credible.

## Definition of done — extra

`REVIEW.md` links the live survey URL, the live console URL, and the recorded rollback.

## Harness prompt

```
Read stories/TS-21-iac-cicd-and-rollback.md, 01-SYSTEM-DESIGN.md §10, and docs/adr/ADR-003-topology.md
together with the A1-A6 decision ADRs. Do not start until those ADRs exist — this story implements a
topology, and implementing one that has not been argued is how the heaviest-weighted pillar gets lost.

Build the AWS topology in Terraform, two variants.

infra/terraform/student is the one that gets applied: Amplify Hosting for web, Lambda plus Function URL
for context-service, Lambda plus Function URL with response streaming for generation-service,
scale-to-zero Postgres, SSM Parameter Store for secrets, S3 for plugin manifests, and an AWS Budgets
alarm at $10. Least-privilege IAM per service — no shared execution role.

infra/terraform/production is the same system on RDS t4g with provisioned concurrency. It is applied to
nothing but must be committed and pass terraform validate in CI. It exists to show the student topology
is a choice under a stated constraint, not the limit of what I can build.

Then the pipeline: GitHub Actions authenticating to AWS via OIDC, with no long-lived access keys
anywhere. Run pnpm verify, build, deploy, then smoke test the deployed URL. Deploy Lambda behind an alias
so rollback is an alias shift.

Finally write docs/RUNBOOK.md and then actually perform the drill: deploy a deliberately broken build to
the non-production stack, watch the smoke test fail, roll it back, and record the real commands and
timestamps in the runbook. A runbook nobody has executed is fiction.
```
