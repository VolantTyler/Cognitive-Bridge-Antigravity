/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { readLedger } from '../cost';
import { HardStopError, JudgeMixError } from '../errors';
import type { ChatClient, ChatRequest } from '../types';
import { readScoreFile } from '../scorefile';
import { runBenchmark } from '../run';
import { neutralScores, recordingClient, scoreText, tempDir, testConfig } from './fixture';

const fixedNow = () => new Date('2026-10-25T04:00:00.000Z');

describe('benchmark run', () => {
  it('sends the same scenarios in order with no system message and one fixed temperature', async () => {
    const dir = tempDir();
    const { client, calls } = recordingClient({
      scores: neutralScores({ openness: 80, conscientiousness: 20 }),
    });
    const scenarios = [
      { id: 'one', text: 'First scenario text' },
      { id: 'two', text: 'Second scenario text' },
    ];
    const config = testConfig({ repeats: 2 });
    const scoreFile = await runBenchmark({
      config,
      client,
      scenarios,
      now: fixedNow,
      scoreFilePath: path.join(dir, 'scores.json'),
      ledgerPath: path.join(dir, 'ledger.jsonl'),
      existingScoreFile: null,
    });

    const interviews = calls.filter((call) => call.kind === 'interview');
    const judges = calls.filter((call) => call.kind === 'judge');
    expect(interviews).toHaveLength(8);
    expect(judges).toHaveLength(4);
    for (const call of interviews) {
      expect(call.messages).toEqual([{ role: 'user', content: call.messages[0].content }]);
      expect(call.messages.some((message) => message.role === 'system')).toBe(false);
      expect(call.temperature).toBe(0.8);
      expect(JSON.stringify(call.messages)).not.toContain('"role":"system"');
    }
    for (const call of judges) {
      expect(call.temperature).toBe(0);
      expect(call.messages[0].role).toBe('system');
      expect(call.messages[0].content).toContain('JSON_SCORES');
    }
    const firstRepeat = interviews.filter((call) => call.model === 'openai/gpt-5-nano' && call.repeat === 1);
    expect(firstRepeat.map((call) => call.messages[0].content)).toEqual(['First scenario text', 'Second scenario text']);
    const otherModel = interviews.filter((call) => call.model === 'google/gemini-2.5-flash-lite' && call.repeat === 2);
    expect(otherModel.map((call) => call.messages[0].content)).toEqual(['First scenario text', 'Second scenario text']);

    expect(scoreFile.models[0].traits.openness).toMatchObject({ mean: 80, low: 80, high: 80, runs: 2 });
    expect(scoreFile.models[0].version).toBe('openai/gpt-5-nano-2026-10-05');
    expect(scoreFile.judge.version).toBe('google/gemini-2.5-flash-lite-2026-10-05');
    expect(scoreFile.spread_warning).toBe(true);

    const ledger = readLedger(path.join(dir, 'ledger.jsonl'));
    expect(ledger).toHaveLength(calls.length);
    expect(ledger[0].prompt_tokens).toBe(10);
    expect(ledger[0].completion_tokens).toBe(20);
    expect(ledger[0].cost_usd).toBeGreaterThan(0);
    expect(JSON.stringify(ledger)).not.toContain('sk-');
  });

  it('drops an unscorable judge reply from the aggregate', async () => {
    const dir = tempDir();
    const { client } = recordingClient({
      judgeContent: (index) => (index === 1 ? 'no scores' : scoreText(neutralScores({ openness: 33 }))),
    });
    const scoreFile = await runBenchmark({
      config: testConfig({
        repeats: 2,
        judgeModelId: 'openai/gpt-5-nano',
        models: [{ id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.4 }],
      }),
      client,
      scenarios: [{ id: 'one', text: 'Only scenario' }],
      now: fixedNow,
      scoreFilePath: path.join(dir, 'scores.json'),
      ledgerPath: path.join(dir, 'ledger.jsonl'),
      existingScoreFile: null,
    });
    expect(scoreFile.models[0].traits.openness).toMatchObject({ mean: 33, low: 33, high: 33, runs: 1 });
  });

  it('aborts before a call that would exceed the hard stop', async () => {
    const dir = tempDir();
    const calls: ChatRequest[] = [];
    const client: ChatClient = {
      async complete(request) {
        calls.push(request);
        return {
          content: request.kind === 'judge' ? scoreText(neutralScores()) : 'answer',
          modelVersion: request.kind === 'judge' ? 'judge-v1' : 'model-v1',
          promptTokens: 0,
          completionTokens: 10,
          usageEstimated: false,
        };
      },
    };
    const config = testConfig({
      repeats: 1,
      maxOutputTokens: 10,
      judgeMaxOutputTokens: 10,
      hardStopPerRunUsd: 15,
      warnPerRunUsd: 10,
      models: [
        { id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 0, outputPerMillionUsd: 600_000 },
        { id: 'google/gemini-2.5-flash-lite', enabled: true, inputPerMillionUsd: 0, outputPerMillionUsd: 600_000 },
      ],
    });
    const warnings: string[] = [];
    await expect(runBenchmark({
      config,
      client,
      scenarios: [{ id: 'one', text: 'scenario' }],
      now: fixedNow,
      scoreFilePath: path.join(dir, 'scores.json'),
      ledgerPath: path.join(dir, 'ledger.jsonl'),
      existingScoreFile: null,
      logger: (level, message) => {
        if (level === 'warn') warnings.push(message);
      },
    })).rejects.toBeInstanceOf(HardStopError);
    expect(calls).toHaveLength(2);
    expect(calls[2]).toBeUndefined();
    const partial = readScoreFile(path.join(dir, 'scores.json'));
    expect(partial?.partial).toBe(true);
    expect(partial?.models.map((model) => model.id)).toEqual(['openai/gpt-5-nano']);
    expect(warnings.some((warning) => warning.includes('Run cost'))).toBe(true);
  });

  it('does not call the network when the stored judge version differs', async () => {
    const dir = tempDir();
    let called = false;
    const client: ChatClient = {
      async complete() {
        called = true;
        throw new Error('should not be called');
      },
    };
    const existing = JSON.parse(JSON.stringify(await seedScore(dir))) as { judge: { version: string } };
    existing.judge.version = 'google/gemini-2.5-flash-lite-001';
    fs.writeFileSync(path.join(dir, 'scores.json'), JSON.stringify(existing));
    await expect(runBenchmark({
      config: testConfig({
        judgeModelId: 'openai/gpt-5-nano',
        judgeVersion: 'google/gemini-2.5-flash-lite-002',
        models: [{ id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 0, outputPerMillionUsd: 0 }],
      }),
      client,
      scenarios: [{ id: 'one', text: 'scenario' }],
      now: fixedNow,
      scoreFilePath: path.join(dir, 'scores.json'),
      ledgerPath: path.join(dir, 'ledger.jsonl'),
    })).rejects.toThrow(JudgeMixError);
    expect(called).toBe(false);
  });

  it('refuses to mix a live judge version and still allows --rescore-all', async () => {
    const dir = tempDir();
    const seeded = await seedScore(dir);
    const calls: string[] = [];
    const client: ChatClient = {
      async complete(request) {
        calls.push(request.kind);
        return {
          content: request.kind === 'judge' ? scoreText(neutralScores({ openness: 61 })) : 'answer',
          modelVersion: request.kind === 'judge' ? 'judge-NEW' : 'model-v2',
          promptTokens: 1,
          completionTokens: 1,
          usageEstimated: false,
        };
      },
    };
    const config = testConfig({
      judgeModelId: 'openai/gpt-5-nano',
      models: [{ id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 0, outputPerMillionUsd: 0 }],
    });
    await expect(runBenchmark({
      config,
      client,
      scenarios: [{ id: 'one', text: 'scenario' }],
      now: fixedNow,
      scoreFilePath: path.join(dir, 'scores.json'),
      ledgerPath: path.join(dir, 'other.jsonl'),
    })).rejects.toThrow(/--rescore-all/);
    expect(readScoreFile(path.join(dir, 'scores.json'))?.judge.version).toBe(seeded.judge.version);

    calls.length = 0;
    const replaced = await runBenchmark({
      config,
      client,
      scenarios: [{ id: 'one', text: 'scenario' }],
      now: fixedNow,
      rescoreAll: true,
      scoreFilePath: path.join(dir, 'scores.json'),
      ledgerPath: path.join(dir, 'other.jsonl'),
    });
    expect(replaced.judge.version).toBe('judge-NEW');
    expect(replaced.models[0].traits.openness.mean).toBe(61);
  });

  it('warns when the UTC month crosses $40', async () => {
    const dir = tempDir();
    const ledgerPath = path.join(dir, 'ledger.jsonl');
    fs.writeFileSync(ledgerPath, `${JSON.stringify({
      ts: '2026-10-01T00:00:00.000Z',
      run_id: 'prior',
      model_id: 'openai/gpt-5-nano',
      kind: 'interview',
      scenario_id: null,
      repeat: 1,
      prompt_tokens: 1,
      completion_tokens: 1,
      cost_usd: 39,
      estimated: false,
    })}\n${JSON.stringify({
      ts: '2026-09-01T00:00:00.000Z',
      run_id: 'prior',
      model_id: 'openai/gpt-5-nano',
      kind: 'interview',
      scenario_id: null,
      repeat: 1,
      prompt_tokens: 1,
      completion_tokens: 1,
      cost_usd: 100,
      estimated: false,
    })}\n`);
    const warnings: string[] = [];
    const { client } = recordingClient({ promptTokens: 1_000_000, completionTokens: 0 });
    await runBenchmark({
      config: testConfig({
        warnPerMonthUsd: 40,
        hardStopPerRunUsd: 100,
        models: [
          { id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 2, outputPerMillionUsd: 0 },
          { id: 'google/gemini-2.5-flash-lite', enabled: true, inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
        ],
      }),
      client,
      scenarios: [{ id: 'one', text: 'scenario' }],
      now: fixedNow,
      scoreFilePath: path.join(dir, 'scores.json'),
      ledgerPath,
      existingScoreFile: null,
      logger: (level, message) => {
        if (level === 'warn') warnings.push(message);
      },
    });
    expect(warnings.some((warning) => warning.includes('Monthly cost'))).toBe(true);
  });
});

async function seedScore(dir: string) {
  const { client } = recordingClient({ judgeVersion: 'google/gemini-2.5-flash-lite-001' });
  return runBenchmark({
    config: testConfig({
      judgeModelId: 'openai/gpt-5-nano',
      models: [{ id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 0, outputPerMillionUsd: 0 }],
    }),
    client,
    scenarios: [{ id: 'one', text: 'scenario' }],
    now: fixedNow,
    scoreFilePath: path.join(dir, 'scores.json'),
    ledgerPath: path.join(dir, 'seed-ledger.jsonl'),
    existingScoreFile: null,
  });
}
