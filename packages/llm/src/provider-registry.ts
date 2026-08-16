export interface ProviderCapabilities {
  readonly displayName: string;
  readonly supportsStructuredOutput: boolean;
  readonly supportsStreaming: boolean;
  readonly maxContextTokens: number;
}

export const PROVIDER_CAPABILITY_MATRIX: Readonly<
  Record<string, ProviderCapabilities>
> = {
  fake: {
    displayName: "Fake Model Gateway",
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 128_000,
  },
  openai: {
    displayName: "OpenAI GPT Models",
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 128_000,
  },
  gemini: {
    displayName: "Google Gemini Models",
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 1_000_000,
  },
};
