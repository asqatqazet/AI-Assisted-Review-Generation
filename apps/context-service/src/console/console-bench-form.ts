import type {
  ConsoleActionKeyDto,
  ConsoleBenchFormDto,
} from "@review/contracts/console";
import type { EffectiveConfigurationSnapshotDto } from "@review/contracts/shared";
import {
  isExecutableGenerationAction,
  resolveExecutableGenerationActions,
} from "@review/domain/generation";
import type { ExecutableGenerationAction } from "@review/domain/generation";

type Options = Pick<
  ConsoleBenchFormDto,
  "actions" | "styles" | "promptVersions" | "providers" | "keywords"
>;

const actionPresentation: Readonly<
  Record<
    ExecutableGenerationAction,
    { readonly label: string; readonly requiredInputs: readonly string[] }
  >
> = {
  generate: { label: "Generate", requiredInputs: ["factOptionsOrFreeText"] },
};

/**
 * Produces choices solely from one immutable published snapshot. Mutable
 * control-plane rows cannot leak into a Bench request between render and run.
 */
export function projectPublishedConsoleBenchForm({
  snapshot,
  tenantId,
  locationId,
  now,
}: {
  readonly snapshot: EffectiveConfigurationSnapshotDto;
  readonly tenantId: string;
  readonly locationId: string;
  readonly now: Date;
}): Options | null {
  void now;
  if (
    snapshot.tenantId !== tenantId ||
    snapshot.locationId !== locationId ||
    snapshot.providerRouting.primaryProvider !== "fake" ||
    snapshot.providerRouting.primaryModel !== "fake-v1"
  ) {
    return null;
  }
  const zeroRates = snapshot.priceRates.filter(
    (rate) =>
      rate.providerModelId === snapshot.providerRouting.providerModelId &&
      rate.provider === "fake" &&
      rate.model === "fake-v1" &&
      rate.inputPerMillionMicros === 0 &&
      rate.outputPerMillionMicros === 0,
  );
  if (zeroRates.length !== 1) {
    return null;
  }

  const enabledFormats = snapshot.reviewFormats.filter((format) =>
    snapshot.settings.enabledReviewFormatVersionIds.includes(format.id),
  );
  const actions = resolveExecutableGenerationActions({
    enabledActions: snapshot.settings.enabledCommands,
    promptActions: snapshot.promptVersions.map(
      (prompt) => prompt.commandKind,
    ),
    reviewFormats: enabledFormats.map((format) => ({
      supportedActions: format.supportedCommands,
    })),
  });
  const actionSet = new Set<ConsoleActionKeyDto>(actions);

  return {
    actions: actions.map((action) => ({
      key: action,
      label: actionPresentation[action].label,
      requiredInputs: [...actionPresentation[action].requiredInputs],
    })),
    styles: enabledFormats.flatMap((format) => {
      const formatActions = format.supportedCommands.filter(
        (action): action is ExecutableGenerationAction =>
          actionSet.has(action as ConsoleActionKeyDto) &&
          isExecutableGenerationAction(action),
      );
      return formatActions.length === 0
        ? []
        : [
            {
              id: format.id,
              name: format.displayName,
              supportedActions: formatActions,
            },
          ];
    }),
    promptVersions: snapshot.promptVersions.flatMap((prompt) =>
      actionSet.has(prompt.commandKind as ConsoleActionKeyDto)
        ? [
            {
              id: prompt.id,
              action: prompt.commandKind as ExecutableGenerationAction,
              key: prompt.key,
              hash: prompt.hash,
            },
          ]
        : [],
    ),
    providers: [
      { key: "fake", displayName: "FakeProvider", isTestProvider: true },
    ],
    keywords: snapshot.factOptions.flatMap((fact) => {
      const owned =
        fact.owner.tenantId === tenantId &&
        (fact.owner.scope === "tenant" || fact.owner.locationId === locationId);
      return fact.active && owned
        ? [{ id: fact.id, label: fact.label ?? fact.proposition }]
        : [];
    }),
  };
}
