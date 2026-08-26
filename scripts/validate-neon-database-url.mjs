const value = process.env.DATABASE_URL_TO_CHECK;
let valid = false;

try {
  if (value !== undefined && value === value.trim()) {
    const url = new URL(value);
    const firstHostnameLabel = url.hostname.split(".")[0] ?? "";
    valid =
      (url.protocol === "postgresql:" || url.protocol === "postgres:") &&
      url.hostname.endsWith(".neon.tech") &&
      !firstHostnameLabel.endsWith("-pooler") &&
      url.username.length > 0 &&
      url.password.length > 0 &&
      url.searchParams.getAll("sslmode").length === 1 &&
      url.searchParams.get("sslmode") === "require" &&
      url.searchParams.getAll("channel_binding").length <= 1 &&
      [null, "require"].includes(url.searchParams.get("channel_binding")) &&
      [...url.searchParams.keys()].every((key) =>
        ["sslmode", "channel_binding"].includes(key),
      );
  }
} catch {
  valid = false;
}

process.exitCode = valid ? 0 : 1;
