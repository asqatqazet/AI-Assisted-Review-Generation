import { PrismaClient } from "../generated/control-plane/index.js";

export interface OperatorIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string;
}

export type StoredOperatorAccess =
  | { readonly status: "unauthorized" }
  | {
      readonly status: "authorized";
      readonly operator: { readonly id: string; readonly email: string };
      readonly platformGrants: {
        readonly roleKey: string;
        readonly capabilities: string[];
      }[];
      readonly tenantGrants: {
        readonly tenantId: string;
        readonly tenantSlug: string;
        readonly tenantName: string;
        readonly roleKey: string;
        readonly capabilities: string[];
        readonly locations: {
          readonly locationId: string;
          readonly locationSlug: string;
          readonly locationName: string;
          readonly status: "active" | "inactive";
        }[];
      }[];
    };

export interface PostgresOperatorAccessStore {
  resolveAccess(identity: OperatorIdentity): Promise<StoredOperatorAccess>;
  disconnect(): Promise<void>;
}

interface OperatorRow {
  readonly id: string;
  readonly email: string;
}

interface GrantRow {
  readonly tenant_id: string;
  readonly tenant_slug: string;
  readonly tenant_name: string;
  readonly role_key: string;
  readonly capabilities: string[];
}

interface PlatformGrantRow {
  readonly role_key: string;
  readonly capabilities: string[];
}

interface LocationRow {
  readonly location_id: string;
  readonly tenant_id: string;
  readonly location_slug: string;
  readonly location_name: string;
  readonly status: "ACTIVE" | "INACTIVE";
}

export function createPostgresOperatorAccessStore({
  databaseUrl,
}: {
  readonly databaseUrl: string;
}): PostgresOperatorAccessStore {
  const client = new PrismaClient({ datasourceUrl: databaseUrl });

  return {
    async resolveAccess(identity) {
      return await client.$transaction(async (transaction) => {
        let operators = await transaction.$queryRaw<OperatorRow[]>`
          SELECT id::text, email::text
          FROM operators
          WHERE external_issuer = ${identity.issuer}
            AND external_subject = ${identity.subject}
            AND status = 'ACTIVE'
          LIMIT 1
        `;
        if (operators.length === 0) {
          operators = await transaction.$queryRaw<OperatorRow[]>`
            UPDATE operators
            SET external_issuer = ${identity.issuer},
                external_subject = ${identity.subject}
            WHERE email = ${identity.email}
              AND status = 'ACTIVE'
              AND external_issuer IS NULL
              AND external_subject IS NULL
            RETURNING id::text, email::text
          `;
        }
        const operator = operators[0];
        if (operator === undefined) {
          return { status: "unauthorized" };
        }

        await transaction.$executeRaw`
          SELECT set_config('app.operator_id', ${operator.id}, true)
        `;
        const platformRows = await transaction.$queryRaw<PlatformGrantRow[]>`
          SELECT access_grant.role_key, role.capabilities
          FROM platform_access_grants AS access_grant
          JOIN operator_role_definitions AS role ON role.key = access_grant.role_key
          WHERE access_grant.operator_id = ${operator.id}::uuid
            AND access_grant.status = 'ACTIVE'
            AND access_grant.valid_from <= clock_timestamp()
            AND (access_grant.valid_until IS NULL OR access_grant.valid_until > clock_timestamp())
            AND role.status = 'ACTIVE'
          ORDER BY access_grant.role_key
        `;
        const tenantRows = await transaction.$queryRaw<GrantRow[]>`
          SELECT access_grant.tenant_id::text,
                 tenant.slug AS tenant_slug,
                 tenant.name AS tenant_name,
                 access_grant.role_key,
                 role.capabilities
          FROM tenant_access_grants AS access_grant
          JOIN operator_role_definitions AS role ON role.key = access_grant.role_key
          JOIN tenants AS tenant ON tenant.id = access_grant.tenant_id
          WHERE access_grant.operator_id = ${operator.id}::uuid
            AND access_grant.status = 'ACTIVE'
            AND access_grant.valid_from <= clock_timestamp()
            AND (access_grant.valid_until IS NULL OR access_grant.valid_until > clock_timestamp())
            AND role.status = 'ACTIVE'
            AND tenant.status = 'ACTIVE'
          ORDER BY tenant.name, access_grant.role_key
        `;
        const locationRows = await transaction.$queryRaw<LocationRow[]>`
          SELECT location.id::text AS location_id,
                 location.tenant_id::text,
                 location.slug AS location_slug,
                 location.name AS location_name,
                 location.status
          FROM locations AS location
          ORDER BY location.name
        `;
        const platformGrants = platformRows.map((row) => ({
          roleKey: row.role_key,
          capabilities: row.capabilities,
        }));
        const tenantGrants = tenantRows.map((row) => ({
          tenantId: row.tenant_id,
          tenantSlug: row.tenant_slug,
          tenantName: row.tenant_name,
          roleKey: row.role_key,
          capabilities: row.capabilities,
          locations: locationRows
            .filter((location) => location.tenant_id === row.tenant_id)
            .map((location) => ({
              locationId: location.location_id,
              locationSlug: location.location_slug,
              locationName: location.location_name,
              status:
                location.status === "ACTIVE"
                  ? ("active" as const)
                  : ("inactive" as const),
            })),
        }));
        const mayReadConsole = [...platformGrants, ...tenantGrants].some(
          (grant) => grant.capabilities.includes("console:read"),
        );
        if (!mayReadConsole) {
          return { status: "unauthorized" };
        }
        return {
          status: "authorized",
          operator,
          platformGrants,
          tenantGrants,
        };
      });
    },

    async disconnect() {
      await client.$disconnect();
    },
  };
}
