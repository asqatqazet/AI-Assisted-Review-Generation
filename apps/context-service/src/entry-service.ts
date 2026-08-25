import type {
  AdvanceEntryInvocationDto,
  AdvanceEntryInvocationResultDto,
  PrepareEntryInvocationDto,
  PrepareEntryInvocationResultDto,
  ReadEntryChallengeInvocationDto,
  ReadEntryChallengeInvocationResultDto,
  VerifyEntryInvocationDto,
  VerifyEntryInvocationResultDto,
} from "@review/contracts/context";
import type { PostgresEntryAdmissionStore } from "@review/db/admission";

type EntryStore = Pick<
  PostgresEntryAdmissionStore,
  "prepare" | "read" | "advance" | "verify"
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
  verifyEntry(
    input: VerifyEntryInvocationDto["input"],
  ): Promise<VerifyEntryInvocationResultDto["result"]>;
}

export function createEntryService({
  store,
  newHandle,
  hashCapability,
  now = () => new Date(),
}: EntryServiceOptions): EntryService {
  return {
    async prepareEntry(input) {
      const entryChallengeHandle = newHandle();
      const [
        routeHandleHash,
        browserCapabilityHash,
        invitationTokenHash,
        tableRefHash,
      ] = await Promise.all([
        hashCapability(entryChallengeHandle),
        hashCapability(input.browserCapability),
        input.invitationToken === undefined
          ? Promise.resolve(undefined)
          : hashCapability(input.invitationToken),
        input.tableRef === undefined
          ? Promise.resolve(undefined)
          : hashCapability(input.tableRef),
      ]);
      const prepared = await store.prepare({
        tenantSlug: input.tenantSlug,
        locationSlug: input.locationSlug,
        ...(invitationTokenHash === undefined ? {} : { invitationTokenHash }),
        routeHandleHash,
        browserCapabilityHash,
        ...(tableRefHash === undefined ? {} : { tableRefHash }),
        ...(input.configurationReleaseId === undefined
          ? {}
          : { configurationReleaseId: input.configurationReleaseId }),
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
            stage: stored.stage,
            provisionalSelection:
              stored.provisionalSelection === null
                ? null
                : { ...stored.provisionalSelection },
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
      const currentTime = now().getTime();
      const admitted = await store.advance({
        routeHandleHash: await hashCapability(input.entryChallengeHandle),
        browserCapabilityHash: await hashCapability(input.browserCapability),
        reviewSessionRouteHandleHash: await hashCapability(reviewSessionHandle),
        rating: input.rating,
        action: input.action === "generate" ? "GENERATE" : "PARAPHRASE",
        reviewSessionExpiresAt: new Date(
          currentTime + 30 * 24 * 60 * 60_000,
        ).toISOString(),
        browserBindingExpiresAt: new Date(
          currentTime + 24 * 60 * 60_000,
        ).toISOString(),
      });
      switch (admitted.status) {
        case "admitted":
          return { status: "admitted", reviewSessionHandle };
        case "verification-required":
          return { status: "verification-required" };
        case "unavailable":
          return { status: "unavailable" };
      }
    },

    async verifyEntry(input) {
      const reviewSessionHandle = newHandle();
      const currentTime = now().getTime();
      const [
        routeHandleHash,
        browserCapabilityHash,
        reviewSessionRouteHandleHash,
        verificationEvidenceHash,
      ] = await Promise.all([
        hashCapability(input.entryChallengeHandle),
        hashCapability(input.browserCapability),
        hashCapability(reviewSessionHandle),
        hashCapability(input.verificationEvidence),
      ]);
      const verified = await store.verify({
        routeHandleHash,
        browserCapabilityHash,
        reviewSessionRouteHandleHash,
        verificationEvidenceHash,
        reviewSessionExpiresAt: new Date(
          currentTime + 30 * 24 * 60 * 60_000,
        ).toISOString(),
        browserBindingExpiresAt: new Date(
          currentTime + 24 * 60 * 60_000,
        ).toISOString(),
      });
      switch (verified.status) {
        case "admitted":
          return { status: "admitted", reviewSessionHandle };
        case "verification-unavailable":
          return { status: "verification-unavailable" };
        case "unavailable":
          return { status: "unavailable" };
      }
    },
  };
}
