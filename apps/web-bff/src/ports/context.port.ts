export interface PrepareEntryInput {
  readonly tenantSlug: string;
  readonly locationSlug: string;
  readonly invitationToken: string | undefined;
  readonly tableRef: string | undefined;
  readonly browserCapability: string;
}

export type PrepareEntryResult =
  | {
      readonly status: "prepared";
      readonly entryChallengeHandle: string;
    }
  | { readonly status: "unavailable" };

export interface ContextPort {
  prepareEntry(input: PrepareEntryInput): Promise<PrepareEntryResult>;
}
