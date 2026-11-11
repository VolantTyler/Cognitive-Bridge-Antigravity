/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Brain, Cpu, User as UserIcon } from "lucide-react";
import { APP_VERSION_LABEL } from "../appVersion";
import { ACCOUNT_COPY } from "../constants/accountCopy";
import { DEMO_CTA, DEMO_HOME } from "../constants/paywallCopy";

export interface TopNavAccount {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  emailVerified: boolean;
}

export interface TopNavStep {
  id: string;
  label: string;
  active: boolean;
  disabled?: boolean;
}

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600";

/**
 * 64px sticky bar shared by the app and the signed-out surfaces.
 * Step tabs render only in the app. Outside it, Sign in stays visible and
 * Start my interview appears from 768px up.
 */
export default function TopNav({
  mode,
  account,
  authPending = false,
  isLightMode,
  onToggleTheme,
  onSignOut,
  onSignIn,
  onVerifyEmail,
  onOpenFeedback,
  onOpenSettings,
  showDevSettings = false,
  ollamaEnabled = false,
  ollamaModel = "",
  onStartInterview,
  steps,
  onSelectStep,
}: {
  mode: "app" | "gate";
  account: TopNavAccount | null;
  /** Hide account controls until auth has settled, so checkout does not flash Sign in. */
  authPending?: boolean;
  isLightMode: boolean;
  onToggleTheme: () => void;
  onSignOut: () => void;
  onSignIn: () => void;
  onVerifyEmail: () => void;
  onOpenFeedback: () => void;
  onOpenSettings?: () => void;
  showDevSettings?: boolean;
  ollamaEnabled?: boolean;
  ollamaModel?: string;
  onStartInterview?: () => void;
  steps?: TopNavStep[];
  onSelectStep?: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const showSteps = mode === "app" && steps && steps.length > 0;
  const showSignedOutActions = !authPending && !account;
  const showAccount = !authPending && !!account;

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const label = account?.displayName || account?.email?.split("@")[0] || "Account";

  return (
    <nav
      aria-label="Main"
      data-testid="top-nav"
      className="sticky top-0 z-50 flex h-16 max-w-full items-center justify-between gap-3 border-b border-border-primary bg-bg-secondary px-4 transition-colors duration-300 md:px-6"
    >
      <a
        href={DEMO_HOME}
        className={`flex min-w-0 items-center gap-2 rounded-md text-text-primary ${focusRing}`}
      >
        <img src="/favicon.svg" alt="" className="h-8 w-8 shrink-0 rounded shadow-lg shadow-orange-500/10" />
        <span className="truncate text-sm font-bold tracking-tight sm:text-lg">
          COGNITIVE BRIDGE
          <span className="ml-1 hidden rounded border border-orange-500/30 px-1 font-mono text-[10px] font-bold uppercase text-status-brand sm:inline-block">
            {APP_VERSION_LABEL}
          </span>
        </span>
      </a>

      <div className="flex shrink-0 items-center gap-2 md:gap-4">
        {showSteps && (
          <div className="mr-2 hidden items-center gap-8 md:flex">
            {steps.map((step) => (
              <button
                key={step.id}
                type="button"
                onClick={() => !step.disabled && onSelectStep?.(step.id)}
                disabled={step.disabled}
                className={`cursor-pointer rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] transition-all ${focusRing} ${
                  step.active
                    ? "border border-border-secondary bg-bg-surface text-text-primary"
                    : step.disabled
                      ? "cursor-not-allowed text-text-muted-darker"
                      : "text-text-muted hover:text-text-primary"
                }`}
              >
                {step.label}
              </button>
            ))}
          </div>
        )}

        {showSignedOutActions && mode === "gate" && (
          <>
            <button type="button" className={`min-h-11 px-4 ${focusRing} rounded-lg border border-text-primary bg-transparent text-sm font-semibold text-text-primary`} onClick={onSignIn}>
              Sign in
            </button>
            {onStartInterview && (
              <button
                type="button"
                className={`hidden min-h-11 rounded-lg bg-button-brand px-4 text-sm font-semibold text-white md:inline-flex md:items-center ${focusRing}`}
                onClick={onStartInterview}
              >
                {DEMO_CTA}
              </button>
            )}
          </>
        )}

        {(showAccount || (showSignedOutActions && mode === "app")) && (
          <div className="relative" ref={menuRef}>
            {account ? (
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-controls={menuId}
                className={`flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-xl border border-border-primary bg-bg-tertiary px-3 py-1.5 shadow-sm transition-all hover:border-orange-500/30 hover:bg-bg-surface ${focusRing}`}
                title="Open settings menu"
              >
                {account.photoURL ? (
                  <img src={account.photoURL} alt="" className="h-5 w-5 rounded-md border border-border-secondary object-cover" />
                ) : (
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-button-brand text-[10px] font-bold text-white">
                    {label[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <span className="text-[10px] font-bold text-text-primary">{label}</span>
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                <span className="hidden text-[9px] font-bold uppercase tracking-wider text-status-success md:inline">Synced</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-controls={menuId}
                className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-orange-500/20 bg-button-brand p-2 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg shadow-orange-600/10 transition-all hover:bg-button-brand-hover sm:px-3.5 sm:py-1.5 ${focusRing}`}
                title="Open menu"
              >
                <UserIcon className="h-3.5 w-3.5 text-white sm:hidden" />
                <Brain className="hidden h-3.5 w-3.5 text-white sm:inline" />
                <span className="hidden sm:inline">Sign in</span>
              </button>
            )}

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  id={menuId}
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 z-50 mt-2 flex w-56 flex-col gap-1 rounded-xl border border-border-primary bg-bg-secondary p-2 shadow-2xl"
                >
                  {account ? (
                    <>
                      {!account.emailVerified && (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            onVerifyEmail();
                          }}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-xs font-semibold text-status-brand transition-all hover:bg-orange-500/10"
                        >
                          <UserIcon className="h-4 w-4 shrink-0" />
                          <span>{ACCOUNT_COPY.menuVerify}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onSignOut();
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-xs font-semibold text-status-danger transition-all hover:bg-red-500/10"
                      >
                        <UserIcon className="h-4 w-4 shrink-0" />
                        <span>Sign out</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onSignIn();
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-xs font-semibold text-status-brand transition-all hover:bg-orange-500/10"
                    >
                      <Brain className="h-4 w-4 shrink-0" />
                      <span>{ACCOUNT_COPY.menuSignIn}</span>
                    </button>
                  )}

                  <div className="my-1 h-px bg-border-primary" />

                  <button
                    type="button"
                    onClick={onToggleTheme}
                    className="flex w-full cursor-pointer items-center justify-between rounded-lg border-0 bg-transparent px-3 py-2 text-xs font-semibold text-text-secondary transition-all hover:bg-bg-tertiary hover:text-text-primary"
                  >
                    <div className="flex items-center gap-2">
                      {isLightMode ? (
                        <svg className="h-4 w-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/></svg>
                      ) : (
                        <svg className="h-4 w-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
                      )}
                      <span>Theme Mode</span>
                    </div>
                    <span className="rounded bg-bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-text-muted">
                      {isLightMode ? "Light" : "Dark"}
                    </span>
                  </button>

                  {showDevSettings && onOpenSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenSettings();
                      }}
                      className={`flex w-full cursor-pointer items-center justify-between rounded-lg border-0 bg-transparent px-3 py-2 text-xs font-semibold transition-all hover:bg-bg-tertiary ${
                        ollamaEnabled ? "text-status-feature" : "text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4 shrink-0" />
                        <span>Local Inference</span>
                      </div>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                        ollamaEnabled ? "bg-purple-500/20 text-status-feature" : "bg-bg-primary text-text-muted"
                      }`}
                      >
                        {ollamaEnabled ? ollamaModel : "Cloud"}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenFeedback();
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-xs font-semibold text-text-secondary transition-all hover:bg-bg-tertiary hover:text-text-primary"
                  >
                    <svg className="h-4 w-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    <span>Leave Feedback</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </nav>
  );
}
