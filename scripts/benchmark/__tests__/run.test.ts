/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { readLedger } from '../cost';
import { AllModelsFailedError, HardStopError, JudgeMixError } from '../errors';
import { createOpenRouterClient, type FetchLike } from '../openrouter';
import { EXTROVERSION_EXCLUSION_REASON, matchModels } from '../match';
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
    expect(scoreFile.judge.recorded_at).toBe('2026-10-25T04:00:00.000Z');
    expect(scoreFile.models[0].runs[0].recorded_at).toBe('2026-10-25T04:00:00.000Z');
    expect(scoreFile.models[0].runs[0].judge_version).toBe(scoreFile.judge.version);
    expect(scoreFile.models[0].runs[0].max_output_tokens).toBe(config.interview.maxOutputTokens);
    expect(scoreFile.models[0].runs[0].reasoning_effort).toBe('minimal');
    expect(scoreFile.output_budget.reasoning_effort).toBe('minimal');
    expect(new Set(calls.map((call) => call.reasoningEffort))).toEqual(new Set(['minimal']));
    expect(new Set(calls.map((call) => call.maxTokens))).toEqual(new Set([config.interview.maxOutputTokens]));
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
    expect(scoreFile.models[0].traits.openness).toMatchObject({ mean: 33, low: 33, high: 33, runs: 1, fewer_runs: true });
    expect(scoreFile.models[0].failed_runs).toBe(1);
    expect(scoreFile.models[0].not_scored_reason).toBeNull();
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

  it('does not let an estimated ledger row trip the monthly warning', async () => {
    const dir = tempDir();
    const ledgerPath = path.join(dir, 'ledger.jsonl');
    fs.writeFileSync(ledgerPath, `${JSON.stringify({
      ts: '2026-10-02T00:00:00.000Z',
      run_id: 'failed-earlier',
      model_id: 'openai/gpt-5-nano',
      kind: 'interview',
      scenario_id: 'demo-bug',
      repeat: 1,
      prompt_tokens: 10,
      completion_tokens: 1024,
      cost_usd: 100,
      estimated: true,
    })}\n`);
    const warnings: string[] = [];
    const { client } = recordingClient({ promptTokens: 1, completionTokens: 1 });
    await runBenchmark({
      config: testConfig({
        warnPerMonthUsd: 40,
        judgeModelId: 'openai/gpt-5-nano',
        models: [{ id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 0, outputPerMillionUsd: 0 }],
      }),
      client,
      scenarios: [{ id: 'one', text: 'scenario' }],
      now: fixedNow,
      scoreFilePath: path.join(dir, 'scores.json'),
      ledgerPath,
      existingScoreFile: null,
      logger: (_level, message) => warnings.push(message),
    });
    expect(warnings.some((warning) => warning.includes('Monthly cost'))).toBe(false);
  });

  it('retries a length cutoff once, records actual usage for each attempt, and never scores reasoning text', async () => {
    const dir = tempDir();
    let nanoAttempts = 0;
    const requests: Array<{ model: string; max_tokens: number; reasoning: unknown; messages: Array<{ role: string; content: string }> }> = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(init.body) as {
        model: string;
        max_tokens: number;
        reasoning: unknown;
        messages: Array<{ role: string; content: string }>;
      };
      requests.push(body);
      expect(body.reasoning).toEqual({ effort: 'minimal' });
      expect(init.headers.Authorization).not.toContain('sk-live');
      const interview = body.messages.every((message) => message.role !== 'system');
      if (body.model === 'openai/gpt-5-nano' && interview) {
        nanoAttempts += 1;
        if (nanoAttempts === 1) {
          return jsonResponse({
            model: 'openai/gpt-5-nano',
            choices: [{
              finish_reason: 'length',
              native_finish_reason: 'max_output_tokens',
              message: { content: null, reasoning: 'SECRET_REASONING_TEXT' },
            }],
            usage: { prompt_tokens: 11, completion_tokens: 64, completion_tokens_details: { reasoning_tokens: 64 } },
          });
        }
        return jsonResponse({
          model: 'openai/gpt-5-nano',
          choices: [{
            finish_reason: 'stop',
            message: { content: 'I would fix the bug.', reasoning: 'SECRET_REASONING_TEXT' },
          }],
          usage: { prompt_tokens: 11, completion_tokens: 8, completion_tokens_details: { reasoning_tokens: 0 } },
        });
      }
      if (!interview) {
        expect(JSON.stringify(body.messages)).not.toContain('SECRET_REASONING_TEXT');
      }
      return jsonResponse({
        model: body.model,
        choices: [{
          finish_reason: 'stop',
          message: {
            content: interview ? 'plain answer' : scoreText(neutralScores({ openness: 77 })),
            reasoning: 'SECRET_REASONING_TEXT',
          },
        }],
        usage: { prompt_tokens: 11, completion_tokens: interview ? 4 : 12 },
      });
    };
    const client = createOpenRouterClient({
      apiKey: 'sk-test-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetchImpl,
    });
    const scoreFile = await runBenchmark({
      config: testConfig({
        repeats: 1,
        maxOutputTokens: 64,
        retryMaxOutputTokens: 128,
        models: [
          { id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.4 },
          { id: 'google/gemini-2.5-flash-lite', enabled: true, inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
        ],
      }),
      client,
      scenarios: [{ id: 'demo-bug', text: 'A bug appears in the demo.' }],
      now: fixedNow,
      scoreFilePath: path.join(dir, 'scores.json'),
      ledgerPath: path.join(dir, 'ledger.jsonl'),
      existingScoreFile: null,
    });
    expect(nanoAttempts).toBe(2);
    expect(requests.filter((request) => request.model === 'openai/gpt-5-nano' && request.messages.every((message) => message.role !== 'system')).map((request) => request.max_tokens)).toEqual([64, 128]);
    expect(new Set(requests.map((request) => JSON.stringify(request.reasoning)))).toEqual(new Set([JSON.stringify({ effort: 'minimal' })]));
    const ledger = readLedger(path.join(dir, 'ledger.jsonl'));
    const nanoInterview = ledger.filter((entry) => entry.model_id === 'openai/gpt-5-nano' && entry.kind === 'interview');
    expect(nanoInterview).toHaveLength(2);
    expect(nanoInterview.map((entry) => [entry.completion_tokens, entry.estimated])).toEqual([[64, false], [8, false]]);
    expect(ledger).toHaveLength(requests.length);
    expect(JSON.stringify(scoreFile)).not.toContain('SECRET_REASONING_TEXT');
    expect(scoreFile.models[0].runs[0].max_output_tokens).toBe(128);
    expect(scoreFile.models[0].runs[0].reasoning_effort).toBe('minimal');
    expect(scoreFile.models[0].traits.openness.mean).toBe(77);
    expect(scoreFile.output_budget).toMatchObject({ max_output_tokens: 64, retry_max_output_tokens: 128, reasoning_effort: 'minimal' });
  });

  it('keeps going when one model stays truncated and marks a majority failure not_scored', async () => {
    const dir = tempDir();
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(init.body) as { model: string; messages: Array<{ role: string }> };
      const interview = body.messages.every((message) => message.role !== 'system');
      if (body.model === 'openai/gpt-5-nano' && interview) {
        return jsonResponse({
          model: body.model,
          choices: [{
            finish_reason: 'length',
            message: { content: null, reasoning: 'SECRET_REASONING_TEXT' },
          }],
          usage: { prompt_tokens: 9, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 40 } },
        });
      }
      return jsonResponse({
        model: body.model,
        choices: [{
          message: { content: interview ? 'answer' : scoreText(neutralScores({ openness: 81 })) },
        }],
        usage: { prompt_tokens: 9, completion_tokens: 5 },
      });
    };
    const warnings: string[] = [];
    const scoreFile = await runBenchmark({
      config: testConfig({
        repeats: 1,
        maxOutputTokens: 40,
        models: [
          { id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.4 },
          { id: 'google/gemini-2.5-flash-lite', enabled: true, inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
        ],
      }),
      client: createOpenRouterClient({ apiKey: 'sk-test-secret', baseUrl: 'https://openrouter.ai/api/v1', fetchImpl }),
      scenarios: [{ id: 'demo-bug', text: 'A bug appears in the demo.' }],
      now: fixedNow,
      scoreFilePath: path.join(dir, 'scores.json'),
      ledgerPath: path.join(dir, 'ledger.jsonl'),
      existingScoreFile: null,
      logger: (level, message) => {
        if (level === 'warn') warnings.push(message);
      },
    });
    const nano = scoreFile.models.find((model) => model.id === 'openai/gpt-5-nano');
    const gemini = scoreFile.models.find((model) => model.id === 'google/gemini-2.5-flash-lite');
    expect(nano?.scored_runs).toBe(0);
    expect(nano?.failed_runs).toBe(1);
    expect(nano?.fewer_runs).toBe(true);
    expect(nano?.not_scored_reason).toMatch(/Failed 1 of 1/);
    expect(nano?.traits.openness).toMatchObject({ runs: 0, confidence: 'not_scored', fewer_runs: true, mean: null });
    expect(nano?.failures[0]).toMatchObject({ scenario_id: 'demo-bug', kind: 'interview', max_output_tokens: 80 });
    expect(gemini?.traits.openness.mean).toBe(81);
    expect(gemini?.scored_runs).toBe(1);
    const ledger = readLedger(path.join(dir, 'ledger.jsonl'));
    const nanoRows = ledger.filter((entry) => entry.model_id === 'openai/gpt-5-nano');
    expect(nanoRows).toHaveLength(2);
    expect(nanoRows.every((entry) => entry.estimated === false && entry.completion_tokens === 40)).toBe(true);
    expect(JSON.stringify(scoreFile)).not.toContain('SECRET_REASONING_TEXT');
    expect(warnings.some((warning) => warning.includes('openai/gpt-5-nano'))).toBe(true);
    const matched = matchModels(neutralScores({ openness: 90 }), scoreFile);
    expect(matched.models.find((model) => model.model_id === 'openai/gpt-5-nano')).toMatchObject({
      tier: 'not_scored',
      not_scored_reason: nano?.not_scored_reason,
    });
    expect(matched.models.find((model) => model.model_id === 'google/gemini-2.5-flash-lite')?.tier).toBe('strong');
  });

  it('flags fewer successful runs without marking a minority of failures not_scored', async () => {
    const dir = tempDir();
    let calls = 0;
    const client: ChatClient = {
      async complete(request) {
        calls += 1;
        if (calls === 1) throw new Error('upstream HTTP 500');
        return {
          content: request.kind === 'judge' ? scoreText(neutralScores({ openness: 44 })) : 'answer',
          modelVersion: request.kind === 'judge' ? 'judge-v1' : 'model-v1',
          promptTokens: 3,
          completionTokens: 4,
          usageEstimated: false,
        };
      },
    };
    const scoreFile = await runBenchmark({
      config: testConfig({
        repeats: 2,
        judgeModelId: 'openai/gpt-5-nano',
        models: [{ id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 1, outputPerMillionUsd: 1 }],
      }),
      client,
      scenarios: [{ id: 'one', text: 'scenario' }],
      now: fixedNow,
      scoreFilePath: path.join(dir, 'scores.json'),
      ledgerPath: path.join(dir, 'ledger.jsonl'),
      existingScoreFile: null,
    });
    expect(scoreFile.models[0].traits.openness).toMatchObject({ mean: 44, runs: 1, fewer_runs: true, confidence: 'normal' });
    expect(scoreFile.models[0].failed_runs).toBe(1);
    expect(scoreFile.models[0].not_scored_reason).toBeNull();
    const ledger = readLedger(path.join(dir, 'ledger.jsonl'));
    expect(ledger[0]).toMatchObject({ estimated: true, kind: 'interview' });
    expect(ledger.slice(1).every((entry) => entry.estimated === false)).toBe(true);
    expect(ledger.filter((entry) => entry.kind === 'interview' && entry.repeat === 1)).toHaveLength(1);
  });

  it('keeps the scored mean when most runs fail and marks the model not_scored', async () => {
    const dir = tempDir();
    let interviews = 0;
    const client: ChatClient = {
      async complete(request) {
        if (request.kind === 'interview') {
          interviews += 1;
          if (interviews <= 2) throw new Error('upstream HTTP 500');
        }
        return {
          content: request.kind === 'judge' ? scoreText(neutralScores({ openness: 62 })) : 'answer',
          modelVersion: request.kind === 'judge' ? 'judge-v1' : 'model-v1',
          promptTokens: 2,
          completionTokens: 3,
          usageEstimated: false,
        };
      },
    };
    const scoreFile = await runBenchmark({
      config: testConfig({
        repeats: 3,
        judgeModelId: 'openai/gpt-5-nano',
        models: [{ id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 0, outputPerMillionUsd: 0 }],
      }),
      client,
      scenarios: [{ id: 'one', text: 'scenario' }],
      now: fixedNow,
      scoreFilePath: path.join(dir, 'scores.json'),
      ledgerPath: path.join(dir, 'ledger.jsonl'),
      existingScoreFile: null,
    });
    expect(scoreFile.models[0].traits.openness).toMatchObject({
      mean: 62,
      runs: 1,
      fewer_runs: true,
      confidence: 'not_scored',
    });
    expect(scoreFile.models[0].failed_runs).toBe(2);
    expect(scoreFile.models[0].not_scored_reason).toMatch(/Failed 2 of 3/);
    const matched = matchModels(neutralScores({ openness: 90 }), scoreFile);
    expect(matched.models[0]).toMatchObject({ tier: 'not_scored' });
  });

  it('writes the score file and fails the process only when every model fails', async () => {
    const dir = tempDir();
    const client: ChatClient = {
      async complete() {
        throw new Error('upstream HTTP 503');
      },
    };
    const scorePath = path.join(dir, 'scores.json');
    await expect(runBenchmark({
      config: testConfig({
        repeats: 1,
        models: [
          { id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
          { id: 'google/gemini-2.5-flash-lite', enabled: true, inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
        ],
      }),
      client,
      scenarios: [{ id: 'one', text: 'scenario' }],
      now: fixedNow,
      scoreFilePath: scorePath,
      ledgerPath: path.join(dir, 'ledger.jsonl'),
      existingScoreFile: null,
    })).rejects.toBeInstanceOf(AllModelsFailedError);
    const saved = readScoreFile(scorePath);
    expect(saved?.models.map((model) => model.scored_runs)).toEqual([0, 0]);
    expect(saved?.models.every((model) => model.not_scored_reason)).toBe(true);
  });

  it('replaces scores.json with only this run’s enabled models', async () => {
    const dir = tempDir();
    const scorePath = path.join(dir, 'scores.json');
    const ledgerPath = path.join(dir, 'ledger.jsonl');
    const first = await runBenchmark({
      config: testConfig({
        models: [
          { id: 'openai/gpt-5-nano', enabled: true, inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
          { id: 'google/gemini-2.5-flash-lite', enabled: true, inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
        ],
      }),
      client: recordingClient().client,
      scenarios: [{ id: 'one', text: 'scenario' }],
      now: fixedNow,
      scoreFilePath: scorePath,
      ledgerPath,
    });
    expect(first.models.map((model) => model.id)).toEqual([
      'openai/gpt-5-nano',
      'google/gemini-2.5-flash-lite',
    ]);

    const stored = JSON.parse(fs.readFileSync(scorePath, 'utf8')) as {
      strategy_table: Array<{ trait: string; exclusion_reason: string | null }>;
    };
    const previousWording = 'Excluded from tiering: benchmarked models scored extroversion between 55 and 61, and the table needs a model below 50. Means are still reported.';
    for (const row of stored.strategy_table) {
      if (row.trait === 'extroversion') row.exclusion_reason = previousWording;
    }
    fs.writeFileSync(scorePath, JSON.stringify(stored));
    const stale = readScoreFile(scorePath);
    expect(stale).not.toBeNull();
    expect(() => matchModels(neutralScores({ openness: 90 }), stale!)).toThrow(/exclusion_reason/);
    expect(() => matchModels(neutralScores({ openness: 90 }), stale!)).toThrow(/Delete the existing scores.json/);

    const replaced = await runBenchmark({
      config: testConfig({
        models: [
          { id: 'openai/gpt-5-nano', enabled: false, inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
          { id: 'google/gemini-2.5-flash-lite', enabled: true, inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
          { id: 'qwen/qwen3-235b-a22b-2507', enabled: true, inputPerMillionUsd: 0.09, outputPerMillionUsd: 0.55 },
        ],
      }),
      client: recordingClient({ scores: neutralScores({ openness: 11 }) }).client,
      scenarios: [{ id: 'one', text: 'scenario' }],
      now: fixedNow,
      scoreFilePath: scorePath,
      ledgerPath,
    });
    expect(replaced.models.map((model) => model.id)).toEqual([
      'google/gemini-2.5-flash-lite',
      'qwen/qwen3-235b-a22b-2507',
    ]);
    const saved = readScoreFile(scorePath);
    expect(saved?.models.map((model) => model.id)).toEqual([
      'google/gemini-2.5-flash-lite',
      'qwen/qwen3-235b-a22b-2507',
    ]);
    expect(saved?.strategy_table.filter((row) => row.trait === 'extroversion').every((row) => row.exclusion_reason === EXTROVERSION_EXCLUSION_REASON)).toBe(true);
    expect(JSON.stringify(saved)).not.toContain('between 55 and 61');
  });
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(body);
    },
  };
}

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
