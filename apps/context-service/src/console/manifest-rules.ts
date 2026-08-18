import type { ConsoleStyleDetailDto } from "@review/contracts/console";

type Validation = NonNullable<ConsoleStyleDetailDto["validation"]>;

interface Rule {
  readonly ruleKey: string;
  readonly label: string;
  readonly check: (manifest: Record<string, unknown>) => string | null;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const RULES: readonly Rule[] = [
  {
    ruleKey: "key-present",
    label: "Manifest declares a stable key",
    check: (manifest) =>
      typeof manifest["key"] === "string" && manifest["key"].trim().length > 0
        ? null
        : "key is missing or empty.",
  },
  {
    ruleKey: "version-present",
    label: "Manifest declares a version",
    check: (manifest) =>
      typeof manifest["version"] === "string" &&
      manifest["version"].trim().length > 0
        ? null
        : "version is missing or empty.",
  },
  {
    ruleKey: "target-platform",
    label: "Target platform is explicit",
    check: (manifest) =>
      typeof manifest["targetPlatform"] === "string" &&
      manifest["targetPlatform"].trim().length > 0
        ? null
        : "targetPlatform is missing or empty.",
  },
  {
    ruleKey: "locale-explicit",
    label: "Locale is explicit",
    check: (manifest) =>
      manifest["locale"] === "en-GB" ||
      manifest["locale"] === "de-DE" ||
      manifest["locale"] === "any"
        ? null
        : "locale must be en-GB, de-DE or any.",
  },
  {
    ruleKey: "character-bounds",
    label: "Character bounds are usable",
    check: (manifest) => {
      const constraints = asRecord(manifest["constraints"]);
      const min = constraints["minChars"];
      const max = constraints["maxChars"];
      if (typeof min !== "number" || typeof max !== "number") {
        return "constraints.minChars and constraints.maxChars must be numbers.";
      }
      if (min < 0 || max <= 0) {
        return "Character bounds must be positive.";
      }
      return min <= max ? null : "minChars must not exceed maxChars.";
    },
  },
  {
    ruleKey: "supported-actions",
    label: "At least one supported Action",
    check: (manifest) => {
      const actions = manifest["supportedActions"] ?? manifest["supportedCommands"];
      return Array.isArray(actions) && actions.length > 0
        ? null
        : "supportedActions must list at least one Action.";
    },
  },
  {
    ruleKey: "emoji-policy",
    label: "Emoji policy is declared",
    check: (manifest) => {
      const policy = asRecord(manifest["constraints"])["emojiPolicy"];
      return policy === "none" || policy === "allowed"
        ? null
        : "constraints.emojiPolicy must be 'none' or 'allowed'.";
    },
  },
];

/**
 * ADM-CFG-04. Validation reports every rule rather than the first failure, and
 * never rewrites the manifest it inspected.
 */
export function validateStyleManifest({
  manifest,
  checkedAt,
}: {
  readonly manifest: string;
  readonly checkedAt: string;
}): Validation {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = asRecord(JSON.parse(manifest) as unknown);
  } catch {
    parsed = null;
  }

  if (parsed === null || Object.keys(parsed).length === 0) {
    return {
      checkedAt,
      status: "fail",
      rules: [
        {
          ruleKey: "parseable",
          label: "Manifest is valid JSON",
          status: "fail",
          detail: "The manifest could not be parsed as a JSON object.",
        },
      ],
    };
  }

  const rules = [
    {
      ruleKey: "parseable",
      label: "Manifest is valid JSON",
      status: "pass" as const,
      detail: null,
    },
    ...RULES.map((rule) => {
      const failure = rule.check(parsed);
      return {
        ruleKey: rule.ruleKey,
        label: rule.label,
        status: failure === null ? ("pass" as const) : ("fail" as const),
        detail: failure,
      };
    }),
  ];

  return {
    checkedAt,
    status: rules.some((rule) => rule.status === "fail") ? "fail" : "pass",
    rules,
  };
}
