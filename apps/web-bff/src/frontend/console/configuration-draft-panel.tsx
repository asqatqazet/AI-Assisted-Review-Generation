import type {
  ConsoleConfigurationDraftChangeDto,
  ConsoleScopeRequestDto,
} from "@review/contracts/console";

import {
  ConsoleRejectionError,
  type ConsoleClient,
  type ConsoleViewOf,
} from "./console-client.js";
import { useConsoleCommand } from "./console-queries.js";
import styles from "./operator-console.module.css";

type ConfigurationState =
  ConsoleViewOf<"tenant-settings">["configuration"];

/** Tenant configuration is always addressed without a Location selector. */
export function tenantConfigurationScope(
  scope: ConsoleScopeRequestDto,
): ConsoleScopeRequestDto {
  return { tenantId: scope.tenantId, locationId: null };
}

export interface ConfigurationDraftController {
  readonly error: Error | null;
  readonly isPending: boolean;
  readonly pendingCommand: string | null;
  stage(
    changes: readonly ConsoleConfigurationDraftChangeDto[],
    options?: { readonly onSuccess?: (() => void) | undefined },
  ): void;
  cancel(): void;
  publish(): void;
}

export function useConfigurationDraftController({
  client,
  scope,
  configuration,
}: {
  readonly client: ConsoleClient;
  readonly scope: ConsoleScopeRequestDto;
  readonly configuration: ConfigurationState | undefined;
}): ConfigurationDraftController {
  const command = useConsoleCommand({
    client,
    scope,
    ifMatch: configuration?.etag,
  });

  return {
    error: command.error,
    isPending: command.isPending,
    pendingCommand:
      command.isPending && command.variables !== undefined
        ? command.variables.command
        : null,
    stage: (changes, options) =>
      command.mutate(
        {
          command: "stage-configuration-changes",
          changes: [...changes],
        },
        options?.onSuccess === undefined
          ? undefined
          : { onSuccess: options.onSuccess },
      ),
    cancel: () => command.mutate({ command: "cancel-configuration-draft" }),
    publish: () => command.mutate({ command: "publish-configuration" }),
  };
}

function draftError(error: Error | null): string | null {
  if (error === null) {
    return null;
  }
  if (error instanceof ConsoleRejectionError) {
    if (error.code === "CONFIG_CONFLICT") {
      return "This Draft changed in another tab. Reload before staging, cancelling or publishing.";
    }
    if (error.code === "INVALID_VALUE") {
      return `The Draft is invalid and was not published. ${error.message}`;
    }
  }
  return error.message;
}

export function ConfigurationDraftPanel({
  configuration,
  controller,
  editable,
  scopeKind,
}: {
  readonly configuration: ConfigurationState;
  readonly controller: ConfigurationDraftController;
  readonly editable: boolean;
  readonly scopeKind: "tenant" | "location";
}): React.JSX.Element {
  const count = configuration.draft?.changes.length ?? 0;
  const error = draftError(controller.error);
  return (
    <section className={styles.form} aria-label="Configuration Draft">
      <h2 className={styles.sectionLabel}>
        {scopeKind === "tenant" ? "Tenant" : "Location"} configuration Draft
      </h2>
      <p className={styles.emptyCopy}>
        {count === 0
          ? "No staged changes"
          : `${count} staged ${count === 1 ? "change" : "changes"}`}
      </p>
      <p className={styles.settingSource}>
        {scopeKind === "tenant"
          ? "Publishing this Tenant Draft updates every Location in the Tenant atomically."
          : "Publishing this Location Draft updates only the selected Location."}
      </p>
      <p className={styles.buttonRow}>
        <button
          type="button"
          className={styles.button}
          disabled={!editable || count === 0 || controller.isPending}
          onClick={controller.cancel}
        >
          {controller.pendingCommand === "cancel-configuration-draft"
            ? "Cancelling…"
            : "Cancel draft"}
        </button>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={!editable || count === 0 || controller.isPending}
          onClick={controller.publish}
        >
          {controller.pendingCommand === "publish-configuration"
            ? "Publishing…"
            : "Publish draft"}
        </button>
      </p>
      {error === null ? null : (
        <p role="alert" className={styles.rejection}>
          {error}
        </p>
      )}
    </section>
  );
}
