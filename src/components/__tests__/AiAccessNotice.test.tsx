import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Mirror from '../Mirror';
import Playground from '../Playground';
import { ComparisonMessage, OceanScores } from '../../types';
import { AI_ACCESS_MESSAGES } from '../../constants/aiAccess';

vi.mock('../../services/gemini', async () => {
  const { AiAccessError } = await import('../../services/aiAccess');
  return {
    DEFAULT_GEMINI_MODEL: 'gemini-test',
    chatWithGeminiStream: async function* () {
      throw new AiAccessError('signed_out');
    },
  };
});

vi.mock('../../services/jev', () => ({
  judgeOcean: vi.fn(async () => null),
  judgeAlignment: vi.fn(async () => null),
}));

const scores: OceanScores = {
  openness: 50,
  conscientiousness: 50,
  extroversion: 50,
  agreeableness: 50,
  neuroticism: 50,
};

function BridgeHarness() {
  const [messages, setMessages] = useState<ComparisonMessage[]>([]);
  return (
    <Playground
      scores={scores}
      messages={messages}
      setMessages={setMessages}
      setScores={vi.fn()}
    />
  );
}

describe('locked AI responses', () => {
  it('keeps a Mirror draft in the input and exposes a signed-out code', async () => {
    const setMessages = vi.fn();
    render(
      <Mirror
        messages={[{ role: 'model', content: 'Welcome.' }]}
        setMessages={setMessages}
        onComplete={vi.fn()}
      />
    );
    const input = screen.getByPlaceholderText(/Respond to the scenario/i);
    fireEvent.change(input, { target: { value: 'I would wait.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send response' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveAttribute('data-ai-access', 'signed_out');
    expect(notice).toHaveTextContent(AI_ACCESS_MESSAGES.signed_out);
    expect(notice).not.toHaveClass('text-status-danger');
    expect(input).toHaveValue('I would wait.');
    expect(setMessages).not.toHaveBeenCalled();
  });

  it('keeps a Bridge draft in the input when the request is rejected', async () => {
    render(<BridgeHarness />);
    const input = screen.getByPlaceholderText(/Ask a question to compare/i);
    fireEvent.change(input, { target: { value: 'Where should we go?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveAttribute('data-ai-access', 'signed_out');
    expect(notice).not.toHaveClass('text-status-danger');
    await waitFor(() => {
      expect(input).toHaveValue('Where should we go?');
      expect(screen.getByRole('button', { name: /Ask your first question/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).not.toBeInTheDocument();
  });
});
