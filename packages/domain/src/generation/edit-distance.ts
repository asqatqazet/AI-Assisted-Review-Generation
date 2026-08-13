export const MAX_EDIT_DISTANCE_CHARACTERS = 4_000;

export interface DraftSystemAnnotation {
  readonly kind: "assisted-review-disclosure";
  readonly text: string;
}

/**
 * A server-known Draft Revision projection for quality measurement.
 * System annotations are structurally separate and are never compared.
 */
export interface ComparableDraftRevision {
  readonly body: string;
  readonly systemAnnotations: readonly DraftSystemAnnotation[];
}

function normaliseBody(body: string): readonly string[] {
  return Array.from(body.normalize("NFC").replace(/\s+/gu, " ").trim()).slice(
    0,
    MAX_EDIT_DISTANCE_CHARACTERS,
  );
}

function levenshtein(left: readonly string[], right: readonly string[]): number {
  if (left.length > right.length) {
    return levenshtein(right, left);
  }

  let previous = new Uint16Array(left.length + 1);
  let current = new Uint16Array(left.length + 1);
  for (let column = 0; column <= left.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= right.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= left.length; column += 1) {
      const insertion = (current[column - 1] ?? 0) + 1;
      const deletion = (previous[column] ?? 0) + 1;
      const substitution =
        (previous[column - 1] ?? 0) +
        (left[column - 1] === right[row - 1] ? 0 : 1);
      current[column] = Math.min(insertion, deletion, substitution);
    }

    const completed = previous;
    previous = current;
    current = completed;
  }

  return previous[left.length] ?? 0;
}

/**
 * Measures reviewer change between two immutable Draft Revisions.
 *
 * Bodies are Unicode-normalised, whitespace-collapsed, and capped at 4,000
 * code points before comparison. Disclosure is a typed system annotation,
 * not a line guessed from customer text, and therefore cannot inflate this
 * metric. The caller persists the result on Generation Disposition.
 */
export function normalisedEditDistance(
  original: ComparableDraftRevision,
  submitted: ComparableDraftRevision,
): number {
  const originalBody = normaliseBody(original.body);
  const submittedBody = normaliseBody(submitted.body);
  const longest = Math.max(originalBody.length, submittedBody.length);

  if (longest === 0) {
    return 0;
  }

  return levenshtein(originalBody, submittedBody) / longest;
}
