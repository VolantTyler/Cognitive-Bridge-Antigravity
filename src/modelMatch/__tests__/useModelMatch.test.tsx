/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OceanScores } from '../../types';
import { STATUS_LABEL } from '../copy';
import ModelMatchSection from '../ModelMatchSection';
import { LOAD_DELAY_MS, useModelMatch, type ModelMatchSource } from '../useModelMatch';

const scores: OceanScores = {
  openness: 50,
  conscientiousness: 50,
  extroversion: 50,
  agreeableness: 50,
  neuroticism: 50,
};

function Harness({ source }: { source?: ModelMatchSource }) {
  const match = useModelMatch(scores, source);
  return (
    <ModelMatchSection state={match.state} onRetry={match.retry} onOpenLeaderboard={() => undefined} />
  );
}

describe('useModelMatch', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing for the committed empty index and does not offer Retry', () => {
    render(<Harness />);
    expect(screen.queryByRole('heading', { name: 'Models that fit your profile' })).toBeNull();
    expect(screen.queryByText(STATUS_LABEL)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows loading, then the load error, and Retry runs the loader again', () => {
    vi.useFakeTimers();
    const load = vi.fn(() => ({ status: 'error' as const, failure: 'missing-file' as const }));
    const availability = () => 'present' as const;
    render(<Harness source={{ availability, load }} />);

    expect(screen.getByText('Loading benchmark scores')).toBeInTheDocument();
    expect(screen.queryByText('Strong fit')).toBeNull();
    expect(load).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(LOAD_DELAY_MS);
    });
    expect(load).toHaveBeenCalledOnce();
    expect(screen.getByRole('alert')).toHaveAttribute('data-failure', 'missing-file');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('Loading benchmark scores')).toBeInTheDocument();
    expect(load).toHaveBeenCalledOnce();

    act(() => {
      vi.advanceTimersByTime(LOAD_DELAY_MS);
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
