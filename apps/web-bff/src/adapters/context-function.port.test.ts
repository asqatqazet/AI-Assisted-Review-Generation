import { describe, expect, it } from "vitest";

import { createInvokedContextPort } from "./context-function.port.js";

describe("invoked Context port", () => {
  it("prepares an entry through the private Context Function contract", async () => {
    let received: unknown;
    const contextPort = createInvokedContextPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "prepare-entry",
          result: {
            status: "prepared",
            entryChallengeHandle: "entry-challenge-demo",
          },
        };
      },
    });

    await expect(
      contextPort.prepareEntry({
        tenantSlug: "apex-dental",
        locationSlug: "central",
        invitationToken: "secret-invitation-token",
        tableRef: "Chair-2",
        browserCapability: "existing-browser-capability-123",
      }),
    ).resolves.toEqual({
      status: "prepared",
      entryChallengeHandle: "entry-challenge-demo",
    });

    expect(received).toEqual({
      operation: "prepare-entry",
      input: {
        tenantSlug: "apex-dental",
        locationSlug: "central",
        invitationToken: "secret-invitation-token",
        tableRef: "Chair-2",
        browserCapability: "existing-browser-capability-123",
      },
    });
  });
});
