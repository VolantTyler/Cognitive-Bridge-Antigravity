import { describe, expect, it } from 'vitest';
import { isStreamErrorText } from '../playgroundUtils';

describe('isStreamErrorText', () => {
  it('detects Gemini proxy stream errors', () => {
    expect(isStreamErrorText('Error connecting to the stream.')).toBe(true);
  });

  it('detects Ollama stream errors', () => {
    expect(isStreamErrorText('Error connecting to Ollama stream: connection refused')).toBe(true);
  });

  it('ignores normal model output', () => {
    expect(isStreamErrorText('Here is an answer about connecting to ideas.')).toBe(false);
  });
});
