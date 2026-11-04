/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Brain, User as UserIcon, Cpu } from 'lucide-react';
import { ModuleId, OceanScores, Message, ComparisonMessage } from './types';
import { APP_VERSION_LABEL } from './appVersion';
import { INITIAL_OCEAN, INITIAL_MIRROR_MESSAGE } from './constants';
import Mirror from './components/Mirror';
import Tailor from './components/Tailor';
import Playground from './components/Playground';
import FeedbackModal from './components/FeedbackModal';
import SettingsModal from './components/SettingsModal';
import ReleaseNotesModal from './components/ReleaseNotesModal';
import SiteFooter from './components/SiteFooter';
import { StandaloneRoutes } from './components/StandaloneRoutes';
import { parseLocation } from './routes';
import { CheckoutStartError, loadCheckoutStatus, requestRestorePurchase, startCheckout } from './services/checkoutClient';
import { completeInterview, loadAccessStatus, readStoredReservation, reserveInterview, AccessSnapshot } from './services/accessClient';
import { canUseLiveChat, canUseLiveInterview, interpretCheckoutResponse, phaseAfterUnlock, resolveSurface, ProductSurface } from './access/productAccess';
import AccessFlow from './components/AccessFlow';
import { logProductEvent } from './services/productAnalytics';
import {
  CONTINUE_RESULTS,
  ENTITLEMENT_FAILED,
  INTERVIEWS_LEFT,
  INTERVIEWS_USED,
  LEGACY_BANNER,
  PAYWALL_BUTTON,
  START_RETAKE,
  VIEW_RESULTS,
} from './constants/paywallCopy';
import { AiAccessError } from './services/aiAccess';
import { getOllamaConfig } from './services/gemini';

import { auth, db, logAnalyticsEvent } from './services/firebase';
import { signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import AccountAuthPanel, { VerifyEmailBanner } from './components/AccountAuthPanel';
import { ACCOUNT_COPY } from './constants/accountCopy';
import { adoptGuestSession, sessionFromCloudData } from './services/sessionMigration';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [access, setAccess] = useState<AccessSnapshot | null>(null);
  const [flowOverride, setFlowOverride] = useState<ProductSurface | null>(null);
  const [flowAlert, setFlowAlert] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const purchaseIntent = useRef(false);
  const loggedEvents = useRef(new Set<string>());
  const [activeModule, setActiveModule] = useState<ModuleId>('mirror');
  const [scores, setScores] = useState<OceanScores | null>(null);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isReleaseNotesOpen, setIsReleaseNotesOpen] = useState(false);
  const [ollamaConfig, setOllamaConfigState] = useState(() => getOllamaConfig());
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [accountView, setAccountView] = useState<'sign-in' | 'verify'>('sign-in');
  const [, setAccountRevision] = useState(0);
  const [href, setHref] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setHref({
      pathname: window.location.pathname,
      search: window.location.search,
    });
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

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
        try {
          const outcome = await adoptGuestSession({
            uid: currentUser.uid,
            guest: {
              scores: scoresRef.current,
              mirrorMessages: mirrorMessagesRef.current,
              playgroundMessages: playgroundMessagesRef.current,
              activeModule: activeModuleRef.current,
            },
            read: async (uid) => {
              const snap = await getDoc(doc(db, 'users', uid));
              if (!snap.exists()) return null;
              return sessionFromCloudData(snap.data());
            },
            write: async (uid, session) => {
              await setDoc(doc(db, 'users', uid), {
                ...session,
                updatedAt: serverTimestamp(),
              });
            },
          });
          setScores(outcome.session.scores);
          setMirrorMessages(outcome.session.mirrorMessages);
          setPlaygroundMessages(outcome.session.playgroundMessages);
          setActiveModule(outcome.session.activeModule);
        } catch (error) {
          console.error("Error restoring/migrating session:", error);
        }
        try {
          setAccess(await loadAccessStatus());
        } catch {
          setAccess(null);
        }
      } else {
        setUser(null);
        setAccess(null);
        logAnalyticsEvent('auth_state_changed', { status: 'logged_out' });
        // Clean slate on disconnect / local guest mode
        setScores(null);
        setMirrorMessages([
          { role: 'model', content: INITIAL_MIRROR_MESSAGE }
        ]);
        setPlaygroundMessages([]);
        setActiveModule('mirror');
      }
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  const openAccount = (view: 'sign-in' | 'verify') => {
    setAccountView(view);
    setIsAccountOpen(true);
    setIsMenuOpen(false);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign out failed:", error);
    }
  };

  const handleMirrorComplete = async (newScores: OceanScores) => {
    if (access?.paid) {
      try {
        const result = await completeInterview(readStoredReservation());
        if (result.newlyCompleted) logProductEvent('interview_completed');
        setAccess((prev) => prev ? {
          ...prev,
          interviewsCompleted: result.completed,
          interviewsRemaining: result.remaining,
          inProgress: false,
        } : prev);
      } catch (error) {
        console.error('Interview complete failed:', error);
        setFlowAlert(ENTITLEMENT_FAILED);
        return;
      }
    }
    setScores(newScores);
    setActiveModule('tailor');
    saveToCloud(newScores, mirrorMessages, playgroundMessages, 'tailor');
  };

  const handleMirrorSave = (updatedMirrorMessages: Message[]) => {
    setMirrorMessages(updatedMirrorMessages);
    saveToCloud(scores, updatedMirrorMessages, playgroundMessages, activeModule);
  };

  const liveUser = user && auth.currentUser?.uid === user.uid ? auth.currentUser : user;
  const searchParams = new URLSearchParams(href.search);
  const canceledCheckout = searchParams.get('checkout') === 'cancel';
  const baseSurface = resolveSurface({
    authReady,
    signedIn: !!liveUser,
    paid: access?.paid === true,
    legacy: access?.legacy === true,
    hasSavedResults: scores !== null,
    view: searchParams.get('view'),
    canceled: canceledCheckout,
  });
  const surface = flowOverride ?? baseSurface;
  const liveInterview = canUseLiveInterview({
    paid: access?.paid === true,
    remaining: access?.interviewsRemaining ?? 0,
    inProgress: access?.inProgress === true,
  });

  const navigate = (query: string) => {
    const search = query ? `?${query.replace(/^\?/, '')}` : '';
    window.history.pushState({}, '', `/${search}`);
    setHref({ pathname: window.location.pathname, search: window.location.search });
    setFlowOverride(null);
  };

  const runCheckout = async () => {
    setCheckoutBusy(true);
    setFlowAlert(null);
    setFlowOverride('redirect');
    try {
      const url = await startCheckout();
      logProductEvent('checkout_started');
      window.location.assign(url);
    } catch (error) {
      const status = error instanceof CheckoutStartError ? error.status : 500;
      const code = error instanceof CheckoutStartError ? error.code : null;
      const intent = interpretCheckoutResponse(status, code);
      if (intent.phase === 'app') {
        navigate('view=app');
        return;
      }
      if (intent.phase === 'verify') {
        setFlowOverride('verify');
        return;
      }
      if (intent.phase === 'paywall') {
        setFlowAlert(intent.alert);
        setFlowOverride(null);
        navigate('view=paywall');
      }
    } finally {
      setCheckoutBusy(false);
    }
  };

  const beginInterview = async () => {
    try {
      const reserved = await reserveInterview();
      if (reserved.created) {
        logProductEvent(reserved.retake ? 'retake_started' : 'interview_started');
      }
      setAccess((prev) => prev ? {
        ...prev,
        interviewsRemaining: reserved.remaining,
        interviewsCompleted: reserved.completed,
        inProgress: true,
      } : prev);
      setActiveModule('mirror');
      navigate('view=app');
    } catch (error) {
      if (error instanceof AiAccessError && error.code === 'interviews_exhausted') {
        setFlowAlert(null);
        navigate('view=app');
        return;
      }
      setFlowAlert(ENTITLEMENT_FAILED);
      navigate('view=paywall');
    }
  };

  useEffect(() => {
    if (!authReady) return;
    const key = `surface:${surface}`;
    if (loggedEvents.current.has(key)) return;
    loggedEvents.current.add(key);
    if (surface === 'demo') logProductEvent('demo_started');
    if (surface === 'paywall') logProductEvent('paywall_viewed');
  }, [authReady, surface]);

  useEffect(() => {
    if (!canceledCheckout || loggedEvents.current.has('checkout_canceled')) return;
    loggedEvents.current.add('checkout_canceled');
    logProductEvent('checkout_canceled');
  }, [canceledCheckout]);

  useEffect(() => {
    if (surface !== 'app') return;
    if (activeModule !== 'tailor' && activeModule !== 'playground') return;
    const key = `report:${activeModule}`;
    if (loggedEvents.current.has(key)) return;
    loggedEvents.current.add(key);
    logProductEvent('report_viewed');
  }, [surface, activeModule]);

  const currentStep = scores ? (activeModule === 'playground' ? 3 : 2) : 1;
  const route = parseLocation(href.pathname, href.search);
  if (route.name !== 'app' && !canceledCheckout) {
    return (
      <StandaloneRoutes
        pathname={href.pathname}
        search={href.search}
        loadStatus={loadCheckoutStatus}
        restore={requestRestorePurchase}
        app={null}
      />
    );
  }

  if (surface !== 'app') {
    return (
      <div className="min-h-screen bg-bg-primary text-text-secondary flex flex-col font-sans">
        <div className="flex-1">
        <AccessFlow
          phase={surface}
          email={liveUser?.email}
          canceled={canceledCheckout}
          alertMessage={flowAlert}
          busy={checkoutBusy}
          onStartInterview={() => {
            logProductEvent('demo_completed');
            if (!liveUser) {
              navigate('view=paywall');
              return;
            }
            if (access?.paid && liveInterview) {
              void beginInterview();
              return;
            }
            if (access?.paid || (access?.legacy && scores)) {
              navigate('view=app');
              return;
            }
            navigate('view=paywall');
          }}
          onUnlock={() => {
            purchaseIntent.current = true;
            const step = phaseAfterUnlock({
              signedIn: !!liveUser,
              emailVerified: !!liveUser?.emailVerified,
            });
            if (step === 'signin') setFlowOverride('signin');
            else if (step === 'verify') setFlowOverride('verify');
            else void runCheckout();
          }}
          onBackToDemo={() => navigate('view=demo')}
          onRestore={() => {
            void requestRestorePurchase().then((ok) => {
              if (ok) navigate('view=app');
              else setFlowAlert(ENTITLEMENT_FAILED);
            });
          }}
          onSignedIn={(accountUser) => {
            if (!purchaseIntent.current) {
              setFlowOverride(null);
              return;
            }
            if (!accountUser.emailVerified) {
              setFlowOverride('verify');
              return;
            }
            void runCheckout();
          }}
          onCloseAuth={() => {
            purchaseIntent.current = false;
            setFlowOverride(null);
          }}
          onRetryCheckout={() => {
            void runCheckout();
          }}
        />
        </div>
        <SiteFooter />
      </div>
    );
  }

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
          <span className="font-bold tracking-tight text-sm sm:text-lg">COGNITIVE BRIDGE <span className="hidden sm:inline-block text-[10px] font-mono text-status-brand ml-1 border border-orange-500/30 px-1 rounded uppercase">{APP_VERSION_LABEL}</span></span>
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
            {liveUser ? (
              <button
                onClick={() => setIsMenuOpen(prev => !prev)}
                className="flex items-center gap-2 bg-bg-tertiary border border-border-primary hover:border-orange-500/30 rounded-xl px-3 py-1.5 select-none shadow-sm cursor-pointer transition-all hover:bg-bg-surface group"
                title="Open settings menu"
              >
                {liveUser.photoURL ? (
                  <img src={liveUser.photoURL} alt="profile" className="w-5 h-5 rounded-md object-cover border border-border-secondary group-hover:border-orange-500/40" />
                ) : (
                  <div className="w-5 h-5 rounded-md bg-button-brand flex items-center justify-center text-white text-[10px] font-bold">
                    {(liveUser.displayName || liveUser.email || '?')[0].toUpperCase()}
                  </div>
                )}
                <span className="text-[10px] font-bold text-text-primary group-hover:text-status-brand transition-colors">
                  {liveUser.displayName || liveUser.email?.split('@')[0]}
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                <span className="text-[9px] uppercase tracking-wider text-status-success font-bold hidden md:inline">Synced</span>
              </button>
            ) : (
              <button
                onClick={() => setIsMenuOpen(prev => !prev)}
                className="flex items-center justify-center gap-2 p-2 sm:px-3.5 sm:py-1.5 rounded-xl bg-button-brand hover:bg-button-brand-hover text-white text-[10px] font-bold uppercase tracking-wider transition-all shadow-lg shadow-orange-600/10 cursor-pointer border border-orange-500/20"
                title="Open menu"
              >
                <UserIcon className="w-3.5 h-3.5 text-white sm:hidden" />
                <Brain className="w-3.5 h-3.5 text-white hidden sm:inline" />
                <span className="hidden sm:inline">Sign in</span>
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
                  {liveUser ? (
                    <>
                      {!liveUser.emailVerified && (
                        <button
                          type="button"
                          onClick={() => openAccount('verify')}
                          className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-status-brand hover:bg-orange-500/10 rounded-lg cursor-pointer transition-all text-left w-full border-0 bg-transparent"
                        >
                          <UserIcon className="w-4.5 h-4.5 shrink-0" />
                          <span>{ACCOUNT_COPY.menuVerify}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          handleLogout();
                          setIsMenuOpen(false);
                        }}
                        className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-status-danger hover:bg-red-500/10 rounded-lg cursor-pointer transition-all text-left w-full border-0 bg-transparent"
                      >
                        <UserIcon className="w-4.5 h-4.5 shrink-0" />
                        <span>Sign out</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openAccount('sign-in')}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-status-brand hover:bg-orange-500/10 rounded-lg cursor-pointer transition-all text-left w-full border-0 bg-transparent"
                    >
                      <Brain className="w-4.5 h-4.5 shrink-0" />
                      <span>{ACCOUNT_COPY.menuSignIn}</span>
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

      {liveUser && !liveUser.emailVerified && (
        <VerifyEmailBanner onVerify={() => openAccount('verify')} />
      )}

      {access?.legacy && !access.paid && (
        <div role="status" className="border-b border-border-primary bg-bg-secondary px-6 py-3 text-sm text-text-secondary flex flex-wrap items-center gap-3">
          <span>{LEGACY_BANNER}</span>
          <button type="button" className="min-h-11 underline" onClick={() => setActiveModule(scores ? 'tailor' : 'mirror')}>{VIEW_RESULTS}</button>
          <button type="button" className="min-h-11 underline" onClick={() => navigate('view=paywall')}>{PAYWALL_BUTTON}</button>
        </div>
      )}
      {access?.paid && (
        <div role="status" className="border-b border-border-primary bg-bg-secondary px-6 py-3 text-sm text-text-secondary flex flex-wrap items-center gap-3">
          <span>{INTERVIEWS_LEFT} {access.interviewsRemaining} of 2.</span>
          {scores && <button type="button" className="min-h-11 underline" onClick={() => setActiveModule('tailor')}>{CONTINUE_RESULTS}</button>}
          {access.interviewsCompleted > 0 && access.interviewsRemaining > 0 && (
            <button type="button" className="min-h-11 underline" onClick={() => { void beginInterview(); }}>{START_RETAKE}</button>
          )}
          {access.interviewsRemaining === 0 && !access.inProgress && <span>{INTERVIEWS_USED}</span>}
        </div>
      )}
      {flowAlert && surface === 'app' && (
        <p role="alert" className="px-6 py-2 text-sm text-status-danger">{flowAlert}</p>
      )}

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
                {liveInterview ? (
                  <Mirror
                    messages={mirrorMessages}
                    setMessages={setMirrorMessages}
                    onComplete={handleMirrorComplete}
                    onSaveSession={handleMirrorSave}
                  />
                ) : (
                  <p role="status" className="text-sm text-text-secondary">{access?.paid ? INTERVIEWS_USED : LEGACY_BANNER}</p>
                )}
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
                  liveChat={canUseLiveChat(access?.paid === true)}
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
      <SiteFooter
        modelLabel={`Model: ${ollamaConfig.enabled ? `Ollama (${ollamaConfig.model})` : 'Gemini 2.5 Flash (live fallbacks)'}`}
        onOpenReleaseNotes={() => setIsReleaseNotesOpen(true)}
      />

      <AccountAuthPanel
        isOpen={isAccountOpen}
        initialView={accountView}
        onClose={() => setIsAccountOpen(false)}
        onSignedIn={() => {
          setIsAccountOpen(false);
          setAccountRevision((revision) => revision + 1);
        }}
        onAccountUpdated={() => setAccountRevision((revision) => revision + 1)}
      />
      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} onConfigChange={(config) => setOllamaConfigState(config)} />
      <ReleaseNotesModal isOpen={isReleaseNotesOpen} onClose={() => setIsReleaseNotesOpen(false)} />
    </div>
  );
}
