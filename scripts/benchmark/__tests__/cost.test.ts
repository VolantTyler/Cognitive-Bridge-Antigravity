/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  appendLedger,
  assessCall,
  costUsd,
  readLedger,
  spendForMonth,
  wouldExceedHardStop,
  type SpendState,
} from '../cost';
import { HardStopError } from '../errors';
import { assertCanSpend } from '../cost';
import { tempDir } from './fixture';

const price = { id: 'example/model', inputPerMillionUsd: 2, outputPerMillionUsd: 4 };

function state(partial: Partial<SpendState> = {}): SpendState {
  return {
    spentUsd: 0,
    runWarned: false,
    monthWarned: false,
    monthBaseUsd: 0,
    runId: 'run-test',
    ...partial,
  };
}

describe('cost ledger and limits', () => {
  it('prices tokens in USD per 1M', () => {
    expect(costUsd(1_000_000, 0, price)).toBe(2);
    expect(costUsd(0, 1_000_000, price)).toBe(4);
    expect(costUsd(10, 20, price)).toBeCloseTo(0.0001);
  });

  it('refuses a call that would pass the hard stop and allows one that would not', () => {
    expect(wouldExceedHardStop(14.9, 0.2, 15)).toBe(true);
    expect(wouldExceedHardStop(14.9, 0.1, 15)).toBe(false);
    expect(() => assertCanSpend(14.9, 0.2, 15)).toThrow(HardStopError);
    expect(() => assertCanSpend(14.9, 0.2, 15)).toThrow(/not sent/);
    const blocked = assessCall(state({ spentUsd: 14.9 }), 0.2, {
      warnPerRunUsd: 10,
      hardStopPerRunUsd: 15,
      warnPerMonthUsd: 40,
    });
    expect(blocked.allowCall).toBe(false);
    const allowed = assessCall(state({ spentUsd: 9 }), 0.5, {
      warnPerRunUsd: 10,
      hardStopPerRunUsd: 15,
      warnPerMonthUsd: 40,
    });
    expect(allowed.allowCall).toBe(true);
    expect(allowed.warnings.some((warning) => warning.startsWith('Run cost'))).toBe(false);
  });

  it('warns when the next call crosses the run or month line but still allows it', () => {
    const decision = assessCall(state({ spentUsd: 9.5, monthBaseUsd: 39 }), 1, {
      warnPerRunUsd: 10,
      hardStopPerRunUsd: 15,
      warnPerMonthUsd: 40,
    });
    expect(decision.allowCall).toBe(true);
    expect(decision.warnings.join('\n')).toMatch(/Run cost warning/);
    expect(decision.warnings.join('\n')).toMatch(/Monthly cost warning/);
  });

  it('sums the UTC month from the JSONL ledger and ignores other months', () => {
    const dir = tempDir();
    const ledgerPath = path.join(dir, 'ledger.jsonl');
    appendLedger(ledgerPath, {
      ts: '2026-10-02T00:00:00.000Z',
      run_id: 'old',
      model_id: 'openai/gpt-5-nano',
      kind: 'interview',
      scenario_id: 'demo-bug',
      repeat: 1,
      prompt_tokens: 100,
      completion_tokens: 50,
      cost_usd: 12.5,
      estimated: false,
    });
    appendLedger(ledgerPath, {
      ts: '2026-09-30T23:00:00.000Z',
      run_id: 'older',
      model_id: 'openai/gpt-5-nano',
      kind: 'judge',
      scenario_id: null,
      repeat: 1,
      prompt_tokens: 5,
      completion_tokens: 5,
      cost_usd: 100,
      estimated: false,
    });
    const entries = readLedger(ledgerPath);
    expect(entries).toHaveLength(2);
    expect(spendForMonth(entries, '2026-10')).toBeCloseTo(12.5);
    expect(fs.readFileSync(ledgerPath, 'utf8')).not.toContain('sk-');
  });
});
