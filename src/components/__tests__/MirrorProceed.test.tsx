/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { interpretOceanAnswers } from '../../jev/questions';
import OceanJudgmentPanel from '../OceanJudgmentPanel';
import Mirror from '../Mirror';
import { Message } from '../../types';
import { OceanScores } from '../../types';

const completeInterview = vi.hoisted(() => vi.fn());

vi.mock('../../services/firebase', () => ({
  auth: {
    currentUser: {
      uid: 'user-1',
      email: 'a@b.c',
      emailVerified: true,
      displayName: 'A',
      photoURL: null,
      getIdToken: async () => 'token',
    },
  },
  db: {},
  googleProvider: {},
  logAnalyticsEvent: vi.fn(),
  getAppCheckToken: async () => null,
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    callback({
      uid: 'user-1',
      email: 'a@b.c',
      emailVerified: true,
      displayName: 'A',
      photoURL: null,
    });
    return () => {};
  },
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ path: 'users/user-1' })),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  setDoc: vi.fn(async () => {}),
  serverTimestamp: vi.fn(() => 'ts'),
}));

vi.mock('../../services/accessClient', () => ({
  loadAccessStatus: vi.fn(async () => ({
    paid: true,
    legacy: false,
    interviewsAllowed: 2,
    interviewsCompleted: 0,
    interviewsRemaining: 2,
    inProgress: true,
  })),
  completeInterview: (...args: unknown[]) => completeInterview(...args),
  readStoredReservation: () => 'iv_test',
  reserveInterview: vi.fn(),
}));

vi.mock('../../services/productAnalytics', () => ({ logProductEvent: vi.fn() }));

vi.mock('../../services/checkoutClient', () => ({
  startCheckout: vi.fn(),
  loadCheckoutStatus: vi.fn(),
  requestRestorePurchase: vi.fn(),
  CheckoutStartError: class CheckoutStartError extends Error {},
}));

const scores: OceanScores = {
  openness: 50,
  conscientiousness: 85,
  extroversion: 40,
  agreeableness: 80,
  neuroticism: 30,
};

function finishedInterview(): Message[] {
  const messages: Message[] = [{ role: 'model', content: 'Welcome (Question 1/5)' }];
  for (let i = 1; i <= 5; i += 1) {
    messages.push({ role: 'user', content: `Answer ${i} with enough detail.` });
    if (i < 5) messages.push({ role: 'model', content: `Next (Question ${i + 1}/5)` });
  }
  messages.push({
    role: 'model',
    content: `Done.\nJSON_SCORES:\n${JSON.stringify(scores)}`,
  });
  return messages;
}

describe('Proceed stays disabled while completeInterview is in flight', () => {
  beforeEach(() => {
    completeInterview.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ unavailable: true }),
    })));
  });

  it('disables Keep and Accept corrections while pending', () => {
    const judgment = interpretOceanAnswers(scores, {
      openness: { type: 'choice', choice: 'matches', confidence: 0.9 },
      conscientiousness: { type: 'choice', choice: 'too_high', confidence: 0.93 },
      extroversion: { type: 'choice', choice: 'matches', confidence: 0.9 },
      agreeableness: { type: 'choice', choice: 'matches', confidence: 0.9 },
      neuroticism: { type: 'choice', choice: 'matches', confidence: 0.9 },
      profile_usable: { type: 'noul', noul: 0.9 },
    });
    const onKeep = vi.fn();
    const onAccept = vi.fn();
    render(
      <OceanJudgmentPanel
        judgment={judgment!}
        pending
        onKeep={onKeep}
        onAcceptCorrections={onAccept}
      />,
    );
    const keep = screen.getByRole('button', { name: 'Keep Mirror scores' });
    const accept = screen.getByRole('button', { name: 'Accept band corrections' });
    expect(keep).toBeDisabled();
    expect(accept).toBeDisabled();
    fireEvent.click(keep);
    fireEvent.click(accept);
    expect(onKeep).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('disables Proceed on the Mirror while completion is pending', () => {
    const onComplete = vi.fn();
    render(
      <Mirror
        messages={[{ role: 'model', content: 'Welcome.' }]}
        setMessages={vi.fn()}
        onComplete={onComplete}
        completePending
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /High Extraversion and Neuroticism/i }));
    const proceed = screen.getByRole('button', { name: /Proceed to Phase 2/i });
    expect(proceed).toBeDisabled();
    fireEvent.click(proceed);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('lets one in-flight completion through and ignores the second click', async () => {
    let release: ((value: { newlyCompleted: boolean; remaining: number; completed: number }) => void) | undefined;
    completeInterview.mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));
    const { default: App } = await import('../../App');
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /High Extraversion and Neuroticism/i }));
    const proceed = screen.getByRole('button', { name: /Proceed to Phase 2/i });
    proceed.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    proceed.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await waitFor(() => expect(completeInterview).toHaveBeenCalledTimes(1));
    expect(completeInterview).toHaveBeenCalledWith('iv_test');
    await waitFor(() => expect(screen.getByRole('button', { name: /Proceed to Phase 2/i })).toBeDisabled());

    release?.({ newlyCompleted: true, remaining: 1, completed: 1 });
    expect(await screen.findByRole('heading', { name: /The Tailor/i })).toBeInTheDocument();
  });
});
