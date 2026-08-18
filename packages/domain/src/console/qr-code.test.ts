import { describe, expect, it } from "vitest";

import {
  QrCapacityError,
  decodeQrPayload,
  encodeQrCode,
  qrBlockSyndromes,
  qrEncodedBlocks,
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
