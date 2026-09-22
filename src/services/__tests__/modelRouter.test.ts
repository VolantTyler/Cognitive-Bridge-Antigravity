import { describe, expect, it } from 'vitest';
import {
  buildModelChain,
  chainExhaustedMessage,
  classifyModelError,
  dominantFailureKind,
} from '../../../functions/src/modelRouter';

describe('modelRouter', () => {
  it('keeps retired model ids out of the automatic backup chain', () => {
    const chain = buildModelChain('gemini-2.5-flash');
    expect(chain[0]).toBe('gemini-2.5-flash');
    expect(chain).toContain('gemini-3.1-pro-preview');
    expect(chain).toContain('gemini-2.5-flash-lite');
    expect(chain).not.toContain('gemini-2.5-pro');
    expect(chain).not.toContain('gemini-1.5-flash');
    expect(chain).not.toContain('gemini-1.5-pro');
  });

  it('tries an explicitly requested retired id once, then live models', () => {
    expect(buildModelChain('models/gemini-2.5-pro')).toEqual([
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.1-pro-preview',
      'gemini-3.8-flash',
    ]);
  });

  it('classifies the 503 high-demand error as capacity', () => {
    const error = 'request failed (code 503): This model is currently experiencing high demand. Status: UNAVAILABLE';
    expect(classifyModelError(error)).toBe('capacity');
  });

  it('classifies retired-model 404 as unavailable even if the socket then closes', () => {
    const error = [
      'request failed (code 404): This model models/gemini-2.5-pro is no longer available to new users.',
      'Status: NOT_FOUND',
      'received 1000 (OK); then sent 1000 (OK)',
    ].join(' ');
    expect(classifyModelError(error)).toBe('unavailable');
  });

  it('classifies a bare websocket close as capacity', () => {
    expect(classifyModelError('received 1000 (OK); then sent 1000 (OK)')).toBe('capacity');
  });

  it('does not treat quota as capacity', () => {
    expect(classifyModelError('request failed (code 429): You exceeded your current quota')).toBe('quota');
  });

  it('describes a mixed 503 and 404 chain without blaming credits', () => {
    const message = chainExhaustedMessage([
      { model: 'gemini-3.8-flash', kind: 'capacity' },
      { model: 'gemini-2.5-flash', kind: 'capacity' },
      { model: 'gemini-2.5-pro', kind: 'unavailable' },
      { model: 'gemini-1.5-flash', kind: 'unavailable' },
    ]);
    expect(message).toContain('503');
    expect(message).toContain('404');
    expect(message).toContain('not fixed by credits');
    expect(dominantFailureKind([
      { model: 'gemini-2.5-pro', kind: 'unavailable' },
      { model: 'gemini-2.5-flash', kind: 'capacity' },
    ])).toBe('capacity');
  });
});
