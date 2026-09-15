/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, User, Bot, Sparkles, Brain, Loader2, ListTodo, ArrowRight } from 'lucide-react';
import { Message, OceanScores } from '../types';
import { MIRROR_SYSTEM_PROMPT } from '../constants';
import { chatWithGeminiStream } from '../services/gemini';
import OceanCards from './OceanCards';

interface MirrorProps {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onComplete: (scores: OceanScores) => void;
  onSaveSession?: (updatedMessages: Message[]) => void;
}

function formatMirrorContent(content: string): string {
  // Remove JSON_SCORES part first
  let text = content.split('JSON_SCORES:')[0];

  // If "Next question:" is already in the text, make sure it has a newline before it
  if (text.includes('Next question:')) {
    text = text.replace(/([^\n])\s*Next question:/g, '$1\n\nNext question:');
    return text;
  }

  // Common scenario transition phrases:
  const transitions = [
    /Let’s change the setting/i,
    /Let's change the setting/i,
    /Let's try a different scenario/i,
    /Let’s try a different scenario/i,
    /Let's move to a/i,
    /Let’s move to a/i,
    /Let's look at another/i,
    /Let’s look at another/i,
    /For your next scenario/i,
    /For the next scenario/i,
    /Here is a new scenario/i,
    /Imagine this:/i,
    /Consider this setting/i,
    /Now, let's change/i,
    /Now, let’s change/i
  ];

  for (const regex of transitions) {
    const match = text.match(regex);
    if (match && match.index !== undefined) {
      const index = match.index;
      const before = text.slice(0, index).trim();
      const after = text.slice(index);
      if (before.length > 0) {
        return `${before}\n\nNext question: ${after}`;
      }
    }
  }

  return text;
}

export default function Mirror({ messages, setMessages, onComplete, onSaveSession }: MirrorProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [completedScores, setCompletedScores] = useState<OceanScores | null>(null);
  const [loadingText, setLoadingText] = useState('Analyzing...');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scan messages to check if mapping is already complete on mount or messages change
  useEffect(() => {
    const lastModelMessage = [...messages].reverse().find(m => m.role === 'model');
    if (lastModelMessage && lastModelMessage.content.includes('JSON_SCORES:')) {
      const jsonMatch = lastModelMessage.content.match(/JSON_SCORES:\s*(?:```json)?\s*({[\s\S]*?})\s*(?:```)?/);
      if (jsonMatch) {
        try {
          const scoresStr = jsonMatch[1].trim();
          const scores = JSON.parse(scoresStr);
          setCompletedScores(scores);
        } catch (e) {
          console.error("Failed to parse scores from historical message:", e);
        }
      }
    }
  }, [messages]);

  // Estimate progress based on model messages (excluding the first one)
  // Target is roughly 5 scenarios
  const scenarioCount = messages.filter(m => m.role === 'model' && m.content.length > 0).length;
  const maxScenarios = 5;
  const progressPercent = Math.min((scenarioCount / maxScenarios) * 100, 100);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setLoadingText('Analyzing...');

    let modelResponse = '';
    setMessages(prev => [...prev, { role: 'model', content: '' }]);

    const stream = chatWithGeminiStream(
      [...messages, userMessage],
      MIRROR_SYSTEM_PROMPT,
      undefined,
      'mirror',
      (failedModel, nextModel) => {
        setLoadingText('Analyzing... changing to a different model');
      }
    );

    for await (const chunk of stream) {
      modelResponse += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, content: modelResponse }];
      });

      // Check for JSON scores in the stream
      if (modelResponse.includes('JSON_SCORES:')) {
        const jsonMatch = modelResponse.match(/JSON_SCORES:\s*(?:```json)?\s*({[\s\S]*?})\s*(?:```)?/);
        if (jsonMatch) {
          try {
            const scoresStr = jsonMatch[1].trim();
            const scores = JSON.parse(scoresStr);
            setCompletedScores(scores);
            break;
          } catch (e) {
            console.error("Failed to parse scores:", e);
          }
        }
      }
    }

    setIsLoading(false);

    if (onSaveSession) {
      onSaveSession([...messages, userMessage, { role: 'model', content: modelResponse }]);
    }
  };

  return (
    <div className="h-full flex flex-col gap-6 overflow-hidden">
      <OceanCards scores={null} />

      <div className="flex-1 flex flex-col bg-bg-secondary text-text-primary font-sans border border-border-primary rounded-xl overflow-hidden shadow-2xl relative transition-colors duration-300">
        <div className="sticky top-0 z-20 p-4 bg-bg-surface/95 backdrop-blur-sm border-b border-border-primary flex items-center justify-between transition-colors duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-medium tracking-tight text-text-primary">The Mirror</h2>
              <p className="text-xs text-text-muted uppercase tracking-widest">Psychometric Diagnostic</p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 min-w-[120px]">
            <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-text-muted-dark">
              <ListTodo className="w-3 h-3" />
              <span>Alignment {Math.min(scenarioCount, maxScenarios)} / {maxScenarios}</span>
            </div>
            <div className="w-full h-1.5 bg-bg-tertiary border border-border-primary/20 rounded-full overflow-hidden shadow-inner">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                className="h-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]"
              />
            </div>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth pt-6 custom-scrollbar"
        >
          <AnimatePresence initial={false}>
            {messages.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[80%] flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-white ${m.role === 'user' ? 'bg-bg-chat-user' : 'bg-bg-surface border border-border-primary'
                    }`}>
                    {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                  </div>
                  <div className={`p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user'
                      ? 'bg-bg-chat-user text-white rounded-tr-none'
                      : 'bg-bg-chat-model text-text-chat-model rounded-tl-none border border-border-chat-model'
                    }`}>
                    {m.role === 'user' ? m.content : formatMirrorContent(m.content)}
                    {m.role === 'model' && m.content.includes('JSON_SCORES:') && (
                      <div className="mt-4 p-3 bg-green-900/20 border border-green-500/30 rounded-lg flex items-center gap-3 animate-pulse">
                        <Sparkles className="text-green-500 w-4 h-4" />
                        <span className="text-green-400 font-medium">Cognitive mapping complete.</span>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-bg-chat-model p-4 rounded-2xl rounded-tl-none border border-border-chat-model flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
                <span className="text-xs text-text-muted-dark italic">{loadingText}</span>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-bg-surface border-t border-border-primary flex flex-col gap-4 transition-colors duration-300">
          {completedScores ? (
            <div className="flex flex-col items-center gap-4 py-6 justify-center animate-in fade-in zoom-in duration-300">
              <div className="text-sm font-semibold text-text-primary tracking-wide text-center">
                Personality mapping calculated. Ready to proceed.
              </div>
              <button
                onClick={() => onComplete(completedScores)}
                className="flex items-center gap-2 px-8 py-4 rounded-full bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white font-bold text-sm uppercase tracking-widest transition-all shadow-lg shadow-orange-500/20 hover:shadow-orange-500/40 cursor-pointer border border-orange-500/30 hover:scale-105 active:scale-95 duration-150"
              >
                <span>Proceed to Phase 2: The Tailor</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="Respond to the scenario..."
                  className="w-full bg-bg-secondary border border-border-secondary text-text-primary placeholder-text-muted-dark rounded-full py-3 px-6 pr-12 text-sm focus:outline-none focus:border-orange-500 transition-colors"
                />
                <button
                  onClick={handleSend}
                  disabled={isLoading || !input.trim()}
                  className="absolute right-2 p-2 bg-orange-500 rounded-full hover:bg-orange-600 disabled:opacity-50 disabled:bg-bg-tertiary transition-all shadow-lg cursor-pointer"
                >
                  <Send className="w-4 h-4 text-white" />
                </button>
              </div>

              <div className="border-t border-border-primary pt-3">
                <div className="text-[10px] uppercase font-bold tracking-widest text-text-muted-dark mb-2 flex items-center gap-1.5 justify-center">
                  <Sparkles className="w-3 h-3 text-accent-orange" />
                  Skip diagnostic using a pre-calibrated test profile:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  <button
                    onClick={() => setCompletedScores({ openness: 50, conscientiousness: 50, extroversion: 90, agreeableness: 50, neuroticism: 85 })}
                    disabled={isLoading}
                    className="p-3 rounded-xl border border-border-card bg-bg-secondary/60 hover:bg-bg-tertiary hover:border-accent-orange text-left transition-all disabled:opacity-50 group flex flex-col justify-between cursor-pointer"
                  >
                    <div className="text-[10px] font-bold text-accent-orange uppercase tracking-wide group-hover:text-accent-orange-hover transition-colors">High Extroversion and Neuroticism</div>
                    <div className="text-[9px] text-text-muted mt-1 italic leading-tight">Dampens hyper-reactive anxiety. Provides steady, structural ground.</div>
                  </button>

                  <button
                    onClick={() => setCompletedScores({ openness: 50, conscientiousness: 50, extroversion: 15, agreeableness: 50, neuroticism: 90 })}
                    disabled={isLoading}
                    className="p-3 rounded-xl border border-border-card bg-bg-secondary/60 hover:bg-bg-tertiary hover:border-accent-yellow text-left transition-all disabled:opacity-50 group flex flex-col justify-between cursor-pointer"
                  >
                    <div className="text-[10px] font-bold text-accent-yellow uppercase tracking-wide group-hover:text-accent-yellow-hover transition-colors">Low Extroversion, High Neuroticism</div>
                    <div className="text-[9px] text-text-muted mt-1 italic leading-tight">Concise, low-friction tone plus compensatory calm under anxiety.</div>
                  </button>

                  <button
                    onClick={() => setCompletedScores({ openness: 50, conscientiousness: 15, extroversion: 50, agreeableness: 90, neuroticism: 50 })}
                    disabled={isLoading}
                    className="p-3 rounded-xl border border-border-card bg-bg-secondary/60 hover:bg-bg-tertiary hover:border-accent-purple text-left transition-all disabled:opacity-50 group flex flex-col justify-between cursor-pointer"
                  >
                    <div className="text-[10px] font-bold text-accent-purple uppercase tracking-wide group-hover:text-accent-purple-hover transition-colors">Low Conscientiousness, High Agreeableness</div>
                    <div className="text-[9px] text-text-muted mt-1 italic leading-tight">Congruent warmth plus compensatory executive-function scaffolding.</div>
                  </button>

                  <button
                    onClick={() => setCompletedScores({ openness: 50, conscientiousness: 45, extroversion: 50, agreeableness: 85, neuroticism: 50 })}
                    disabled={isLoading}
                    className="p-3 rounded-xl border border-border-card bg-bg-secondary/60 hover:bg-bg-tertiary hover:border-accent-green text-left transition-all disabled:opacity-50 group flex flex-col justify-between cursor-pointer"
                  >
                    <div className="text-[10px] font-bold text-accent-green uppercase tracking-wide group-hover:text-accent-green-hover transition-colors">High Agreeableness (bleed resolved)</div>
                    <div className="text-[9px] text-text-muted mt-1 italic leading-tight">Compassion over industriousness after A↔C disambiguation (A=85, C=45).</div>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
