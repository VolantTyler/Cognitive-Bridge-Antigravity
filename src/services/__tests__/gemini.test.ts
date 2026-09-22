import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Import the module after mocking
import {
  parseModelName,
  getDynamicModelFallbacks,
  isTransientError,
  chatWithGemini,
  chatWithGeminiStream,
  activeModelsCache
} from '../gemini';

describe('Gemini Service Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    activeModelsCache.length = 0;
  });

  describe('parseModelName', () => {
    it('correctly parses model parameters', () => {
      expect(parseModelName('gemini-3.5-flash')).toEqual({
        name: 'gemini-3.5-flash',
        version: 3.5,
        isPro: false,
        isFlash: true,
        isLite: false,
        isPreview: false
      });

      expect(parseModelName('models/gemini-3.1-pro-preview')).toEqual({
        name: 'models/gemini-3.1-pro-preview',
        version: 3.1,
        isPro: true,
        isFlash: false,
        isLite: false,
        isPreview: true
      });

      expect(parseModelName('gemini-2.5-flash-lite')).toEqual({
        name: 'gemini-2.5-flash-lite',
        version: 2.5,
        isPro: false,
        isFlash: false,
        isLite: true,
        isPreview: false
      });
    });
  });

  describe('isTransientError', () => {
    it('correctly identifies transient (503 / Unavailable / High Demand) errors', () => {
      expect(isTransientError({ code: 503 })).toBe(true);
      expect(isTransientError({ status: 503 })).toBe(true);
      expect(isTransientError({ error: { code: 503 } })).toBe(true);
      expect(isTransientError({ error: { message: '{"code": 503, "status": "UNAVAILABLE"}' } })).toBe(true);
      expect(isTransientError(new Error('This model is currently experiencing high demand.'))).toBe(true);
      expect(isTransientError(new Error('service unavailable'))).toBe(true);
      expect(isTransientError(new Error('Some generic 400 Bad Request error'))).toBe(false);
      expect(isTransientError(null)).toBe(false);
    });
  });

  describe('getDynamicModelFallbacks', () => {
    it('returns static fallback hierarchy when activeModelsCache is empty', () => {
      const fallbacks = getDynamicModelFallbacks('gemini-3-flash-preview');
      expect(fallbacks[0]).toBe('gemini-3-flash-preview');
      expect(fallbacks.length).toBeGreaterThan(1);
      expect(fallbacks).toContain('gemini-2.5-flash');
      expect(fallbacks).toContain('gemini-3.1-pro-preview');
      expect(fallbacks).not.toContain('gemini-1.5-flash');
      expect(fallbacks).not.toContain('gemini-2.5-pro');
    });

    it('starts a retired pro request on that id, then live models', () => {
      const fallbacks = getDynamicModelFallbacks('gemini-2.5-pro');
      expect(fallbacks[0]).toBe('gemini-2.5-pro');
      expect(fallbacks[1]).toBe('gemini-2.5-flash');
      expect(fallbacks).not.toContain('gemini-1.5-flash');
    });
  });

  describe('chatWithGemini', () => {
    it('returns response successfully on first attempt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'Hello!' })
      });

      const response = await chatWithGemini([{ role: 'user', content: 'Hi' }]);
      expect(response).toBe('Hello!');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('handles HTTP error gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      });

      const response = await chatWithGemini([{ role: 'user', content: 'Hi' }]);
      expect(response).toBe('I encountered an error connecting to the intelligence bridge.');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('chatWithGeminiStream', () => {
    it('yields chunks successfully', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"text":"Part 1, "}\n'));
          controller.enqueue(new TextEncoder().encode('data: {"text":"Part 2."}\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
          controller.close();
        }
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream
      });

      const stream = chatWithGeminiStream([{ role: 'user', content: 'Hi' }]);
      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Part 1, ', 'Part 2.']);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('handles stream errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      });

      const stream = chatWithGeminiStream([{ role: 'user', content: 'Hi' }]);
      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks[chunks.length - 1]).toContain('Error connecting to the stream.');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('switches to the next live model on HTTP 503 without retrying the same id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({
          error: 'This model is currently experiencing high demand.',
          code: 503,
        }),
      });

      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"text":"Recovered."}\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
          controller.close();
        }
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      });

      const switches: string[] = [];
      const stream = chatWithGeminiStream(
        [{ role: 'user', content: 'Hi' }],
        undefined,
        'gemini-3.8-flash',
        'test',
        (failed, next) => switches.push(`${failed}->${next}`)
      );
      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Recovered.']);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const firstBody = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
      const secondBody = JSON.parse(String(mockFetch.mock.calls[1][1]?.body));
      expect(firstBody.modelName).toBe('gemini-3.8-flash');
      expect(secondBody.modelName).toBe('gemini-2.5-flash');
      expect(switches).toEqual(['gemini-3.8-flash->gemini-2.5-flash']);
    });

    it('skips a retired model (HTTP 404) immediately', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({
          error: 'This model models/gemini-2.5-pro is no longer available to new users.',
          code: 404,
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'From flash' }),
      });

      const response = await chatWithGemini(
        [{ role: 'user', content: 'Hi' }],
        undefined,
        'gemini-2.5-pro'
      );

      expect(response).toBe('From flash');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const secondBody = JSON.parse(String(mockFetch.mock.calls[1][1]?.body));
      expect(secondBody.modelName).toBe('gemini-2.5-flash');
      expect(secondBody.stream).toBe(false);
    });

    it('does not walk the chain after the proxy exhausts fallbacks', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({
          error: 'Gemini is at capacity.',
          fallbacksExhausted: true,
          code: 503,
        }),
      });

      const stream = chatWithGeminiStream([{ role: 'user', content: 'Hi' }]);
      const chunks: string[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(chunks[0]).toContain('HTTP 503');
      expect(chunks[0]).toContain('not fixed by adding credits');
    });

    it('stops on quota instead of burning the fallback chain', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({
          error: 'You exceeded your current quota, please check your plan and billing details.',
          code: 429,
        }),
      });

      const response = await chatWithGemini([{ role: 'user', content: 'Hi' }]);
      expect(response).toBe('I encountered an error connecting to the intelligence bridge.');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
