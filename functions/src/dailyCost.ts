import { costCapMessage } from "./accessCopy";
import { GateError } from "./gate";
import { usdToMicros } from "./pricing";

/**
 * One document per uid per US Eastern day:
 * daily_cost/{uid}/days/{yyyy-mm-dd} { usdMicros }.
 *
 * The check is one read. The increment happens later, after the model call,
 * with FieldValue.increment. Two requests that both read under the cap can
 * both run, so the day's total can overshoot the cap by about one in-flight
 * call. That race is accepted so the pre-check stays a single document read.
 *
 * AI_ALLOWLIST_UIDS does not skip this cap. The allowlist only skips the
 * paid-entitlement check.
 */
export function dailyCostDocPath(uid: string, day: string): string {
  return `daily_cost/${uid}/days/${day}`;
}

export function microsOnDay(
  storedDay: string | undefined,
  storedMicros: number | undefined,
  day: string
): number {
  if (storedDay !== day || typeof storedMicros !== "number" || !Number.isFinite(storedMicros)) return 0;
  return Math.max(0, Math.floor(storedMicros));
}

export function isDailyCostCapped(spentMicros: number, capUsd: number): boolean {
  return spentMicros >= usdToMicros(capUsd);
}

export function costCapReachedError(): GateError {
  return new GateError(429, "cost_cap_reached", costCapMessage());
}

export async function assertUnderDailyCostCap(input: {
  spentMicros: number;
  capUsd: number;
}): Promise<void> {
  if (isDailyCostCapped(input.spentMicros, input.capUsd)) {
    throw costCapReachedError();
  }
}
