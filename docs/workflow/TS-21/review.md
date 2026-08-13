# TS-21 review

## Behavioral evidence

- Student topology in `infra/terraform/student/` provisions Lambda Function URLs with response streaming, S3 manifests storage, SSM Parameter Store secrets, and an AWS Budget alarm capped at $10.
- Production topology in `infra/terraform/production/` provisions Multi-AZ RDS PostgreSQL on `db.t4g.medium` with provisioned concurrency Lambda execution.
- CI/CD workflow `.github/workflows/deploy.yml` utilizes GitHub Actions OIDC federation with AWS, eliminating long-lived IAM secret credentials.
- `docs/RUNBOOK.md` documents alias shift rollback, generation input reconstruction, tenant emergency suspension, key rotation, and the completed rollback drill with real timestamps.
