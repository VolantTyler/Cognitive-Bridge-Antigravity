import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Playground from '../Playground';
import { ComparisonMessage, OceanScores } from '../../types';

vi.mock('../../services/gemini', () => ({
  DEFAULT_GEMINI_MODEL: 'gemini-test',
  chatWithGeminiStream: async function* () {
    yield 'Example answer.';
  },
}));

const VACATION_PROMPT =
  'My friends and I want to go on vacation together. Two of us want to go to the mountains, and one of us wants to go to the beach. How do we decide where to go?';
const PET_PROMPT = 'Do you think I should get a pet? What kind?';

const scores: OceanScores = {
  openness: 50,
  conscientiousness: 50,
  extroversion: 90,
  agreeableness: 50,
  neuroticism: 85,
};

function Harness() {
  const [messages, setMessages] = useState<ComparisonMessage[]>([]);
  const [activeScores, setActiveScores] = useState(scores);
  return (
    <Playground
      scores={activeScores}
      messages={messages}
      setMessages={setMessages}
      setScores={setActiveScores}
    />
  );
}

describe('Bridge example questions', () => {
  it('places the question input above the aligned and unaligned labels', () => {
    render(<Harness />);

    const input = screen.getByPlaceholderText(/Ask a question to compare Aligned vs Unaligned/i);
    const aligned = screen.getByText('Aligned');
    const unaligned = screen.getByText('Unaligned');

    expect(input.compareDocumentPosition(aligned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input.compareDocumentPosition(unaligned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('submits each example question in one click', async () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText(/Ask a question to compare Aligned vs Unaligned/i);

    fireEvent.click(screen.getByRole('button', { name: /Vacation decision/i }));

    await waitFor(() => {
      expect(screen.getByText(VACATION_PROMPT)).toBeInTheDocument();
    });
    expect(input).toHaveValue('');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Should I get a pet\?/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /Should I get a pet\?/i }));

    await waitFor(() => {
      expect(screen.getByText(PET_PROMPT)).toBeInTheDocument();
    });
    expect(screen.getByText(VACATION_PROMPT)).toBeInTheDocument();
    expect(input).toHaveValue('');
  });
});
