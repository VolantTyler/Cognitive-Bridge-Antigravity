function blockedAnalyticsKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "id" || normalized === "uid" || normalized === "userid") return true;
  if (normalized.endsWith("userid") || normalized.endsWith("uid")) return true;
  return /email|phone|name|message|content|prompt|reply|answer|transcript|body/.test(normalized);
}

/** Drops identifiers and message text. Analytics params stay short and non-email. */
export function sanitizeAnalyticsParams(
  params?: Record<string, unknown>
): Record<string, string | number | boolean> | undefined {
  if (!params) return undefined;
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (blockedAnalyticsKey(key)) continue;
    if (typeof value === "string") {
      if (value.includes("@") || value.length > 80) continue;
      clean[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      clean[key] = value;
    } else if (typeof value === "boolean") {
      clean[key] = value;
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}
