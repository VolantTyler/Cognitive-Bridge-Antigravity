import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('keeps the chat input in view at 360px and restores the desktop height', () => {
    render(<Harness />);
    const chat = document.querySelector('[data-bridge-chat]');
    expect(chat).toBeTruthy();
    expect(chat!.className).toContain('h-[75vh]');
    expect(chat!.className).toContain('lg:h-[70vh]');
    expect(chat!.className).toContain('lg:min-h-[560px]');
    expect(chat!.className).not.toMatch(/(^|\s)min-h-\[560px\](\s|$)/);
    expect(chat!.className).not.toMatch(/(^|\s)h-\[70vh\](\s|$)/);
  });

  it('jumps from under the chat to the models section', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<Harness />);

    const bridge = screen.getByRole('heading', { name: 'The Bridge' });
    const link = screen.getByRole('link', { name: 'See which models scored closest ↓' });
    const models = document.getElementById('models-that-fit');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '#models-that-fit');
    expect(link).not.toHaveAttribute('tabindex', '-1');
    expect(models).toBeTruthy();
    expect(models).toHaveAttribute('tabindex', '-1');
    expect(bridge.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(models!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(link);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(document.activeElement).toBe(models);
    expect(window.location.hash).toBe('#models-that-fit');
  });
});
