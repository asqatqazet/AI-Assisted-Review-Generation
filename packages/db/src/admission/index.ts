import { PrismaClient } from "../generated/admission/index.js";
import type { Prisma } from "../generated/admission/index.js";

export interface ReviewSessionCapabilityHashes {
  readonly routeHandleHash: string;
  readonly browserCapabilityHash: string;
}

export interface ReviewSessionFactProjection {
  readonly id: string;
  readonly label: string;
  readonly categoryLabel: string;
  readonly polarity: "positive" | "neutral" | "negative";
}

export interface ReviewSessionFormatProjection {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly sample: string;
  readonly availableCommands: readonly (
    | "generate"
    | "paraphrase"
    | "reformat"
    | "condense"
    | "expand"
    | "revise-wording"
  )[];
}

export interface StoredReviewSessionProjection {
  readonly reviewSessionId: string;
  readonly tenantId: string;
  readonly locationId: string;
  readonly tenantDisplayName: string;
  readonly locationDisplayName: string;
  readonly locale: "en-GB" | "de-DE";
  readonly rating: 1 | 2 | 3 | 4 | 5;
  readonly action: "generate" | "paraphrase";
  readonly factOptions: readonly ReviewSessionFactProjection[];
  readonly reviewFormats: readonly ReviewSessionFormatProjection[];
}

export interface PostgresReviewSessionReader {
  read(
    hashes: ReviewSessionCapabilityHashes,
  ): Promise<StoredReviewSessionProjection | null>;
  disconnect(): Promise<void>;
}

interface BindingRow {
  readonly tenant_id: string;
  readonly location_id: string;
  readonly review_session_id: string;
}

interface SessionRow {
  readonly review_session_id: string;
  readonly tenant_name: string;
  readonly location_name: string;
  readonly locale: string;
  readonly rating: number;
  readonly selected_action: string;
}

interface FactRow {
  readonly id: string;
  readonly label: string;
  readonly category_label: string;
  readonly polarity: string;
}

interface ReviewFormatRow {
  readonly id: string;
  readonly display_name: string | null;
  readonly description: string | null;
  readonly sample: string | null;
  readonly allowed_actions: string[];
}

const isLocale = (value: string): value is "en-GB" | "de-DE" =>
  value === "en-GB" || value === "de-DE";

const isRating = (value: number): value is 1 | 2 | 3 | 4 | 5 =>
  Number.isInteger(value) && value >= 1 && value <= 5;

const toAction = (value: string): "generate" | "paraphrase" | undefined =>
  value === "GENERATE"
    ? "generate"
    : value === "PARAPHRASE"
      ? "paraphrase"
      : undefined;

const toPolarity = (
  value: string,
): "positive" | "neutral" | "negative" | undefined =>
  value === "POSITIVE"
    ? "positive"
    : value === "NEUTRAL"
      ? "neutral"
      : value === "NEGATIVE"
        ? "negative"
        : undefined;

const toAvailableCommand = (
  value: string,
): ReviewSessionFormatProjection["availableCommands"][number] | undefined => {
  switch (value) {
    case "GENERATE":
      return "generate";
    case "PARAPHRASE":
      return "paraphrase";
    case "REFORMAT":
      return "reformat";
    case "CONDENSE":
      return "condense";
    case "EXPAND":
      return "expand";
    case "REVISE_WORDING":
      return "revise-wording";
    default:
      return undefined;
  }
};

export function createPostgresReviewSessionReader({
  databaseUrl,
}: {
  readonly databaseUrl: string;
}): PostgresReviewSessionReader {
  if (databaseUrl.trim().length === 0) {
    throw new Error("Admission database URL is required");
  }
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  const withTenant = async <Result>(
    tenantId: string,
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> =>
    await client.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT set_config('app.tenant_id', ${tenantId}, true)
      `;
      return await operation(transaction);
    });

  return {
    async read({ routeHandleHash, browserCapabilityHash }) {
      const bindings = await client.$queryRaw<BindingRow[]>`
        SELECT tenant_id, location_id, review_session_id
        FROM review_session_browser_bindings
        WHERE route_handle_hash = ${routeHandleHash}
          AND browser_capability_hash = ${browserCapabilityHash}
          AND revoked_at IS NULL
          AND expires_at > clock_timestamp()
        LIMIT 1
      `;
      const binding = bindings[0];
      if (binding === undefined) {
        return null;
      }

      return await withTenant(binding.tenant_id, async (transaction) => {
        const sessions = await transaction.$queryRaw<SessionRow[]>`
          SELECT
            session.id AS review_session_id,
            tenant.name AS tenant_name,
            location.name AS location_name,
            tenant.locale,
            session.rating,
            session.selected_action::text
          FROM review_sessions AS session
          JOIN tenants AS tenant ON tenant.id = session.tenant_id
          JOIN locations AS location
            ON location.id = session.location_id
           AND location.tenant_id = session.tenant_id
          WHERE session.id = ${binding.review_session_id}::uuid
            AND session.tenant_id = ${binding.tenant_id}::uuid
            AND session.location_id = ${binding.location_id}::uuid
            AND session.status = 'OPEN'
            AND session.expires_at > clock_timestamp()
            AND session.rating IS NOT NULL
            AND session.selected_action IS NOT NULL
        `;
        const session = sessions[0];
        if (session === undefined || !isLocale(session.locale) || !isRating(session.rating)) {
          return null;
        }
        const action = toAction(session.selected_action);
        if (action === undefined) {
          return null;
        }

        const facts = await transaction.$queryRaw<FactRow[]>`
          SELECT
            fact.id,
            COALESCE(fact.label ->> ${session.locale}, fact.label ->> 'en-GB') AS label,
            COALESCE(category.label ->> ${session.locale}, category.label ->> 'en-GB') AS category_label,
            fact.polarity::text
          FROM fact_option_versions AS fact
          JOIN fact_option_categories AS category
            ON category.id = fact.category_id
           AND category.tenant_id = fact.tenant_id
          WHERE fact.tenant_id = ${binding.tenant_id}::uuid
            AND (fact.location_id IS NULL OR fact.location_id = ${binding.location_id}::uuid)
            AND fact.is_active = true
            AND fact.retired_at IS NULL
          ORDER BY fact.sort_order, fact.id
        `;
        const factOptions: ReviewSessionFactProjection[] = [];
        for (const fact of facts) {
          const polarity = toPolarity(fact.polarity);
          if (polarity === undefined || fact.label === null || fact.category_label === null) {
            continue;
          }
          factOptions.push({
            id: fact.id,
            label: fact.label,
            categoryLabel: fact.category_label,
            polarity,
          });
        }

        const formatRows = await transaction.$queryRaw<ReviewFormatRow[]>`
          SELECT
            format.id,
            COALESCE(
              format.localized_text -> 'displayName' ->> ${session.locale},
              format.localized_text -> 'displayName' ->> 'en-GB'
            ) AS display_name,
            COALESCE(
              format.localized_text -> 'description' ->> ${session.locale},
              format.localized_text -> 'description' ->> 'en-GB'
            ) AS description,
            COALESCE(
              format.localized_text -> 'sample' ->> ${session.locale},
              format.localized_text -> 'sample' ->> 'en-GB'
            ) AS sample,
            enablement.allowed_actions::text[]
          FROM review_format_enablements AS enablement
          JOIN review_format_versions AS format
            ON format.id = enablement.review_format_version_id
          WHERE enablement.tenant_id = ${binding.tenant_id}::uuid
            AND enablement.enabled = true
            AND format.status = 'ACTIVE'
            AND format.locale IN (${session.locale}, 'any')
            AND enablement.allowed_actions @>
              ARRAY[${session.selected_action}::generation_action]
            AND format.supported_actions @>
              ARRAY[${session.selected_action}::generation_action]
          ORDER BY enablement.sort_order, format.id
        `;
        const reviewFormats: ReviewSessionFormatProjection[] = [];
        for (const format of formatRows) {
          if (
            format.display_name === null ||
            format.description === null ||
            format.sample === null
          ) {
            continue;
          }
          reviewFormats.push({
            id: format.id,
            displayName: format.display_name,
            description: format.description,
            sample: format.sample,
            availableCommands: format.allowed_actions.flatMap((action) => {
              const command = toAvailableCommand(action);
              return command === undefined ? [] : [command];
            }),
          });
        }

        return {
          reviewSessionId: session.review_session_id,
          tenantId: binding.tenant_id,
          locationId: binding.location_id,
          tenantDisplayName: session.tenant_name,
          locationDisplayName: session.location_name,
          locale: session.locale,
          rating: session.rating,
          action,
          factOptions,
          reviewFormats,
        };
      });
    },

    async disconnect() {
      await client.$disconnect();
    },
  };
}
