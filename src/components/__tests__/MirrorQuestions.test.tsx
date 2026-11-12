/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Mirror from '../Mirror';
import { Message } from '../../types';
import { continuationInstruction } from '../../mirror/interviewTurns';

const chatWithGeminiStream = vi.hoisted(() => vi.fn());

vi.mock('../../services/gemini', () => ({
  chatWithGeminiStream,
}));

vi.mock('../../services/firebase', () => ({
  auth: { currentUser: { uid: 'user-1', getIdToken: async () => 'test-token' } },
  db: {},
  getAppCheckToken: async () => null,
  logAnalyticsEvent: () => {},
}));

const scores = {
  openness: 50,
  conscientiousness: 40,
  extroversion: 60,
  agreeableness: 70,
  neuroticism: 30,
};

function fiveAnswers(): Message[] {
  const messages: Message[] = [{ role: 'model', content: 'Welcome scenario (Question 1/5)' }];
  for (let i = 1; i <= 5; i += 1) {
    messages.push({ role: 'user', content: `Answer ${i} is specific.` });
    if (i < 5) messages.push({ role: 'model', content: `Scenario (Question ${i + 1}/5)` });
  }
  messages.push({
    role: 'model',
    content: `Mapping complete.\nJSON_SCORES:\n${JSON.stringify(scores)}`,
  });
  return messages;
}

function Host({ initial }: { initial: Message[] }) {
  const [messages, setMessages] = useState(initial);
  return <Mirror messages={messages} setMessages={setMessages} onComplete={vi.fn()} />;
}

describe('Mirror question gate', () => {
  beforeEach(() => {
    chatWithGeminiStream.mockReset();
  });

  it('does not finish from an early JSON_SCORES block and asks the next scenario once', async () => {
    chatWithGeminiStream.mockImplementation(async function* (_messages: Message[], system?: string) {
      if (chatWithGeminiStream.mock.calls.length === 1) {
        yield `Too soon.\nJSON_SCORES:\n${JSON.stringify(scores)}`;
        return;
      }
      expect(system).toContain(continuationInstruction(1));
      yield 'A colleague wants to replace the stable tool (Question 9/5)';
    });

    render(<Host initial={[{ role: 'model', content: 'Welcome. Dirty hack or cancel? (Question 1/5)' }]} />);
    fireEvent.change(screen.getByPlaceholderText('Respond to the scenario...'), {
      target: { value: 'I cancel the demo.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send response' }));

    expect(await screen.findByText(/\(Question 2\/5\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Question 9\/5/)).not.toBeInTheDocument();
    expect(screen.queryByText(/JSON_SCORES/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cognitive mapping complete/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Proceed to Phase 2/i })).not.toBeInTheDocument();
    await waitFor(() => expect(chatWithGeminiStream).toHaveBeenCalledTimes(2));
    expect(chatWithGeminiStream).toHaveBeenCalledTimes(2);
    expect(chatWithGeminiStream.mock.calls[0][6]).toEqual({ turnIndex: 1, isFinalTurn: false });
    expect(chatWithGeminiStream.mock.calls[1][6]).toEqual({ turnIndex: 1, isFinalTurn: false });
  });

  it('sends the scoring turn after the fifth user answer', async () => {
    chatWithGeminiStream.mockImplementation(async function* () {
      yield `Mapping complete.\nJSON_SCORES:\n${JSON.stringify(scores)}`;
    });
    const initial: Message[] = [{ role: 'model', content: 'Welcome (Question 1/5)' }];
    for (let i = 1; i <= 4; i += 1) {
      initial.push({ role: 'user', content: `Answer ${i} is specific.` });
      initial.push({ role: 'model', content: `Scenario (Question ${i + 1}/5)` });
    }
    render(<Host initial={initial} />);
    fireEvent.change(screen.getByPlaceholderText('Respond to the scenario...'), {
      target: { value: 'I check on my teammate.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send response' }));

    expect(await screen.findByText(/Cognitive mapping complete/)).toBeInTheDocument();
    expect(chatWithGeminiStream).toHaveBeenCalledTimes(1);
    expect(chatWithGeminiStream.mock.calls[0][6]).toEqual({ turnIndex: 5, isFinalTurn: true });
  });

  it('does not finish when the fifth answer echoes the <0-100> placeholder', async () => {
    const echoed = `Mapping complete.\nJSON_SCORES:\n${JSON.stringify({
      openness: '<0-100>',
      conscientiousness: '<0-100>',
      extroversion: '<0-100>',
      agreeableness: '<0-100>',
      neuroticism: '<0-100>',
    })}`;
    chatWithGeminiStream.mockImplementation(async function* () {
      yield echoed;
    });
    const initial: Message[] = [{ role: 'model', content: 'Welcome (Question 1/5)' }];
    for (let i = 1; i <= 4; i += 1) {
      initial.push({ role: 'user', content: `Answer ${i} is specific.` });
      initial.push({ role: 'model', content: `Scenario (Question ${i + 1}/5)` });
    }
    render(<Host initial={initial} />);
    fireEvent.change(screen.getByPlaceholderText('Respond to the scenario...'), {
      target: { value: 'I check on my teammate.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send response' }));

    await waitFor(() => expect(chatWithGeminiStream).toHaveBeenCalledTimes(1));
    expect(chatWithGeminiStream.mock.calls[0][6]).toEqual({ turnIndex: 5, isFinalTurn: true });
    expect(screen.queryByText(/Cognitive mapping complete/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Proceed to Phase 2/i })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Respond to the scenario...')).toBeInTheDocument();
  });

  it('ignores a second Enter while the first reply is still running', async () => {
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    chatWithGeminiStream.mockImplementation(async function* () {
      await started;
      yield 'A colleague wants to replace the stable tool (Question 2/5)';
    });

    render(<Host initial={[{ role: 'model', content: 'Welcome. Dirty hack or cancel? (Question 1/5)' }]} />);
    const input = screen.getByPlaceholderText('Respond to the scenario...');
    fireEvent.change(input, { target: { value: 'I cancel the demo.' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Send response' }));

    expect(chatWithGeminiStream).toHaveBeenCalledTimes(1);
    release?.();
    expect(await screen.findByText(/\(Question 2\/5\)/)).toBeInTheDocument();
    expect(chatWithGeminiStream).toHaveBeenCalledTimes(1);
  });

  it('normalizes a skipped question label from the user-turn count, including restored messages', () => {
    render(
      <Host
        initial={[
          { role: 'model', content: 'Welcome scenario (Question 4/5)' },
          { role: 'user', content: 'I ship the hack and tell them after.' },
          { role: 'model', content: 'Noted.\n\nNext question: A new scene (Question 3/5)' },
        ]}
      />,
    );

    expect(screen.getByText(/Welcome scenario \(Question 1\/5\)/)).toBeInTheDocument();
    expect(screen.getByText(/A new scene \(Question 2\/5\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Question 3\/5/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Question 4\/5/)).not.toBeInTheDocument();
  });

  it('ignores restored scores until five user answers exist, then accepts them', () => {
    const { unmount } = render(
      <Host
        initial={[
          { role: 'model', content: 'Welcome (Question 1/5)' },
          { role: 'user', content: 'I cancel.' },
          { role: 'model', content: `Done.\nJSON_SCORES:\n${JSON.stringify(scores)} (Question 3/5)` },
        ]}
      />,
    );
    expect(screen.queryByText(/Cognitive mapping complete/)).not.toBeInTheDocument();
    expect(screen.queryByText(/JSON_SCORES/)).not.toBeInTheDocument();
    expect(screen.getByText(/\(Question 2\/5\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Proceed to Phase 2/i })).not.toBeInTheDocument();
    unmount();

    render(<Host initial={fiveAnswers()} />);
    expect(screen.getByText(/Cognitive mapping complete/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Proceed to Phase 2/i })).toBeInTheDocument();
  });
});
