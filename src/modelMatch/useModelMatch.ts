/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import type { OceanScores } from '../types';
import {
  bundledAvailability,
  loadBundledModelMatch,
  type ModelMatchState,
} from './loadRuns';

/** Long enough for the loading skeleton to paint before a bundled file resolves. */
export const LOAD_DELAY_MS = 32;

export interface ModelMatchSource {
  availability?: () => 'empty' | 'unreadable' | 'present';
  load?: (scores: OceanScores) => ModelMatchState;
}

export function useModelMatch(
  scores: OceanScores,
  source: ModelMatchSource = {},
): { state: ModelMatchState; retry: () => void } {
  const availability = source.availability ?? bundledAvailability;
  const load = source.load ?? loadBundledModelMatch;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ModelMatchState>(() =>
    availability() === 'empty' ? { status: 'empty' } : { status: 'loading' },
  );

  useEffect(() => {
    if (availability() === 'empty') {
      setState({ status: 'empty' });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    const timer = window.setTimeout(() => {
      if (active) setState(load(scores));
    }, LOAD_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [scores, attempt, availability, load]);

  const retry = useCallback(() => {
    if (availability() === 'empty') {
      setState({ status: 'empty' });
      return;
    }
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, [availability]);

  return { state, retry };
}
