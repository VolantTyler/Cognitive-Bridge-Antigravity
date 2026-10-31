/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Local screenshot preview. Vite builds index.html only, so this page is
 * not in the production bundle. The data is labeled example data.
 */

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import LeaderboardPage from '../LeaderboardPage';
import ModelMatchSection from '../ModelMatchSection';
import OceanCards from '../../components/OceanCards';
import type { ModelMatchState } from '../loadRuns';
import { agreeablenessTieView, sampleEntry, sampleView } from '../__fixtures__/joinSamples';
import { balancedView, lowConfidenceView, relativeRankView } from './extraViews';
import { FRONTIER_PROFILES, frontierFixtureState, type FrontierProfileKey } from './frontierView';

const STATES = ['normal', 'tie', 'poor', 'extroversion', 'neuroticism', 'wide', 'balanced', 'low-confidence', 'relative-rank', 'loading', 'error'] as const;
type StateName = (typeof STATES)[number];

const SAMPLE_FOR_STATE: Partial<Record<StateName, 'A' | 'B' | 'C' | 'D' | 'E'>> = {
  normal: 'A',
  poor: 'B',
  extroversion: 'C',
  neuroticism: 'D',
  wide: 'E',
};

function viewFor(name: StateName): ModelMatchState {
  if (name === 'loading') return { status: 'loading' };
  if (name === 'error') return { status: 'error', failure: 'unknown-schema' };
  if (name === 'tie') return { status: 'ready', view: agreeablenessTieView() };
  if (name === 'poor') return { status: 'ready', view: sampleView('B') };
  if (name === 'extroversion') return { status: 'ready', view: sampleView('C') };
  if (name === 'neuroticism') return { status: 'ready', view: sampleView('D') };
  if (name === 'wide') return { status: 'ready', view: sampleView('E') };
  if (name === 'balanced') return { status: 'ready', view: balancedView() };
  if (name === 'low-confidence') return { status: 'ready', view: lowConfidenceView() };
  if (name === 'relative-rank') return { status: 'ready', view: relativeRankView() };
  return { status: 'ready', view: sampleView('A') };
}

const NOTES: Record<StateName, string> = {
  normal: 'Sample A, high openness and high conscientiousness. Includes the not-scored Gemini card, the Haiku 9 of 10 tag, and the GPT-5 Nano wide range.',
  tie: 'Agreeableness only, tiers from placement() on the 2026-10-29 trait stats. matchModels is not called.',
  poor: 'Sample B, low openness and low conscientiousness. Every scored model is poor.',
  extroversion: 'Sample C. Nothing to match. The stored exclusion sentence is in the sample and must not appear.',
  neuroticism: 'Sample D. active_traits is empty. The chip comes from targets.',
  wide: 'Sample E, high openness only. GPT-5 Nano openness is the wide-range row.',
  loading: 'Skeleton state. No tiers.',
  error: 'A listed run failed to load. Retry checks that run again.',
  balanced: 'No active traits. No strong recommendation.',
  'low-confidence': 'Openness confidence is low on the score file.',
  'relative-rank': 'matchModels output for a synthetic cluster. The decent model is globally closer. The cards renumber inside each tier.',
};

function Preview() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('state');
  const initial = (STATES as readonly string[]).includes(requested ?? '') ? requested as StateName : 'normal';
  const [name, setName] = useState<StateName>(initial);
  const [page, setPage] = useState<'section' | string>('section');
  const hideChrome = params.get('chrome') === '0';
  const fixtureParam = params.get('fixture');
  const fixture = fixtureParam === 'frontier-a' || fixtureParam === 'frontier-b' || fixtureParam === 'shipped'
    ? fixtureParam
    : null;
  const profileKey = (params.get('profile') ?? 'A').toUpperCase();
  const profile = (profileKey in FRONTIER_PROFILES ? profileKey : 'A') as FrontierProfileKey;
  const state = fixture ? frontierFixtureState(fixture, FRONTIER_PROFILES[profile]) : viewFor(name);
  const focus = params.get('focus');

  useEffect(() => {
    const options = { focusVisible: true } as FocusOptions;
    if (focus === 'measured') {
      document.querySelector<HTMLElement>('[aria-controls="how-we-measured"]')?.focus(options);
    }
    if (focus === 'scores') {
      const link = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((anchor) =>
        anchor.textContent?.includes('See all scores for this model'),
      );
      link?.focus(options);
    }
  }, [focus, name, page]);

  return (
    <div className="min-h-screen bg-bg-primary px-4 py-6 text-text-primary">
      {!hideChrome && !fixture && (
        <div className="mx-auto mb-4 max-w-5xl flex flex-wrap gap-2">
          {STATES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setName(item);
                setPage('section');
              }}
              className="rounded border border-border-primary px-2 py-1 text-xs"
            >
              {item}
            </button>
          ))}
        </div>
      )}
      {!hideChrome && (
      <div className="mx-auto mb-6 max-w-5xl">
        <p className="inline-block rounded border border-current px-2 py-1 text-xs font-semibold">
          {fixture ? 'FIXTURE. Not the shipped run.' : 'EXAMPLE DATA. Not shown to app users.'}
        </p>
        <p className="mt-2 max-w-3xl text-sm text-text-secondary">
          {fixture
            ? `Loaded ${fixture} through matchModels for profile ${profile}. This page is not the production bundle.`
            : `Match tiers are from match-samples.json. Ranges, run counts, and dates are from scores-10run-2026-10-29.json. matchModels rejects that file. ${NOTES[name]}`}
        </p>
      </div>
      )}
      <div className="mx-auto max-w-5xl">
        {params.get('context') === '1' && page === 'section' && SAMPLE_FOR_STATE[name] && (
          <div className="mb-8">
            <OceanCards scores={sampleEntry(SAMPLE_FOR_STATE[name]).profile} />
          </div>
        )}
        {page === 'section' ? (
          <ModelMatchSection
            state={state}
            onRetry={() => undefined}
            timeZone="America/New_York"
            initialPoorOpen={params.get('expand') === '1'}
            initialWhyOpen={params.get('why') === '1'}
            onOpenLeaderboard={(modelId) => setPage(modelId ?? 'leaderboard')}
          />
        ) : (
          <LeaderboardPage
            state={state}
            onRetry={() => undefined}
            timeZone="America/New_York"
            focusModelId={page === 'leaderboard' ? undefined : page}
            onBack={() => setPage('section')}
          />
        )}
      </div>
    </div>
  );
}

const gray = new URLSearchParams(window.location.search).get('gray') === '1';
if (gray) document.documentElement.style.filter = 'grayscale(1)';

createRoot(document.getElementById('root')!).render(<Preview />);
