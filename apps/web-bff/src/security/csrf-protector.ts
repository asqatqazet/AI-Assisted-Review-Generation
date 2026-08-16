export interface CsrfBinding {
  readonly entryChallengeHandle: string;
  readonly browserCapability: string;
}

export interface CsrfVerification extends CsrfBinding {
  readonly token: string;
}

export interface CsrfProtector {
  issue(binding: CsrfBinding): Promise<string>;
  verify(verification: CsrfVerification): Promise<boolean>;
}

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function signingInput(
  version: string,
  expiresAt: string,
  nonce: string,
  binding: CsrfBinding,
): ArrayBuffer {
  return encoder.encode(
    [
      version,
      expiresAt,
      nonce,
      binding.entryChallengeHandle.length,
      binding.entryChallengeHandle,
      binding.browserCapability.length,
      binding.browserCapability,
    ].join("."),
  ).buffer;
}

export function createHmacCsrfProtector(
  secret: string,
  options: {
    readonly now?: (() => number) | undefined;
    readonly lifetimeMs?: number | undefined;
  } = {},
): CsrfProtector {
  if (encoder.encode(secret).byteLength < 32) {
    throw new Error("REVIEW_CSRF_SECRET must contain at least 32 bytes");
  }

  const now = options.now ?? Date.now;
  const lifetimeMs = options.lifetimeMs ?? 15 * 60 * 1000;
  const key = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  return {
    async issue(binding) {
      const version = "v1";
      const expiresAt = (now() + lifetimeMs).toString(36);
      const nonceBytes = new Uint8Array(16);
      crypto.getRandomValues(nonceBytes);
      const nonce = toHex(nonceBytes);
      const signature = await crypto.subtle.sign(
        "HMAC",
        await key,
        signingInput(version, expiresAt, nonce, binding),
      );

      return `${version}.${expiresAt}.${nonce}.${toHex(new Uint8Array(signature))}`;
    },

    async verify({ token, ...binding }) {
      const [version, expiresAt, nonce, signatureHex, ...remainder] = token.split(".");
      if (
        version !== "v1" ||
        expiresAt === undefined ||
        nonce === undefined ||
        !/^[0-9a-f]{32}$/.test(nonce) ||
        signatureHex === undefined ||
        !/^[0-9a-f]{64}$/.test(signatureHex) ||
        remainder.length !== 0
      ) {
        return false;
      }

      const expiry = Number.parseInt(expiresAt, 36);
      if (!Number.isSafeInteger(expiry) || expiry <= now()) {
        return false;
      }

      const signature = Uint8Array.from(
        signatureHex.match(/.{2}/g) ?? [],
        (byte) => Number.parseInt(byte, 16),
      );

      return crypto.subtle.verify(
        "HMAC",
        await key,
        signature,
        signingInput(version, expiresAt, nonce, binding),
      );
    },
  };
}

export const unavailableCsrfProtector: CsrfProtector = {
  issue: async () => {
    throw new Error("CSRF protection is not configured");
  },
  verify: async () => false,
};
