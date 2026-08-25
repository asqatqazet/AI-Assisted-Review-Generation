/**
 * Builds a service-role URL for integration tests only. Local Unix-socket
 * clusters can use peer/trust authentication; CI supplies the password it
 * assigned to every disposable service role.
 */
export function databaseUrlForTestRole(input: {
  readonly databaseUrl: string;
  readonly role: string;
  readonly serviceRolePassword?: string;
}): string {
  const url = new URL(input.databaseUrl);
  url.username = input.role;
  url.password =
    input.serviceRolePassword ??
    process.env["TEST_SERVICE_ROLE_PASSWORD"] ??
    "";
  return url.toString();
}
