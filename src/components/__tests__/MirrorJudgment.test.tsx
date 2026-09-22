/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Mirror from '../Mirror';
import { Message } from '../../types';

const dialogue: Message[] = [
  { role: 'model', content: 'A teammate falls sick before launch. What do you do?' },
  { role: 'user', content: 'I would take the night shift so they can recover.' },
  {
    role: 'model',
    content: `Mapping complete.\nJSON_SCORES:\n${JSON.stringify({
      openness: 50,
      conscientiousness: 85,
      extroversion: 40,
      agreeableness: 80,
      neuroticism: 30,
    })}`,
  },
];

describe('Mirror Jev score check', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips the judge for a preset profile and still proceeds', () => {
    const onComplete = vi.fn();
    render(
      <Mirror
        messages={[{ role: 'model', content: 'Welcome.' }]}
        setMessages={vi.fn()}
        onComplete={onComplete}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /High Extroversion and Neuroticism/i }));

    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Proceed to Phase 2/i }));
    expect(onComplete).toHaveBeenCalledWith({
      openness: 50,
      conscientiousness: 50,
      extroversion: 90,
      agreeableness: 50,
      neuroticism: 85,
    });
  });

  it('shows a band correction when the judge says a score is too high', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        answers: {
          openness: { type: 'choice', choice: 'matches', confidence: 0.9 },
          conscientiousness: { type: 'choice', choice: 'too_high', confidence: 0.93 },
          extroversion: { type: 'choice', choice: 'matches', confidence: 0.81 },
          agreeableness: { type: 'choice', choice: 'matches', confidence: 0.84 },
          neuroticism: { type: 'choice', choice: 'matches', confidence: 0.78 },
          profile_usable: { type: 'noul', noul: 0.88 },
        },
      }),
    } as Response);

    const onComplete = vi.fn();
    render(<Mirror messages={dialogue} setMessages={vi.fn()} onComplete={onComplete} />);

    expect(await screen.findByText('Higher than your answers support')).toBeInTheDocument();
    expect(screen.getByText('85 → 50')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Accept band corrections/i }));
    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
        conscientiousness: 50,
        agreeableness: 80,
      }));
    });
  });
});
