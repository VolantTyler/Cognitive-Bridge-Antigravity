/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class ConfigError extends Error {
  readonly code = 'CONFIG';
}

export class HardStopError extends Error {
  readonly code = 'HARD_STOP';
}

export class JudgeMixError extends Error {
  readonly code = 'JUDGE_MIX';
}

export class OpenRouterError extends Error {
  readonly code = 'OPENROUTER';
}

export class ScoreFileSchemaError extends Error {
  readonly code = 'SCORE_FILE_SCHEMA';
}
