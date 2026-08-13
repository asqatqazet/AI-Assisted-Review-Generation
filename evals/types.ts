import type { CommandKind } from "@review/domain/configuration";

export interface GoldenScenario {
  readonly id: string;
  readonly description: string;
  readonly tenantId: string;
  readonly action: CommandKind;
  readonly reviewFormatKey: string;
  readonly promptVersionKey: string;
  readonly assertions: readonly {
    readonly id: string;
    readonly semanticId: string;
    readonly semanticKind: "experience-fact" | "rating-sentiment";
    readonly polarity: "positive" | "negative";
    readonly text: string;
  }[];
  readonly mockedModelOutput: {
    readonly draft: string;
    readonly claims: readonly {
      readonly id: string;
      readonly text: string;
      readonly assertionIds?: string[];
    }[];
  };
  readonly expectedVerdict: "pass" | "rejected";
  readonly expectedRejectionCode?: string | undefined;
  readonly expectedMaxChars?: number | undefined;
  readonly disallowedTerms?: readonly string[] | undefined;
}

export interface GoldenEvalReport {
  readonly totalScenarios: number;
  readonly passedScenarios: number;
  readonly failedScenarios: number;
  readonly passRate: number;
  readonly results: readonly {
    readonly id: string;
    readonly passed: boolean;
    readonly failureReason?: string | undefined;
  }[];
  readonly timestamp: string;
}
