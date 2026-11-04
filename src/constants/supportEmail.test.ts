import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL_PLACEHOLDER } from "./checkoutCopy";

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

describe("support email placeholder", () => {
  it("is defined once so a later edit replaces every visible use", () => {
    expect(SUPPORT_EMAIL_PLACEHOLDER).toContain("pending Tyler");
    const offenders: string[] = [];
    for (const root of ["src", "functions/src"]) {
      for (const file of filesUnder(root)) {
        if (file.endsWith(`${path.sep}checkoutCopy.ts`)) continue;
        const text = readFileSync(file, "utf8");
        if (text.includes(SUPPORT_EMAIL_PLACEHOLDER)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
