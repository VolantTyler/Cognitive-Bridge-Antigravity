import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const authState = vi.hoisted(() => ({
  currentUser: {
    uid: 'user-1',
    getIdToken: vi.fn(async () => 'id-token-test'),
  } as null | { uid: string; getIdToken: () => Promise<string> },
}));

vi.mock('../firebase', () => ({
  auth: {
    get currentUser() {
      return authState.currentUser;
    },
  },
  db: {},
  getAppCheckToken: async () => null,
}));

import { storeReservation } from '../accessClient';
import { judgeAlignment, judgeOcean, requestJudgment } from '../jev';
import { OceanScores } from '../../types';

const scores: OceanScores = {
  openness: 50,
  conscientiousness: 50,
  extroversion: 50,
  agreeableness: 50,
  neuroticism: 50,
};

describe('Jev judge requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    sessionStorage.removeItem('cb.interviewReservation');
    authState.currentUser = {
      uid: 'user-1',
      getIdToken: vi.fn(async () => 'id-token-test'),
    };
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ unavailable: true }),
    });
  });

  it('tags a mirror judge call as the judge step and sends the reservation', async () => {
    storeReservation('iv_mirror_1');
    await judgeOcean([], scores);
    const body = JSON.parse(String(mockFetch.mock.calls[0][1].body));
    expect(body.feature).toBe('judge');
    expect(body.reservationId).toBe('iv_mirror_1');
    expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(JSON.stringify(body)).not.toContain('id-token-test');
  });

  it('omits reservationId when the tab has no interview reservation', async () => {
    await requestJudgment('state', { openness: { type: 'noul', instructions: 'Check.' } });
    const body = JSON.parse(String(mockFetch.mock.calls[0][1].body));
    expect(body.feature).toBe('judge');
    expect(body.reservationId).toBeUndefined();
  });

  it('keeps the bridge judge feature distinct from the mirror judge step', async () => {
    storeReservation('iv_mirror_1');
    await judgeAlignment({
      scores,
      userQuery: 'hello',
      alignedReply: 'aligned',
      unalignedReply: 'unaligned',
    });
    const body = JSON.parse(String(mockFetch.mock.calls[0][1].body));
    expect(body.feature).toBe('bridge');
    expect(body.reservationId).toBe('iv_mirror_1');
  });
});
