export interface TenantContext {
  readonly tenantId: string;
}

export async function withTenant<T>(
  tenantId: string,
  fn: (context: TenantContext) => Promise<T>,
): Promise<T> {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error("withTenant requires a valid non-empty tenantId.");
  }
  return await fn({ tenantId });
}
