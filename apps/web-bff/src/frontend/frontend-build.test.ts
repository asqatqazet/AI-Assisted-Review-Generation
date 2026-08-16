import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("production frontend artifact", () => {
  it("emits a hashed React shell without the prototype runtime", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "review-ui-"));
    temporaryDirectories.push(outputDirectory);

    await build({
      root: resolve("apps/web-bff"),
      build: {
        emptyOutDir: true,
        outDir: outputDirectory,
      },
      logLevel: "silent",
    });

    const files = await readdir(outputDirectory, { recursive: true });
    const textFiles = files.filter((file) => /\.(?:html|js|css)$/.test(file));
    const contents = await Promise.all(
      textFiles.map((file) => readFile(join(outputDirectory, file), "utf8")),
    );
    const artifact = contents.join("\n");

    expect({
      hasReactRoot: artifact.includes('id="root"'),
      hasHashedScript: files.some((file) => /^assets\/index-[\w-]+\.js$/.test(file)),
      prototypeMarkers: ["data-dc-script", "Survey.dc.html", "maue.reviewwriter.store"].filter(
        (marker) => artifact.includes(marker),
      ),
    }).toEqual({
      hasReactRoot: true,
      hasHashedScript: true,
      prototypeMarkers: [],
    });
  });
});
