/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
  // Do not put `load` or `availability` in the effect deps. An inline function
  // created in the caller's render is a new identity every time, and depending
  // on it restarts this effect after every setState. Read the latest function
  // through a ref instead.
  const availabilityRef = useRef(availability);
  const loadRef = useRef(load);
  availabilityRef.current = availability;
  loadRef.current = load;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ModelMatchState>(() =>
    availability() === 'empty' ? { status: 'empty' } : { status: 'loading' },
  );

  useEffect(() => {
    if (availabilityRef.current() === 'empty') {
      setState({ status: 'empty' });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    const timer = window.setTimeout(() => {
      if (active) setState(loadRef.current(scores));
    }, LOAD_DELAY_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [scores, attempt]);

  const retry = useCallback(() => {
    if (availabilityRef.current() === 'empty') {
      setState({ status: 'empty' });
      return;
    }
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  return { state, retry };
}
