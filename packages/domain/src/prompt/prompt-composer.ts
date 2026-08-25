import type {
  CommandKind,
  EffectiveSettings,
  PromptVersion,
} from "../configuration/index.js";
import type { ReviewFormatManifest } from "../review-format/index.js";

export interface PromptComposerAssertion {
  readonly id: string;
  readonly proposition?: string;
  readonly text?: string;
}

export interface PromptComposerSourceClaim {
  readonly id: string;
  readonly text: string;
  readonly assertionIds?: readonly string[];
}

export interface PromptComposerSourceGeneration {
  readonly draft: string;
  readonly claims: readonly PromptComposerSourceClaim[];
}

export interface ComposePromptInput {
  readonly snapshot: {
    readonly settings: Pick<
      EffectiveSettings,
      "locale" | "toneGuidelines" | "bannedTerms"
    >;
  };
  readonly style: ReviewFormatManifest;
  readonly promptVersion: PromptVersion;
  readonly action: CommandKind;
  readonly assertions?: readonly PromptComposerAssertion[] | undefined;
  readonly freeText?: string | undefined;
  readonly sourceText?: string | undefined;
  readonly sourceGeneration?: PromptComposerSourceGeneration | undefined;
  readonly instruction?: string | undefined;
  readonly targetLength?: number | undefined;
}

export interface PromptMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ComposedPrompt {
  readonly system: string;
  readonly messages: readonly PromptMessage[];
  readonly outputSchema: Record<string, unknown>;
}

export const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    draft: {
      type: "string",
      description: "The complete review draft text.",
    },
    claims: {
      type: "array",
      description:
        "List of grounded factual claims in the draft with their supporting assertion IDs.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          assertionIds: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "text", "assertionIds"],
      },
    },
  },
  required: ["draft", "claims"],
} as const;

const DERIVED_ACTIONS = new Set<CommandKind>([
  "reformat",
  "condense",
  "expand",
  "revise-wording",
]);

export function composePrompt(input: ComposePromptInput): ComposedPrompt {
  const { snapshot, style, promptVersion, action } = input;
  const locale = snapshot.settings.locale;

  const systemParts: string[] = [
    promptVersion.body,
    `Tone: ${snapshot.settings.toneGuidelines}`,
  ];

  if (snapshot.settings.bannedTerms.length > 0) {
    systemParts.push(
      `Banned terms: ${[...snapshot.settings.bannedTerms].sort().join(", ")}`,
    );
  }

  const formatDesc =
    style.description[locale] ?? style.description["en-GB"] ?? "";
  systemParts.push(
    `Format: ${style.displayName} (${style.targetPlatform})`,
    `Language: ${locale}`,
    formatDesc.length > 0 ? `Format description: ${formatDesc}` : "",
    `Style guide: ${style.promptFragments.styleGuide}`,
    `Constraints: Min ${style.constraints.minChars} chars, Max ${style.constraints.maxChars} chars, ${style.constraints.paragraphs} paragraph(s).`,
    `Emoji policy: ${style.constraints.emojiPolicy}`,
    `Perspective: ${style.constraints.secondPerson ? "second-person" : "first-person"}`,
  );

  if (DERIVED_ACTIONS.has(action)) {
    systemParts.push(
      "Ceiling constraint: The source claim set is a hard ceiling. Do not introduce any new claims or factual propositions beyond those present in the source generation.",
    );
  }

  const system = systemParts.filter((part) => part.length > 0).join("\n\n");

  const messages: PromptMessage[] = [];

  // Add few-shot turns
  for (const shot of style.promptFragments.fewShot) {
    messages.push({
      role: "user",
      content: shot.input,
    });
    const shotClaims = (shot.claims ?? []).map((claimText, idx) => ({
      id: `c${idx + 1}`,
      text: claimText,
      assertionIds: [`a${idx + 1}`],
    }));
    messages.push({
      role: "assistant",
      content: JSON.stringify({
        draft: shot.output,
        claims: shotClaims,
      }),
    });
  }

  // Build the user turn for the specific action
  const userTurnParts: string[] = [];

  switch (action) {
    case "generate": {
      const assertions = [...(input.assertions ?? [])].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
      if (assertions.length > 0) {
        userTurnParts.push(
          `Assertions:\n${assertions.map((a) => `- [${a.id}] ${a.proposition ?? a.text ?? ""}`).join("\n")}`,
        );
      }
      const trimmedFreeText = input.freeText?.trim();
      if (trimmedFreeText && trimmedFreeText.length > 0) {
        userTurnParts.push(`Free text: ${trimmedFreeText}`);
      }
      break;
    }

    case "paraphrase": {
      const assertions = [...(input.assertions ?? [])].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
      if (assertions.length > 0) {
        userTurnParts.push(
          `Source Assertions (immutable reviewer text):\n${assertions.map((a) => `- [${a.id}] ${a.proposition ?? a.text ?? ""}`).join("\n")}`,
        );
      }
      break;
    }

    case "reformat": {
      userTurnParts.push(
        `Source draft to reformat:\n${input.sourceGeneration?.draft ?? ""}`,
      );
      const claims = input.sourceGeneration?.claims ?? [];
      if (claims.length > 0) {
        userTurnParts.push(
          `Existing claims:\n${claims.map((c) => `- [${c.id}] ${c.text}`).join("\n")}`,
        );
      }
      break;
    }

    case "condense": {
      userTurnParts.push(
        `Source draft to condense:\n${input.sourceGeneration?.draft ?? ""}`,
      );
      const claims = input.sourceGeneration?.claims ?? [];
      if (claims.length > 0) {
        userTurnParts.push(
          `Existing claims:\n${claims.map((c) => `- [${c.id}] ${c.text}`).join("\n")}`,
        );
      }
      if (input.targetLength !== undefined) {
        userTurnParts.push(`Target length: ${input.targetLength} characters`);
      }
      break;
    }

    case "expand": {
      userTurnParts.push(
        `Source draft to expand:\n${input.sourceGeneration?.draft ?? ""}`,
      );
      const claims = input.sourceGeneration?.claims ?? [];
      if (claims.length > 0) {
        userTurnParts.push(
          `Existing claims:\n${claims.map((c) => `- [${c.id}] ${c.text}`).join("\n")}`,
        );
      }
      if (input.targetLength !== undefined) {
        userTurnParts.push(`Target length: ${input.targetLength} characters`);
      }
      break;
    }

    case "revise-wording": {
      userTurnParts.push(
        `Source draft to revise:\n${input.sourceGeneration?.draft ?? ""}`,
      );
      const claims = input.sourceGeneration?.claims ?? [];
      if (claims.length > 0) {
        userTurnParts.push(
          `Existing claims:\n${claims.map((c) => `- [${c.id}] ${c.text}`).join("\n")}`,
        );
      }
      if (input.instruction) {
        userTurnParts.push(`Instruction: ${input.instruction}`);
      }
      break;
    }
  }

  messages.push({
    role: "user",
    content: userTurnParts.join("\n\n"),
  });

  return {
    system,
    messages,
    outputSchema: OUTPUT_SCHEMA,
  };
}
