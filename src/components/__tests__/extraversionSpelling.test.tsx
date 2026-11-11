import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { generatePortableMetadata } from '../../constants';
import DemoExperience from '../DemoExperience';
import Mirror from '../Mirror';
import OceanCards from '../OceanCards';
import OceanJudgmentPanel from '../OceanJudgmentPanel';
import Tailor from '../Tailor';
import { interpretOceanAnswers } from '../../jev/questions';
import LeaderboardPage from '../../modelMatch/LeaderboardPage';
import ModelMatchSection from '../../modelMatch/ModelMatchSection';
import { sampleView } from '../../modelMatch/__fixtures__/joinSamples';
import type { OceanScores } from '../../types';

const scores: OceanScores = {
  openness: 50,
  conscientiousness: 50,
  extroversion: 90,
  agreeableness: 50,
  neuroticism: 85,
};

const OLD_SPELLING = /extroversion/i;

function assertVisibleSpelling(container: HTMLElement) {
  expect(container.textContent ?? '').not.toMatch(OLD_SPELLING);
  container.querySelectorAll('[aria-label], [alt], [title]').forEach((node) => {
    for (const attr of ['aria-label', 'alt', 'title']) {
      const value = node.getAttribute(attr);
      if (value) expect(value).not.toMatch(OLD_SPELLING);
    }
  });
}

describe('extraversion spelling on user-facing surfaces', () => {
  it('keeps Extraversion on the score cards, Mirror, Tailor, demo, and model match', () => {
    const cards = render(<OceanCards scores={scores} />);
    expect(cards.getByText('Extraversion')).toBeInTheDocument();
    assertVisibleSpelling(cards.container);
    cards.unmount();

    const mirror = render(
      <Mirror messages={[]} setMessages={() => undefined} onComplete={() => undefined} />,
    );
    expect(mirror.getByRole('button', { name: /High Extraversion and Neuroticism/i })).toBeInTheDocument();
    expect(mirror.getByRole('button', { name: /Low Extraversion, High Neuroticism/i })).toBeInTheDocument();
    assertVisibleSpelling(mirror.container);
    mirror.unmount();

    const tailor = render(<Tailor scores={scores} onNext={() => undefined} />);
    expect(tailor.getByText(/High Extraversion/)).toBeInTheDocument();
    assertVisibleSpelling(tailor.container);
    tailor.unmount();

    const judgment = interpretOceanAnswers(scores, {
      openness: { type: 'choice', choice: 'matches', confidence: 0.9 },
      conscientiousness: { type: 'choice', choice: 'matches', confidence: 0.9 },
      extroversion: { type: 'choice', choice: 'matches', confidence: 0.9 },
      agreeableness: { type: 'choice', choice: 'matches', confidence: 0.9 },
      neuroticism: { type: 'choice', choice: 'matches', confidence: 0.9 },
      profile_usable: { type: 'noul', noul: 0.9 },
    });
    const panel = render(
      <OceanJudgmentPanel
        judgment={judgment!}
        onKeep={() => undefined}
        onAcceptCorrections={() => undefined}
      />,
    );
    expect(panel.getByText('Extraversion')).toBeInTheDocument();
    assertVisibleSpelling(panel.container);
    panel.unmount();

    const demo = render(<DemoExperience onStart={() => undefined} />);
    expect(demo.getAllByText('Extraversion').length).toBeGreaterThan(0);
    assertVisibleSpelling(demo.container);
    fireEvent.click(demo.getByRole('button', { name: /Example B/ }));
    expect(demo.getAllByText('Extraversion').length).toBeGreaterThan(0);
    assertVisibleSpelling(demo.container);
    demo.unmount();

    const match = render(
      <ModelMatchSection
        state={{ status: 'ready', view: sampleView('C') }}
        onRetry={() => undefined}
        onOpenLeaderboard={() => undefined}
        initialWhyOpen
      />,
    );
    expect(match.getByText('Extraversion: not used')).toBeVisible();
    expect(match.getByText(/Why we don't use extraversion/)).toBeVisible();
    assertVisibleSpelling(match.container);
    match.unmount();

    const board = render(
      <LeaderboardPage
        state={{ status: 'ready', view: sampleView('A') }}
        onBack={() => undefined}
        onRetry={() => undefined}
      />,
    );
    expect(board.getAllByText('Extraversion').length).toBeGreaterThan(0);
    assertVisibleSpelling(board.container);
    board.unmount();

    const markdown = generatePortableMetadata(scores);
    expect(markdown).toContain('**Extraversion:**');
    expect(markdown).not.toMatch(OLD_SPELLING);
  });
});
