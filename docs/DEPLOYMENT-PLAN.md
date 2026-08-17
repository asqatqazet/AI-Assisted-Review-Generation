# Student deployment plan

## Release scope

The first public release is an assessment walking skeleton, not a customer production system. It uses
synthetic data and `FakeProvider` only. The checked-in release path is:

```text
Browser
  -> CloudFront default domain
     -> private S3 (React UI)
     -> OAC-signed BFF Function URLs
        -> private Context Lambda -> Context-only Neon role
        -> private Generation Lambda -> Generation-only Neon role
                                  -> FakeProvider
```

The four delivery gates now have executable evidence:

| Gate | Evidence | Status |
| --- | --- | --- |
| Production composition | BFF, Context and Generation Lambda entrypoints load only their permitted ports and secrets | Implemented and tested |
| Persisted Generate vertical | admission, immutable snapshot, execution fence, grounding, terminal Draft and cost settlement cross the real service ports | Implemented and tested |
| Real database acceptance | success, provider failure and a 60-second progress-only stream cross all three deployables and PostgreSQL | Implemented and tested locally/CI |
| Student AWS release | Terraform, OIDC workflow, immutable artifacts, aliases, synthetic seed, edge/direct-origin smoke and coordinated rollback | Implemented; no AWS deployment has been run |

## Hard stop before any deployment

1. Revoke the root access key that was pasted into the project conversation and inspect CloudTrail for its
   use. Never save it in GitHub, SSM, Terraform, shell history or this repository. Root should have MFA and no
   active access keys.
2. Use a new AWS **Free account plan** in `eu-central-1`, record its expiry date, and do not join AWS
   Organizations. The preflight deliberately stops if the teardown date is unsafe or the account cannot
   allocate the required Lambda concurrency while leaving 100 unreserved.
3. Create the GitHub OIDC provider and a deployment role whose trust policy is restricted to
   `asqatqazet/AI-Assisted-Review-Generation`, the `main` branch and the deployment environment. Put only its
   ARN in the GitHub variable `AWS_DEPLOY_ROLE_ARN`; do not create GitHub AWS access-key secrets.

## One-time prerequisites

Create a Neon Free project in Frankfurt and apply the migrations with a migration-owner connection. Give
`context_svc` and `generation_svc` separate generated passwords and connection URLs. Forced RLS and their
disjoint grants are part of the schema; do not give either runtime role the migration-owner URL.

Configure these GitHub repository values:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `AWS_DEPLOY_ROLE_ARN` | Repo/branch/environment-scoped OIDC role ARN |
| Variable | `COST_ALERT_EMAIL` | Monitored billing email |
| Secret | `NEON_MIGRATION_DATABASE_URL` | Migration owner; workflow only |
| Secret | `NEON_CONTEXT_DATABASE_URL` | `context_svc` pooled TLS URL |
| Secret | `NEON_GENERATION_DATABASE_URL` | `generation_svc` pooled TLS URL |
| Secret | `REVIEW_CSRF_SECRET` | At least 32 random bytes |
| Secret | `CONTEXT_WORK_PRIVATE_KEY_PEM` | Context Ed25519 PKCS#8 private key |
| Secret | `CONTEXT_WORK_PUBLIC_KEY_PEM` | Matching SPKI public key |
| Secret | `GENERATION_WORK_PRIVATE_KEY_PEM` | Generation Ed25519 PKCS#8 private key |
| Secret | `GENERATION_WORK_PUBLIC_KEY_PEM` | Matching SPKI public key |

The workflow writes runtime material to distinct SSM Standard `SecureString` parameters. Terraform receives
only parameter names and artifact paths, so secrets do not enter its plan or remote state.

## First deployment

1. Push the verified commits to `main` and require the `verify` workflow to pass.
2. Run `deploy-student` manually with a teardown date before the AWS Free-plan expiry and acknowledge the
   FakeProvider-only release.
3. The workflow verifies against disposable PostgreSQL, builds once, hashes the three deployment artifacts,
   migrates Neon, installs the idempotent `demo-tenant/demo-location` fixture, runs the AWS/free-tier
   preflight, plans and applies Terraform, then publishes that exact UI build.
4. Treat the run as successful only if the workflow proves all of the following:
   - `GET /health` and the UI succeed through CloudFront;
   - `GET /s/demo-tenant/demo-location` returns the expected entry redirect;
   - direct fast and streaming Function URL requests return `403`;
   - the release artifact contains checksums, Terraform outputs and five numeric Lambda alias versions.
5. During the restricted assessment window, run one browser Generate journey and retain evidence that the
   SSE stream contains only progress until the guarded terminal Draft. Run the 60-second variant once before
   calling the cloud path accepted; the current automated 60-second proof is local/CI, not cloud.

## Rollback and teardown

For rollback, run `rollback-student` with the successful deployment run ID. It verifies the archived
checksums, moves only qualified `live` aliases to the recorded versions, restores the matching UI, invalidates
CloudFront and reruns health/UI probes. Database migrations must remain backward compatible for one release;
the rollback workflow never reverses data migrations.

At the recorded teardown date, destroy the student Terraform stack, empty/delete its remote-state bucket only
after exporting the release evidence, delete SSM parameters and remove the Neon project. AWS Budgets is an
alert, not a hard spending cap.

## Explicitly deferred gates

Do not describe this release as customer-ready until all of these are complete:

- the rate-limit policy is enforced by a shared PostgreSQL admission path across Lambda instances, not only
  by pure/in-memory code and reserved concurrency;
- Cognito/OIDC operator login, Access Grant enforcement and the operator console are deployed and tested;
- a real cloud 60-second generation and rollback drill have produced retained evidence;
- live provider adapters have funded accounts, contract/evaluation evidence and atomic provider-specific
  spend caps. OpenAI and Gemini remain disabled in the strict-zero public release;
- an abuse review decides whether the public assessment can stay without WAF. Reserved concurrency limits
  paid work but does not provide layer-7 filtering.
