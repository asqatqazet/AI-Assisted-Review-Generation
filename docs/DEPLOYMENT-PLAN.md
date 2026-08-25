# Deployment plan (deprecated pointer)

This filename is retained for inbound links; it is not a second deployment authority.

- Architecture and supported target: [SYSTEM-ARCHITECTURE.md](SYSTEM-ARCHITECTURE.md)
- Human execution guide: [STUDENT-DEPLOYMENT-GUIDE.md](STUDENT-DEPLOYMENT-GUIDE.md)
- Incident, rollback, cutoff and teardown operations: [RUNBOOK.md](RUNBOOK.md)

Only `infra/terraform/student` is supported. It deploys the synthetic, FakeProvider-only,
strict-$0 assessment in `eu-central-1`. `infra/terraform/production` is an obsolete and
incomplete scaffold: **do not run `terraform apply` there**. A production deployment
requires a new funded architecture decision and implementation.
