# Student deployment operational runbook

This runbook covers the `student-low-quota` assessment deployment in
`eu-central-1`. It is intentionally narrower than a production runbook: the public
deployment uses synthetic data and `FakeProvider`; OpenAI and Gemini are disabled.

The source of truth for resource names is the successful deployment evidence and
the trusted Terraform state. Do not copy function names, URLs, bucket names, or
alias versions from this document.

There are three logical deployables. The student AWS composition releases six
qualified functions: BFF fast, BFF stream, BFF reconciliation, Reviewer Context,
Console Context and Generation. The two Context Lambdas use the same Context
artifact but deliberately have different IAM roles, signing material and database
roles. The current expand phase also retains the old physical Context function and
role as a seventh, dormant rollback resource; it is not a promoted release target,
and the new Reviewer role cannot read its legacy database parameter. The contract
release removes that function and its database bridge together. The unaliased
Fake-only Generation canary is an eighth physical support resource, not a release
alias.
`infra/terraform/student` is the only supported Terraform target;
`infra/terraform/production` is an obsolete scaffold and **must not be applied**.

Capacity is profile-specific. `student-low-quota` requires account and unreserved
concurrency of at least 10 and creates no function reservations. The funded
`reserved-concurrency` profile reserves BFF fast/stream 5/2, Reviewer/Console
Context 4/1 and Generation 1 (13 total); reconciliation and the Fake-only canary
remain unreserved.

## 1. Establish the release you are operating

Use a successful `deploy-student` run from `main` and verify its evidence before
making an operational change:

```bash
RUN_ID=<successful-deploy-run-id>
EVIDENCE_DIR="$(mktemp -d)"

gh run view "$RUN_ID" --repo asqatqazet/AI-Assisted-Review-Generation
gh run download "$RUN_ID" \
  --repo asqatqazet/AI-Assisted-Review-Generation \
  --name student-release \
  --dir "$EVIDENCE_DIR"

(cd "$EVIDENCE_DIR" && shasum -a 256 -c checksums.sha256)
jq . "$EVIDENCE_DIR/release-manifest.json"
jq . "$EVIDENCE_DIR/deployment-outputs.json"
```

The manifest source SHA must equal the successful run's `headSha`. The workflow
also binds the three Lambda artifacts and canonical UI tree digest to that SHA.

## 2. Roll back an application release

Do not manually move one Lambda alias. A release spans the Context handlers,
Generation, the BFF handlers, and the versioned UI prefix; moving only one piece
can produce an incompatible composition.

Run the repository's rollback workflow on `main`:

```bash
gh workflow run rollback-student.yml \
  --repo asqatqazet/AI-Assisted-Review-Generation \
  --ref main \
  -f release_run_id="$RUN_ID"

ROLLBACK_RUN_ID="$(gh run list \
  --repo asqatqazet/AI-Assisted-Review-Generation \
  --workflow rollback-student.yml \
  --branch main \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId')"

gh run watch "$ROLLBACK_RUN_ID" \
  --repo asqatqazet/AI-Assisted-Review-Generation \
  --exit-status
```

The workflow must verify that the selected run was a successful deployment from
this repository's `main`, stage candidate aliases and a candidate UI prefix,
smoke them, promote the complete release, and restore the prior live pointers if
a post-promotion probe fails. Database migrations are forward-only. During the
current expand phase, the release manifest binds the immutable pre-split Context
version, and deployment proves that exact version both before and after migration.
Its legacy `context_svc` login is a bounded rollback bridge; new Context versions
do not receive that database URL. Do not apply the later contract migration that
removes this bridge until the application rollback window has closed.

## 3. Disable paid work or public traffic

`student-low-quota` is already Fake-only. If unexpected traffic or errors threaten
the AWS credit allowance, freeze application execution before investigating:

1. Open the latest successful `deploy-student` run and download
   `deployment-outputs.json`.
2. Use the exact function names recorded by the workflow/Terraform state, never a
   guessed wildcard.
3. Set reserved concurrency to `0` for the public BFF functions and Generation.
4. Disable the EventBridge reconciliation schedule.
5. Preserve logs and release evidence; do not delete the database during triage.

The scheduled `student-cutoff` workflow is the normal cutoff mechanism. A manual freeze
is an incident action, not a substitute for the teardown date.

## 4. Suspend a Tenant

There is no public `PATCH /tenants/...` Context endpoint. Use the authenticated
Operator Console and the Platform Tenant lifecycle command:

1. Sign in through `https://<cloudfront-domain>/console` as an Operator with the
   current Platform capability.
2. Open **Tenants**, select the target Tenant, and set it to **Suspended**.
3. Confirm a reviewer entry request for that Tenant returns the generic unavailable
   response and that no new Generation reservation is created.
4. Record the actor, Tenant ID, release SHA, time, and reason in the incident log.

Do not edit the Tenant row using the migration-owner database credential. That
would bypass the same authorization boundary the incident procedure is meant to
exercise.

## 5. Investigate one Generation

Use identifiers and immutable provenance, not reviewer text in logs:

1. Search the Generation Lambda log group for the exact `generationId` and trace
   ID. Never broaden the query to Draft text, assertions, invitation tokens, or
   session cookies.
2. In the authenticated Console, open the immutable Generation detail. Context
   must authorize the requested Tenant set and Generation must verify the signed,
   short-lived read authorization before its database projection runs.
3. Record the snapshot ID/hash, Prompt Version hash, Review Format identity,
   provider/model identity (`fake` in this deployment), grounding disposition,
   and release SHA.
4. Reproduce locally with the same immutable snapshot and FakeProvider. A
   byte-for-byte model replay is only expected when the recorded fake fixture and
   source inputs are identical.

Raw reviewer-authored content is not an ordinary analytics field. It requires the
separate audited raw-read capability; otherwise projections must redact it.

## 6. Authentication incident and logout behaviour

If an Operator should lose access, revoke/disable the current Access Grant first;
Context rechecks current grants for every Console request. Then disable the
Cognito user if necessary.

Logout is best-effort at Cognito but unconditional locally: the BFF must expire its
own session cookie even when Cognito's revoke endpoint fails, log the upstream
failure without tokens, and continue to the allow-listed Cognito logout URL. A
failed revoke must never leave the local BFF session usable.

## 7. Provider credentials

The strict-zero-budget deployment has no OpenAI or Gemini parameter name, IAM
grant, environment variable, route, or enabled catalogue row. There is therefore
no live provider key to rotate in this profile.

Enabling a paid provider is a separate, owner-approved deployment decision. It
requires a new configuration release, budget reservation/cap tests, provider
credential provisioning, and a rollback exercise. Never run
`aws lambda update-function-configuration --environment Variables=...` for a key
rotation: that replaces the function's environment map and can remove unrelated
required settings.

### Offline Prompt release evaluation

Before promoting a Prompt Version to Candidate, run the checked-in evaluator from
a clean checkout of the release commit:

```bash
DATABASE_URL=<migration-owner-url> pnpm eval:prompt -- \
  --prompt-version-id <immutable-prompt-version-uuid>
```

The command refuses a dirty worktree, derives the actual 40-character release SHA
from `git rev-parse HEAD`, and has no suite-path override. It reads only regular
JSON files under the tracked `evals/golden` tree whose bytes exactly match `HEAD`;
ignored/untracked files and symlinks fail closed. It loads the immutable Prompt
ID/hash/body/action directly from PostgreSQL, composes the scenarios, re-runs the
grounding gate, and appends the full canonical report. The stored document binds
the exact Prompt identity, release SHA, suite manifest hash, per-case scenario and
composed-request hashes, counts, and `reportHash = sha256(canonical report bytes)`.
`DATABASE_URL` must be the migration-owner URL; the Console and runtime database
roles cannot insert evidence. If automation supplies `REVIEW_RELEASE_SHA`, it
must exactly match the checked-out SHA.

The AWS workflow is deliberately two-phase: `seed-student.sql` installs only the
immutable base catalogue and Prompt, then `eval:prompt` appends real release
evidence. After Operator authority exists, `qualify-student-release.ts` binds a
Candidate decision to the latest passing report and publishes the Prompt through
the production Console Draft/publish materializer. The seed never inserts an
Evaluation Result, Candidate, Deployment, or Effective Configuration Snapshot.
Legacy summary-only evidence remains immutable audit history but is ineligible.
Rerunning the same release is idempotent and still confirms that candidacy is
bound to the latest strict evaluation before accepting an existing snapshot.
Local composition uses the explicitly named local static fixture helper; that
helper is not referenced by the AWS workflow.

The report deliberately records `providerBehaviorMeasured=false`. This is the
strict-$0 deterministic compose/request/grounding release gate only. It does not
call an LLM and is not evidence of OpenAI or Gemini response quality. Any paid
provider mode must add a separately reviewed live-provider evaluation before its
Prompt Version may be promoted.

A perfect deterministic report is necessary but not sufficient for the
strict-$0 profile: across every Tenant, the evaluator, Console
candidacy/deployment gates, and deployment qualifier allow only the checked-in
immutable Prompt approval
`00000000-0000-4000-8000-000000000136` at
`sha256:faf385e0cafc00a1b456dbedaa29828486d5fc2f2da8cb16a6debf871ae4fbeb`.
Another Tenant is not an escape hatch. Changing the Prompt body issues a new
hash and fails closed. Releasing another artifact requires an explicit future
profile/policy with separately reviewed provider-behaviour evidence; rerunning
mocked cases does not approve it.

Migration 33 takes the global Prompt-release lock and aborts before installing
the policy if any non-retired Candidate, Deployment, running Experiment variant,
or latest active-Location snapshot still references unapproved Prompt content.
It never deletes historical evaluation, candidacy, or snapshot evidence. Keep
Generation frozen when this preflight fails; append retirement evidence, stop an
Experiment, move mutable deployments, and publish a newer approved snapshot as
applicable, then rerun the migration. The deployment must run the same
`assert_strict_zero_prompt_executable_state()` check before restoring Generation
concurrency.

## 8. Cost and availability signals

The deployed AWS Budget is an email alert, not a hard spending cap. The hard paid
work boundary for this profile is Fake-only admission plus the absence of provider
credentials. Watch:

- AWS Budget actual and forecast notifications;
- Lambda errors, throttles, duration, and concurrency for each qualified handler;
- CloudFront 4xx/5xx rates;
- application counters for admission denial, grounding rejection, stale leases,
  and reconciliation failures;
- Neon storage/compute allowance and connection errors.

Do not refer to named CloudWatch alarms unless Terraform actually creates them.

## 9. Cutoff and teardown are different operations

At `teardown_date`, `student-cutoff` disables CloudFront delivery and the
reconciliation schedule, then sets reserved concurrency to `0` for every function
name returned by trusted student Terraform state. It preserves Lambda functions,
aliases, SSM parameters, Terraform state, Neon and release evidence. A successful
cutoff therefore **does not mean the stack was destroyed**.

Run the separately reviewed Terraform destroy/SSM cleanup and delete the Neon
assessment project before Free-plan expiry. Only then verify:

- CloudFront and Lambda Function URLs no longer serve the assessment;
- Lambda functions and schedules are gone;
- application SSM parameters are removed;
- the Terraform state records no remaining application resources;
- the remote state bucket was emptied/deleted only after evidence export;
- the Neon assessment project is deleted separately;
- release and incident evidence is retained without secrets or reviewer content.

## 10. Rollback-drill record

No successful cloud rollback drill is recorded in this repository yet. Do not use
invented timestamps or outcomes as evidence.

After the first real drill, attach the workflow run URL and retain:

- source and target release SHAs;
- candidate smoke results;
- live promotion and restoration events;
- post-rollback reviewer and Console smoke results;
- measured recovery time;
- confirmation that no migration rollback or cross-Tenant read occurred.

Until that artifact exists, the rollback mechanism is implemented but the cloud
operational claim remains **pending**.
