import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import Playground from '../Playground';
import { OceanScores } from '../../types';

const scores: OceanScores = {
  openness: 50,
  conscientiousness: 15,
  extroversion: 50,
  agreeableness: 90,
  neuroticism: 50,
};

const sampleMessages = [
  {
    user: 'How should I structure my proposal?',
    aligned:
      'Start with outcomes. <mark-bridge explanation="Compensatory scaffolding for low Conscientiousness (15): breaks work into milestones instead of mirroring organic flow.">Use a three-step checklist before drafting.</mark-bridge>',
    unaligned:
      'Follow your instinct. <mark-bridge explanation="Reinforces high Agreeableness (90) by avoiding friction and prioritizing harmony over structure.">Keep the tone warm and avoid rigid formats.</mark-bridge>',
    loading: false,
  },
];

describe('Playground highlight activation', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('min-width: 1024px'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    Element.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollTo = vi.fn();
    HTMLElement.prototype.focus = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('scrolls Logic Analysis into view when a highlight is activated', () => {
    render(
      <Playground
        scores={scores}
        messages={sampleMessages}
        setMessages={vi.fn()}
        setScores={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /three-step checklist/i }));

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    const panel = document.getElementById('logic-analysis-panel');
    expect(panel).toBeTruthy();
    expect(within(panel!).getByText('Alignment Explanation:')).toBeInTheDocument();
    expect(
      within(panel!).getByText(/Compensatory scaffolding for low Conscientiousness/i)
    ).toBeInTheDocument();
  });

  it('shows misalignment label when an unaligned highlight is selected', async () => {
    render(
      <Playground
        scores={scores}
        messages={sampleMessages}
        setMessages={vi.fn()}
        setScores={vi.fn()}
      />
    );

    const highlightButtons = screen.getAllByRole('button', { name: /warm and avoid rigid formats/i });
    fireEvent.click(highlightButtons[0]);

    await waitFor(() => {
      expect(document.getElementById('logic-analysis-panel')).toBeTruthy();
    });
    const panel = document.getElementById('logic-analysis-panel')!;
    expect(within(panel).getByText('Misalignment Explanation:')).toBeInTheDocument();
    expect(within(panel).getByText(/Reinforces high Agreeableness/i)).toBeInTheDocument();
  });
});
