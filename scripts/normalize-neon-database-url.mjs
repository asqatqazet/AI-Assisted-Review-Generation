const value = process.env.DATABASE_URL_TO_NORMALIZE;

if (value === undefined) {
  process.exitCode = 1;
} else {
  try {
    const url = new URL(value);
    url.search = "";
    url.searchParams.set("sslmode", "require");
    url.searchParams.set("channel_binding", "require");
    process.stdout.write(url.toString());
  } catch {
    process.exitCode = 1;
  }
}
