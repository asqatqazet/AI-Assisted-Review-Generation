import type {
  ConsoleCommandDto,
  ConsoleScopeRequestDto,
} from "@review/contracts/console";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import type {
  ConsoleClient,
  ConsoleViewName,
  ConsoleViewOf,
} from "./console-client.js";

/**
 * One query key shape for the whole Console: every cached view is addressed by
 * the scope it was read in, so changing scope invalidates exactly the views
 * that were scoped to the old one.
 */
export function consoleQueryKey(
  view: ConsoleViewName,
  scope: ConsoleScopeRequestDto,
  params: Readonly<Record<string, string | null>> = {},
): readonly unknown[] {
  return ["console", view, scope.tenantId, scope.locationId, params];
}

export function useConsoleView<TView extends ConsoleViewName>({
  client,
  view,
  scope,
  params = {},
  enabled = true,
}: {
  readonly client: ConsoleClient;
  readonly view: TView;
  readonly scope: ConsoleScopeRequestDto;
  readonly params?: Readonly<Record<string, string | null>> | undefined;
  readonly enabled?: boolean | undefined;
}): UseQueryResult<NoInfer<ConsoleViewOf<TView>>, Error> {
  return useQuery({
    queryKey: consoleQueryKey(view, scope, params),
    enabled,
    queryFn: ({ signal }) =>
      client.readView({ view, scope, params, signal }),
  });
}

export function useConsoleCommand({
  client,
  scope,
  ifMatch,
}: {
  readonly client: ConsoleClient;
  readonly scope: ConsoleScopeRequestDto;
  readonly ifMatch?: string | undefined;
}): UseMutationResult<unknown, Error, ConsoleCommandDto> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: ConsoleCommandDto) =>
      client.runCommand({ command, scope, ifMatch }),
    onSuccess: async () => {
      // A control-plane change can alter any scoped projection, so the whole
      // Console cache is refetched rather than guessed at.
      await queryClient.invalidateQueries({ queryKey: ["console"] });
    },
  });
}
