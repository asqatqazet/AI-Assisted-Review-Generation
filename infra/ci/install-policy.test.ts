import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("CI dependency build policy", () => {
  it("allows the Prisma install scripts required by a clean frozen install", () => {
    const workspace = fs.readFileSync(
      path.join(__dirname, "../../pnpm-workspace.yaml"),
      "utf8",
    );
    const allowBuilds = workspace.match(
      /^allowBuilds:\n((?: {2}.+\n)+)/m,
    )?.[1];

    expect(allowBuilds).toContain("  '@prisma/engines': true");
    expect(allowBuilds).toContain("  prisma: true");
    expect(allowBuilds).not.toContain("set this to true or false");
  });

  it("resolves the UI build tool from the package that declares it", () => {
    const project = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, "../../apps/web-bff/project.json"),
        "utf8",
      ),
    ) as {
      readonly targets: {
        readonly build: {
          readonly options: { readonly commands: readonly string[] };
        };
      };
    };

    expect(project.targets.build.options.commands).toContain(
      "node apps/web-bff/node_modules/vite/bin/vite.js build apps/web-bff --config apps/web-bff/vite.config.ts",
    );
  });
});
