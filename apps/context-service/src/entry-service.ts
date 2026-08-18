import type {
  AdvanceEntryInvocationDto,
  AdvanceEntryInvocationResultDto,
  PrepareEntryInvocationDto,
  PrepareEntryInvocationResultDto,
  ReadEntryChallengeInvocationDto,
  ReadEntryChallengeInvocationResultDto,
} from "@review/contracts/context";
import type { PostgresEntryAdmissionStore } from "@review/db/admission";

type EntryStore = Pick<
  PostgresEntryAdmissionStore,
  "prepare" | "read" | "advance"
>;

export interface EntryServiceOptions {
  readonly store: EntryStore;
  readonly newHandle: () => string;
  readonly hashCapability: (value: string) => Promise<string>;
  readonly now?: () => Date;
}

export interface EntryService {
  prepareEntry(
    input: PrepareEntryInvocationDto["input"],
  ): Promise<PrepareEntryInvocationResultDto["result"]>;
  readEntryChallenge(
    input: ReadEntryChallengeInvocationDto["input"],
  ): Promise<ReadEntryChallengeInvocationResultDto["result"]>;
  advanceEntry(
    input: AdvanceEntryInvocationDto["input"],
  ): Promise<AdvanceEntryInvocationResultDto["result"]>;
}

export function createEntryService({
  store,
  newHandle,
  hashCapability,
  now = () => new Date(),
}: EntryServiceOptions): EntryService {
  return {
    async prepareEntry(input) {
      if (input.invitationToken !== undefined) {
        return { status: "unavailable" };
      }
      const entryChallengeHandle = newHandle();
      const prepared = await store.prepare({
        tenantSlug: input.tenantSlug,
        locationSlug: input.locationSlug,
        routeHandleHash: await hashCapability(entryChallengeHandle),
        browserCapabilityHash: await hashCapability(input.browserCapability),
        expiresAt: new Date(now().getTime() + 5 * 60_000).toISOString(),
      });
      return prepared.status === "prepared"
        ? { status: "prepared", entryChallengeHandle }
        : { status: "unavailable" };
    },

    async readEntryChallenge(input) {
      const stored = await store.read({
        routeHandleHash: await hashCapability(input.entryChallengeHandle),
        browserCapabilityHash: await hashCapability(input.browserCapability),
      });
      return stored.status !== "ready"
        ? stored
        : {
            status: "ready",
            context: {
              ...stored.context,
              factOptions: [...stored.context.factOptions],
              reviewFormats: stored.context.reviewFormats.map((format) => ({
                ...format,
                constraints: { ...format.constraints },
                availableCommands: [...format.availableCommands],
              })),
              destinations: stored.context.destinations.map((destination) => ({
                ...destination,
              })),
            },
          };
    },

    async advanceEntry(input) {
      const reviewSessionHandle = newHandle();
      const admitted = await store.advance({
        routeHandleHash: await hashCapability(input.entryChallengeHandle),
        browserCapabilityHash: await hashCapability(input.browserCapability),
        reviewSessionRouteHandleHash: await hashCapability(reviewSessionHandle),
        rating: input.rating,
        action: input.action === "generate" ? "GENERATE" : "PARAPHRASE",
        reviewSessionExpiresAt: new Date(
          now().getTime() + 60 * 60_000,
        ).toISOString(),
      });
      return admitted.status === "admitted"
        ? { status: "admitted", reviewSessionHandle }
        : { status: "unavailable" };
    },
  };
}
