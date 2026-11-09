/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { GuestSession, StoredSession, adoptGuestSession } from '../sessionMigration';

const guest: GuestSession = {
  scores: {
    openness: 80,
    conscientiousness: 20,
    extroversion: 40,
    agreeableness: 60,
    neuroticism: 30,
  },
  mirrorMessages: [
    { role: 'model', content: 'Welcome.' },
    { role: 'user', content: 'I would wait.' },
  ],
  playgroundMessages: [
    { user: 'Where next?', aligned: 'A plan.', unaligned: 'A tangent.', loading: true, error: true },
  ],
  activeModule: 'playground',
};

/**
 * App's auth listener calls adoptGuestSession for every signed-in user.
 * Google and email/password do not have separate migration paths.
 */
describe('guest session migration', () => {
  it.each([
    ['password', 'uid-password'],
    ['google.com', 'uid-google'],
  ] as const)('copies the guest session onto a new %s account', async (_provider, uid) => {
    const writes: Array<{ uid: string; session: StoredSession }> = [];
    const outcome = await adoptGuestSession({
      uid,
      guest,
      read: async () => null,
      write: async (id, session) => {
        writes.push({ uid: id, session });
      },
    });

    expect(outcome.action).toBe('migrated');
    expect(writes).toHaveLength(1);
    expect(writes[0].uid).toBe(uid);
    expect(writes[0].session.scores).toEqual(guest.scores);
    expect(writes[0].session.mirrorMessages).toEqual(guest.mirrorMessages);
    expect(writes[0].session.activeModule).toBe('playground');
    expect(writes[0].session.playgroundMessages).toEqual([
      { user: 'Where next?', aligned: 'A plan.', unaligned: 'A tangent.', loading: false },
    ]);
  });

  it('writes the same session body for Google and email/password', async () => {
    const bodies: StoredSession[] = [];
    for (const uid of ['uid-password', 'uid-google']) {
      await adoptGuestSession({
        uid,
        guest,
        read: async () => null,
        write: async (_id, session) => {
          bodies.push(session);
        },
      });
    }
    expect(bodies[0]).toEqual(bodies[1]);
  });

  it.each(['uid-password', 'uid-google'])('restores an existing cloud session for %s and does not overwrite it', async (uid) => {
    const existing: StoredSession = {
      scores: null,
      mirrorMessages: [{ role: 'model', content: 'Saved in the cloud.' }],
      playgroundMessages: [],
      activeModule: 'mirror',
    };
    const write = vi.fn();
    const outcome = await adoptGuestSession({
      uid,
      guest,
      read: async () => existing,
      write,
    });
    expect(outcome).toEqual({ action: 'restored', session: existing, uid });
    expect(write).not.toHaveBeenCalled();
  });
});
