/**
 * Console publication takes advisory locks and materializes immutable
 * snapshots in one transaction. A direct remote Neon connection can exceed
 * Prisma's five-second interactive transaction default without being stuck.
 */
export const consoleTransactionOptions = {
  maxWait: 10_000,
  timeout: 30_000,
} as const;
