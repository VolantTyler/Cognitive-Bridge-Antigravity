import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Mirror from '../Mirror';
import Playground from '../Playground';
import { ComparisonMessage, OceanScores } from '../../types';
import { AI_ACCESS_MESSAGES, DEFAULT_MAX_MESSAGE_CHARS } from '../../constants/aiAccess';

const streamCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../services/gemini', async () => {
  const { AiAccessError } = await import('../../services/aiAccess');
  return {
    DEFAULT_GEMINI_MODEL: 'gemini-test',
    chatWithGeminiStream: async function* () {
      streamCalls.count += 1;
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

  it('blocks a Mirror answer over the per-message cap before calling the model', async () => {
    streamCalls.count = 0;
    render(
      <Mirror
        messages={[{ role: 'model', content: 'Welcome.' }]}
        setMessages={vi.fn()}
        onComplete={vi.fn()}
      />
    );
    const input = screen.getByPlaceholderText(/Respond to the scenario/i);
    fireEvent.change(input, { target: { value: 'x'.repeat(DEFAULT_MAX_MESSAGE_CHARS + 1) } });
    fireEvent.click(screen.getByRole('button', { name: 'Send response' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveAttribute('data-ai-access', 'input_too_long');
    expect(notice).toHaveTextContent(AI_ACCESS_MESSAGES.input_too_long);
    expect(input).toHaveValue('x'.repeat(DEFAULT_MAX_MESSAGE_CHARS + 1));
    expect(streamCalls.count).toBe(0);
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

  it('blocks a Bridge prompt over the per-message cap and keeps the draft', async () => {
    streamCalls.count = 0;
    render(<BridgeHarness />);
    const input = screen.getByPlaceholderText(/Ask a question to compare/i);
    const tooLong = 'y'.repeat(DEFAULT_MAX_MESSAGE_CHARS + 1);
    fireEvent.change(input, { target: { value: tooLong } });
    fireEvent.click(screen.getByRole('button', { name: 'Send prompt' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveAttribute('data-ai-access', 'input_too_long');
    expect(notice).toHaveTextContent(AI_ACCESS_MESSAGES.input_too_long);
    expect(input).toHaveValue(tooLong);
    expect(streamCalls.count).toBe(0);
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).not.toBeInTheDocument();
  });
});
