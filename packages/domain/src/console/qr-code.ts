/**
 * Byte-mode QR encoder, error-correction level M, versions 1-10.
 *
 * The distribution screen must hand an operator a QR that resolves the real
 * Location survey URL, so the code is generated from that URL rather than
 * illustrated. Pure by construction: no imports, no I/O, deterministic output.
 */

export class QrCapacityError extends Error {
  public constructor(public readonly byteLength: number) {
    super(`QR payload of ${byteLength} bytes exceeds version 10-M capacity.`);
    this.name = "QrCapacityError";
  }
}

interface VersionSpec {
  /** Data codewords available to the payload. */
  readonly dataCodewords: number;
  readonly ecCodewordsPerBlock: number;
  readonly group1Blocks: number;
  readonly group1DataCodewords: number;
  readonly group2Blocks: number;
  readonly group2DataCodewords: number;
  readonly alignmentCentres: readonly number[];
}

const VERSIONS: readonly VersionSpec[] = [
  { dataCodewords: 16, ecCodewordsPerBlock: 10, group1Blocks: 1, group1DataCodewords: 16, group2Blocks: 0, group2DataCodewords: 0, alignmentCentres: [] },
  { dataCodewords: 28, ecCodewordsPerBlock: 16, group1Blocks: 1, group1DataCodewords: 28, group2Blocks: 0, group2DataCodewords: 0, alignmentCentres: [6, 18] },
  { dataCodewords: 44, ecCodewordsPerBlock: 26, group1Blocks: 1, group1DataCodewords: 44, group2Blocks: 0, group2DataCodewords: 0, alignmentCentres: [6, 22] },
  { dataCodewords: 64, ecCodewordsPerBlock: 18, group1Blocks: 2, group1DataCodewords: 32, group2Blocks: 0, group2DataCodewords: 0, alignmentCentres: [6, 26] },
  { dataCodewords: 86, ecCodewordsPerBlock: 24, group1Blocks: 2, group1DataCodewords: 43, group2Blocks: 0, group2DataCodewords: 0, alignmentCentres: [6, 30] },
  { dataCodewords: 108, ecCodewordsPerBlock: 16, group1Blocks: 4, group1DataCodewords: 27, group2Blocks: 0, group2DataCodewords: 0, alignmentCentres: [6, 34] },
  { dataCodewords: 124, ecCodewordsPerBlock: 18, group1Blocks: 4, group1DataCodewords: 31, group2Blocks: 0, group2DataCodewords: 0, alignmentCentres: [6, 22, 38] },
  { dataCodewords: 154, ecCodewordsPerBlock: 22, group1Blocks: 2, group1DataCodewords: 38, group2Blocks: 2, group2DataCodewords: 39, alignmentCentres: [6, 24, 42] },
  { dataCodewords: 182, ecCodewordsPerBlock: 22, group1Blocks: 3, group1DataCodewords: 36, group2Blocks: 2, group2DataCodewords: 37, alignmentCentres: [6, 26, 46] },
  { dataCodewords: 216, ecCodewordsPerBlock: 26, group1Blocks: 4, group1DataCodewords: 43, group2Blocks: 1, group2DataCodewords: 44, alignmentCentres: [6, 28, 50] },
];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    EXP[index] = value;
    LOG[value] = index;
    value <<= 1;
    if (value & 0x100) {
      value ^= 0x11d;
    }
  }
  for (let index = 255; index < 512; index += 1) {
    EXP[index] = EXP[index - 255]!;
  }
}

function multiply(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }
  return EXP[LOG[left]! + LOG[right]!]!;
}

function generatorPolynomial(degree: number): number[] {
  let polynomial = [1];
  for (let index = 0; index < degree; index += 1) {
    const next = new Array<number>(polynomial.length + 1).fill(0);
    for (let position = 0; position < polynomial.length; position += 1) {
      next[position] = next[position]! ^ multiply(polynomial[position]!, EXP[index]!);
      next[position + 1] = next[position + 1]! ^ polynomial[position]!;
    }
    polynomial = next;
  }
  // Division below expects descending powers with the leading 1 first.
  return polynomial.reverse();
}

function errorCorrection(data: readonly number[], ecLength: number): number[] {
  const generator = generatorPolynomial(ecLength);
  const remainder = new Array<number>(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.shift();
    remainder.push(0);
    for (let index = 0; index < ecLength; index += 1) {
      remainder[index] = remainder[index]! ^ multiply(generator[index + 1]!, factor);
    }
  }
  return remainder;
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point < 0x80) {
      bytes.push(point);
    } else if (point < 0x800) {
      bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point < 0x10000) {
      bytes.push(
        0xe0 | (point >> 12),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return bytes;
}

function selectVersion(byteLength: number): number {
  for (let version = 1; version <= VERSIONS.length; version += 1) {
    const spec = VERSIONS[version - 1]!;
    const countBits = version < 10 ? 8 : 16;
    const requiredBits = 4 + countBits + byteLength * 8;
    if (spec.dataCodewords * 8 >= requiredBits) {
      return version;
    }
  }
  throw new QrCapacityError(byteLength);
}

function buildCodewords(payload: readonly number[], version: number): number[] {
  const spec = VERSIONS[version - 1]!;
  const countBits = version < 10 ? 8 : 16;
  const bits: number[] = [];
  const pushBits = (value: number, length: number): void => {
    for (let index = length - 1; index >= 0; index -= 1) {
      bits.push((value >> index) & 1);
    }
  };

  pushBits(0b0100, 4);
  pushBits(payload.length, countBits);
  for (const byte of payload) {
    pushBits(byte, 8);
  }

  const capacityBits = spec.dataCodewords * 8;
  for (let index = 0; index < 4 && bits.length < capacityBits; index += 1) {
    bits.push(0);
  }
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const codewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset += 1) {
      byte = (byte << 1) | bits[index + offset]!;
    }
    codewords.push(byte);
  }
  const padBytes = [0xec, 0x11];
  while (codewords.length < spec.dataCodewords) {
    codewords.push(padBytes[codewords.length % 2]!);
  }
  return codewords;
}

function interleave(dataCodewords: readonly number[], version: number): number[] {
  const spec = VERSIONS[version - 1]!;
  const blocks: number[][] = [];
  let cursor = 0;
  for (let index = 0; index < spec.group1Blocks; index += 1) {
    blocks.push(
      dataCodewords.slice(cursor, cursor + spec.group1DataCodewords),
    );
    cursor += spec.group1DataCodewords;
  }
  for (let index = 0; index < spec.group2Blocks; index += 1) {
    blocks.push(
      dataCodewords.slice(cursor, cursor + spec.group2DataCodewords),
    );
    cursor += spec.group2DataCodewords;
  }
  const ecBlocks = blocks.map((block) =>
    errorCorrection(block, spec.ecCodewordsPerBlock),
  );

  const result: number[] = [];
  const longestData = Math.max(...blocks.map((block) => block.length));
  for (let index = 0; index < longestData; index += 1) {
    for (const block of blocks) {
      const codeword = block[index];
      if (codeword !== undefined) {
        result.push(codeword);
      }
    }
  }
  for (let index = 0; index < spec.ecCodewordsPerBlock; index += 1) {
    for (const block of ecBlocks) {
      result.push(block[index]!);
    }
  }
  return result;
}

type Matrix = (0 | 1 | null)[][];

function placeFunctionPatterns(matrix: Matrix, version: number): void {
  const size = matrix.length;
  const spec = VERSIONS[version - 1]!;

  const drawFinder = (row: number, column: number): void => {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const y = row + dy;
        const x = column + dx;
        if (y < 0 || y >= size || x < 0 || x >= size) {
          continue;
        }
        const inRing =
          dy === 0 || dy === 6 || dx === 0 || dx === 6
            ? dy >= 0 && dy <= 6 && dx >= 0 && dx <= 6
            : false;
        const inCore = dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4;
        matrix[y]![x] = inRing || inCore ? 1 : 0;
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let index = 8; index < size - 8; index += 1) {
    const module = index % 2 === 0 ? 1 : 0;
    matrix[6]![index] = module;
    matrix[index]![6] = module;
  }

  for (const centreRow of spec.alignmentCentres) {
    for (const centreColumn of spec.alignmentCentres) {
      const nearFinder =
        (centreRow === 6 && centreColumn === 6) ||
        (centreRow === 6 && centreColumn === size - 7) ||
        (centreRow === size - 7 && centreColumn === 6);
      if (nearFinder) {
        continue;
      }
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const ring = Math.max(Math.abs(dy), Math.abs(dx));
          matrix[centreRow + dy]![centreColumn + dx] = ring === 1 ? 0 : 1;
        }
      }
    }
  }

  matrix[size - 8]![8] = 1;

  // Reserve the format areas; the values arrive once the mask is chosen.
  for (let index = 0; index <= 8; index += 1) {
    if (matrix[8]![index] === null) {
      matrix[8]![index] = 0;
    }
    if (matrix[index]![8] === null) {
      matrix[index]![8] = 0;
    }
  }
  for (let index = 0; index < 8; index += 1) {
    matrix[size - 1 - index]![8] = matrix[size - 1 - index]![8] ?? 0;
    matrix[8]![size - 1 - index] = matrix[8]![size - 1 - index] ?? 0;
  }

  if (version >= 7) {
    const versionBits = versionInformation(version);
    for (let index = 0; index < 18; index += 1) {
      const bit = ((versionBits >> index) & 1) as 0 | 1;
      const row = Math.floor(index / 3);
      const column = size - 11 + (index % 3);
      matrix[row]![column] = bit;
      matrix[column]![row] = bit;
    }
  }
}

function versionInformation(version: number): number {
  let remainder = version;
  for (let index = 0; index < 12; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >> 11) * 0x1f25);
  }
  return ((version << 12) | remainder) & 0x3ffff;
}

function formatInformation(mask: number): number {
  const data = (0b00 << 3) | mask;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >> 9) * 0x537);
  }
  return (((data << 10) | remainder) ^ 0x5412) & 0x7fff;
}

function functionModuleMap(version: number, size: number): boolean[][] {
  const reserved: Matrix = Array.from({ length: size }, () =>
    new Array<0 | 1 | null>(size).fill(null),
  );
  placeFunctionPatterns(reserved, version);
  return reserved.map((row) => row.map((module) => module !== null));
}

/**
 * Every data module position, in the order the standard fills them: upward and
 * downward through two-column pairs from the right, skipping the vertical
 * timing column.
 *
 * Writer and reader share this one traversal. When they each had their own,
 * an identical mistake in both still round-tripped, so the encoder's own test
 * could not see that column 4 was written twice and column 0 never at all.
 */
export function qrDataModulePositions(
  version: number,
): readonly (readonly [number, number])[] {
  const size = 17 + version * 4;
  const reserved = functionModuleMap(version, size);
  const positions: [number, number][] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the timing pattern. Stepping over it moves the cursor to 5,
    // so the pairs that follow are (5,4), (3,2), (1,0).
    if (right === 6) {
      right = 5;
    }
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const column of [right, right - 1]) {
        if (!reserved[row]![column]!) {
          positions.push([row, column]);
        }
      }
    }
    upward = !upward;
  }
  return positions;
}

/** The function-module map, exposed so placement can be checked against it. */
export function qrFunctionModuleMap(version: number): readonly (readonly boolean[])[] {
  return functionModuleMap(version, 17 + version * 4);
}

function placeData(
  matrix: Matrix,
  version: number,
  codewords: readonly number[],
): void {
  qrDataModulePositions(version).forEach(([row, column], bitIndex) => {
    const byte = codewords[bitIndex >> 3];
    const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1;
    matrix[row]![column] = bit as 0 | 1;
  });
}

function maskCondition(mask: number, row: number, column: number): boolean {
  switch (mask) {
    case 0:
      return (row + column) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return column % 3 === 0;
    case 3:
      return (row + column) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5:
      return ((row * column) % 2) + ((row * column) % 3) === 0;
    case 6:
      return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
    default:
      return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
  }
}

function penalty(modules: readonly (readonly (0 | 1)[])[]): number {
  const size = modules.length;
  let score = 0;

  const runScore = (run: number): number => (run >= 5 ? run - 2 : 0);
  for (let row = 0; row < size; row += 1) {
    let horizontalRun = 1;
    let verticalRun = 1;
    for (let index = 1; index < size; index += 1) {
      horizontalRun =
        modules[row]![index] === modules[row]![index - 1]
          ? horizontalRun + 1
          : ((score += runScore(horizontalRun)), 1);
      verticalRun =
        modules[index]![row] === modules[index - 1]![row]
          ? verticalRun + 1
          : ((score += runScore(verticalRun)), 1);
    }
    score += runScore(horizontalRun) + runScore(verticalRun);
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const first = modules[row]![column];
      if (
        first === modules[row]![column + 1] &&
        first === modules[row + 1]![column] &&
        first === modules[row + 1]![column + 1]
      ) {
        score += 3;
      }
    }
  }

  const finderLike = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const reversedFinder = [...finderLike].reverse();
  const matches = (values: readonly (0 | 1)[], start: number): boolean =>
    finderLike.every((bit, offset) => values[start + offset] === bit) ||
    reversedFinder.every((bit, offset) => values[start + offset] === bit);
  for (let index = 0; index < size; index += 1) {
    const rowValues = modules[index]!;
    const columnValues = modules.map((row) => row[index]!);
    for (let start = 0; start + 11 <= size; start += 1) {
      if (matches(rowValues, start)) {
        score += 40;
      }
      if (matches(columnValues, start)) {
        score += 40;
      }
    }
  }

  const dark = modules.flat().filter((module) => module === 1).length;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

export interface QrCode {
  readonly version: number;
  readonly size: number;
  readonly modules: readonly (readonly (0 | 1)[])[];
}

export function encodeQrCode(text: string): QrCode {
  const payload = utf8Bytes(text);
  const version = selectVersion(payload.length);
  const size = 17 + version * 4;
  const codewords = interleave(buildCodewords(payload, version), version);
  const reserved = functionModuleMap(version, size);

  let best: { modules: (0 | 1)[][]; score: number } | undefined;
  for (let mask = 0; mask < 8; mask += 1) {
    const matrix: Matrix = Array.from({ length: size }, () =>
      new Array<0 | 1 | null>(size).fill(null),
    );
    placeFunctionPatterns(matrix, version);
    placeData(matrix, version, codewords);

    const modules = matrix.map((row, rowIndex) =>
      row.map((module, columnIndex) => {
        const value = (module ?? 0) as 0 | 1;
        if (reserved[rowIndex]![columnIndex]!) {
          return value;
        }
        return (maskCondition(mask, rowIndex, columnIndex)
          ? value ^ 1
          : value) as 0 | 1;
      }),
    );
    applyFormatInformation(modules, mask);

    const score = penalty(modules);
    if (best === undefined || score < best.score) {
      best = { modules, score };
    }
  }

  return { version, size, modules: best!.modules };
}

function applyFormatInformation(modules: (0 | 1)[][], mask: number): void {
  const size = modules.length;
  const bits = formatInformation(mask);
  const bitAt = (index: number): 0 | 1 => ((bits >> index) & 1) as 0 | 1;

  for (let index = 0; index <= 5; index += 1) {
    modules[8]![index] = bitAt(index);
  }
  modules[8]![7] = bitAt(6);
  modules[8]![8] = bitAt(7);
  modules[7]![8] = bitAt(8);
  for (let index = 9; index <= 14; index += 1) {
    modules[14 - index]![8] = bitAt(index);
  }

  // The second copy is split 7/8, not 8/7: the eighth module of that column is
  // the dark module, so bit 7 belongs to the row beside the top-right finder.
  // Writing it as 8/7 dropped bit 7 and shifted the rest by one column, which
  // left the redundant copy unreadable to a decoder that falls back to it.
  for (let index = 0; index <= 6; index += 1) {
    modules[size - 1 - index]![8] = bitAt(index);
  }
  for (let index = 7; index <= 14; index += 1) {
    modules[8]![size - 15 + index] = bitAt(index);
  }
  modules[size - 8]![8] = 1;
}

/**
 * Renders as inline SVG so the Console can show and download the same asset
 * without a binary round-trip.
 */
export function renderQrSvg(
  text: string,
  { moduleSize = 4, quietZone = 4 }: {
    readonly moduleSize?: number | undefined;
    readonly quietZone?: number | undefined;
  } = {},
): string {
  const code = encodeQrCode(text);
  const extent = (code.size + quietZone * 2) * moduleSize;
  const path: string[] = [];
  for (let row = 0; row < code.size; row += 1) {
    for (let column = 0; column < code.size; column += 1) {
      if (code.modules[row]![column] === 1) {
        const x = (column + quietZone) * moduleSize;
        const y = (row + quietZone) * moduleSize;
        path.push(`M${x} ${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`);
      }
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" width="${extent}" height="${extent}" role="img">`,
    `<rect width="${extent}" height="${extent}" fill="#ffffff"/>`,
    // Module edges must stay hard: an anti-aliased boundary is what makes a
    // code scanned off a screen ambiguous to a camera.
    `<path d="${path.join("")}" fill="#000000" shape-rendering="crispEdges"/>`,
    "</svg>",
  ].join("");
}

/**
 * Inverse of {@link encodeQrCode}, limited to the byte mode this module emits.
 *
 * It exists so a test can assert that a rendered code really carries the
 * Location survey URL instead of asserting that some black squares were drawn.
 */
export function decodeQrPayload(code: QrCode): string {
  const { modules, version } = code;

  let format = 0;
  for (let index = 0; index <= 5; index += 1) {
    format |= modules[8]![index]! << index;
  }
  format |= modules[8]![7]! << 6;
  format |= modules[8]![8]! << 7;
  format |= modules[7]![8]! << 8;
  for (let index = 9; index <= 14; index += 1) {
    format |= modules[14 - index]![8]! << index;
  }
  const unmaskedFormat = (format ^ 0x5412) >> 10;
  const mask = unmaskedFormat & 0b111;

  const bits = qrDataModulePositions(version).map(([row, column]) => {
    const module = modules[row]![column]!;
    return maskCondition(mask, row, column) ? module ^ 1 : module;
  });

  const codewords: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    let byte = 0;
    for (let offset = 0; offset < 8; offset += 1) {
      byte = (byte << 1) | bits[index + offset]!;
    }
    codewords.push(byte);
  }

  const spec = VERSIONS[version - 1]!;
  const blockLengths = [
    ...new Array<number>(spec.group1Blocks).fill(spec.group1DataCodewords),
    ...new Array<number>(spec.group2Blocks).fill(spec.group2DataCodewords),
  ];
  const blocks: number[][] = blockLengths.map(() => []);
  const longest = Math.max(...blockLengths);
  let cursor = 0;
  for (let index = 0; index < longest; index += 1) {
    for (let block = 0; block < blockLengths.length; block += 1) {
      if (index < blockLengths[block]!) {
        blocks[block]!.push(codewords[cursor]!);
        cursor += 1;
      }
    }
  }

  const data = blocks.flat();
  const countBits = version < 10 ? 8 : 16;
  const dataBits: number[] = [];
  for (const byte of data) {
    for (let index = 7; index >= 0; index -= 1) {
      dataBits.push((byte >> index) & 1);
    }
  }
  const readBits = (offset: number, length: number): number => {
    let value = 0;
    for (let index = 0; index < length; index += 1) {
      value = (value << 1) | dataBits[offset + index]!;
    }
    return value;
  };
  if (readBits(0, 4) !== 0b0100) {
    throw new Error("Only byte mode is decodable here.");
  }
  const byteLength = readBits(4, countBits);
  const bytes: number[] = [];
  for (let index = 0; index < byteLength; index += 1) {
    bytes.push(readBits(4 + countBits + index * 8, 8));
  }

  let result = "";
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index]!;
    if (first < 0x80) {
      result += String.fromCodePoint(first);
      index += 1;
    } else if (first < 0xe0) {
      result += String.fromCodePoint(((first & 0x1f) << 6) | (bytes[index + 1]! & 0x3f));
      index += 2;
    } else if (first < 0xf0) {
      result += String.fromCodePoint(
        ((first & 0x0f) << 12) |
          ((bytes[index + 1]! & 0x3f) << 6) |
          (bytes[index + 2]! & 0x3f),
      );
      index += 3;
    } else {
      result += String.fromCodePoint(
        ((first & 0x07) << 18) |
          ((bytes[index + 1]! & 0x3f) << 12) |
          ((bytes[index + 2]! & 0x3f) << 6) |
          (bytes[index + 3]! & 0x3f),
      );
      index += 4;
    }
  }
  return result;
}

/**
 * Reed-Solomon syndromes of one encoded block. All-zero means the parity
 * really corrects that block rather than merely occupying the right space.
 */
export function qrBlockSyndromes(
  block: readonly number[],
  ecLength: number,
): number[] {
  const syndromes: number[] = [];
  for (let index = 0; index < ecLength; index += 1) {
    let value = 0;
    for (const codeword of block) {
      value = multiply(value, EXP[index]!) ^ codeword;
    }
    syndromes.push(value);
  }
  return syndromes;
}

/** Encoded data + parity for one payload, for parity verification in tests. */
export function qrEncodedBlocks(
  text: string,
): readonly { readonly codewords: readonly number[]; readonly ecLength: number }[] {
  const payload = utf8Bytes(text);
  const version = selectVersion(payload.length);
  const spec = VERSIONS[version - 1]!;
  const data = buildCodewords(payload, version);
  const lengths = [
    ...new Array<number>(spec.group1Blocks).fill(spec.group1DataCodewords),
    ...new Array<number>(spec.group2Blocks).fill(spec.group2DataCodewords),
  ];
  let cursor = 0;
  return lengths.map((length) => {
    const block = data.slice(cursor, cursor + length);
    cursor += length;
    return {
      codewords: [...block, ...errorCorrection(block, spec.ecCodewordsPerBlock)],
      ecLength: spec.ecCodewordsPerBlock,
    };
  });
}
