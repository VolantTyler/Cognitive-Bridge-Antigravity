/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ACCOUNT_COPY } from '../constants/accountCopy';
import { PAYWALL_AGE } from '../constants/paywallCopy';
import { logProductEvent } from '../services/productAnalytics';
import {
  AccountAuthClient,
  AccountEvent,
  AccountFlowResult,
  AccountLogger,
  AccountUser,
  confirmEmailVerified,
  linkWithPassword,
  requestPasswordReset,
  resendVerificationEmail,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '../services/accountAuth';
import { createFirebaseAccountAuthClient } from '../services/firebaseAccountAuth';

type Screen = 'sign-in' | 'sign-up' | 'reset' | 'verify' | 'link';
type LinkIntent = Extract<AccountFlowResult, { status: 'needs_link' }>;

interface AccountAuthPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialView?: 'sign-in' | 'verify';
  embedded?: boolean;
  client?: AccountAuthClient;
  onSignedIn?: (user: AccountUser) => void;
  onAccountUpdated?: () => void;
  log?: AccountLogger;
}

const inputClass =
  'w-full bg-bg-primary border border-border-secondary text-text-primary placeholder-text-muted-dark rounded-xl py-2.5 px-4 text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all';

const primaryClass =
  'w-full min-h-11 px-5 py-2.5 bg-gradient-to-r from-button-brand to-red-800 text-white rounded-xl text-xs font-bold uppercase shadow-lg shadow-orange-500/10 hover:shadow-orange-500/20 disabled:opacity-50 transition-all cursor-pointer';

const secondaryClass =
  'w-full min-h-11 px-5 py-2.5 bg-bg-tertiary border border-border-primary text-text-primary rounded-xl text-xs font-bold uppercase hover:border-orange-500/30 disabled:opacity-50 transition-all cursor-pointer';

function defaultLog(event: AccountEvent) {
  if (event.name === 'signin_started' || event.name === 'signin_completed') {
    logProductEvent(event.name, { method: event.method });
    return;
  }
  logProductEvent(event.name);
}

export function VerifyEmailBanner({ onVerify }: { onVerify: () => void }) {
  return (
    <div
      role="status"
      className="bg-bg-secondary border-b border-border-primary px-6 py-2 flex flex-wrap items-center justify-center gap-3 text-xs text-text-secondary"
    >
      <span>{ACCOUNT_COPY.verifyBanner}</span>
      <button
        type="button"
        onClick={onVerify}
        className="text-[10px] font-bold uppercase tracking-wider text-status-brand hover:underline cursor-pointer bg-transparent border-0"
      >
        {ACCOUNT_COPY.verifyBannerAction}
      </button>
    </div>
  );
}

export default function AccountAuthPanel({
  isOpen,
  onClose,
  initialView = 'sign-in',
  embedded = false,
  client: clientProp,
  onSignedIn,
  onAccountUpdated,
  log = defaultLog,
}: AccountAuthPanelProps) {
  const owned = useRef<AccountAuthClient | null>(null);
  const authClient = clientProp ?? (owned.current ??= createFirebaseAccountAuthClient());
  const clientRef = useRef(authClient);
  clientRef.current = authClient;

  const titleRef = useRef<HTMLHeadingElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const [view, setView] = useState<Screen>(initialView);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [field, setField] = useState<'email' | 'password' | 'displayName' | null>(null);
  const [busy, setBusy] = useState(false);
  const [accountUser, setAccountUser] = useState<AccountUser | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);
  const [pending, setPending] = useState<LinkIntent | null>(null);

  useEffect(() => {
    if (isOpen) return;
    setPassword('');
    setPending(null);
    setError(null);
    setNote(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const current = clientRef.current.currentUser();
    setView(initialView);
    setError(null);
    setNote(null);
    setField(null);
    setPassword('');
    setDisplayName('');
    setPending(null);
    setVerificationSent(false);
    setAccountUser(current);
    setEmail(initialView === 'verify' ? current?.email ?? '' : '');
  }, [isOpen, initialView]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen, view]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!error || !field) return;
    const target = field === 'email' ? emailRef.current : field === 'password' ? passwordRef.current : nameRef.current;
    target?.focus();
  }, [error, field]);

  if (!isOpen) return null;

  function clearSecrets() {
    setPassword('');
    setPending(null);
  }

  function applyResult(result: AccountFlowResult) {
    if (result.ok && result.status === 'signed_in') {
      clearSecrets();
      onAccountUpdated?.();
      onSignedIn?.(result.user);
      return;
    }
    if (result.ok && result.status === 'verify_email') {
      setAccountUser(result.user);
      setEmail(result.email);
      setVerificationSent(result.verificationSent);
      setView('verify');
      setField(null);
      setPending(null);
      setPassword('');
      if (result.tone === 'status') {
        setNote(result.message);
        setError(null);
      } else {
        setError(result.message);
        setNote(null);
      }
      onAccountUpdated?.();
      return;
    }
    if (result.ok && result.status === 'reset_sent') {
      setView('reset');
      setError(null);
      setNote(result.message);
      setField(null);
      setPassword('');
      return;
    }
    if (!result.ok && result.status === 'needs_link') {
      if (result.direction === 'use_existing_password') {
        setPending(null);
        setPassword('');
        setView('sign-in');
        setEmail(result.email);
        setError(result.message);
        setNote(null);
        setField('password');
        return;
      }
      setPending(result);
      setView('link');
      setEmail(result.email);
      setPassword('');
      setError(result.message);
      setNote(null);
      setField(null);
      return;
    }
    if (!result.ok && result.status === 'error') {
      setError(result.message);
      setField(result.field);
      setNote(null);
    }
  }

  async function run(action: () => Promise<AccountFlowResult>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      applyResult(await action());
    } catch {
      setError(ACCOUNT_COPY.generic);
      setField(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function switchTab(next: 'sign-in' | 'sign-up') {
    setView(next);
    setError(null);
    setNote(null);
    setField(null);
    setPassword('');
    setPending(null);
  }

  const showVerifyBody = view === 'verify' && email && (verificationSent || error !== ACCOUNT_COPY.sendFailed);
  const description = showVerifyBody
    ? ACCOUNT_COPY.verifyBody(email)
    : view === 'reset'
      ? ACCOUNT_COPY.resetHelp
      : ACCOUNT_COPY.sub;

  const showGoogle =
    view === 'sign-in' ||
    view === 'sign-up' ||
    (view === 'link' &&
      pending?.direction === 'password_onto_google' &&
      (pending.knownMethods === null || pending.knownMethods.includes('google.com')));

  const showStoredPassword =
    view === 'link' &&
    pending?.direction === 'password_onto_google' &&
    !!pending.pendingPassword &&
    (pending.knownMethods === null || pending.knownMethods.includes('password'));

  const Heading = embedded ? 'h1' : 'h2';
  return (
    <div className={embedded ? 'w-full' : 'fixed inset-0 z-50 flex items-center justify-center p-4'}>
      {!embedded && <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />}
      <div
        role={embedded ? 'region' : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="account-auth-title"
        aria-describedby="account-auth-sub"
        data-account-view={view}
        className="w-full max-w-md rounded-2xl bg-bg-secondary border border-border-primary p-6 shadow-2xl relative z-10 transition-colors duration-300"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <Heading
            id="account-auth-title"
            ref={titleRef}
            tabIndex={-1}
            className="text-lg font-bold tracking-tight text-text-primary focus:outline-none focus:ring-2 focus:ring-orange-500 rounded"
          >
            {view === 'verify' ? ACCOUNT_COPY.verifyTitle : view === 'reset' ? ACCOUNT_COPY.resetTitle : ACCOUNT_COPY.title}
          </Heading>
          {!embedded && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-surface transition-all cursor-pointer"
              aria-label={ACCOUNT_COPY.close}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <p id="account-auth-sub" className="text-text-muted text-xs leading-relaxed mb-4">
          {description}
        </p>
        {view === 'sign-up' && (
          <p className="text-xs text-text-secondary mb-4">{PAYWALL_AGE}</p>
        )}

        {error && (
          <p id="account-auth-error" role="alert" className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-status-danger rounded-xl text-xs">
            {error}
          </p>
        )}
        {note && (
          <p role="status" className="mb-4 p-3 bg-bg-primary border border-border-primary text-text-secondary rounded-xl text-xs">
            {note}
          </p>
        )}

        {showGoogle && (
          <button
            type="button"
            className={secondaryClass}
            disabled={busy}
            onClick={() => run(() => signInWithGoogle(authClient, pending, log))}
          >
            {busy ? ACCOUNT_COPY.googleBusy : ACCOUNT_COPY.googleButton}
          </button>
        )}

        {(view === 'sign-in' || view === 'sign-up') && (
          <>
            <p className="my-4 text-center text-[10px] font-bold uppercase tracking-wider text-text-muted">{ACCOUNT_COPY.orEmail}</p>
            <div role="tablist" aria-label={ACCOUNT_COPY.methodTabs} className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-bg-primary border border-border-primary mb-4">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'sign-in'}
                className={`min-h-11 rounded-lg text-xs font-bold uppercase cursor-pointer ${view === 'sign-in' ? 'bg-bg-surface text-text-primary' : 'text-text-muted'}`}
                onClick={() => switchTab('sign-in')}
              >
                {ACCOUNT_COPY.tabSignIn}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'sign-up'}
                className={`min-h-11 rounded-lg text-xs font-bold uppercase cursor-pointer ${view === 'sign-up' ? 'bg-bg-surface text-text-primary' : 'text-text-muted'}`}
                onClick={() => switchTab('sign-up')}
              >
                {ACCOUNT_COPY.tabSignUp}
              </button>
            </div>
            <form
              className="space-y-4"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                if (view === 'sign-up') {
                  void run(() => signUpWithEmail(authClient, { email, password, displayName }, log));
                } else {
                  void run(() => signInWithEmail(authClient, { email, password }, log));
                }
              }}
            >
              <Field
                id="account-email"
                label={ACCOUNT_COPY.emailLabel}
                type="email"
                autoComplete="email"
                value={email}
                disabled={busy}
                invalid={field === 'email'}
                describedBy={field === 'email' ? 'account-auth-error' : undefined}
                inputRef={emailRef}
                onChange={setEmail}
              />
              <Field
                id="account-password"
                label={ACCOUNT_COPY.passwordLabel}
                type="password"
                autoComplete={view === 'sign-up' ? 'new-password' : 'current-password'}
                value={password}
                disabled={busy}
                invalid={field === 'password'}
                describedBy={field === 'password' ? 'account-auth-error' : undefined}
                inputRef={passwordRef}
                onChange={setPassword}
              />
              {view === 'sign-up' && (
                <Field
                  id="account-display-name"
                  label={ACCOUNT_COPY.displayNameLabel}
                  type="text"
                  autoComplete="nickname"
                  value={displayName}
                  disabled={busy}
                  invalid={field === 'displayName'}
                  describedBy={field === 'displayName' ? 'account-display-help account-auth-error' : 'account-display-help'}
                  inputRef={nameRef}
                  onChange={setDisplayName}
                  help={ACCOUNT_COPY.displayNameHelp}
                  helpId="account-display-help"
                />
              )}
              <button type="submit" className={primaryClass} disabled={busy}>
                {busy
                  ? view === 'sign-up'
                    ? ACCOUNT_COPY.signUpBusy
                    : ACCOUNT_COPY.signInBusy
                  : view === 'sign-up'
                    ? ACCOUNT_COPY.signUpButton
                    : ACCOUNT_COPY.signInButton}
              </button>
              <button
                type="button"
                className="w-full text-xs font-semibold text-status-brand hover:underline cursor-pointer bg-transparent border-0"
                onClick={() => {
                  setView('reset');
                  setError(null);
                  setNote(null);
                  setField(null);
                  setPassword('');
                }}
              >
                {ACCOUNT_COPY.forgot}
              </button>
            </form>
          </>
        )}

        {view === 'reset' && (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => requestPasswordReset(authClient, email, log));
            }}
          >
            <Field
              id="account-reset-email"
              label={ACCOUNT_COPY.emailLabel}
              type="email"
              autoComplete="email"
              value={email}
              disabled={busy}
              invalid={field === 'email'}
              describedBy={field === 'email' ? 'account-auth-error' : undefined}
              inputRef={emailRef}
              onChange={setEmail}
            />
            <button type="submit" className={primaryClass} disabled={busy}>
              {busy ? ACCOUNT_COPY.resetBusy : ACCOUNT_COPY.resetButton}
            </button>
            <button type="button" className={secondaryClass} onClick={() => switchTab('sign-in')}>
              {ACCOUNT_COPY.back}
            </button>
          </form>
        )}

        {view === 'verify' && (
          <div className="space-y-3">
            <button
              type="button"
              className={primaryClass}
              disabled={busy || !accountUser}
              onClick={() => accountUser && run(() => confirmEmailVerified(authClient, accountUser, log))}
            >
              {busy ? ACCOUNT_COPY.verifyChecking : ACCOUNT_COPY.verifyContinue}
            </button>
            <button
              type="button"
              className={secondaryClass}
              disabled={busy || !accountUser}
              onClick={() => accountUser && run(() => resendVerificationEmail(authClient, accountUser, log))}
            >
              {busy ? ACCOUNT_COPY.verifyResending : ACCOUNT_COPY.verifyResend}
            </button>
          </div>
        )}

        {view === 'link' && pending?.direction === 'google_onto_password' && (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => linkWithPassword(authClient, pending, password, log));
            }}
          >
            {pending.email ? (
              <p className="text-sm text-text-primary break-all">{pending.email}</p>
            ) : (
              <Field
                id="account-link-email"
                label={ACCOUNT_COPY.emailLabel}
                type="email"
                autoComplete="email"
                value={email}
                disabled={busy}
                invalid={field === 'email'}
                describedBy={field === 'email' ? 'account-auth-error' : undefined}
                inputRef={emailRef}
                onChange={(value) => {
                  setEmail(value);
                  setPending({ ...pending, email: value });
                }}
              />
            )}
            <Field
              id="account-link-password"
              label={ACCOUNT_COPY.passwordLabel}
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={busy}
              invalid={field === 'password'}
              describedBy={field === 'password' ? 'account-auth-error' : undefined}
              inputRef={passwordRef}
              onChange={setPassword}
            />
            <button type="submit" className={primaryClass} disabled={busy}>
              {busy ? ACCOUNT_COPY.signInBusy : ACCOUNT_COPY.linkSubmit}
            </button>
          </form>
        )}

        {showStoredPassword && pending && (
          <button
            type="button"
            className={`${primaryClass} mt-3`}
            disabled={busy}
            onClick={() => run(() => linkWithPassword(authClient, pending, pending.pendingPassword ?? '', log))}
          >
            {ACCOUNT_COPY.signInWithPassword}
          </button>
        )}

        {view === 'link' && (
          <button
            type="button"
            className="mt-3 w-full text-xs font-semibold text-text-muted hover:text-text-primary cursor-pointer bg-transparent border-0"
            onClick={() => switchTab('sign-in')}
          >
            {ACCOUNT_COPY.differentEmail}
          </button>
        )}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  type,
  autoComplete,
  value,
  disabled,
  invalid,
  describedBy,
  inputRef,
  onChange,
  help,
  helpId,
}: {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  value: string;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onChange: (value: string) => void;
  help?: string;
  helpId?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        spellCheck={false}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
      {help && (
        <p id={helpId} className="text-[11px] text-text-muted leading-relaxed">
          {help}
        </p>
      )}
    </div>
  );
}
