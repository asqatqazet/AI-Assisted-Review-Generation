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
      url.searchParams.get("sslmode") === "require";
  }
} catch {
  valid = false;
}

process.exitCode = valid ? 0 : 1;
