/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import type { OceanScores } from '../types';
import { loadBundledModelMatch, type ModelMatchState } from './loadRuns';

export function useModelMatch(scores: OceanScores): { state: ModelMatchState; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ModelMatchState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    const next = loadBundledModelMatch(scores);
    if (active) setState(next);
    return () => {
      active = false;
    };
  }, [scores, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);
  return { state, retry };
}
