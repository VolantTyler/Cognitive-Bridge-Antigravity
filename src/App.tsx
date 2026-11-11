/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ModuleId, OceanScores, Message, ComparisonMessage } from './types';
import { INITIAL_OCEAN, INITIAL_MIRROR_MESSAGE } from './constants';
import { shouldPersistInterviewDraft } from './access/interviewDraft';
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
import InterviewsExhausted, { MIRROR_INVITE } from './components/InterviewsExhausted';
import { showMirrorInvite } from './access/productAccess';
import RetakeStartControl from './components/RetakeStartControl';
import { logProductEvent } from './services/productAnalytics';
import {
  CONTINUE_RESULTS,
  ENTITLEMENT_FAILED,
  INTERVIEWS_LEFT,
  LEGACY_BANNER,
  PAYWALL_BUTTON,
  VIEW_RESULTS,
} from './constants/paywallCopy';
import { AiAccessError } from './services/aiAccess';
import { getOllamaConfig } from './services/gemini';

import { auth, db, logAnalyticsEvent } from './services/firebase';
import { signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import AccountAuthPanel, { VerifyEmailBanner } from './components/AccountAuthPanel';
import TopNav from './components/TopNav';
import { openSignInWithoutPurchase } from './access/signInIntent';
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
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [accountView, setAccountView] = useState<'sign-in' | 'verify'>('sign-in');
  const [, setAccountRevision] = useState(0);
  const [href, setHref] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
  }));
  useEffect(() => {
    const sync = () => setHref({
      pathname: window.location.pathname,
      search: window.location.search,
    });
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
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

  const retakeDraftOpen = !shouldPersistInterviewDraft({
    inProgress: access?.inProgress === true,
    interviewsCompleted: access?.interviewsCompleted ?? 0,
  });

  const handleMirrorSave = (updatedMirrorMessages: Message[]) => {
    setMirrorMessages(updatedMirrorMessages);
    if (retakeDraftOpen) return;
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
  const mirrorInvite = showMirrorInvite({
    paid: access?.paid === true,
    interviewsRemaining: access?.interviewsRemaining ?? 0,
    inProgress: access?.inProgress === true,
  });
  const interviewsExhausted = access?.paid === true && !mirrorInvite;

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

  const draftedRetake = useRef(false);
  useEffect(() => {
    const holding = access?.inProgress === true && (access?.interviewsCompleted ?? 0) > 0;
    if (!holding) {
      draftedRetake.current = false;
      return;
    }
    if (draftedRetake.current) return;
    draftedRetake.current = true;
    setMirrorMessages([{ role: 'model', content: INITIAL_MIRROR_MESSAGE }]);
  }, [access?.inProgress, access?.interviewsCompleted]);

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

  const handleStartInterview = () => {
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
  };

  const handleNavSignIn = () => {
    openSignInWithoutPurchase(purchaseIntent, () => openAccount('sign-in'));
  };

  const navAccount = liveUser
    ? {
        displayName: liveUser.displayName,
        email: liveUser.email,
        photoURL: liveUser.photoURL,
        emailVerified: liveUser.emailVerified,
      }
    : null;

  const renderNav = (mode: 'app' | 'gate') => (
    <TopNav
      mode={mode}
      account={authReady ? navAccount : null}
      authPending={!authReady}
      isLightMode={isLightMode}
      onToggleTheme={toggleTheme}
      onSignOut={() => { void handleLogout(); }}
      onSignIn={handleNavSignIn}
      onVerifyEmail={() => openAccount('verify')}
      onOpenFeedback={() => setIsFeedbackOpen(true)}
      onOpenSettings={() => setIsSettingsOpen(true)}
      showDevSettings={import.meta.env.DEV}
      ollamaEnabled={ollamaConfig.enabled}
      ollamaModel={ollamaConfig.model}
      onStartInterview={mode === 'gate' ? handleStartInterview : undefined}
      steps={mode === 'app' ? [
        { id: 'mirror', label: '1. The Mirror', active: activeModule === 'mirror' },
        { id: 'tailor', label: '2. The Tailor', active: activeModule === 'tailor', disabled: !scores },
        { id: 'playground', label: '3. The Bridge', active: activeModule === 'playground', disabled: !scores },
      ] : undefined}
      onSelectStep={(id) => setActiveModule(id as ModuleId)}
    />
  );

  const overlays = (
    <>
      <AccountAuthPanel
        isOpen={isAccountOpen}
        initialView={accountView}
        onClose={() => setIsAccountOpen(false)}
        onSignedIn={(accountUser) => {
          setIsAccountOpen(false);
          setAccountRevision((revision) => revision + 1);
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
        onAccountUpdated={() => setAccountRevision((revision) => revision + 1)}
      />
      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} onConfigChange={(config) => setOllamaConfigState(config)} />
      <ReleaseNotesModal isOpen={isReleaseNotesOpen} onClose={() => setIsReleaseNotesOpen(false)} />
    </>
  );

  const route = parseLocation(href.pathname, href.search);
  if (route.name !== 'app' && !canceledCheckout) {
    return (
      <>
        <StandaloneRoutes
          pathname={href.pathname}
          search={href.search}
          loadStatus={loadCheckoutStatus}
          restore={requestRestorePurchase}
          app={null}
          header={route.name === 'checkout' ? (
            <>
              {renderNav('gate')}
              {liveUser && !liveUser.emailVerified && (
                <VerifyEmailBanner onVerify={() => openAccount('verify')} />
              )}
            </>
          ) : undefined}
        />
        {route.name === 'checkout' ? overlays : null}
      </>
    );
  }

  if (surface !== 'app') {
    return (
      <div className="min-h-screen overflow-x-hidden bg-bg-primary text-text-secondary flex flex-col font-sans">
        {renderNav('gate')}
        {liveUser && !liveUser.emailVerified && (
          <VerifyEmailBanner onVerify={() => openAccount('verify')} />
        )}
        <div className="flex-1">
        <AccessFlow
          phase={surface}
          email={liveUser?.email}
          canceled={canceledCheckout}
          alertMessage={flowAlert}
          busy={checkoutBusy}
          onStartInterview={handleStartInterview}
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
        {overlays}
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-bg-primary text-text-secondary flex flex-col font-sans transition-colors duration-300">
      {renderNav('app')}

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
          {access.interviewsRemaining > 0 && scores && (
            <button type="button" className="min-h-11 underline" onClick={() => setActiveModule('tailor')}>{CONTINUE_RESULTS}</button>
          )}
          {access.interviewsCompleted > 0 && access.interviewsRemaining > 0 && (
            <RetakeStartControl onRetake={() => { void beginInterview(); }} />
          )}
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
                {mirrorInvite && (
                  <p className="text-text-muted text-lg leading-relaxed max-w-2xl">{MIRROR_INVITE}</p>
                )}
              </div>
              <div className={interviewsExhausted ? "flex-1" : "flex-1 min-h-[500px]"}>
                {liveInterview ? (
                  <Mirror
                    messages={mirrorMessages}
                    setMessages={setMirrorMessages}
                    onComplete={handleMirrorComplete}
                    onSaveSession={handleMirrorSave}
                  />
                ) : interviewsExhausted ? (
                  <InterviewsExhausted onViewResults={() => setActiveModule(scores ? 'tailor' : 'mirror')} />
                ) : (
                  <p role="status" className="text-sm text-text-secondary">{LEGACY_BANNER}</p>
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

      {overlays}
    </div>
  );
}
