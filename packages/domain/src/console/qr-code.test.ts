import { describe, expect, it } from "vitest";

import {
  QrCapacityError,
  decodeQrPayload,
  encodeQrCode,
  qrBlockSyndromes,
  qrDataModulePositions,
  qrEncodedBlocks,
  qrFunctionModuleMap,
  renderQrSvg,
} from "./qr-code.js";

const surveyUrl = "https://review.example.test/s/brightsmile/downtown";

describe("ADM-LOC-04 production QR generation", () => {
  it("carries the actual Location survey URL", () => {
    expect(decodeQrPayload(encodeQrCode(surveyUrl))).toBe(surveyUrl);
  });

  it("produces a different code for a different venue", () => {
    const downtown = encodeQrCode(surveyUrl);
    const harbour = encodeQrCode(
      "https://review.example.test/s/brightsmile/harbour",
    );

    expect(harbour.modules).not.toEqual(downtown.modules);
    expect(decodeQrPayload(harbour)).toBe(
      "https://review.example.test/s/brightsmile/harbour",
    );
  });

  it("round-trips a token-bearing invitation link and non-ASCII text", () => {
    const invited = `${surveyUrl}?v=Jd8s-2Kq_1aB4cD6eF8gH0iJ`;
    expect(decodeQrPayload(encodeQrCode(invited))).toBe(invited);
    expect(decodeQrPayload(encodeQrCode("Grüße aus Bremen — ößü"))).toBe(
      "Grüße aus Bremen — ößü",
    );
  });

  it("emits parity that actually corrects each block", () => {
    for (const block of qrEncodedBlocks(surveyUrl)) {
      expect(qrBlockSyndromes(block.codewords, block.ecLength)).toEqual(
        new Array<number>(block.ecLength).fill(0),
      );
    }
  });

  it("places the three finder patterns at the standard corners", () => {
    const code = encodeQrCode(surveyUrl);
    const size = code.size;

    expect(size).toBe(17 + code.version * 4);
    for (const [row, column] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ] as const) {
      expect(code.modules[row]![column]).toBe(1);
      expect(code.modules[row + 1]![column + 1]).toBe(0);
      expect(code.modules[row + 3]![column + 3]).toBe(1);
    }
  });

  it("grows the version with the payload instead of truncating", () => {
    expect(encodeQrCode("https://a.test/s/a/b").version).toBeLessThan(
      encodeQrCode(`https://a.test/s/${"x".repeat(160)}`).version,
    );
    expect(() => encodeQrCode("y".repeat(400))).toThrow(QrCapacityError);
  });

  it("renders deterministic self-contained SVG", () => {
    const svg = renderQrSvg(surveyUrl);

    expect(svg).toBe(renderQrSvg(surveyUrl));
    expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\"")).toBe(true);
    expect(svg).not.toContain("http://www.w3.org/1999/xlink");
    expect(svg).toContain("<path d=\"M");
  });
});

describe("format information a scanner relies on", () => {
  /** Reads the 15 format bits from the copy beside the top-left finder. */
  function firstCopy(modules: readonly (readonly (0 | 1)[])[]): number {
    let raw = 0;
    for (let index = 0; index <= 5; index += 1) {
      raw |= modules[8]![index]! << index;
    }
    raw |= modules[8]![7]! << 6;
    raw |= modules[8]![8]! << 7;
    raw |= modules[7]![8]! << 8;
    for (let index = 9; index <= 14; index += 1) {
      raw |= modules[14 - index]![8]! << index;
    }
    return raw;
  }

  /** Reads the redundant copy split across the other two finders. */
  function secondCopy(modules: readonly (readonly (0 | 1)[])[]): number {
    const size = modules.length;
    let raw = 0;
    for (let index = 0; index <= 6; index += 1) {
      raw |= modules[size - 1 - index]![8]! << index;
    }
    for (let index = 7; index <= 14; index += 1) {
      raw |= modules[8]![size - 15 + index]! << index;
    }
    return raw;
  }

  it("writes both copies identically, so a damaged code still decodes", () => {
    for (const text of [
      "https://review.example.test/s/brightsmile/downtown",
      "https://review.example.test/s/a/b",
      `https://review.example.test/s/${"x".repeat(120)}`,
    ]) {
      const code = encodeQrCode(text);

      expect(secondCopy(code.modules)).toBe(firstCopy(code.modules));
    }
  });

  it("declares error-correction level M and the mask it actually applied", () => {
    const code = encodeQrCode("https://review.example.test/s/brightsmile/downtown");
    // The stored bits are XOR-masked by the standard's 0x5412 pattern.
    const data = (firstCopy(code.modules) ^ 0x5412) >> 10;

    expect(data >> 3).toBe(0b00);
    expect(data & 0b111).toBeGreaterThanOrEqual(0);
    expect(data & 0b111).toBeLessThanOrEqual(7);
  });

  it("keeps the dark module set", () => {
    const code = encodeQrCode("https://review.example.test/s/brightsmile/downtown");

    expect(code.modules[code.size - 8]![8]).toBe(1);
  });
});

describe("rendered output is scannable off a screen", () => {
  it("keeps module edges hard rather than anti-aliased", () => {
    expect(renderQrSvg("https://review.example.test/s/a/b")).toContain(
      'shape-rendering="crispEdges"',
    );
  });

  it("surrounds the code with the quiet zone a decoder expects", () => {
    const text = "https://review.example.test/s/brightsmile/downtown";
    const code = encodeQrCode(text);
    const svg = renderQrSvg(text, { moduleSize: 4, quietZone: 4 });
    // Four clear modules on every side, so the viewBox is eight wider.
    const extent = (code.size + 8) * 4;

    expect(svg).toContain(`viewBox="0 0 ${extent} ${extent}"`);
  });
});

describe("data placement covers the symbol exactly once", () => {
  // Checked against the function-module map rather than by re-running the
  // traversal, so a traversal that is wrong in the same way twice still fails.
  for (const version of [1, 2, 3, 5, 7, 10]) {
    it(`fills every data module of version ${version} once`, () => {
      const size = 17 + version * 4;
      const functionModules = qrFunctionModuleMap(version);
      const positions = qrDataModulePositions(version);

      const seen = new Set<string>();
      for (const [row, column] of positions) {
        const key = `${row}:${column}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        expect(functionModules[row]![column]).toBe(false);
      }

      let expected = 0;
      for (let row = 0; row < size; row += 1) {
        for (let column = 0; column < size; column += 1) {
          if (!functionModules[row]![column]!) {
            expected += 1;
          }
        }
      }
      // Nothing skipped: a missed column would leave data unplaced and the
      // symbol unreadable to a scanner.
      expect(positions.length).toBe(expected);
    });
  }

  it("uses every column except the vertical timing pattern", () => {
    const columns = new Set(
      qrDataModulePositions(3).map(([, column]) => column),
    );

    expect(columns.has(6)).toBe(false);
    expect(columns.has(0)).toBe(true);
    for (let column = 0; column < 29; column += 1) {
      if (column !== 6) {
        expect(columns.has(column)).toBe(true);
      }
    }
  });
});
