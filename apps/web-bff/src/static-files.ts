import * as fs from "node:fs";
import * as path from "node:path";
import type { Context } from "hono";

const PROTOTYPES_DIR = path.resolve(process.cwd(), "prototypes");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export function servePrototypeFile(relativePath: string, c: Context): Response | undefined {
  const sanitized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PROTOTYPES_DIR, sanitized);

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return undefined;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  const content = fs.readFileSync(filePath);

  return c.body(content, 200, {
    "Content-Type": contentType,
  });
}
