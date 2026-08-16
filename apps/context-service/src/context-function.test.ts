import { describe, expect, it } from "vitest";

import { createContextFunctionHandler } from "./context-function.js";

describe("private Context Function", () => {
  it("prepares an Entry Challenge through the Context-owned application boundary", async () => {
    let received: unknown;
    const handler = createContextFunctionHandler({
      entryService: {
        prepareEntry: async (input) => {
          received = input;
          return {
            status: "prepared",
            entryChallengeHandle: "entry-challenge-demo",
          };
        },
        readEntryChallenge: async () => ({ status: "unavailable" }),
        advanceEntry: async () => ({ status: "unavailable" }),
      },
    });

    await expect(
      handler({
        operation: "prepare-entry",
        input: {
          tenantSlug: "apex-dental",
          locationSlug: "central",
          invitationToken: "secret-invitation-token",
          tableRef: "Chair-2",
          browserCapability: "existing-browser-capability-123",
        },
      }),
    ).resolves.toEqual({
      operation: "prepare-entry",
      result: {
        status: "prepared",
        entryChallengeHandle: "entry-challenge-demo",
      },
    });

    expect(received).toEqual({
      tenantSlug: "apex-dental",
      locationSlug: "central",
      invitationToken: "secret-invitation-token",
      tableRef: "Chair-2",
      browserCapability: "existing-browser-capability-123",
    });
  });
});
