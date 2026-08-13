# TS-15 plan

## Outcome

Implement Context Service in `apps/context-service` as a Hono control plane microservice serving strong-ETag snapshot reads with 304 conditional evaluation, role-gated multi-scope writes, and unconfigured first-run provisioning.

## Public seam

- `GET /context/:tenantId/:locationId`
- `POST /admin/platform/settings`
- `POST /admin/tenants/:tenantId/settings`
- `POST /admin/tenants/:tenantId/locations/:locationId/overrides`
- `POST /admin/tenants/provision`
