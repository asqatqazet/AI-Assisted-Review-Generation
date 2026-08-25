import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";

const temporaryDirectories: string[] = [];

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map((offset) =>
      Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
    );
    const linear = channels.map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function cssColour(styles: string, property: string): string {
  const match = styles.match(new RegExp(`${property}:(#[0-9a-f]{6})`));
  if (match?.[1] === undefined) {
    throw new Error(`Missing CSS colour ${property}`);
  }
  return match[1];
}

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
    const productionStyles = contents
      .filter((_content, index) => textFiles[index]?.endsWith(".css") === true)
      .join("\n");

    expect({
      hasReactRoot: artifact.includes('id="root"'),
      hasHashedScript: files.some((file) => /^assets\/index-[\w-]+\.js$/.test(file)),
      hasRobotsPolicy: files.includes("robots.txt"),
      shellIsNoIndex: artifact.includes(
        'name="robots" content="noindex, nofollow, noarchive"',
      ),
      prototypeMarkers: ["data-dc-script", "Survey.dc.html", "maue.reviewwriter.store"].filter(
        (marker) => artifact.includes(marker),
      ),
    }).toEqual({
      hasReactRoot: true,
      hasHashedScript: true,
      hasRobotsPolicy: true,
      shellIsNoIndex: true,
      prototypeMarkers: [],
    });
    expect(contrastRatio(cssColour(productionStyles, "--muted"), "#ffffff"))
      .toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(cssColour(productionStyles, "--slate"), "#ffffff"))
      .toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(cssColour(productionStyles, "--hairline"), "#ffffff"))
      .toBeGreaterThanOrEqual(3);
    expect(productionStyles).toMatch(
      /\._textButton_[^{]+\{[^}]*min-height:44px/,
    );
    expect(productionStyles).toMatch(
      /\._provenance_[^{]+ summary\{[^}]*min-height:44px/,
    );
  });
});
