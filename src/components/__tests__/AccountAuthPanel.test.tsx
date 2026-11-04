/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_COPY } from '../../constants/accountCopy';
import { auth, googleProvider } from '../../services/firebase';
import AccountAuthPanel, { VerifyEmailBanner } from '../AccountAuthPanel';

const authState = vi.hoisted(() => ({
  currentUser: null as null | FakeUser,
}));

const fb = vi.hoisted(() => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  updateProfile: vi.fn(),
  fetchSignInMethodsForEmail: vi.fn(),
  linkWithCredential: vi.fn(),
  signOut: vi.fn(),
  logAnalyticsEvent: vi.fn(),
}));

vi.mock('firebase/auth', () => {
  class GoogleAuthProvider {
    static PROVIDER_ID = 'google.com';
    static credentialFromError(error: { customData?: { _credential?: unknown } } | null) {
      return error?.customData?._credential ?? null;
    }
    setCustomParameters() {}
  }
  class EmailAuthProvider {
    static PROVIDER_ID = 'password';
    static credential(email: string, password: string) {
      return { providerId: 'password', email, password };
    }
  }
  return {
    GoogleAuthProvider,
    EmailAuthProvider,
    createUserWithEmailAndPassword: fb.createUserWithEmailAndPassword,
    signInWithEmailAndPassword: fb.signInWithEmailAndPassword,
    signInWithPopup: fb.signInWithPopup,
    sendEmailVerification: fb.sendEmailVerification,
    sendPasswordResetEmail: fb.sendPasswordResetEmail,
    updateProfile: fb.updateProfile,
    fetchSignInMethodsForEmail: fb.fetchSignInMethodsForEmail,
    linkWithCredential: fb.linkWithCredential,
    signOut: fb.signOut,
  };
});

vi.mock('../../services/firebase', () => ({
  auth: authState,
  googleProvider: { providerId: 'google.com', kind: 'existing-google-provider' },
  logAnalyticsEvent: fb.logAnalyticsEvent,
}));

interface FakeUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  providerData: Array<{ providerId: string }>;
  photoURL: string | null;
  reload: ReturnType<typeof vi.fn>;
  getIdToken: ReturnType<typeof vi.fn>;
}

function token(payload: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${body}.sig`;
}

function makeUser(overrides: Partial<FakeUser> = {}): FakeUser {
  const user = {
    uid: 'uid-1',
    email: 'ada@example.com',
    displayName: null,
    emailVerified: false,
    providerData: [{ providerId: 'password' }],
    photoURL: null,
    reload: vi.fn(),
    getIdToken: vi.fn(),
    ...overrides,
  } as FakeUser;
  if (!overrides.reload) {
    user.reload = vi.fn(async () => {
      user.emailVerified = true;
    });
  }
  if (!overrides.getIdToken) {
    user.getIdToken = vi.fn(async () => token({
      email_verified: user.emailVerified,
      email: user.email,
      sub: user.uid,
    }));
  }
  return user;
}

function authErr(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`raw ${code}`), { code, ...extra });
}

const PASSWORD = 'longpassword';

async function openSignUp() {
  fireEvent.click(screen.getByRole('tab', { name: ACCOUNT_COPY.tabSignUp }));
}

function typeEmail(value: string) {
  fireEvent.change(screen.getByLabelText(ACCOUNT_COPY.emailLabel), { target: { value } });
}

function typePassword(value: string) {
  fireEvent.change(screen.getByLabelText(ACCOUNT_COPY.passwordLabel), { target: { value } });
}

describe('AccountAuthPanel', () => {
  beforeEach(() => {
    authState.currentUser = null;
    fb.createUserWithEmailAndPassword.mockReset();
    fb.signInWithEmailAndPassword.mockReset();
    fb.signInWithPopup.mockReset();
    fb.sendEmailVerification.mockReset();
    fb.sendPasswordResetEmail.mockReset();
    fb.updateProfile.mockReset();
    fb.fetchSignInMethodsForEmail.mockReset();
    fb.linkWithCredential.mockReset();
    fb.signOut.mockReset();
    fb.logAnalyticsEvent.mockReset();
    fb.sendEmailVerification.mockResolvedValue(undefined);
    fb.sendPasswordResetEmail.mockResolvedValue(undefined);
    fb.signOut.mockResolvedValue(undefined);
    fb.updateProfile.mockImplementation(async (user: FakeUser, profile: { displayName?: string }) => {
      user.displayName = profile.displayName ?? null;
    });
    fb.fetchSignInMethodsForEmail.mockRejectedValue(authErr('auth/operation-not-allowed'));
    fb.linkWithCredential.mockImplementation(async (user: FakeUser) => ({ user }));
  });

  it('signs up with email, sends verification, and checks again', async () => {
    const user = makeUser();
    const onSignedIn = vi.fn();
    fb.createUserWithEmailAndPassword.mockResolvedValue({ user });
    render(<AccountAuthPanel isOpen onClose={vi.fn()} onSignedIn={onSignedIn} />);

    await openSignUp();
    expect(screen.getByText(ACCOUNT_COPY.displayNameHelp)).toBeInTheDocument();
    typeEmail('Ada@Example.com');
    typePassword(PASSWORD);
    fireEvent.change(screen.getByLabelText(ACCOUNT_COPY.displayNameLabel), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.signUpButton }));

    expect(await screen.findByRole('heading', { name: ACCOUNT_COPY.verifyTitle })).toBeInTheDocument();
    expect(screen.getByText(ACCOUNT_COPY.verifyBody('ada@example.com'))).toBeInTheDocument();
    expect(fb.createUserWithEmailAndPassword).toHaveBeenCalledWith(auth, 'ada@example.com', PASSWORD);
    expect(fb.updateProfile).toHaveBeenCalledWith(user, { displayName: 'Ada' });
    expect(fb.sendEmailVerification.mock.calls[0]?.[0]).toBe(user);
    expect(fb.fetchSignInMethodsForEmail).not.toHaveBeenCalled();
    expect(onSignedIn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.verifyResend }));
    await waitFor(() => expect(fb.sendEmailVerification).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('status')).toHaveTextContent(ACCOUNT_COPY.verifyResent);

    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.verifyContinue }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'uid-1',
      emailVerified: true,
    })));
    expect(user.reload).toHaveBeenCalled();
    expect(user.getIdToken).toHaveBeenCalledWith(true);
  });

  it('blocks a short password in the client', async () => {
    render(<AccountAuthPanel isOpen onClose={vi.fn()} />);
    await openSignUp();
    typeEmail('ada@example.com');
    typePassword('short');
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.signUpButton }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ACCOUNT_COPY.passwordTooShort);
    expect(fb.createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('shows plain errors for a wrong password, throttling, and an unverified email', async () => {
    render(<AccountAuthPanel isOpen onClose={vi.fn()} />);
    typeEmail('ada@example.com');
    typePassword(PASSWORD);

    fb.signInWithEmailAndPassword.mockRejectedValueOnce(authErr('auth/wrong-password'));
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.signInButton }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ACCOUNT_COPY.wrongCredentials);
    expect(screen.queryByText(/raw auth/)).not.toBeInTheDocument();
    expect(fb.fetchSignInMethodsForEmail).not.toHaveBeenCalled();

    fb.signInWithEmailAndPassword.mockRejectedValueOnce(authErr('auth/too-many-requests'));
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.signInButton }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ACCOUNT_COPY.tooManyAttempts);
    expect(fb.signInWithEmailAndPassword).toHaveBeenCalledTimes(2);

    typeEmail('ada@example.com');
    typePassword(PASSWORD);
    fb.signInWithEmailAndPassword.mockResolvedValueOnce({ user: makeUser({ emailVerified: false }) });
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.signInButton }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ACCOUNT_COPY.unverified);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-account-view', 'verify');
  });

  it('uses the existing Google provider', async () => {
    const onSignedIn = vi.fn();
    fb.signInWithPopup.mockResolvedValue({
      user: makeUser({ uid: 'google-uid', emailVerified: true, providerData: [{ providerId: 'google.com' }] }),
    });
    render(<AccountAuthPanel isOpen onClose={vi.fn()} onSignedIn={onSignedIn} />);
    expect(screen.queryByLabelText(ACCOUNT_COPY.displayNameLabel)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.googleButton }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(expect.objectContaining({ uid: 'google-uid' })));
    expect(fb.signInWithPopup).toHaveBeenCalledWith(auth, googleProvider);
    expect(fb.createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('shows one reset confirmation when the email exists and when it does not', async () => {
    const first = render(<AccountAuthPanel isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.forgot }));
    typeEmail('ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.resetButton }));
    expect(await screen.findByRole('status')).toHaveTextContent(ACCOUNT_COPY.resetSent);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fb.fetchSignInMethodsForEmail).not.toHaveBeenCalled();
    first.unmount();

    fb.sendPasswordResetEmail.mockRejectedValueOnce(authErr('auth/user-not-found'));
    render(<AccountAuthPanel isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.forgot }));
    typeEmail('missing@example.com');
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.resetButton }));
    expect(await screen.findByRole('status')).toHaveTextContent(ACCOUNT_COPY.resetSent);
    expect(screen.queryByText(/raw auth/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('links a new password onto the Google account that already owns the email', async () => {
    const onSignedIn = vi.fn();
    const googleUser = makeUser({
      uid: 'google-uid',
      emailVerified: true,
      email: 'ada@example.com',
      providerData: [{ providerId: 'google.com' }],
    });
    fb.createUserWithEmailAndPassword.mockRejectedValue(authErr('auth/email-already-in-use'));
    fb.fetchSignInMethodsForEmail.mockResolvedValue(['google.com']);
    fb.signInWithPopup.mockResolvedValue({ user: googleUser });
    fb.linkWithCredential.mockResolvedValue({
      user: { ...googleUser, providerData: [{ providerId: 'google.com' }, { providerId: 'password' }] },
    });

    render(<AccountAuthPanel isOpen onClose={vi.fn()} onSignedIn={onSignedIn} />);
    await openSignUp();
    typeEmail('ada@example.com');
    typePassword(PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.signUpButton }));

    expect(await screen.findByRole('alert')).toHaveTextContent(ACCOUNT_COPY.linkGoogle);
    expect(screen.getByRole('dialog').textContent).not.toContain(PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.googleButton }));

    await waitFor(() => expect(fb.linkWithCredential).toHaveBeenCalled());
    expect(fb.linkWithCredential).toHaveBeenCalledWith(
      googleUser,
      expect.objectContaining({ providerId: 'password', email: 'ada@example.com', password: PASSWORD })
    );
    expect(onSignedIn).toHaveBeenCalledWith(expect.objectContaining({ uid: 'google-uid' }));
  });

  it('links Google onto the password account that already owns the email', async () => {
    const onSignedIn = vi.fn();
    const pendingCred = { providerId: 'google.com', idToken: 'pending' };
    const passwordUser = makeUser({ uid: 'password-uid', emailVerified: true, email: 'ada@example.com' });
    fb.signInWithPopup.mockRejectedValue(authErr('auth/account-exists-with-different-credential', {
      customData: { email: 'ada@example.com', _credential: pendingCred },
    }));
    fb.signInWithEmailAndPassword.mockResolvedValue({ user: passwordUser });
    fb.linkWithCredential.mockResolvedValue({
      user: { ...passwordUser, providerData: [{ providerId: 'password' }, { providerId: 'google.com' }] },
    });

    render(<AccountAuthPanel isOpen onClose={vi.fn()} onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.googleButton }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ACCOUNT_COPY.linkPassword);
    expect(fb.fetchSignInMethodsForEmail).not.toHaveBeenCalled();

    typePassword(PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.linkSubmit }));
    await waitFor(() => expect(fb.linkWithCredential).toHaveBeenCalledWith(passwordUser, pendingCred));
    expect(onSignedIn).toHaveBeenCalledWith(expect.objectContaining({ uid: 'password-uid' }));
  });

  it('sends an existing password account back to sign-in instead of creating a second uid', async () => {
    fb.createUserWithEmailAndPassword.mockRejectedValue(authErr('auth/email-already-in-use'));
    fb.fetchSignInMethodsForEmail.mockResolvedValue(['password']);
    render(<AccountAuthPanel isOpen onClose={vi.fn()} />);
    await openSignUp();
    typeEmail('ada@example.com');
    typePassword(PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.signUpButton }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ACCOUNT_COPY.linkUsePassword);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-account-view', 'sign-in');
    expect(screen.queryByLabelText(ACCOUNT_COPY.displayNameLabel)).not.toBeInTheDocument();
    expect(screen.getByLabelText(ACCOUNT_COPY.passwordLabel)).toHaveValue('');
  });

  it('offers both sign-in methods when enumeration protection hides the provider list', async () => {
    const googleUser = makeUser({
      uid: 'google-uid',
      emailVerified: true,
      email: 'ada@example.com',
      providerData: [{ providerId: 'google.com' }],
    });
    fb.createUserWithEmailAndPassword.mockRejectedValue(authErr('auth/email-already-in-use'));
    fb.signInWithPopup.mockResolvedValue({ user: googleUser });
    render(<AccountAuthPanel isOpen onClose={vi.fn()} onSignedIn={vi.fn()} />);
    await openSignUp();
    typeEmail('ada@example.com');
    typePassword(PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.signUpButton }));

    expect(await screen.findByRole('alert')).toHaveTextContent(ACCOUNT_COPY.linkEither);
    expect(screen.getByRole('button', { name: ACCOUNT_COPY.googleButton })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ACCOUNT_COPY.signInWithPassword })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.googleButton }));
    await waitFor(() => expect(fb.linkWithCredential).toHaveBeenCalled());
    expect(fb.fetchSignInMethodsForEmail).toHaveBeenCalledWith(auth, 'ada@example.com');
  });

  it('opens the verify screen from the banner', async () => {
    const onVerify = vi.fn();
    render(<VerifyEmailBanner onVerify={onVerify} />);
    expect(screen.getByRole('status')).toHaveTextContent(ACCOUNT_COPY.verifyBanner);
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT_COPY.verifyBannerAction }));
    expect(onVerify).toHaveBeenCalled();

    authState.currentUser = makeUser({ emailVerified: false });
    render(<AccountAuthPanel isOpen initialView="verify" onClose={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: ACCOUNT_COPY.verifyTitle })).toBeInTheDocument();
    expect(screen.getByText(ACCOUNT_COPY.verifyBody('ada@example.com'))).toBeInTheDocument();
  });
});
