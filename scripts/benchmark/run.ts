/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { priceOf, resolveRepoPath, runnableModels, skippedModels } from './config';
import {
  appendLedger,
  assessCall,
  costUsd,
  createRunId,
  hardStopMessage,
  readLedger,
  spendForMonth,
  type SpendState,
} from './cost';
import { ConfigError, HardStopError, JudgeMixError } from './errors';
import { interviewMessages } from './openrouter';
import { interviewScenarios } from './scenarios';
import {
  assertJudgeMixAllowed,
  buildScoreFile,
  readScoreFile,
  versionsAgree,
  writeScoreFile,
  type CompletedModelRun,
} from './scorefile';
import { buildInterviewTranscript, judgeMessages, parseMirrorScores } from './scorer';
import { estimateMessagesTokens } from './tokens';
import type { BenchmarkConfig, ChatClient, ChatRequest, ChatResponse, PricedModel, Scenario } from './types';

export interface RunOptions {
  config: BenchmarkConfig;
  client: ChatClient;
  scenarios?: Scenario[];
  rescoreAll?: boolean;
  now?: () => Date;
  runId?: string;
  logger?: (level: 'info' | 'warn' | 'error', message: string) => void;
  scoreFilePath?: string;
  ledgerPath?: string;
  existingScoreFile?: ReturnType<typeof readScoreFile>;
}

interface BilledResponse {
  response: ChatResponse;
  costUsd: number;
}

async function completeWithinBudget(options: {
  state: SpendState;
  config: BenchmarkConfig;
  request: ChatRequest;
  price: PricedModel;
  client: ChatClient;
  ledgerPath?: string;
  logger: (level: 'info' | 'warn' | 'error', message: string) => void;
  now: () => Date;
}): Promise<BilledResponse> {
  const estimate = costUsd(
    estimateMessagesTokens(options.request.messages),
    options.request.maxTokens,
    options.price,
  );
  const decision = assessCall(options.state, estimate, options.config.limits);
  if (!decision.allowCall) {
    throw new HardStopError(
      hardStopMessage(options.state.spentUsd, estimate, options.config.limits.hardStopPerRunUsd),
    );
  }
  for (const warning of decision.warnings) {
    if (warning.startsWith('Run cost') && !options.state.runWarned) {
      options.state.runWarned = true;
      options.logger('warn', warning);
    }
    if (warning.startsWith('Monthly cost') && !options.state.monthWarned) {
      options.state.monthWarned = true;
      options.logger('warn', warning);
    }
  }

  let response: ChatResponse;
  try {
    response = await options.client.complete(options.request);
  } catch (error) {
    recordSpend(options, {
      amountUsd: estimate,
      promptTokens: estimateMessagesTokens(options.request.messages),
      completionTokens: options.request.maxTokens,
      estimated: true,
      request: options.request,
    });
    throw error;
  }
  const actual = costUsd(response.promptTokens, response.completionTokens, options.price);
  recordSpend(options, {
    amountUsd: actual,
    promptTokens: response.promptTokens,
    completionTokens: response.completionTokens,
    estimated: response.usageEstimated,
    request: options.request,
  });
  return { response, costUsd: actual };
}

function recordSpend(
  options: {
    state: SpendState;
    config: BenchmarkConfig;
    ledgerPath?: string;
    logger: (level: 'info' | 'warn' | 'error', message: string) => void;
    now: () => Date;
  },
  entry: {
    amountUsd: number;
    promptTokens: number;
    completionTokens: number;
    estimated: boolean;
    request: ChatRequest;
  },
): void {
  options.state.spentUsd += entry.amountUsd;
  if (options.ledgerPath) {
    appendLedger(options.ledgerPath, {
      ts: options.now().toISOString(),
      run_id: options.state.runId,
      model_id: entry.request.model,
      kind: entry.request.kind,
      scenario_id: entry.request.scenarioId ?? null,
      repeat: entry.request.repeat ?? null,
      prompt_tokens: entry.promptTokens,
      completion_tokens: entry.completionTokens,
      cost_usd: entry.amountUsd,
      estimated: entry.estimated,
    });
  }
  if (!options.state.runWarned && options.state.spentUsd >= options.config.limits.warnPerRunUsd) {
    options.state.runWarned = true;
    options.logger(
      'warn',
      `Run cost warning: spent $${options.state.spentUsd.toFixed(6)}, at or above $${options.config.limits.warnPerRunUsd.toFixed(2)}.`,
    );
  }
  const monthTotal = options.state.monthBaseUsd + options.state.spentUsd;
  if (!options.state.monthWarned && monthTotal >= options.config.limits.warnPerMonthUsd) {
    options.state.monthWarned = true;
    options.logger(
      'warn',
      `Monthly cost warning: $${monthTotal.toFixed(6)} in this UTC month, at or above $${options.config.limits.warnPerMonthUsd.toFixed(2)}.`,
    );
  }
}

export async function runBenchmark(options: RunOptions): Promise<ReturnType<typeof buildScoreFile>> {
  const config = options.config;
  const scenarios = options.scenarios ?? interviewScenarios();
  const logger = options.logger ?? (() => {});
  const now = options.now ?? (() => new Date());
  const scoreFilePath = options.scoreFilePath ?? resolveRepoPath(config.paths.scoreFile);
  const ledgerPath = options.ledgerPath ?? resolveRepoPath(config.paths.ledger);
  const existing = options.existingScoreFile === undefined ? readScoreFile(scoreFilePath) : options.existingScoreFile;
  assertJudgeMixAllowed({
    stored: existing ? { modelId: existing.judge.model_id, version: existing.judge.version } : null,
    configJudge: { modelId: config.judge.modelId, version: config.judge.version },
    rescoreAll: options.rescoreAll ?? false,
  });

  for (const skipped of skippedModels(config)) {
    if (skipped.reason === 'no price') {
      logger('warn', `Skipping ${skipped.id}: no price configured.`);
    }
  }
  if (runnableModels(config).length === 0) {
    throw new ConfigError('No priced models are enabled.');
  }

  const prior = readLedger(ledgerPath);
  const state: SpendState = {
    spentUsd: 0,
    runWarned: false,
    monthWarned: false,
    monthBaseUsd: spendForMonth(prior, now().toISOString().slice(0, 7)),
    runId: options.runId ?? createRunId(now()),
  };
  let judgeVersion: string | null = options.rescoreAll ? null : existing?.judge.version ?? null;
  if (config.judge.version) {
    judgeVersion = config.judge.version;
  }

  const judgePrice = priceOf(config, config.judge.modelId);
  const completed: CompletedModelRun[] = [];

  try {
    for (const model of runnableModels(config)) {
      completed.push(await runOneModel({
        model,
        config,
        scenarios,
        client: options.client,
        state,
        ledgerPath,
        logger,
        now,
        judgePrice,
        getJudgeVersion: () => judgeVersion,
        setJudgeVersion: (version) => {
          versionsAgree(judgeVersion, version);
          judgeVersion = version;
        },
      }));
    }
  } catch (error) {
    if (error instanceof HardStopError && completed.length > 0 && judgeVersion) {
      const partial = buildScoreFile({
        models: completed,
        judge: {
          modelId: config.judge.modelId,
          version: judgeVersion,
          temperature: config.judge.temperature,
          recordedAt: now().toISOString(),
        },
        interviewTemperature: config.interview.temperature,
        repeats: config.interview.repeats,
        generatedAt: now().toISOString(),
        priceDate: config.priceDate,
        wideRangeThreshold: config.wideRangeThreshold,
        spreadThreshold: config.spreadThreshold,
        traitConfidence: config.traitConfidence,
        partial: true,
      });
      writeScoreFile(scoreFilePath, partial);
      logger('warn', `Wrote partial score file for ${completed.length} finished model(s) before the hard stop.`);
    }
    throw error;
  }

  if (!judgeVersion) {
    throw new JudgeMixError('No judge version was recorded. Refusing to write an unscored file.');
  }
  const scoreFile = buildScoreFile({
    models: completed,
    judge: {
      modelId: config.judge.modelId,
      version: judgeVersion,
      temperature: config.judge.temperature,
      recordedAt: now().toISOString(),
    },
    interviewTemperature: config.interview.temperature,
    repeats: config.interview.repeats,
    generatedAt: now().toISOString(),
    priceDate: config.priceDate,
    wideRangeThreshold: config.wideRangeThreshold,
    spreadThreshold: config.spreadThreshold,
    traitConfidence: config.traitConfidence,
    partial: false,
  });
  writeScoreFile(scoreFilePath, scoreFile);
  logger('info', `Wrote ${scoreFilePath}`);
  return scoreFile;
}

async function runOneModel(options: {
  model: PricedModel;
  config: BenchmarkConfig;
  scenarios: Scenario[];
  client: ChatClient;
  state: SpendState;
  ledgerPath: string;
  logger: (level: 'info' | 'warn' | 'error', message: string) => void;
  now: () => Date;
  judgePrice: PricedModel;
  getJudgeVersion: () => string | null;
  setJudgeVersion: (version: string) => void;
}): Promise<CompletedModelRun> {
  const repeats: CompletedModelRun['repeats'] = [];
  let cost = 0;
  for (let repeat = 1; repeat <= options.config.interview.repeats; repeat += 1) {
    const answers: Array<{ scenario: Scenario; answer: string }> = [];
    let modelVersion = options.model.id;
    for (const scenario of options.scenarios) {
      const billed = await completeWithinBudget({
        state: options.state,
        config: options.config,
        client: options.client,
        price: options.model,
        ledgerPath: options.ledgerPath,
        logger: options.logger,
        now: options.now,
        request: {
          kind: 'interview',
          model: options.model.id,
          messages: interviewMessages(options.config.interview.systemPrompt, scenario.text),
          temperature: options.config.interview.temperature,
          maxTokens: options.config.interview.maxOutputTokens,
          scenarioId: scenario.id,
          repeat,
        },
      });
      cost += billed.costUsd;
      modelVersion = billed.response.modelVersion;
      answers.push({ scenario, answer: billed.response.content });
      options.logger('info', `interview ${options.model.id} repeat ${repeat} ${scenario.id} ${billed.response.modelVersion}`);
    }

    const billedJudge = await completeWithinBudget({
      state: options.state,
      config: options.config,
      client: options.client,
      price: options.judgePrice,
      ledgerPath: options.ledgerPath,
      logger: options.logger,
      now: options.now,
      request: {
        kind: 'judge',
        model: options.config.judge.modelId,
        messages: judgeMessages(buildInterviewTranscript(answers)),
        temperature: options.config.judge.temperature,
        maxTokens: options.config.judge.maxOutputTokens,
        repeat,
      },
    });
    cost += billedJudge.costUsd;
    options.setJudgeVersion(billedJudge.response.modelVersion);
    try {
      const scores = parseMirrorScores(billedJudge.response.content);
      repeats.push({
        repeat,
        modelVersion,
        judgeVersion: billedJudge.response.modelVersion,
        recordedAt: options.now().toISOString(),
        scores,
      });
    } catch (error) {
      options.logger('warn', `Judge output for ${options.model.id} repeat ${repeat} was not scorable: ${(error as Error).message}`);
    }
  }

  return {
    id: options.model.id,
    repeats,
    costUsd: cost,
    timestamp: options.now().toISOString(),
  };
}
