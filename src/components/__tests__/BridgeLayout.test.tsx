import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Playground from '../Playground';
import type { ComparisonMessage, OceanScores } from '../../types';

vi.mock('../../services/gemini', () => ({
  DEFAULT_GEMINI_MODEL: 'gemini-test',
  chatWithGeminiStream: async function* () {
    yield 'Example answer.';
  },
}));

const scores: OceanScores = {
  openness: 50,
  conscientiousness: 50,
  extroversion: 90,
  agreeableness: 50,
  neuroticism: 85,
};

function Harness() {
  const [messages, setMessages] = useState<ComparisonMessage[]>([]);
  const [activeScores, setActiveScores] = useState<OceanScores | null>(scores);
  return (
    <Playground
      scores={activeScores ?? scores}
      messages={messages}
      setMessages={setMessages}
      setScores={setActiveScores}
    />
  );
}

describe('Bridge page section order', () => {
  it('puts the chat under the score cards and models at the bottom', async () => {
    render(<Harness />);

    const cards = document.querySelector('[data-ocean-grid]');
    const bridge = screen.getByRole('heading', { name: 'The Bridge' });
    const models = screen.getByRole('heading', { name: 'Models that fit your profile' });
    expect(cards).toBeTruthy();
    expect(cards!.compareDocumentPosition(bridge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bridge.compareDocumentPosition(models) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'What you asked for' })).toBeInTheDocument();
    });
    expect(bridge.compareDocumentPosition(screen.getByRole('heading', { name: 'What you asked for' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
