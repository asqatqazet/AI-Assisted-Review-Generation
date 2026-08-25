import { describe, expect, it } from "vitest";

import { databaseUrlForTestRole } from "./database-role-url.js";

describe("databaseUrlForTestRole", () => {
  it("uses the disposable CI service-role password without retaining owner credentials", () => {
    const result = new URL(
      databaseUrlForTestRole({
        databaseUrl:
          "postgresql://review_owner:owner-only@localhost:5432/assisted_reviews",
        role: "context_runtime_svc",
        serviceRolePassword: "integration-only",
      }),
    );

    expect(result.username).toBe("context_runtime_svc");
    expect(result.password).toBe("integration-only");
    expect(result.password).not.toBe("owner-only");
  });

  it("keeps passwordless local socket authentication when no test password exists", () => {
    const result = new URL(
      databaseUrlForTestRole({
        databaseUrl:
          "postgresql://review_owner@localhost:55555/review?host=%2Fprivate%2Ftmp%2Freview-pg",
        role: "generation_svc",
        serviceRolePassword: "",
      }),
    );

    expect(result.username).toBe("generation_svc");
    expect(result.password).toBe("");
  });
});
