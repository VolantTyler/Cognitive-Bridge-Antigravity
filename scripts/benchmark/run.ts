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
import {
  AllModelsFailedError,
  ConfigError,
  HardStopError,
  JudgeMixError,
  TruncatedOutputError,
  usageFromError,
} from './errors';
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
import { PROVIDER_LIST_SEPARATOR, type BenchmarkConfig, type ChatClient, type ChatRequest, type ChatResponse, type PricedModel, type ProviderRoute, type Scenario } from './types';

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

interface BilledCall {
  response?: ChatResponse;
  error?: Error;
  costUsd: number;
  maxOutputTokens: number;
}

async function billCall(options: {
  state: SpendState;
  config: BenchmarkConfig;
  request: ChatRequest;
  price: PricedModel;
  client: ChatClient;
  ledgerPath?: string;
  logger: (level: 'info' | 'warn' | 'error', message: string) => void;
  now: () => Date;
}): Promise<BilledCall> {
  const promptEstimate = estimateMessagesTokens(options.request.messages);
  // Reasoning tokens are billed as completion tokens, so the pre-call estimate uses the full cap.
  const estimate = costUsd(promptEstimate, options.request.maxTokens, options.price);
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

  try {
    const response = await options.client.complete(options.request);
    const actual = costUsd(response.promptTokens, response.completionTokens, options.price);
    recordSpend(options, {
      amountUsd: actual,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
      estimated: response.usageEstimated,
      request: options.request,
    });
    return { response, costUsd: actual, maxOutputTokens: options.request.maxTokens };
  } catch (error) {
    if (error instanceof HardStopError || error instanceof JudgeMixError) throw error;
    const known = usageFromError(error);
    if (known) {
      const actual = costUsd(known.promptTokens, known.completionTokens, options.price);
      recordSpend(options, {
        amountUsd: actual,
        promptTokens: known.promptTokens,
        completionTokens: known.completionTokens,
        estimated: false,
        request: options.request,
      });
      return { error: error as Error, costUsd: actual, maxOutputTokens: options.request.maxTokens };
    }
    recordSpend(options, {
      amountUsd: estimate,
      promptTokens: promptEstimate,
      completionTokens: options.request.maxTokens,
      estimated: true,
      request: options.request,
    });
    return { error: error as Error, costUsd: estimate, maxOutputTokens: options.request.maxTokens };
  }
}

async function billCallWithRetry(options: {
  state: SpendState;
  config: BenchmarkConfig;
  request: ChatRequest;
  price: PricedModel;
  client: ChatClient;
  ledgerPath?: string;
  logger: (level: 'info' | 'warn' | 'error', message: string) => void;
  now: () => Date;
  retryMaxTokens: number;
}): Promise<BilledCall> {
  const first = await billCall(options);
  if (!first.error || !(first.error instanceof TruncatedOutputError)) return first;
  options.logger(
    'warn',
    `Retrying ${options.request.model} ${options.request.kind} once at ${options.retryMaxTokens} tokens after a length cutoff.`,
  );
  const second = await billCall({
    ...options,
    request: { ...options.request, maxTokens: options.retryMaxTokens },
  });
  if (second.error) {
    return {
      error: second.error,
      costUsd: first.costUsd + second.costUsd,
      maxOutputTokens: options.retryMaxTokens,
    };
  }
  return {
    response: second.response,
    costUsd: first.costUsd + second.costUsd,
    maxOutputTokens: options.retryMaxTokens,
  };
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
  if (!entry.estimated) options.state.spentActualUsd += entry.amountUsd;
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
  const monthTotal = options.state.monthBaseUsd + options.state.spentActualUsd;
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
    spentActualUsd: 0,
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
        outputBudget: outputBudgetOf(config),
        runLabel: config.runLabel,
      });
      writeScoreFile(scoreFilePath, partial);
      logger('warn', `Wrote partial score file for ${completed.length} finished model(s) before the hard stop.`);
    }
    throw error;
  }

  if (!judgeVersion) {
    judgeVersion = config.judge.version ?? config.judge.modelId;
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
    outputBudget: outputBudgetOf(config),
    runLabel: config.runLabel,
  });
  writeScoreFile(scoreFilePath, scoreFile);
  logger('info', `Wrote ${scoreFilePath}`);
  const summary = formatFailureSummary(scoreFile);
  const everyModelFailed = scoreFile.models.length > 0 && scoreFile.models.every((model) => model.scored_runs === 0);
  if (everyModelFailed) {
    throw new AllModelsFailedError(summary ?? 'Every model failed. No repeat was scored.');
  }
  if (summary) logger('warn', summary);
  return scoreFile;
}

function joinProviders(values: string[]): string | null {
  const unique: string[] = [];
  for (const value of values) {
    if (!unique.includes(value)) unique.push(value);
  }
  return unique.length === 0 ? null : unique.join(PROVIDER_LIST_SEPARATOR);
}

function interviewProviderRoute(config: BenchmarkConfig, modelId: string): ProviderRoute | undefined {
  return config.models.find((model) => model.id === modelId)?.provider;
}

function outputBudgetOf(config: BenchmarkConfig) {
  return {
    maxOutputTokens: config.interview.maxOutputTokens,
    retryMaxOutputTokens: config.interview.retryMaxOutputTokens,
    reasoningEffort: config.interview.reasoningEffort,
  };
}

function formatFailureSummary(scoreFile: ReturnType<typeof buildScoreFile>): string | null {
  const failed = scoreFile.models.filter((model) => model.failed_runs > 0 || model.failures.length > 0);
  if (failed.length === 0) return null;
  const lines = [`${failed.length} model(s) had unscored repeats. Other models were not stopped.`];
  for (const model of failed) {
    lines.push(
      `- ${model.id}: scored ${model.scored_runs}, failed ${model.failed_runs}${model.not_scored_reason ? ` (${model.not_scored_reason})` : ''}`,
    );
    for (const failure of model.failures) {
      const where = failure.scenario_id ? `${failure.kind} ${failure.scenario_id}` : failure.kind;
      lines.push(`  repeat ${failure.repeat} ${where}: ${failure.reason}`);
    }
  }
  return lines.join('\n');
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
  const failures: CompletedModelRun['failures'] = [];
  let cost = 0;
  const effort = options.config.interview.reasoningEffort;
  const retryMaxTokens = options.config.interview.retryMaxOutputTokens;

  for (let repeat = 1; repeat <= options.config.interview.repeats; repeat += 1) {
    const answers: Array<{ scenario: Scenario; answer: string }> = [];
    let modelVersion = options.model.id;
    const interviewProviders: string[] = [];
    let maxUsed = options.config.interview.maxOutputTokens;
    let repeatFailed = false;

    for (const scenario of options.scenarios) {
      const billed = await billCallWithRetry({
        state: options.state,
        config: options.config,
        client: options.client,
        price: options.model,
        ledgerPath: options.ledgerPath,
        logger: options.logger,
        now: options.now,
        retryMaxTokens,
        request: {
          kind: 'interview',
          model: options.model.id,
          messages: interviewMessages(options.config.interview.systemPrompt, scenario.text),
          temperature: options.config.interview.temperature,
          maxTokens: options.config.interview.maxOutputTokens,
          reasoningEffort: effort,
          scenarioId: scenario.id,
          repeat,
          provider: interviewProviderRoute(options.config, options.model.id),
        },
      });
      cost += billed.costUsd;
      maxUsed = Math.max(maxUsed, billed.maxOutputTokens);
      if (billed.error || !billed.response) {
        const reason = billed.error?.message ?? 'Interview call failed';
        failures.push({
          repeat,
          scenarioId: scenario.id,
          kind: 'interview',
          reason,
          maxOutputTokens: billed.maxOutputTokens,
          reasoningEffort: effort,
        });
        options.logger('error', `${options.model.id} repeat ${repeat} ${scenario.id} failed: ${reason}`);
        repeatFailed = true;
        break;
      }
      modelVersion = billed.response.modelVersion;
      if (billed.response.provider) interviewProviders.push(billed.response.provider);
      answers.push({ scenario, answer: billed.response.content });
      options.logger('info', `interview ${options.model.id} repeat ${repeat} ${scenario.id} ${billed.response.modelVersion}`);
    }
    if (repeatFailed) continue;

    const transcript = buildInterviewTranscript(answers);
    const billedJudge = await billCallWithRetry({
      state: options.state,
      config: options.config,
      client: options.client,
      price: options.judgePrice,
      ledgerPath: options.ledgerPath,
      logger: options.logger,
      now: options.now,
      retryMaxTokens,
      request: {
        kind: 'judge',
        model: options.config.judge.modelId,
        messages: judgeMessages(transcript),
        temperature: options.config.judge.temperature,
        maxTokens: options.config.judge.maxOutputTokens,
        reasoningEffort: effort,
        repeat,
      },
    });
    cost += billedJudge.costUsd;
    maxUsed = Math.max(maxUsed, billedJudge.maxOutputTokens);
    if (billedJudge.error || !billedJudge.response) {
      const reason = billedJudge.error?.message ?? 'Judge call failed';
      failures.push({
        repeat,
        scenarioId: null,
        kind: 'judge',
        reason,
        maxOutputTokens: billedJudge.maxOutputTokens,
        reasoningEffort: effort,
      });
      options.logger('error', `${options.model.id} repeat ${repeat} judge failed: ${reason}`);
      continue;
    }
    options.setJudgeVersion(billedJudge.response.modelVersion);
    try {
      const scores = parseMirrorScores(billedJudge.response.content);
      repeats.push({
        repeat,
        modelVersion,
        judgeVersion: billedJudge.response.modelVersion,
        recordedAt: options.now().toISOString(),
        maxOutputTokens: maxUsed,
        reasoningEffort: effort,
        provider: joinProviders(interviewProviders),
        scores,
      });
    } catch (error) {
      const reason = `Judge output was not scorable: ${(error as Error).message}`;
      failures.push({
        repeat,
        scenarioId: null,
        kind: 'judge',
        reason,
        maxOutputTokens: billedJudge.maxOutputTokens,
        reasoningEffort: effort,
      });
      options.logger('warn', `Judge output for ${options.model.id} repeat ${repeat} was not scorable: ${(error as Error).message}`);
    }
  }

  return {
    id: options.model.id,
    repeats,
    failures,
    configuredRepeats: options.config.interview.repeats,
    costUsd: cost,
    timestamp: options.now().toISOString(),
  };
}
