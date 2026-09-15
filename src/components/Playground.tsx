/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Sparkles, User, Shield, Info, Loader2, AlertTriangle, Zap, Split, Brain, Trash2, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { OceanScores, Message, ComparisonMessage } from '../types';
import { generateAlignmentPrompt, generateInverseAlignmentPrompt } from '../constants';
import { chatWithGeminiStream } from '../services/gemini';
import OceanCards from './OceanCards';
import { isStreamErrorText } from './playgroundUtils';

const GENERATION_TIMEOUT_MS = 25000;

interface PlaygroundProps {
  scores: OceanScores;
  messages: ComparisonMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ComparisonMessage[]>>;
  setScores: React.Dispatch<React.SetStateAction<OceanScores | null>>;
  onSaveSession?: (updatedMessages: ComparisonMessage[], updatedScores?: OceanScores) => void;
}

function extractFirstHighlight(text: string): { text: string; explanation: string } | null {
  const match = text.match(/<mark-bridge explanation="([^"]*)">(.*?)<\/mark-bridge>/);
  if (match) {
    return { explanation: match[1], text: match[2] };
  }
  return null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Generation timed out')), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export default function Playground({ scores, messages, setMessages, setScores, onSaveSession }: PlaygroundProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activeAnalysis, setActiveAnalysis] = useState<{ text: string; explanation: string; type: string } | null>(null);
  const [expandedIndices, setExpandedIndices] = useState<Record<number, boolean>>({});
  const initializedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const generationAttemptsRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    if (!initializedRef.current && messages.length > 0) {
      setExpandedIndices({ [messages.length - 1]: true });
      initializedRef.current = true;
    }
  }, [messages]);

  const handleDelete = (indexToDelete: number) => {
    const updated = messages.filter((_, idx) => idx !== indexToDelete);
    setMessages(updated);
    if (onSaveSession) {
      onSaveSession(updated);
    }
    setExpandedIndices(prev => {
      const next: Record<number, boolean> = {};
      Object.keys(prev).forEach(keyStr => {
        const idx = parseInt(keyStr, 10);
        if (idx < indexToDelete) {
          next[idx] = prev[idx];
        } else if (idx > indexToDelete) {
          next[idx - 1] = prev[idx];
        }
      });
      return next;
    });
  };

  const alignedSystemPrompt = generateAlignmentPrompt(scores);
  const unalignedSystemPrompt = generateInverseAlignmentPrompt(scores);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [messages]);

  const updateMessage = useCallback((index: number, patch: Partial<ComparisonMessage>) => {
    setMessages(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...patch };
      return updated;
    });
  }, [setMessages]);

  const selectFirstHighlight = useCallback((alignedText: string, unalignedText: string) => {
    const alignedHighlight = extractFirstHighlight(alignedText);
    if (alignedHighlight) {
      setActiveAnalysis({ ...alignedHighlight, type: 'aligned' });
      return;
    }
    const unalignedHighlight = extractFirstHighlight(unalignedText);
    if (unalignedHighlight) {
      setActiveAnalysis({ ...unalignedHighlight, type: 'unaligned' });
    }
  }, []);

  const runGeneration = useCallback(async (
    messageIndex: number,
    userPrompt: string,
    options?: { scoresOverride?: OceanScores }
  ) => {
    const attemptId = (generationAttemptsRef.current.get(messageIndex) ?? 0) + 1;
    generationAttemptsRef.current.set(messageIndex, attemptId);
    const isStaleAttempt = () => generationAttemptsRef.current.get(messageIndex) !== attemptId;

    const activeScores = options?.scoresOverride ?? scores;
    const alignedPrompt = generateAlignmentPrompt(activeScores);
    const unalignedPrompt = generateInverseAlignmentPrompt(activeScores);

    updateMessage(messageIndex, {
      loading: true,
      error: false,
      aligned: '',
      unaligned: '',
    });
    setIsLoading(true);

    const conversationHistory: Message[] = messages
      .filter((_, idx) => idx !== messageIndex)
      .flatMap(m => [
        { role: 'user' as const, content: m.user },
        { role: 'model' as const, content: m.aligned },
      ]);
    const currentInput: Message = { role: 'user', content: userPrompt };

    let alignedText = '';
    let unalignedText = '';

    const generationPromise = (async () => {
      const alignedPromise = (async () => {
        const stream = chatWithGeminiStream(
          [...conversationHistory, currentInput],
          alignedPrompt,
          'gemini-2.5-pro',
          'playground-aligned'
        );
        for await (const chunk of stream) {
          alignedText += chunk;
        }
      })();

      const unalignedPromise = (async () => {
        const stream = chatWithGeminiStream(
          [...conversationHistory, currentInput],
          unalignedPrompt,
          'gemini-2.5-pro',
          'playground-unaligned'
        );
        for await (const chunk of stream) {
          unalignedText += chunk;
        }
      })();

      await Promise.all([alignedPromise, unalignedPromise]);

      if (isStreamErrorText(alignedText) || isStreamErrorText(unalignedText)) {
        throw new Error('Stream connection failed');
      }

      return { alignedText, unalignedText };
    })();

    try {
      const { alignedText: finalAligned, unalignedText: finalUnaligned } = await withTimeout(
        generationPromise,
        GENERATION_TIMEOUT_MS
      );

      if (isStaleAttempt()) return;

      setMessages(prev => {
        const updated = [...prev];
        updated[messageIndex] = {
          ...updated[messageIndex],
          aligned: finalAligned,
          unaligned: finalUnaligned,
          loading: false,
          error: false,
        };
        if (onSaveSession) {
          onSaveSession(updated, options?.scoresOverride);
        }
        return updated;
      });
      selectFirstHighlight(finalAligned, finalUnaligned);
    } catch (err) {
      if (isStaleAttempt()) return;
      console.error('Bridge generation failed:', err);
      updateMessage(messageIndex, { loading: false, error: true });
    } finally {
      if (!isStaleAttempt()) {
        setIsLoading(false);
      }
    }
  }, [messages, scores, updateMessage, selectFirstHighlight, onSaveSession, setMessages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userPrompt = input.trim();
    const newMessage: ComparisonMessage = {
      user: userPrompt,
      aligned: '',
      unaligned: '',
      loading: true,
    };

    const newIndex = messages.length;
    setExpandedIndices({ [newIndex]: true });
    setMessages(prev => [...prev, newMessage]);
    setInput('');

    await runGeneration(newIndex, userPrompt);
  };

  const handleRetry = async (messageIndex: number) => {
    if (isLoading) return;
    const message = messages[messageIndex];
    if (!message) return;
    await runGeneration(messageIndex, message.user);
  };

  const handlePresetSubmit = async (presetScores: OceanScores, presetPrompt: string) => {
    if (isLoading) return;

    if (setScores) {
      setScores(presetScores);
    }

    setInput('');

    const newMessage: ComparisonMessage = {
      user: presetPrompt,
      aligned: '',
      unaligned: '',
      loading: true,
    };

    const newIndex = messages.length;
    setExpandedIndices({ [newIndex]: true });
    setMessages(prev => [...prev, newMessage]);

    await runGeneration(newIndex, presetPrompt, { scoresOverride: presetScores });
  };

  const focusQuestionInput = () => {
    inputRef.current?.focus();
  };

  const renderContent = (text: string, type: 'aligned' | 'unaligned') => {
    const parts = text.split(/(<mark-bridge explanation="[^"]*">.*?<\/mark-bridge>)/g);

    return parts.map((part, i) => {
      const match = part.match(/<mark-bridge explanation="([^"]*)">(.*?)<\/mark-bridge>/);
      if (match) {
        const explanation = match[1];
        const content = match[2];
        const isActive = activeAnalysis?.text === content && activeAnalysis?.explanation === explanation;

        return (
          <button
            key={i}
            onClick={() => setActiveAnalysis({ text: content, explanation, type })}
            className={`cursor-help transition-all duration-300 font-medium mark-bridge-highlight ${
              type === 'aligned' ? 'mark-aligned' : 'mark-unaligned'
            } ${isActive ? 'active' : ''}`}
            title="Click to analyze in Logic Analysis"
          >
            {content}
          </button>
        );
      }
      return part;
    });
  };

  const renderColumnSkeleton = () => (
    <div className="space-y-2">
      <div className="h-3 w-3/4 bg-border-primary animate-pulse rounded" />
      <div className="h-3 w-1/2 bg-border-primary animate-pulse rounded" />
      <div className="h-3 w-2/3 bg-border-primary animate-pulse rounded" />
    </div>
  );

  return (
    <div className="h-full flex flex-col gap-6 overflow-hidden">
      <OceanCards scores={scores} />

      <div className="flex-1 flex gap-6 relative min-h-0">
        <AnimatePresence>
          {activeAnalysis && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
              onClick={() => setActiveAnalysis(null)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className={`p-6 rounded-2xl border max-w-sm w-full shadow-2xl transition-colors duration-300 ${
                  activeAnalysis.type === 'aligned'
                    ? 'bg-bg-modal-aligned border-green-500/50 text-text-primary'
                    : 'bg-bg-modal-unaligned border-red-500/50 text-text-primary'
                }`}
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className={`p-1.5 rounded-lg ${activeAnalysis.type === 'aligned' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {activeAnalysis.type === 'aligned' ? <Shield className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                  </div>
                  <h4 className="font-bold text-sm uppercase tracking-widest">{activeAnalysis.type.toUpperCase()} ANALYSIS</h4>
                </div>
                <p className="text-text-secondary text-[10px] uppercase font-bold tracking-wider mb-2">Original Context:</p>
                <blockquote className="border-l-2 border-border-primary/40 pl-3 italic text-xs mb-4 text-text-secondary">&ldquo;{activeAnalysis.text}&rdquo;</blockquote>
                <p className="text-text-secondary text-[10px] uppercase font-bold tracking-wider mb-2">Bridge Logic:</p>
                <p className="text-sm leading-relaxed text-text-primary">
                  {activeAnalysis.explanation}
                </p>
                <button
                  onClick={() => setActiveAnalysis(null)}
                  className="mt-6 w-full py-3 bg-bg-surface hover:bg-bg-tertiary border border-border-primary text-text-primary rounded-xl text-xs font-bold uppercase transition-colors cursor-pointer"
                >
                  Dismiss Analysis
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 flex flex-col bg-bg-secondary border border-border-primary rounded-xl overflow-hidden shadow-2xl relative min-w-0 transition-colors duration-300">
          <div className="grid grid-cols-2 bg-bg-surface border-b border-border-primary transition-colors duration-300">
            <div className="p-4 flex items-center justify-between border-r border-border-primary">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-3">
                  <Shield className="w-4 h-4 text-green-400" />
                  <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-green-400">Aligned</span>
                </div>
                <span className="text-[9px] text-text-muted italic pl-7">Complementarity + congruence (research matrix)</span>
              </div>
              <Zap className="w-3 h-3 text-text-primary animate-pulse hidden sm:block" />
            </div>
            <div className="p-4 flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-red-500">Unaligned</span>
                </div>
                <span className="text-[9px] text-text-muted italic pl-7">Similarity-attraction / amplify extremes</span>
              </div>
              <Split className="w-3 h-3 text-red-800 hidden sm:block" />
            </div>
          </div>

          <div className="p-4 bg-bg-surface border-b border-border-primary transition-colors duration-300">
            <div className="relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask a question to compare Aligned vs Unaligned responses..."
                className="w-full bg-bg-secondary border border-border-secondary text-text-primary placeholder-text-muted-dark rounded-xl py-4 px-6 pr-14 text-sm focus:outline-none focus:border-blue-500 transition-all resize-none h-[64px]"
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="absolute right-3 bottom-3 p-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 transition-all rounded-lg shadow-lg shadow-orange-600/20 cursor-pointer"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-0 flex flex-col divide-y divide-border-primary custom-scrollbar transition-colors duration-300"
          >
            {isLoading && (
              <div className="p-3 flex justify-center gap-2 bg-bg-secondary border-b border-border-primary transition-colors duration-300 shrink-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                <span className="text-[10px] uppercase font-bold tracking-widest text-text-secondary">Generating Aligned and Unaligned responses...</span>
              </div>
            )}

            {messages.length === 0 && !isLoading && (
              <div className="p-12 sm:p-16 flex flex-col items-center justify-center text-center">
                <Sparkles className="w-12 h-12 mb-4 text-orange-500" />
                <h4 className="text-lg font-semibold text-text-primary">Compare Aligned vs Unaligned</h4>
                <p className="text-sm max-w-md mt-2 text-text-secondary leading-relaxed">
                  Ask any question below. Both columns will answer side-by-side so you can see how personality-aware steering changes the response.
                </p>
                <button
                  type="button"
                  onClick={focusQuestionInput}
                  className="mt-6 inline-flex items-center gap-2 px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white font-bold text-sm uppercase tracking-wider rounded-xl shadow-lg shadow-orange-600/20 transition-all cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  Ask your first question
                </button>
              </div>
            )}

            {[...messages].reverse().map((m, idx) => {
              const origIdx = messages.length - 1 - idx;
              const isExpanded = expandedIndices[origIdx];

              return (
                <div key={origIdx} className="flex flex-col">
                  {isExpanded ? (
                    <>
                      <div className="bg-bg-tertiary p-4 flex justify-between items-center border-b border-border-primary transition-colors duration-300">
                        <div className="flex-1 flex justify-center">
                          <div className="flex items-center gap-3 bg-bg-playground-user-bubble px-4 py-2 rounded-full border border-border-playground-user-bubble max-w-[90%] overflow-hidden">
                            <User className="w-3 h-3 text-icon-playground-user-bubble shrink-0" />
                            <span className="text-xs font-medium text-text-playground-user-bubble italic truncate">{m.user}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleDelete(origIdx)}
                            className="p-1.5 hover:bg-red-500/10 text-text-muted hover:text-red-500 rounded-lg transition-colors cursor-pointer"
                            title="Delete conversation"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setExpandedIndices(prev => ({ ...prev, [origIdx]: false }))}
                            className="p-1.5 hover:bg-bg-surface text-text-muted hover:text-text-primary rounded-lg transition-colors cursor-pointer"
                            title="Collapse conversation"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {m.error ? (
                        <div className="p-8 flex flex-col items-center justify-center text-center gap-4 bg-bg-secondary">
                          <AlertTriangle className="w-10 h-10 text-red-500" />
                          <div>
                            <p className="text-sm font-semibold text-text-primary">Generation failed or timed out</p>
                            <p className="text-xs text-text-secondary mt-1 max-w-sm">
                              Both responses must finish before results appear. This took longer than {GENERATION_TIMEOUT_MS / 1000} seconds or the connection was interrupted.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRetry(origIdx)}
                            disabled={isLoading}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-all cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Retry
                          </button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 divide-x divide-border-primary min-h-[100px] transition-colors duration-300">
                          <div className="p-4 sm:p-6 text-sm text-text-primary leading-relaxed whitespace-pre-wrap bg-green-500/5">
                            {m.loading || !m.aligned
                              ? renderColumnSkeleton()
                              : renderContent(m.aligned, 'aligned')}
                          </div>
                          <div className="p-4 sm:p-6 text-sm text-text-primary leading-relaxed whitespace-pre-wrap border-l border-red-500/10 bg-red-500/5">
                            {m.loading || !m.unaligned
                              ? renderColumnSkeleton()
                              : renderContent(m.unaligned, 'unaligned')}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="bg-bg-tertiary/60 hover:bg-bg-tertiary p-3 flex justify-between items-center transition-colors duration-200">
                      <div
                        onClick={() => setExpandedIndices(prev => ({ ...prev, [origIdx]: true }))}
                        className="flex-1 flex items-center gap-3 cursor-pointer select-none overflow-hidden mr-4"
                      >
                        <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-blue-600/10 text-blue-400 border border-blue-500/20 shrink-0">
                          Prompt
                        </span>
                        <span className="text-xs text-text-secondary truncate font-medium max-w-[80%]">
                          {m.user}
                        </span>
                        {m.error && (
                          <span className="text-[10px] uppercase font-bold text-red-500 shrink-0">Failed</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleDelete(origIdx)}
                          className="p-1.5 hover:bg-red-500/10 text-text-muted hover:text-red-500 rounded-lg transition-colors cursor-pointer"
                          title="Delete conversation"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setExpandedIndices(prev => ({ ...prev, [origIdx]: true }))}
                          className="p-1.5 hover:bg-bg-surface text-text-muted hover:text-text-primary rounded-lg transition-colors cursor-pointer"
                          title="Expand conversation"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="hidden lg:flex w-[320px] shrink-0 flex-col gap-6">
          <div className="flex-1 p-6 bg-bg-tertiary border border-border-primary rounded-xl flex flex-col gap-4 overflow-hidden shadow-xl transition-colors duration-300">
            <div className="flex items-center gap-3">
              <Brain className="w-5 h-5 text-orange-500" />
              <h4 className="text-sm font-bold uppercase tracking-[0.2em] text-text-primary">Logic Analysis</h4>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
              <AnimatePresence mode="wait">
                {activeAnalysis ? (
                  <motion.div
                    key="analysis"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <div>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-widest ${
                        activeAnalysis.type === 'aligned' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {activeAnalysis.type} Mode Active
                      </span>
                    </div>

                    <div className="space-y-2">
                      <p className="text-[10px] uppercase font-bold text-text-secondary tracking-wider">Proof Point:</p>
                      <blockquote className="p-4 bg-bg-primary/40 border-l-2 border-orange-500 rounded-r-lg italic text-sm text-text-secondary">
                        &ldquo;{activeAnalysis.text}&rdquo;
                      </blockquote>
                    </div>

                    <div className="space-y-3">
                      <p className="text-[10px] uppercase font-bold text-text-secondary tracking-wider">Alignment Explanation:</p>
                      <p className="text-sm leading-relaxed text-text-secondary">
                        {activeAnalysis.explanation}
                      </p>
                    </div>

                    <button
                      onClick={() => setActiveAnalysis(null)}
                      className="text-[10px] uppercase font-bold text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                    >
                      Clear Selection
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="h-full flex flex-col items-center justify-center text-center p-4"
                  >
                    <Info className="w-10 h-10 text-text-secondary mb-4" />
                    <p className="text-xs text-text-secondary leading-relaxed">
                      Select a <span className="font-semibold text-text-primary">highlighted</span> span in the Aligned or Unaligned column to view its psychometric derivation and alignment logic.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="p-5 bg-blue-900/10 border border-blue-500/20 rounded-xl">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-3">Steering Mode</h4>
            <div className="space-y-4">
              <div className="flex items-start gap-2">
                <Shield className="w-3 h-3 text-green-500 mt-0.5 shrink-0" />
                <p className="text-[11px] text-text-secondary leading-relaxed italic">
                  Aligned: Complementarity + congruence (research matrix). Applies congruent, complementary, or compensatory directives per trait.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3 h-3 text-red-500 mt-0.5 shrink-0" />
                <p className="text-[11px] text-text-secondary leading-relaxed italic">
                  Unaligned: Similarity-attraction / amplify extremes. Inverts directive selection to reinforce trait spikes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
