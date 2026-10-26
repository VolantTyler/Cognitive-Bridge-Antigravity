/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { priceOf, runnableModels, skippedModels } from './config';
import { costUsd } from './cost';
import { interviewMessages } from './openrouter';
import { interviewScenarios } from './scenarios';
import { buildJudgeSystemPrompt } from './scorer';
import { estimateMessagesTokens, estimateTokens, MESSAGE_OVERHEAD_TOKENS } from './tokens';
import type { BenchmarkConfig, PricedModel, Scenario } from './types';

export interface ModelDryRun {
  id: string;
  interviewCalls: number;
  judgeCalls: number;
  interviewInputTokens: number;
  interviewOutputTokens: number;
  judgeInputTokens: number;
  judgeOutputTokens: number;
  interviewCostUsd: number;
  judgeCostUsd: number;
  totalCostUsd: number;
}

export interface DryRunEstimate {
  priceDate: string;
  temperature: number;
  judgeTemperature: number;
  judgeModelId: string;
  repeats: number;
  scenarioCount: number;
  scenarioIds: string[];
  interviewMaxOutputTokens: number;
  judgeMaxOutputTokens: number;
  retryMaxOutputTokens: number;
  reasoningEffort: string;
  systemPrompt: null | string;
  models: ModelDryRun[];
  skipped: Array<{ id: string; reason: string }>;
  totalCostUsd: number;
  warnPerRunUsd: number;
  hardStopPerRunUsd: number;
  warnPerMonthUsd: number;
}

/**
 * Upper bound for one judge call: real scenario and rubric text, plus the
 * configured max answer length standing in for each unknown completion.
 */
export function estimateJudgeInputTokens(scenarios: Scenario[], maxAnswerTokens: number): number {
  let tokens = estimateTokens(buildJudgeSystemPrompt()) + MESSAGE_OVERHEAD_TOKENS;
  const preamble = 'Completed interview. Score the interviewee from the answers below. Do not ask further questions.';
  tokens += estimateTokens(preamble) + MESSAGE_OVERHEAD_TOKENS;
  scenarios.forEach((scenario, index) => {
    const questionBlock = `Scenario ${index + 1} (${scenario.id})\nQuestion: ${scenario.text}\nAnswer: `;
    tokens += estimateTokens(questionBlock) + maxAnswerTokens;
  });
  return tokens;
}

export function estimateDryRun(
  config: BenchmarkConfig,
  scenarios: Scenario[] = interviewScenarios(),
): DryRunEstimate {
  const judgePrice = priceOf(config, config.judge.modelId);
  const repeats = config.interview.repeats;
  const judgeInputPerCall = estimateJudgeInputTokens(scenarios, config.interview.maxOutputTokens);
  const judgeOutputPerCall = config.judge.maxOutputTokens;
  const judgeCalls = repeats;
  const judgeInputTokens = judgeCalls * judgeInputPerCall;
  const judgeOutputTokens = judgeCalls * judgeOutputPerCall;
  const judgeCost = costUsd(judgeInputTokens, judgeOutputTokens, judgePrice);

  const models = runnableModels(config).map((model) => estimateModel(config, model, scenarios, {
    judgeInputTokens,
    judgeOutputTokens,
    judgeCost,
    judgeCalls,
  }));

  return {
    priceDate: config.priceDate,
    temperature: config.interview.temperature,
    judgeTemperature: config.judge.temperature,
    judgeModelId: config.judge.modelId,
    repeats,
    scenarioCount: scenarios.length,
    scenarioIds: scenarios.map((scenario) => scenario.id),
    interviewMaxOutputTokens: config.interview.maxOutputTokens,
    judgeMaxOutputTokens: config.judge.maxOutputTokens,
    retryMaxOutputTokens: config.interview.retryMaxOutputTokens,
    reasoningEffort: config.interview.reasoningEffort,
    systemPrompt: config.interview.systemPrompt,
    models,
    skipped: skippedModels(config),
    totalCostUsd: models.reduce((sum, model) => sum + model.totalCostUsd, 0),
    warnPerRunUsd: config.limits.warnPerRunUsd,
    hardStopPerRunUsd: config.limits.hardStopPerRunUsd,
    warnPerMonthUsd: config.limits.warnPerMonthUsd,
  };
}

function estimateModel(
  config: BenchmarkConfig,
  model: PricedModel,
  scenarios: Scenario[],
  judge: { judgeInputTokens: number; judgeOutputTokens: number; judgeCost: number; judgeCalls: number },
): ModelDryRun {
  const repeats = config.interview.repeats;
  let interviewInputTokens = 0;
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const scenario of scenarios) {
      interviewInputTokens += estimateMessagesTokens(
        interviewMessages(config.interview.systemPrompt, scenario.text),
      );
    }
  }
  const interviewCalls = scenarios.length * repeats;
  const interviewOutputTokens = interviewCalls * config.interview.maxOutputTokens;
  const interviewCostUsd = costUsd(interviewInputTokens, interviewOutputTokens, model);
  return {
    id: model.id,
    interviewCalls,
    judgeCalls: judge.judgeCalls,
    interviewInputTokens,
    interviewOutputTokens,
    judgeInputTokens: judge.judgeInputTokens,
    judgeOutputTokens: judge.judgeOutputTokens,
    interviewCostUsd,
    judgeCostUsd: judge.judgeCost,
    totalCostUsd: interviewCostUsd + judge.judgeCost,
  };
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(6)}`;
}

export function formatDryRun(estimate: DryRunEstimate): string {
  const lines = [
    'Cognitive Bridge model benchmark — dry run',
    'No network calls were made.',
    `Price date: ${estimate.priceDate} (USD per 1M tokens)`,
    `Interview temperature: ${estimate.temperature} (same for every model and repeat)`,
    `System prompt: ${estimate.systemPrompt === null ? 'none' : 'set'}`,
    `Scenarios (${estimate.scenarioCount}, fixed order): ${estimate.scenarioIds.join(', ')}`,
    `Repeats per model: ${estimate.repeats}`,
    `Judge: ${estimate.judgeModelId} at temperature ${estimate.judgeTemperature}`,
    `Max output tokens: ${estimate.interviewMaxOutputTokens} for every model and the judge (retry once at ${estimate.retryMaxOutputTokens} after a length cutoff; retry is not included here)`,
    `Reasoning effort: ${estimate.reasoningEffort} (OpenRouter reasoning.effort on every call; models that ignore it are left as-is)`,
    '',
    'Per model (interview calls = scenarios × repeats; judge calls = one Mirror scoring per repeat):',
  ];
  for (const model of estimate.models) {
    lines.push(`- ${model.id}`);
    lines.push(
      `  interview: ${model.interviewCalls} calls, input ${model.interviewInputTokens} tok, output ${model.interviewOutputTokens} tok, ${formatUsd(model.interviewCostUsd)}`,
    );
    lines.push(
      `  judge: ${model.judgeCalls} calls, input ${model.judgeInputTokens} tok, output ${model.judgeOutputTokens} tok, ${formatUsd(model.judgeCostUsd)}`,
    );
    lines.push(`  subtotal: ${formatUsd(model.totalCostUsd)}`);
  }
  if (estimate.skipped.length > 0) {
    lines.push('', 'Skipped:');
    for (const skipped of estimate.skipped) {
      lines.push(`- ${skipped.id}: ${skipped.reason}`);
    }
  }
  lines.push(
    '',
    `Total estimated USD: ${formatUsd(estimate.totalCostUsd)}`,
    `Warn at ${formatUsd(estimate.warnPerRunUsd)} per run; hard stop at ${formatUsd(estimate.hardStopPerRunUsd)} per run; warn at ${formatUsd(estimate.warnPerMonthUsd)} per month.`,
    'Input tokens are counted from the real scenario prompts and the Mirror judge rubric. Output tokens use the full configured maximum, because reasoning tokens are billed as completion tokens and can fill the cap. This is an upper bound and does not add the one length-cutoff retry. Judge cost is included in every model subtotal and uses the judge model price.',
  );
  return lines.join('\n');
}
