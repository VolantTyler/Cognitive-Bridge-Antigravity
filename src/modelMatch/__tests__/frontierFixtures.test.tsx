/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stand-in frontier runs. Not the shipped file. Model ids here belong to
 * these fixtures. The shipped-run test does not name them.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EXTROVERSION_EXCLUSION_REASON, RELATIVE_RANKING_NOTE, matchModels } from '../../../scripts/benchmark/match';
import type { ScoreFile } from '../../../scripts/benchmark/types';
import type { OceanScores } from '../../types';
import frontierAJson from '../__fixtures__/scores-frontier-a.json';
import frontierBJson from '../__fixtures__/scores-frontier-b.json';
import { CLOSE_CALL_NOTE, DECENT_SENTENCE, MATCH_REJECTED_DETAIL } from '../copy';
import { buildView, displayRunLabel } from '../derive';
import ModelMatchSection from '../ModelMatchSection';
import { resolveModelMatch } from '../loadRuns';

const frontierA = frontierAJson as unknown as ScoreFile;
const frontierB = frontierBJson as unknown as ScoreFile;

const profiles = {
  A: { openness: 85, conscientiousness: 85, extroversion: 50, agreeableness: 70, neuroticism: 40 },
  B: { openness: 20, conscientiousness: 20, extroversion: 50, agreeableness: 50, neuroticism: 50 },
  C: { openness: 50, conscientiousness: 50, extroversion: 90, agreeableness: 50, neuroticism: 50 },
  D: { openness: 50, conscientiousness: 50, extroversion: 50, agreeableness: 50, neuroticism: 10 },
  E: { openness: 90, conscientiousness: 50, extroversion: 50, agreeableness: 50, neuroticism: 50 },
  highExtroversionNeuroticism: { openness: 50, conscientiousness: 50, extroversion: 90, agreeableness: 50, neuroticism: 85 },
  lowExtroversionHighNeuroticism: { openness: 50, conscientiousness: 50, extroversion: 15, agreeableness: 50, neuroticism: 90 },
  lowConscientiousnessHighAgreeableness: { openness: 50, conscientiousness: 15, extroversion: 50, agreeableness: 90, neuroticism: 50 },
  highAgreeableness: { openness: 50, conscientiousness: 45, extroversion: 50, agreeableness: 85, neuroticism: 50 },
} satisfies Record<string, OceanScores>;

const ZONE = 'America/New_York';

function storedExtroversionReason(file: ScoreFile): string | null {
  const row = file.strategy_table.find((item) => item.trait === 'extroversion' && item.exclusion_reason);
  return row?.exclusion_reason ?? null;
}

function renderFile(file: ScoreFile, profile: OceanScores) {
  const state = {
    status: 'ready' as const,
    view: buildView(matchModels(profile, file), file),
  };
  render(
    <ModelMatchSection state={state} onRetry={() => undefined} onOpenLeaderboard={() => undefined} timeZone={ZONE} />,
  );
  return state;
}

function article(modelId: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 4, name: modelId });
  const node = heading.closest('article');
  if (!node) throw new Error(`no article for ${modelId}`);
  return node;
}

function groupIds(name: string): string[] {
  const list = screen.getByRole('list', { name });
  return within(list).getAllByRole('heading', { level: 4 }).map((node) => node.textContent ?? '');
}

describe('frontier fixtures and matchModels', () => {
  it('accepts both files while the stored exclusion_reason matches the in-code sentence', () => {
    const message = [
      'These fixtures store the exclusion_reason from before a reword of EXTROVERSION_EXCLUSION_REASON.',
      'matchModels compares that field exactly.',
      'If this fails, the in-code sentence changed and scores-frontier-a.json and scores-frontier-b.json are rejected.',
      'Do not edit the fixture text or EXTROVERSION_EXCLUSION_REASON to force a pass.',
      'A new benchmark has to write the current sentence into the file.',
    ].join(' ');
    expect(storedExtroversionReason(frontierA), message).toBe(EXTROVERSION_EXCLUSION_REASON);
    expect(storedExtroversionReason(frontierB), message).toBe(EXTROVERSION_EXCLUSION_REASON);
    expect(frontierA.run_label).toBe('frontier-a');
    expect(frontierB.run_label).toBe('frontier-b');
    expect(frontierA.spread_warning).toBe(false);
    expect(frontierB.spread_warning).toBe(false);
    expect(frontierA.partial).toBe(false);
    expect(frontierB.partial).toBe(false);
    expect(() => matchModels(profiles.A, frontierA)).not.toThrow();
    expect(() => matchModels(profiles.A, frontierB)).not.toThrow();
    expect(displayRunLabel('frontier')).toBe('frontier');
  });

  it('rejects a frontier file whose exclusion_reason was reworded, and names that field', () => {
    const mutated = structuredClone(frontierA);
    for (const row of mutated.strategy_table) {
      if (row.trait === 'extroversion' && row.exclusion_reason) {
        row.exclusion_reason = `${row.exclusion_reason} (reworded)`;
      }
    }
    expect(storedExtroversionReason(mutated)).not.toBe(EXTROVERSION_EXCLUSION_REASON);
    expect(() => matchModels(profiles.A, mutated)).toThrow(
      /Score file strategy_table does not match the in-code STRATEGY_TABLE, including a changed exclusion_reason/,
    );

    const state = resolveModelMatch(
      profiles.A,
      { runs: [{ id: 'frontier-a', file: 'scores-frontier-a.json', run_label: 'frontier-a', tested_at: frontierA.generated_at, repeats: 10 }] },
      { 'scores-frontier-a.json': mutated },
    );
    expect(state).toEqual({ status: 'error', failure: 'match-rejected' });

    render(
      <ModelMatchSection state={state} onRetry={() => undefined} onOpenLeaderboard={() => undefined} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-failure', 'match-rejected');
    expect(alert).toHaveTextContent(MATCH_REJECTED_DETAIL);
    expect(alert.textContent).not.toContain(EXTROVERSION_EXCLUSION_REASON);
  });
});

describe('frontier A, profile A', () => {
  it('splits Strong and Decent by model id, with no rank line', () => {
    renderFile(frontierA, profiles.A);
    expect(groupIds('Strong fit')).toEqual(['anthropic/claude-opus-5.5', 'x-ai/grok-4.7']);
    expect(groupIds('Decent fit')).toEqual(['google/gemini-3.8-flash', 'openai/gpt-6-luna']);
    expect(screen.getByRole('list', { name: 'Strong fit' })).toHaveAttribute('data-ordered', 'model-id');
    expect(screen.queryByText(RELATIVE_RANKING_NOTE)).toBeNull();
    expect(screen.queryByText(/in this group/)).toBeNull();
    expect(screen.queryByText(/We don't rank them/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Not enough data' })).toBeNull();
    expect(document.body.textContent).not.toContain(EXTROVERSION_EXCLUSION_REASON);
    expect(document.body.textContent).not.toMatch(/crossed the midpoint/);
  });

  it('tags every card with its scored-run count and a dashed bar, without a warning color', () => {
    renderFile(frontierA, profiles.A);
    const counts: Record<string, string> = {
      'google/gemini-3.8-flash': '8 of 10 runs',
      'x-ai/grok-4.7': '9 of 10 runs',
      'anthropic/claude-opus-5.5': '8 of 10 runs',
      'openai/gpt-6-luna': '9 of 10 runs',
    };
    for (const [id, tag] of Object.entries(counts)) {
      const card = article(id);
      const label = within(card).getByText(tag);
      expect(label.className).not.toMatch(/red|warning|orange|amber|danger/i);
      expect(within(card).getByText('10 repeats')).toBeInTheDocument();
      expect(within(card).getByText('frontier-a')).toBeInTheDocument();
      expect(card.querySelector('[data-run-label]')).toHaveTextContent('frontier-a');
      const dashed = card.querySelector('[data-dashed="true"]');
      expect(dashed).toBeTruthy();
      expect(dashed).toHaveAttribute('stroke', 'var(--match-tick)');
      expect(within(card).getByText('tested on Oct 30, 2026')).toBeInTheDocument();
    }
  });

  it('marks Gemini and Luna as close calls, and puts the wide range on Gemini conscientiousness', () => {
    renderFile(frontierA, profiles.A);
    const gemini = article('google/gemini-3.8-flash');
    expect(within(gemini).getByText('Decent fit')).toBeInTheDocument();
    expect(within(gemini).getByText(DECENT_SENTENCE)).toBeInTheDocument();
    expect(within(gemini).getByText(CLOSE_CALL_NOTE)).toBeInTheDocument();
    expect(within(gemini).getByText('Wide range')).toBeInTheDocument();
    expect(gemini.querySelector('[data-trait="conscientiousness"]')).toBeTruthy();
    expect(gemini.querySelector('[data-trait="openness"]')).toBeNull();
    expect(gemini.querySelector('[data-hatched="true"]')).toBeTruthy();

    const luna = article('openai/gpt-6-luna');
    expect(within(luna).getByText(DECENT_SENTENCE)).toBeInTheDocument();
    expect(within(luna).getByText(CLOSE_CALL_NOTE)).toBeInTheDocument();
    expect(within(luna).queryByText('Wide range')).toBeNull();

    for (const id of ['anthropic/claude-opus-5.5', 'x-ai/grok-4.7']) {
      const card = article(id);
      expect(within(card).getByText('Strong fit')).toBeInTheDocument();
      expect(within(card).getByText('Matches you on openness and conscientiousness.')).toBeInTheDocument();
      expect(within(card).queryByText(CLOSE_CALL_NOTE)).toBeNull();
      expect(within(card).queryByText(DECENT_SENTENCE)).toBeNull();
    }
  });

  it('keeps provider names in details, including the Gemini split and Claude Platform on AWS', () => {
    renderFile(frontierA, profiles.A);
    const gemini = article('google/gemini-3.8-flash');
    expect(gemini.textContent).not.toMatch(/Served by/);
    fireEvent.click(within(gemini).getByRole('button', { name: 'Details' }));
    expect(gemini.textContent).toContain('Served by more than one provider: Google (8), Google AI Studio (7).');
    expect(gemini.textContent).not.toMatch(/more than one reasoning effort/);

    const opus = article('anthropic/claude-opus-5.5');
    expect(opus.textContent).not.toMatch(/Served by/);
    fireEvent.click(within(opus).getByRole('button', { name: 'Details' }));
    expect(opus.textContent).toContain('Served by Claude Platform on AWS (8).');
  });
});

describe('frontier B and the other profiles', () => {
  it('tags scored runs 9, 7, 7, and 6', () => {
    renderFile(frontierB, profiles.E);
    expect(within(article('google/gemini-3.8-flash')).getByText('9 of 10 runs')).toBeInTheDocument();
    expect(within(article('x-ai/grok-4.7')).getByText('7 of 10 runs')).toBeInTheDocument();
    expect(within(article('anthropic/claude-opus-5.5')).getByText('7 of 10 runs')).toBeInTheDocument();
    expect(within(article('openai/gpt-6-luna')).getByText('6 of 10 runs')).toBeInTheDocument();
    expect(within(article('google/gemini-3.8-flash')).getByText('frontier-b')).toBeInTheDocument();
  });

  it('shows the tie banner on profile E for run A, and a Grok close call for run B', () => {
    const { unmount } = render(
      <ModelMatchSection
        state={{ status: 'ready', view: buildView(matchModels(profiles.E, frontierA), frontierA) }}
        onRetry={() => undefined}
        onOpenLeaderboard={() => undefined}
        timeZone={ZONE}
      />,
    );
    expect(screen.getByText(/All four models fit you about equally/)).toBeInTheDocument();
    expect(screen.getByText(/We don't rank them/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Decent fit' })).toBeNull();
    expect(screen.queryByText(CLOSE_CALL_NOTE)).toBeNull();
    unmount();

    renderFile(frontierB, profiles.E);
    expect(screen.queryByText(/We don't rank them/)).toBeNull();
    expect(groupIds('Strong fit')).toEqual([
      'anthropic/claude-opus-5.5',
      'google/gemini-3.8-flash',
      'openai/gpt-6-luna',
    ]);
    expect(groupIds('Decent fit')).toEqual(['x-ai/grok-4.7']);
    const grok = article('x-ai/grok-4.7');
    expect(within(grok).getByText(DECENT_SENTENCE)).toBeInTheDocument();
    expect(within(grok).getByText(CLOSE_CALL_NOTE)).toBeInTheDocument();
    expect(grok.querySelector('[data-trait="openness"]')).toBeTruthy();
  });

  it('collapses four poor cards on profile B', () => {
    renderFile(frontierA, profiles.B);
    expect(screen.getByText('None of the models we tested fit this part of your profile.')).toBeVisible();
    expect(screen.queryByRole('heading', { level: 4 })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show model cards' }));
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(4);
    expect(within(screen.getByRole('list', { name: 'Poor fit' })).getAllByText('Poor fit')).toHaveLength(4);
    expect(screen.queryByText(CLOSE_CALL_NOTE)).toBeNull();
  });

  it('matches nothing on profiles C and D and does not print the stored exclusion sentence', () => {
    const { unmount } = render(
      <ModelMatchSection
        state={{ status: 'ready', view: buildView(matchModels(profiles.C, frontierA), frontierA) }}
        onRetry={() => undefined}
        onOpenLeaderboard={() => undefined}
      />,
    );
    expect(screen.queryByRole('heading', { level: 4 })).toBeNull();
    expect(screen.getByText(/Your strongest trait is extroversion/)).toBeVisible();
    expect(document.body.textContent).not.toContain(EXTROVERSION_EXCLUSION_REASON);
    unmount();

    renderFile(frontierA, profiles.D);
    expect(screen.getByText('Neuroticism: not used')).toBeVisible();
    expect(screen.queryByRole('heading', { level: 4 })).toBeNull();
    expect(document.body.textContent).not.toContain(EXTROVERSION_EXCLUSION_REASON);
  });
});

describe('Mirror presets on the frontier fixtures', () => {
  it('ties all four on neuroticism for the high-extroversion and low-extroversion presets', () => {
    for (const profile of [profiles.highExtroversionNeuroticism, profiles.lowExtroversionHighNeuroticism]) {
      for (const file of [frontierA, frontierB]) {
        const { unmount } = render(
          <ModelMatchSection
            state={{ status: 'ready', view: buildView(matchModels(profile, file), file) }}
            onRetry={() => undefined}
            onOpenLeaderboard={() => undefined}
          />,
        );
        expect(screen.getByText('Extroversion: not used')).toBeVisible();
        expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(4);
        expect(screen.queryByRole('heading', { name: 'Decent fit' })).toBeNull();
        expect(screen.getByText(/We don't rank them/)).toBeInTheDocument();
        expect(screen.queryByText(CLOSE_CALL_NOTE)).toBeNull();
        unmount();
      }
    }
  });

  it('ties all four on high agreeableness in run A, and marks Grok a close call in run B', () => {
    const { unmount } = render(
      <ModelMatchSection
        state={{ status: 'ready', view: buildView(matchModels(profiles.highAgreeableness, frontierA), frontierA) }}
        onRetry={() => undefined}
        onOpenLeaderboard={() => undefined}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(4);
    expect(screen.queryByRole('heading', { name: 'Decent fit' })).toBeNull();
    expect(screen.getByText(/We don't rank them/)).toBeInTheDocument();
    unmount();

    renderFile(frontierB, profiles.highAgreeableness);
    expect(groupIds('Decent fit')).toEqual(['x-ai/grok-4.7']);
    expect(within(article('x-ai/grok-4.7')).getByText(CLOSE_CALL_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/We don't rank them/)).toBeNull();
  });

  it('splits low conscientiousness on run A and puts a wide-range close call on Grok in run B', () => {
    const { unmount } = render(
      <ModelMatchSection
        state={{ status: 'ready', view: buildView(matchModels(profiles.lowConscientiousnessHighAgreeableness, frontierA), frontierA) }}
        onRetry={() => undefined}
        onOpenLeaderboard={() => undefined}
      />,
    );
    expect(groupIds('Strong fit')).toEqual(['anthropic/claude-opus-5.5', 'x-ai/grok-4.7']);
    expect(groupIds('Decent fit')).toEqual(['google/gemini-3.8-flash', 'openai/gpt-6-luna']);
    expect(within(article('google/gemini-3.8-flash')).getByText(CLOSE_CALL_NOTE)).toBeInTheDocument();
    expect(within(article('google/gemini-3.8-flash')).getByText('Wide range')).toBeInTheDocument();
    unmount();

    renderFile(frontierB, profiles.lowConscientiousnessHighAgreeableness);
    expect(groupIds('Decent fit')).toEqual(['x-ai/grok-4.7']);
    const grok = article('x-ai/grok-4.7');
    expect(within(grok).getByText('Wide range')).toBeInTheDocument();
    expect(within(grok).getByText(CLOSE_CALL_NOTE)).toBeInTheDocument();
    expect(grok.querySelector('[data-trait="agreeableness"]')).toBeTruthy();
  });
});
