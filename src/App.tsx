/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Brain, User as UserIcon, Cpu } from 'lucide-react';
import { ModuleId, OceanScores, Message, ComparisonMessage } from './types';
import { INITIAL_OCEAN, INITIAL_MIRROR_MESSAGE } from './constants';
import Mirror from './components/Mirror';
import Tailor from './components/Tailor';
import Playground from './components/Playground';
import FeedbackModal from './components/FeedbackModal';
import SettingsModal from './components/SettingsModal';
import ReleaseNotesModal from './components/ReleaseNotesModal';
import { getOllamaConfig } from './services/gemini';

import { auth, googleProvider, db, logAnalyticsEvent } from './services/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [activeModule, setActiveModule] = useState<ModuleId>('mirror');
  const [scores, setScores] = useState<OceanScores | null>(null);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isReleaseNotesOpen, setIsReleaseNotesOpen] = useState(false);
  const [ollamaConfig, setOllamaConfigState] = useState(() => getOllamaConfig());
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Theme state initialized from localStorage
  const [isLightMode, setIsLightMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      return saved !== 'dark';
    }
    return true;
  });

  // Synchronize class list on document element
  useEffect(() => {
    if (isLightMode) {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
    localStorage.setItem('theme', isLightMode ? 'light' : 'dark');
  }, [isLightMode]);

  const toggleTheme = () => {
    setIsLightMode(prev => !prev);
  };

  const [mirrorMessages, setMirrorMessages] = useState<Message[]>([
    { role: 'model', content: INITIAL_MIRROR_MESSAGE }
  ]);
  const [playgroundMessages, setPlaygroundMessages] = useState<ComparisonMessage[]>([]);

  // Refs to capture the latest state in the onAuthStateChanged closure
  const scoresRef = useRef(scores);
  const mirrorMessagesRef = useRef(mirrorMessages);
  const playgroundMessagesRef = useRef(playgroundMessages);
  const activeModuleRef = useRef(activeModule);

  useEffect(() => { scoresRef.current = scores; }, [scores]);
  useEffect(() => { mirrorMessagesRef.current = mirrorMessages; }, [mirrorMessages]);
  useEffect(() => { playgroundMessagesRef.current = playgroundMessages; }, [playgroundMessages]);
  useEffect(() => {
    activeModuleRef.current = activeModule;
    logAnalyticsEvent('module_viewed', { module_id: activeModule });
  }, [activeModule]);

  // Firestore save wrapper (stream-settlement optimized)
  const saveToCloud = async (
    updatedScores: OceanScores | null,
    updatedMirror: Message[],
    updatedPlayground: ComparisonMessage[],
    updatedModule: ModuleId
  ) => {
    if (!auth.currentUser) return;
    try {
      const userDocRef = doc(db, 'users', auth.currentUser.uid);
      await setDoc(userDocRef, {
        scores: updatedScores,
        mirrorMessages: updatedMirror,
        playgroundMessages: updatedPlayground.map(msg => ({
          user: msg.user,
          aligned: msg.aligned,
          unaligned: msg.unaligned,
          loading: false
        })),
        activeModule: updatedModule,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Failed to save session to cloud:", error);
    }
  };

  // Auth State Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        logAnalyticsEvent('auth_state_changed', { status: 'logged_in' });
        // Check for existing cloud profile
        const userDocRef = doc(db, 'users', currentUser.uid);
        try {
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            setScores(data.scores || null);
            setMirrorMessages(data.mirrorMessages || []);
            setPlaygroundMessages(data.playgroundMessages || []);
            setActiveModule(data.activeModule || 'mirror');
          } else {
            // New user: Migrate local guest session to Cloud
            await setDoc(userDocRef, {
              scores: scoresRef.current,
              mirrorMessages: mirrorMessagesRef.current,
              playgroundMessages: playgroundMessagesRef.current.map(msg => ({
                user: msg.user,
                aligned: msg.aligned,
                unaligned: msg.unaligned,
                loading: false
              })),
              activeModule: activeModuleRef.current,
              updatedAt: serverTimestamp()
            });
          }
        } catch (error) {
          console.error("Error restoring/migrating session:", error);
        }
      } else {
        setUser(null);
        logAnalyticsEvent('auth_state_changed', { status: 'logged_out' });
        // Clean slate on disconnect / local guest mode
        setScores(null);
        setMirrorMessages([
          { role: 'model', content: INITIAL_MIRROR_MESSAGE }
        ]);
        setPlaygroundMessages([]);
        setActiveModule('mirror');
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Google Sign-In failed:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign out failed:", error);
    }
  };

  const handleMirrorComplete = (newScores: OceanScores) => {
    setScores(newScores);
    setActiveModule('tailor');
    saveToCloud(newScores, mirrorMessages, playgroundMessages, 'tailor');
  };

  const handleMirrorSave = (updatedMirrorMessages: Message[]) => {
    setMirrorMessages(updatedMirrorMessages);
    saveToCloud(scores, updatedMirrorMessages, playgroundMessages, activeModule);
  };

  const currentStep = scores ? (activeModule === 'playground' ? 3 : 2) : 1;

  return (
    <div className="min-h-screen bg-bg-primary text-text-secondary flex flex-col font-sans transition-colors duration-300">
      {/* Navigation Header */}
      <nav className="h-16 bg-bg-secondary border-b border-border-primary px-6 flex items-center justify-between z-50 sticky top-0 transition-colors duration-300">
        <div className="flex items-center gap-2">
          <img
            src="/favicon.svg"
            alt="Cognitive Bridge"
            className="w-8 h-8 rounded shadow-lg shadow-orange-500/10"
          />
          <span className="font-bold tracking-tight text-sm sm:text-lg">COGNITIVE BRIDGE <span className="hidden sm:inline-block text-[10px] font-mono text-status-brand ml-1 border border-orange-500/30 px-1 rounded uppercase">v1.5</span></span>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-8 mr-2">
            {[
              { id: 'mirror', label: '1. The Mirror', active: activeModule === 'mirror' },
              { id: 'tailor', label: '2. The Tailor', active: activeModule === 'tailor', disabled: !scores },
              { id: 'playground', label: '3. The Bridge', active: activeModule === 'playground', disabled: !scores },
            ].map((step) => (
              <button
                key={step.id}
                onClick={() => !step.disabled && setActiveModule(step.id as ModuleId)}
                disabled={step.disabled}
                className={`text-xs uppercase tracking-[0.2em] font-bold transition-all px-4 py-2 rounded-full cursor-pointer ${step.active
                  ? 'text-text-primary bg-bg-surface border border-border-secondary'
                  : step.disabled ? 'text-text-muted-darker cursor-not-allowed' : 'text-text-muted hover:text-text-primary'
                  }`}
              >
                {step.label}
              </button>
            ))}
          </div>

          {/* Combined Settings Menu Dropdown Container */}
          <div className="relative" ref={menuRef}>
            {user ? (
              <button
                onClick={() => setIsMenuOpen(prev => !prev)}
                className="flex items-center gap-2 bg-bg-tertiary border border-border-primary hover:border-orange-500/30 rounded-xl px-3 py-1.5 select-none shadow-sm cursor-pointer transition-all hover:bg-bg-surface group"
                title="Open settings menu"
              >
                {user.photoURL ? (
                  <img src={user.photoURL} alt="profile" className="w-5 h-5 rounded-md object-cover border border-border-secondary group-hover:border-orange-500/40" />
                ) : (
                  <div className="w-5 h-5 rounded-md bg-button-brand flex items-center justify-center text-white text-[10px] font-bold">
                    {(user.displayName || user.email || '?')[0].toUpperCase()}
                  </div>
                )}
                <span className="text-[10px] font-bold text-text-primary group-hover:text-status-brand transition-colors">
                  {user.displayName || user.email?.split('@')[0]}
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                <span className="text-[9px] uppercase tracking-wider text-status-success font-bold hidden md:inline">Synced</span>
              </button>
            ) : (
              <button
                onClick={() => setIsMenuOpen(prev => !prev)}
                className="flex items-center justify-center gap-2 p-2 sm:px-3.5 sm:py-1.5 rounded-xl bg-button-brand hover:bg-button-brand-hover text-white text-[10px] font-bold uppercase tracking-wider transition-all shadow-lg shadow-orange-600/10 cursor-pointer border border-orange-500/20"
                title="Open menu / Login"
              >
                <UserIcon className="w-3.5 h-3.5 text-white sm:hidden" />
                <Brain className="w-3.5 h-3.5 text-white hidden sm:inline" />
                <span className="hidden sm:inline">Login</span>
              </button>
            )}

            {/* Dropdown Menu Box */}
            <AnimatePresence>
              {isMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 mt-2 w-56 rounded-xl border border-border-primary bg-bg-secondary p-2 shadow-2xl z-50 flex flex-col gap-1 transition-colors duration-300"
                >
                  {/* Log In / Log Out */}
                  {user ? (
                    <button
                      type="button"
                      onClick={() => {
                        handleLogout();
                        setIsMenuOpen(false);
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-status-danger hover:bg-red-500/10 rounded-lg cursor-pointer transition-all text-left w-full border-0 bg-transparent"
                    >
                      <UserIcon className="w-4.5 h-4.5 shrink-0" />
                      <span>Log Out</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        handleLogin();
                        setIsMenuOpen(false);
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-status-brand hover:bg-orange-500/10 rounded-lg cursor-pointer transition-all text-left w-full border-0 bg-transparent"
                    >
                      <Brain className="w-4.5 h-4.5 shrink-0" />
                      <span>Log In with Google</span>
                    </button>
                  )}

                  <div className="h-[1px] bg-border-primary my-1" />

                  {/* Theme Mode Toggle */}
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="flex items-center justify-between px-3 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-lg cursor-pointer transition-all w-full border-0 bg-transparent"
                  >
                    <div className="flex items-center gap-2">
                      {isLightMode ? (
                        <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/></svg>
                      ) : (
                        <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
                      )}
                      <span>Theme Mode</span>
                    </div>
                    <span className="text-[9px] uppercase tracking-wider font-bold text-text-muted bg-bg-primary px-1.5 py-0.5 rounded">
                      {isLightMode ? 'Light' : 'Dark'}
                    </span>
                  </button>

                  {/* Local Inference Configuration (Dev-only) */}
                  {import.meta.env.DEV && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsSettingsOpen(true);
                        setIsMenuOpen(false);
                      }}
                      className={`flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-all hover:bg-bg-tertiary w-full border-0 bg-transparent ${
                        ollamaConfig.enabled 
                          ? 'text-status-feature hover:text-accent-purple-hover' 
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Cpu className="w-4 h-4 shrink-0" />
                        <span>Local Inference</span>
                      </div>
                      <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
                        ollamaConfig.enabled ? 'bg-purple-500/20 text-status-feature' : 'bg-bg-primary text-text-muted'
                      }`}>
                        {ollamaConfig.enabled ? ollamaConfig.model : 'Cloud'}
                      </span>
                    </button>
                  )}

                  {/* Leave Feedback */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsFeedbackOpen(true);
                      setIsMenuOpen(false);
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary hover:bg-bg-tertiary rounded-lg cursor-pointer transition-all text-left w-full border-0 bg-transparent"
                  >
                    <svg className="w-4 h-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    <span>Leave Feedback</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

      </nav>

      {/* Mobile/Tablet Secondary Navigation */}
      <div className="flex md:hidden bg-bg-secondary border-b border-border-primary px-4 py-2.5 justify-around items-center sticky top-16 z-40 transition-colors duration-300">
        {[
          { id: 'mirror', label: '1. Mirror', active: activeModule === 'mirror' },
          { id: 'tailor', label: '2. Tailor', active: activeModule === 'tailor', disabled: !scores },
          { id: 'playground', label: '3. Bridge', active: activeModule === 'playground', disabled: !scores },
        ].map((step) => (
          <button
            key={step.id}
            onClick={() => !step.disabled && setActiveModule(step.id as ModuleId)}
            disabled={step.disabled}
            className={`text-[10px] uppercase tracking-[0.15em] font-bold transition-all px-3.5 py-1.5 rounded-full cursor-pointer ${step.active
                ? 'text-text-primary bg-bg-surface border border-border-secondary'
                : step.disabled
                  ? 'text-text-muted-darker cursor-not-allowed opacity-50'
                  : 'text-text-muted hover:text-text-primary'
              }`}
          >
            {step.label}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-10 flex flex-col min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {activeModule === 'mirror' && (
            <motion.div
              key="mirror"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="flex-1 flex flex-col"
            >
              <div className="mb-8">
                <h1 className="text-4xl font-bold tracking-tighter mb-2">Make Your AI Fit You</h1>
                <p className="text-text-muted text-lg leading-relaxed max-w-2xl">You get along with certain people better than others. It's the same with your AI assistants. Answer a few questions and we'll map your OCEAN personality traits to make your AI fit YOU. (Or, pick one of the examples below to skip ahead!)</p>
              </div>
              <div className="flex-1 min-h-[500px]">
                <Mirror
                  messages={mirrorMessages}
                  setMessages={setMirrorMessages}
                  onComplete={handleMirrorComplete}
                  onSaveSession={handleMirrorSave}
                />
              </div>
            </motion.div>
          )}

          {activeModule === 'tailor' && scores && (
            <motion.div
              key="tailor"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="flex-1 flex flex-col"
            >
              <div className="flex-1">
                <Tailor
                  scores={scores}
                  onNext={() => {
                    setActiveModule('playground');
                    saveToCloud(scores, mirrorMessages, playgroundMessages, 'playground');
                  }}
                />
              </div>
            </motion.div>
          )}

          {activeModule === 'playground' && scores && (
            <motion.div
              key="playground"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="flex-1 flex flex-col"
            >
              <div className="flex-1 min-h-0">
                <Playground
                  scores={scores}
                  messages={playgroundMessages}
                  setMessages={setPlaygroundMessages}
                  setScores={setScores}
                  onSaveSession={(updatedPlayground, updatedScores) => {
                    const finalScores = updatedScores || scores;
                    if (updatedScores) {
                      setScores(updatedScores);
                    }
                    saveToCloud(finalScores, mirrorMessages, updatedPlayground, activeModule);
                  }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Branding */}
      <footer className="h-auto md:h-10 border-t border-border-primary px-6 py-4 md:py-0 flex flex-col md:flex-row items-center justify-between gap-3 md:gap-0 text-[9px] uppercase tracking-[0.3em] font-bold text-text-muted-darker bg-bg-primary transition-colors duration-300">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 md:gap-4 text-center">
          <a
            href="https://tylerstahl.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-primary transition-colors"
          >
            Tyler J. Stahl
          </a>
          <span className="text-border-primary">/</span>
          <a
            href="https://www.linkedin.com/in/tyler-j-stahl"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-primary transition-colors"
          >
            LinkedIn
          </a>
          <span className="text-border-primary">/</span>
          <button
            onClick={() => setIsReleaseNotesOpen(true)}
            className="hover:text-text-primary transition-colors cursor-pointer border-0 bg-transparent uppercase tracking-[0.3em] font-bold text-[9px] text-text-muted-darker"
            title="View Release Notes"
          >
            Cognitive Bridge v1.5
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 md:gap-4 text-center">
          <span className="text-text-muted">Model: {ollamaConfig.enabled ? `Ollama (${ollamaConfig.model})` : 'Gemini 3.1 Pro // Flash'}</span>
          <span className="text-border-primary">/</span>
          <span>Procedural Skills Engine</span>
        </div>
      </footer>

      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} onConfigChange={(config) => setOllamaConfigState(config)} />
      <ReleaseNotesModal isOpen={isReleaseNotesOpen} onClose={() => setIsReleaseNotesOpen(false)} />
    </div>
  );
}
