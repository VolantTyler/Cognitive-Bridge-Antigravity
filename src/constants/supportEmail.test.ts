import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL } from "./checkoutCopy";

const SUPPORT_ADDRESS = "cos-stahl+cbsupport@mail.grokbot.com";

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "lib" || entry === "dist") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("support email", () => {
  it("is one address, defined once, and is not a bracket placeholder", () => {
    expect(SUPPORT_EMAIL).toBe(SUPPORT_ADDRESS);
    const offenders: string[] = [];
    for (const root of ["src", "functions/src"]) {
      for (const file of filesUnder(root)) {
        if (file.endsWith(`${path.sep}checkoutCopy.ts`) || file.endsWith(`${path.sep}supportEmail.test.ts`)) continue;
        const text = readFileSync(file, "utf8");
        if (
          text.includes(SUPPORT_ADDRESS) ||
          text.includes("SUPPORT_EMAIL_PLACEHOLDER") ||
          text.includes("[SUPPORT EMAIL")
        ) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("commits functions/.env with the test-mode price and no secrets", () => {
    const text = readFileSync("functions/.env", "utf8");
    expect(text).toBe(
      [
        "# Non-secret function config. `firebase deploy` loads this file from the functions directory.",
        "# Stripe test mode only. STRIPE_PRICE_ID is a test-mode Price ID, not a secret.",
        "AI_GATE_MODE=paid",
        "PAYMENTS_ENABLED=true",
        "LEGACY_ACCESS_CUTOFF=2026-11-09T19:00:00.000Z",
        "STRIPE_PRICE_ID=price_1UZy2AIlhaYGK2ond2TfcrGe",
        "",
      ].join("\n")
    );
    expect(text).not.toMatch(/sk_live_|sk_test_|whsec_|pending/i);
    const ignored = spawnSync("git", ["check-ignore", "-q", "functions/.env"], { encoding: "utf8" });
    expect(ignored.status).toBe(1);
  });
});
