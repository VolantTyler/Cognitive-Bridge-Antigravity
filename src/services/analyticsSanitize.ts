const BLOCKED_KEY = /email|e-mail|name|uid|user_id|userid|phone/i;

/** Drops identifiers. Analytics params stay limited to short non-email values. */
export function sanitizeAnalyticsParams(
  params?: Record<string, unknown>
): Record<string, string | number | boolean> | undefined {
  if (!params) return undefined;
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (BLOCKED_KEY.test(key)) continue;
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
