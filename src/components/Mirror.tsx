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
import {
  MIRROR_QUESTION_COUNT,
  continuationInstruction,
  mirrorTurnFields,
  parseScoreBlock,
  questionNumberAt,
  scoresReady,
  stampQuestionLabel,
  stripJsonScores,
  userAnswerCount,
} from '../mirror/interviewTurns';
import { AiAccessError } from '../services/aiAccess';
import { DEFAULT_MAX_MESSAGE_CHARS } from '../constants/aiAccess';
import { AI_DISCLOSURE } from '../constants/paywallCopy';
import { OceanJudgment } from '../jev/questions';
import { judgeOcean } from '../services/jev';
import OceanCards from './OceanCards';
import OceanJudgmentPanel from './OceanJudgmentPanel';
import AiAccessNotice from './AiAccessNotice';

interface MirrorProps {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  onComplete: (scores: OceanScores) => void;
  onSaveSession?: (updatedMessages: Message[]) => void;
  /** True while App is saving the completed interview. */
  completePending?: boolean;
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

function presentMirrorMessage(content: string, questionNumber: number | null): string {
  return stampQuestionLabel(formatMirrorContent(content), questionNumber);
}

export default function Mirror({ messages, setMessages, onComplete, onSaveSession, completePending = false }: MirrorProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [completedScores, setCompletedScores] = useState<OceanScores | null>(null);
  const [scoreOrigin, setScoreOrigin] = useState<'dialogue' | 'preset' | null>(null);
  const [judgment, setJudgment] = useState<OceanJudgment | null>(null);
  const [judgeStatus, setJudgeStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [loadingText, setLoadingText] = useState('Analyzing...');
  const [accessError, setAccessError] = useState<AiAccessError | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Scores in history count only after five user answers. Presets set scores
  // directly and do not go through this path.
  useEffect(() => {
    if (!scoresReady(messages)) return;
    const lastModelMessage = [...messages].reverse().find(m => m.role === 'model');
    const scores = lastModelMessage ? parseScoreBlock(lastModelMessage.content) : null;
    if (!scores) return;
    setCompletedScores(scores as unknown as OceanScores);
    setScoreOrigin(messages.some((message) => message.role === 'user' && message.content.trim()) ? 'dialogue' : 'preset');
  }, [messages]);

  useEffect(() => {
    if (!completedScores || scoreOrigin !== 'dialogue') return;
    const dialogue = messagesRef.current;
    const hasUser = dialogue.some((message) => message.role === 'user' && message.content.trim());
    if (!hasUser) {
      setJudgeStatus('unavailable');
      setJudgment(null);
      return;
    }
    let cancelled = false;
    setJudgeStatus('loading');
    setJudgment(null);
    judgeOcean(dialogue, completedScores).then((result) => {
      if (cancelled) return;
      if (!result) {
        setJudgeStatus('unavailable');
        return;
      }
      setJudgment(result);
      setJudgeStatus('ready');
    }).catch((error: unknown) => {
      if (cancelled) return;
      if (error instanceof AiAccessError) setAccessError(error);
      setJudgeStatus('unavailable');
    });
    return () => {
      cancelled = true;
    };
  }, [completedScores, scoreOrigin]);

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
    if (sendingRef.current) return;
    const draft = input;
    if (!draft.trim()) return;
    if (draft.length > DEFAULT_MAX_MESSAGE_CHARS) {
      setAccessError(new AiAccessError('input_too_long'));
      return;
    }

    sendingRef.current = true;
    setAccessError(null);
    setIsLoading(true);
    setLoadingText('Analyzing...');

    const userMessage: Message = { role: 'user', content: draft };
    let modelResponse = '';
    let committed = false;

    const commitTurn = () => {
      if (committed) return;
      committed = true;
      setInput('');
      setMessages(prev => [...prev, userMessage, { role: 'model', content: '' }]);
    };

    const answerCount = userAnswerCount([...messages, userMessage]);
    const acceptScores = answerCount >= MIRROR_QUESTION_COUNT;
    const turn = mirrorTurnFields(answerCount);
    const showModel = (content: string) => {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'model') return prev;
        return [...prev.slice(0, -1), { ...last, content }];
      });
    };

    try {
      const stream = chatWithGeminiStream(
        [...messages, userMessage],
        MIRROR_SYSTEM_PROMPT,
        undefined,
        'mirror',
        () => {
          setLoadingText('Still working on it…');
        },
        commitTurn,
        turn,
      );

      for await (const chunk of stream) {
        commitTurn();
        modelResponse += chunk;
        const visible = acceptScores ? modelResponse : stripJsonScores(modelResponse);
        showModel(visible);

        if (acceptScores && parseScoreBlock(modelResponse)) {
          setCompletedScores(parseScoreBlock(modelResponse) as unknown as OceanScores);
          setScoreOrigin('dialogue');
          break;
        }
      }

      if (!acceptScores && modelResponse.includes('JSON_SCORES:')) {
        const commentary = stripJsonScores(modelResponse).trim();
        const followSystem = `${MIRROR_SYSTEM_PROMPT}\n\n${continuationInstruction(answerCount)}`;
        let followUp = '';
        const followStream = chatWithGeminiStream(
          [...messages, userMessage],
          followSystem,
          undefined,
          'mirror',
          () => {
            setLoadingText('Still working on it…');
          },
          commitTurn,
          turn,
        );
        for await (const chunk of followStream) {
          commitTurn();
          followUp += chunk;
          const question = stripJsonScores(followUp).trim();
          modelResponse = commentary && question ? `${commentary}\n\n${question}` : (question || commentary);
          showModel(modelResponse);
        }
        if (!followUp.trim()) {
          modelResponse = commentary;
          showModel(modelResponse);
        }
      }

      if (committed && onSaveSession) {
        onSaveSession([...messages, userMessage, { role: 'model', content: modelResponse }]);
      }
    } catch (error) {
      if (error instanceof AiAccessError) {
        setAccessError(error);
        return;
      }
      console.error("Mirror request failed:", error);
    } finally {
      sendingRef.current = false;
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col gap-6 overflow-hidden">
      <p className="text-sm leading-relaxed text-text-secondary">{AI_DISCLOSURE}</p>
      <OceanCards scores={null} />

      <div className="flex-1 flex flex-col bg-bg-secondary text-text-primary font-sans border border-border-primary rounded-xl overflow-hidden shadow-2xl relative transition-colors duration-300">
        <div className="sticky top-0 z-20 p-4 bg-bg-surface/95 backdrop-blur-sm border-b border-border-primary flex items-center justify-between transition-colors duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-button-brand flex items-center justify-center shadow-lg shadow-orange-500/20">
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
            {messages.map((m, i) => {
              const questionNumber = m.role === 'model' ? questionNumberAt(messages, i) : null;
              const scoringTurn = m.role === 'model' && questionNumber === null && m.content.includes('JSON_SCORES:');
              return (
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
                    {m.role === 'user' ? m.content : presentMirrorMessage(m.content, questionNumber)}
                    {scoringTurn && (
                      <div className="mt-4 p-3 bg-green-900/20 border border-green-500/30 rounded-lg flex items-center gap-3 animate-pulse">
                        <Sparkles className="text-status-success w-4 h-4" />
                        <span className="text-status-success font-medium">Cognitive mapping complete.</span>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
              );
            })}
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
              {judgeStatus === 'loading' && (
                <p className="text-xs text-text-secondary italic">Checking these scores against your answers…</p>
              )}
              {judgeStatus === 'ready' && judgment && (
                <OceanJudgmentPanel
                  judgment={judgment}
                  pending={completePending}
                  onKeep={() => onComplete(completedScores)}
                  onAcceptCorrections={() => onComplete(judgment.correctedScores)}
                />
              )}
              {judgeStatus !== 'ready' && (
                <button
                  onClick={() => onComplete(completedScores)}
                  disabled={completePending}
                  className="flex items-center gap-2 px-8 py-4 rounded-full bg-gradient-to-r from-button-brand to-red-800 hover:from-button-brand-hover hover:to-red-900 text-white font-bold text-sm uppercase tracking-widest transition-all shadow-lg shadow-orange-500/20 hover:shadow-orange-500/40 cursor-pointer border border-orange-500/30 hover:scale-105 active:scale-95 duration-150 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  <span>Proceed to Phase 2: The Tailor</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <>
              <AiAccessNotice error={accessError} />
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
                  aria-label="Send response"
                  className="absolute right-2 p-2 bg-button-brand rounded-full hover:bg-button-brand-hover disabled:opacity-50 disabled:bg-bg-tertiary transition-all shadow-lg cursor-pointer"
                >
                  <Send className="w-4 h-4 text-white" />
                </button>
              </div>

              <div className="border-t border-border-primary pt-3">
                <div className="text-[10px] uppercase font-bold tracking-widest text-text-secondary mb-1 flex items-center gap-1.5 justify-center">
                  <Sparkles className="w-3 h-3 text-accent-orange" />
                  Skip diagnostic using a pre-calibrated test profile:
                </div>
                <p className="text-[11px] text-text-secondary text-center mb-2 italic">
                  Presets skip the diagnostic for a quick demo — no login required.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  <button
                    onClick={() => {
                      setScoreOrigin('preset');
                      setJudgment(null);
                      setJudgeStatus('idle');
                      setCompletedScores({ openness: 50, conscientiousness: 50, extroversion: 90, agreeableness: 50, neuroticism: 85 });
                    }}
                    disabled={isLoading}
                    className="p-3 rounded-xl border border-border-card bg-bg-secondary/60 hover:bg-bg-tertiary hover:border-accent-orange text-left transition-all disabled:opacity-50 group flex flex-col justify-between cursor-pointer"
                  >
                    <div className="text-[10px] font-bold text-accent-orange uppercase tracking-wide group-hover:text-accent-orange-hover transition-colors">High Extraversion and Neuroticism</div>
                    <div className="text-[9px] text-text-secondary mt-1 italic leading-tight">Dampens hyper-reactive anxiety. Provides steady, structural ground.</div>
                  </button>

                  <button
                    onClick={() => {
                      setScoreOrigin('preset');
                      setJudgment(null);
                      setJudgeStatus('idle');
                      setCompletedScores({ openness: 50, conscientiousness: 50, extroversion: 15, agreeableness: 50, neuroticism: 90 });
                    }}
                    disabled={isLoading}
                    className="p-3 rounded-xl border border-border-card bg-bg-secondary/60 hover:bg-bg-tertiary hover:border-accent-yellow text-left transition-all disabled:opacity-50 group flex flex-col justify-between cursor-pointer"
                  >
                    <div className="text-[10px] font-bold text-accent-yellow uppercase tracking-wide group-hover:text-accent-yellow-hover transition-colors">Low Extraversion, High Neuroticism</div>
                    <div className="text-[9px] text-text-secondary mt-1 italic leading-tight">Concise, low-friction tone plus compensatory calm under anxiety.</div>
                  </button>

                  <button
                    onClick={() => {
                      setScoreOrigin('preset');
                      setJudgment(null);
                      setJudgeStatus('idle');
                      setCompletedScores({ openness: 50, conscientiousness: 15, extroversion: 50, agreeableness: 90, neuroticism: 50 });
                    }}
                    disabled={isLoading}
                    className="p-3 rounded-xl border border-border-card bg-bg-secondary/60 hover:bg-bg-tertiary hover:border-accent-purple text-left transition-all disabled:opacity-50 group flex flex-col justify-between cursor-pointer"
                  >
                    <div className="text-[10px] font-bold text-accent-purple uppercase tracking-wide group-hover:text-accent-purple-hover transition-colors">Low Conscientiousness, High Agreeableness</div>
                    <div className="text-[9px] text-text-secondary mt-1 italic leading-tight">Congruent warmth plus compensatory executive-function scaffolding.</div>
                  </button>

                  <button
                    onClick={() => {
                      setScoreOrigin('preset');
                      setJudgment(null);
                      setJudgeStatus('idle');
                      setCompletedScores({ openness: 50, conscientiousness: 45, extroversion: 50, agreeableness: 85, neuroticism: 50 });
                    }}
                    disabled={isLoading}
                    className="p-3 rounded-xl border border-border-card bg-bg-secondary/60 hover:bg-bg-tertiary hover:border-accent-green text-left transition-all disabled:opacity-50 group flex flex-col justify-between cursor-pointer"
                  >
                    <div className="text-[10px] font-bold text-accent-green uppercase tracking-wide group-hover:text-accent-green-hover transition-colors">High Agreeableness (bleed resolved)</div>
                    <div className="text-[9px] text-text-secondary mt-1 italic leading-tight">Compassion over industriousness after A↔C disambiguation (A=85, C=45).</div>
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
