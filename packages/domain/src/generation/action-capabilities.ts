export const GENERATION_ACTIONS = [
  "generate",
  "paraphrase",
  "resample",
  "reformat",
  "condense",
  "expand",
  "revise-wording",
] as const;

export type GenerationAction = (typeof GENERATION_ACTIONS)[number];

/**
 * Actions with a complete production path from immutable input evidence to a
 * grounded Generation. Derived Actions remain unavailable until their source
 * Generation and Claim set are loaded and bound by the execution boundary.
 */
export const EXECUTABLE_GENERATION_ACTIONS = [
  "generate",
] as const satisfies readonly GenerationAction[];

export type ExecutableGenerationAction =
  (typeof EXECUTABLE_GENERATION_ACTIONS)[number];

const executableActions = new Set<string>(EXECUTABLE_GENERATION_ACTIONS);

export function isExecutableGenerationAction(
  action: string,
): action is ExecutableGenerationAction {
  return executableActions.has(action);
}

export function resolveExecutableGenerationActions(input: {
  readonly enabledActions: readonly string[];
  readonly promptActions: readonly string[];
  readonly reviewFormats: readonly {
    readonly supportedActions: readonly string[];
  }[];
}): readonly ExecutableGenerationAction[] {
  const enabled = new Set(input.enabledActions);
  return EXECUTABLE_GENERATION_ACTIONS.filter((action) => {
    const promptCount = input.promptActions.filter(
      (candidate) => candidate === action,
    ).length;
    return (
      enabled.has(action) &&
      promptCount === 1 &&
      input.reviewFormats.some((format) =>
        format.supportedActions.includes(action),
      )
    );
  });
}
