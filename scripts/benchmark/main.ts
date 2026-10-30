/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { loadConfig, DEFAULT_CONFIG_PATH } from './config';
import { estimateDryRun, formatDryRun } from './dryrun';
import { AllModelsFailedError, ConfigError, HardStopError, JudgeMixError } from './errors';
import { redactSecret, createOpenRouterClient } from './openrouter';
import { runBenchmark } from './run';

export interface MainIo {
  env: NodeJS.ProcessEnv;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface ParsedArgs {
  dryRun: boolean;
  rescoreAll: boolean;
  configPath?: string;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let dryRun = false;
  let rescoreAll = false;
  let configPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--rescore-all') {
      rescoreAll = true;
    } else if (arg === '--config') {
      const value = argv[index + 1];
      if (!value) throw new ConfigError('--config requires a file path');
      configPath = value;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      throw new ConfigError(
        'Usage: npm run benchmark -- [--dry-run] [--rescore-all] [--config path]\n' +
          'Reads OPENROUTER_API_KEY from the environment. --dry-run makes no network calls.',
      );
    } else {
      throw new ConfigError(`Unknown argument ${arg}`);
    }
  }
  return { dryRun, rescoreAll, configPath };
}

export async function main(argv: string[], io?: Partial<MainIo>): Promise<number> {
  const env = io?.env ?? process.env;
  const stdout = io?.stdout ?? ((message: string) => console.log(message));
  const stderr = io?.stderr ?? ((message: string) => console.error(message));
  const secret = env.OPENROUTER_API_KEY ?? '';
  const report = (message: string) => stderr(redactSecret(message, secret));

  try {
    const args = parseArgs(argv);
    const config = loadConfig(args.configPath ?? DEFAULT_CONFIG_PATH);
    if (args.dryRun) {
      stdout(formatDryRun(estimateDryRun(config)));
      return 0;
    }
    if (!secret.trim()) {
      report('OPENROUTER_API_KEY is not set. Export it in the environment before running the benchmark. --dry-run does not need it.');
      return 1;
    }
    const client = createOpenRouterClient({ apiKey: secret, baseUrl: config.baseUrl });
    await runBenchmark({
      config,
      client,
      rescoreAll: args.rescoreAll,
      logger: (level, message) => report(`[${level}] ${message}`),
    });
    return 0;
  } catch (error) {
    const message = redactSecret((error as Error).message, secret);
    report(message);
    if (error instanceof JudgeMixError) return 2;
    if (error instanceof HardStopError) return 3;
    if (error instanceof AllModelsFailedError) return 4;
    if (error instanceof ConfigError) return 1;
    return 1;
  }
}
