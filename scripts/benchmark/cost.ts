/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { HardStopError } from './errors';
import type { LedgerEntry, PricedModel } from './types';

export interface SpendState {
  /** All recorded cost this run, including estimated rows. Used for the per-run warn and hard stop. */
  spentUsd: number;
  /** Recorded cost this run whose usage came from the API. Estimated rows are excluded. */
  spentActualUsd: number;
  runWarned: boolean;
  monthWarned: boolean;
  /** Ledger total for the current UTC month before this run, excluding estimated rows. */
  monthBaseUsd: number;
  runId: string;
}

export interface LimitCheck {
  allowCall: boolean;
  warnings: string[];
}

export function costUsd(promptTokens: number, completionTokens: number, price: PricedModel): number {
  return (
    (promptTokens / 1_000_000) * price.inputPerMillionUsd +
    (completionTokens / 1_000_000) * price.outputPerMillionUsd
  );
}

export function wouldExceedHardStop(spentUsd: number, nextCallUsd: number, hardStopUsd: number): boolean {
  return spentUsd + nextCallUsd > hardStopUsd;
}

export function monthKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 7);
}

/** Estimated rows are upper bounds for calls whose usage never came back. They do not count toward the monthly warning. */
export function countsTowardMonth(entry: LedgerEntry): boolean {
  return entry.estimated !== true;
}

export function spendForMonth(entries: LedgerEntry[], month: string): number {
  return entries
    .filter((entry) => monthKey(entry.ts) === month && countsTowardMonth(entry))
    .reduce((sum, entry) => sum + entry.cost_usd, 0);
}

/**
 * Decide whether the next call is allowed. This does not perform I/O.
 * A call that would pass the hard stop is refused before it is sent.
 */
export function assessCall(state: SpendState, nextCallUsd: number, limits: {
  warnPerRunUsd: number;
  hardStopPerRunUsd: number;
  warnPerMonthUsd: number;
}): LimitCheck {
  const warnings: string[] = [];
  if (wouldExceedHardStop(state.spentUsd, nextCallUsd, limits.hardStopPerRunUsd)) {
    return { allowCall: false, warnings };
  }
  const projectedRun = state.spentUsd + nextCallUsd;
  if (!state.runWarned && projectedRun >= limits.warnPerRunUsd) {
    warnings.push(
      `Run cost warning: this call would bring the run to about $${projectedRun.toFixed(6)}, at or above the $${limits.warnPerRunUsd.toFixed(2)} warning line.`,
    );
  }
  const projectedMonth = state.monthBaseUsd + state.spentActualUsd + nextCallUsd;
  if (!state.monthWarned && projectedMonth >= limits.warnPerMonthUsd) {
    warnings.push(
      `Monthly cost warning: spend for this UTC month would reach about $${projectedMonth.toFixed(6)}, at or above the $${limits.warnPerMonthUsd.toFixed(2)} warning line.`,
    );
  }
  return { allowCall: true, warnings };
}

export function hardStopMessage(spentUsd: number, nextCallUsd: number, hardStopUsd: number): string {
  return (
    `Hard stop at $${hardStopUsd.toFixed(2)} per run. ` +
    `Spent $${spentUsd.toFixed(6)}; the next call is estimated at $${nextCallUsd.toFixed(6)}, ` +
    `which would exceed the limit. The request was not sent.`
  );
}

export function assertCanSpend(spentUsd: number, nextCallUsd: number, hardStopUsd: number): void {
  if (wouldExceedHardStop(spentUsd, nextCallUsd, hardStopUsd)) {
    throw new HardStopError(hardStopMessage(spentUsd, nextCallUsd, hardStopUsd));
  }
}

export function readLedger(ledgerPath: string): LedgerEntry[] {
  if (!fs.existsSync(ledgerPath)) return [];
  const raw = fs.readFileSync(ledgerPath, 'utf8');
  if (!raw.trim()) return [];
  const entries: LedgerEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed) as LedgerEntry;
    if (typeof parsed.cost_usd !== 'number' || typeof parsed.ts !== 'string') {
      throw new Error(`Ledger line is missing ts or cost_usd: ${trimmed.slice(0, 120)}`);
    }
    entries.push(parsed);
  }
  return entries;
}

export function appendLedger(ledgerPath: string, entry: LedgerEntry): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function createRunId(now: Date = new Date()): string {
  return `run-${now.toISOString().replace(/[:.]/g, '-')}`;
}
