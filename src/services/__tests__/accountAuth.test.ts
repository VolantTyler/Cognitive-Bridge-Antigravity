/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { ACCOUNT_COPY } from '../../constants/accountCopy';
import {
  AccountAuthClient,
  AccountUser,
  EmailNotVerifiedError,
  confirmEmailVerified,
  emailVerifiedClaimFromIdToken,
  linkWithPassword,
  requestPasswordReset,
  requireVerifiedEmail,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from '../accountAuth';

const PASSWORD = 'longpassword';

function account(partial: Partial<AccountUser> = {}): AccountUser {
  return {
    uid: 'uid-1',
    email: 'ada@example.com',
    displayName: null,
    emailVerified: true,
    providerIds: ['password'],
    ...partial,
  };
}

function authError(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`firebase ${code} leak-me`), { code, ...extra });
}

function jwt(payload: Record<string, unknown>): string {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${body}.sig`;
}

function client(overrides: Partial<AccountAuthClient> = {}): AccountAuthClient {
  return {
    currentUser: () => null,
    signInWithGoogle: vi.fn(async () => account({ uid: 'google-uid', emailVerified: true, providerIds: ['google.com'] })),
    createUser: vi.fn(async () => account({ emailVerified: false, providerIds: ['password'] })),
    signInWithEmail: vi.fn(async () => account()),
    sendVerification: vi.fn(async () => undefined),
    sendPasswordReset: vi.fn(async () => undefined),
    updateDisplayName: vi.fn(async (user, displayName) => ({ ...user, displayName })),
    fetchSignInMethods: vi.fn(async () => {
      throw authError('auth/operation-not-allowed');
    }),
    linkPassword: vi.fn(async (user) => ({ ...user, providerIds: ['google.com', 'password'] })),
    linkGoogle: vi.fn(async (user) => ({ ...user, providerIds: ['password', 'google.com'] })),
    googleCredentialFromError: (error) => (error as { credential?: unknown }).credential ?? null,
    signOut: vi.fn(async () => undefined),
    refreshUser: vi.fn(async (user) => ({
      user: { ...user, emailVerified: true },
      idToken: jwt({ email_verified: true, email: user.email }),
    })),
    ...overrides,
  };
}

describe('email and password accounts', () => {
  it('creates an account with the email, sends verification, and keeps the display name off the login', async () => {
    const auth = client();
    const log = vi.fn();
    const result = await signUpWithEmail(auth, {
      email: ' Ada@Example.com ',
      password: PASSWORD,
      displayName: ' Ada ',
    }, log);

    expect(auth.createUser).toHaveBeenCalledWith('ada@example.com', PASSWORD);
    expect(auth.updateDisplayName).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@example.com' }), 'Ada');
    expect(auth.sendVerification).toHaveBeenCalled();
    expect(auth.fetchSignInMethods).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      status: 'verify_email',
      email: 'ada@example.com',
      verificationSent: true,
    });
    expect(log).toHaveBeenCalledWith({ name: 'signin_started', method: 'password' });
    expect(log).toHaveBeenCalledWith({ name: 'email_verification_sent' });
    expect(JSON.stringify(log.mock.calls)).not.toContain(PASSWORD);
  });

  it('rejects a short password before calling Firebase', async () => {
    const auth = client();
    const result = await signUpWithEmail(auth, { email: 'ada@example.com', password: 'short', displayName: '' });
    expect(result).toMatchObject({
      status: 'error',
      code: 'password_too_short',
      message: ACCOUNT_COPY.passwordTooShort,
      field: 'password',
    });
    expect(auth.createUser).not.toHaveBeenCalled();
  });

  it('skips a blank display name', async () => {
    const auth = client();
    await signUpWithEmail(auth, { email: 'ada@example.com', password: PASSWORD, displayName: '   ' });
    expect(auth.updateDisplayName).not.toHaveBeenCalled();
  });

  it('maps a wrong password and a missing account to the same message', async () => {
    for (const code of ['auth/wrong-password', 'auth/user-not-found', 'auth/invalid-credential']) {
      const auth = client({
        signInWithEmail: vi.fn(async () => {
          throw authError(code);
        }),
      });
      const result = await signInWithEmail(auth, { email: 'ada@example.com', password: PASSWORD });
      expect(result).toMatchObject({
        status: 'error',
        code: 'wrong_credentials',
        message: ACCOUNT_COPY.wrongCredentials,
      });
      expect(JSON.stringify(result)).not.toContain('leak-me');
      expect(auth.fetchSignInMethods).not.toHaveBeenCalled();
    }
  });

  it('shows the throttling message and does not retry', async () => {
    const signInWithEmailMock = vi.fn(async () => {
      throw authError('auth/too-many-requests');
    });
    const result = await signInWithEmail(client({ signInWithEmail: signInWithEmailMock }), {
      email: 'ada@example.com',
      password: PASSWORD,
    });
    expect(result).toMatchObject({ code: 'too_many_attempts', message: ACCOUNT_COPY.tooManyAttempts });
    expect(signInWithEmailMock).toHaveBeenCalledTimes(1);
  });

  it('sends an unverified password sign-in to the verify state', async () => {
    const log = vi.fn();
    const result = await signInWithEmail(client({
      signInWithEmail: vi.fn(async () => account({ emailVerified: false })),
    }), { email: 'ada@example.com', password: PASSWORD }, log);
    expect(result).toMatchObject({
      status: 'verify_email',
      message: ACCOUNT_COPY.unverified,
      tone: 'error',
    });
    expect(log.mock.calls.map((call) => call[0].name)).not.toContain('signin_completed');
  });

  it('keeps Google sign-in on the popup path', async () => {
    const auth = client();
    const log = vi.fn();
    const result = await signInWithGoogle(auth, null, log);
    expect(result).toMatchObject({ status: 'signed_in', method: 'google', user: { uid: 'google-uid' } });
    expect(auth.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(auth.createUser).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith({ name: 'signin_completed', method: 'google' });
  });

  it('maps a closed Google popup to a plain message', async () => {
    const result = await signInWithGoogle(client({
      signInWithGoogle: vi.fn(async () => {
        throw authError('auth/popup-closed-by-user');
      }),
    }), null);
    expect(result).toMatchObject({ code: 'google_cancelled', message: ACCOUNT_COPY.googleCancelled });
  });
});

describe('password reset does not reveal whether the account exists', () => {
  it('returns the same confirmation for a real account and a missing one', async () => {
    const present = client();
    const missing = client({
      sendPasswordReset: vi.fn(async () => {
        throw authError('auth/user-not-found');
      }),
    });
    const log = vi.fn();
    const sent = await requestPasswordReset(present, 'ada@example.com', log);
    const hidden = await requestPasswordReset(missing, 'missing@example.com', log);
    expect(sent).toEqual(hidden);
    expect(sent).toEqual({ ok: true, status: 'reset_sent', message: ACCOUNT_COPY.resetSent });
    expect(present.fetchSignInMethods).not.toHaveBeenCalled();
    expect(missing.fetchSignInMethods).not.toHaveBeenCalled();
    expect(JSON.stringify(hidden)).not.toContain('leak-me');
  });

  it('still surfaces throttling', async () => {
    const result = await requestPasswordReset(client({
      sendPasswordReset: vi.fn(async () => {
        throw authError('auth/too-many-requests');
      }),
    }), 'ada@example.com');
    expect(result).toMatchObject({ code: 'too_many_attempts', message: ACCOUNT_COPY.tooManyAttempts });
  });
});

describe('account linking keeps one uid', () => {
  it('links a password onto the existing Google account', async () => {
    const googleUser = account({ uid: 'google-uid', emailVerified: true, providerIds: ['google.com'] });
    const auth = client({
      createUser: vi.fn(async () => {
        throw authError('auth/email-already-in-use');
      }),
      fetchSignInMethods: vi.fn(async () => ['google.com']),
      signInWithGoogle: vi.fn(async () => googleUser),
      linkPassword: vi.fn(async () => ({ ...googleUser, providerIds: ['google.com', 'password'] })),
    });

    const pending = await signUpWithEmail(auth, {
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: '',
    });
    expect(pending).toMatchObject({
      status: 'needs_link',
      direction: 'password_onto_google',
      message: ACCOUNT_COPY.linkGoogle,
    });
    if (pending.status !== 'needs_link') throw new Error('expected link');

    const linked = await signInWithGoogle(auth, pending);
    expect(linked).toMatchObject({ status: 'signed_in', linked: true, user: { uid: 'google-uid' } });
    expect(auth.linkPassword).toHaveBeenCalledWith(googleUser, 'ada@example.com', PASSWORD);
    expect(auth.createUser).toHaveBeenCalledTimes(1);
  });

  it('links Google onto the existing password account', async () => {
    const passwordUser = account({ uid: 'password-uid', emailVerified: true, providerIds: ['password'] });
    const credential = { providerId: 'google.com', token: 'pending-google' };
    const auth = client({
      signInWithGoogle: vi.fn(async () => {
        throw authError('auth/account-exists-with-different-credential', {
          customData: { email: 'Ada@Example.com' },
          credential,
        });
      }),
      signInWithEmail: vi.fn(async () => passwordUser),
      linkGoogle: vi.fn(async () => ({ ...passwordUser, providerIds: ['password', 'google.com'] })),
    });

    const pending = await signInWithGoogle(auth, null);
    expect(pending).toMatchObject({
      status: 'needs_link',
      direction: 'google_onto_password',
      email: 'ada@example.com',
      message: ACCOUNT_COPY.linkPassword,
    });
    expect(auth.fetchSignInMethods).not.toHaveBeenCalled();
    if (pending.status !== 'needs_link') throw new Error('expected link');

    const linked = await linkWithPassword(auth, pending, PASSWORD);
    expect(linked).toMatchObject({ status: 'signed_in', linked: true, user: { uid: 'password-uid' } });
    expect(auth.linkGoogle).toHaveBeenCalledWith(passwordUser, credential);
  });

  it('still offers linking when enumeration protection blocks fetchSignInMethods', async () => {
    const googleUser = account({ uid: 'google-uid', emailVerified: true, providerIds: ['google.com'] });
    for (const fetchSignInMethods of [
      vi.fn(async () => {
        throw authError('auth/operation-not-allowed');
      }),
      vi.fn(async () => [] as string[]),
    ]) {
      const auth = client({
        createUser: vi.fn(async () => {
          throw authError('auth/email-already-in-use');
        }),
        fetchSignInMethods,
        signInWithGoogle: vi.fn(async () => googleUser),
      });
      const pending = await signUpWithEmail(auth, {
        email: 'ada@example.com',
        password: PASSWORD,
        displayName: '',
      });
      expect(pending).toMatchObject({
        status: 'needs_link',
        direction: 'password_onto_google',
        message: ACCOUNT_COPY.linkEither,
        knownMethods: null,
      });
      if (pending.status !== 'needs_link') throw new Error('expected link');
      const linked = await signInWithGoogle(auth, pending);
      expect(linked).toMatchObject({ status: 'signed_in', user: { uid: 'google-uid' }, linked: true });
    }
  });

  it('does not link a Google account that uses a different email', async () => {
    const auth = client({
      signInWithGoogle: vi.fn(async () => account({
        uid: 'other-google',
        email: 'other@example.com',
        emailVerified: true,
        providerIds: ['google.com'],
      })),
    });
    const pending = {
      ok: false as const,
      status: 'needs_link' as const,
      direction: 'password_onto_google' as const,
      email: 'ada@example.com',
      message: ACCOUNT_COPY.linkGoogle,
      pendingPassword: PASSWORD,
      pendingGoogleCredential: null,
      knownMethods: ['google.com'],
    };
    const result = await signInWithGoogle(auth, pending);
    expect(result).toMatchObject({ code: 'email_mismatch', message: ACCOUNT_COPY.emailMismatch });
    expect(auth.linkPassword).not.toHaveBeenCalled();
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('asks for the existing password when that is the only known method', async () => {
    const auth = client({
      createUser: vi.fn(async () => {
        throw authError('auth/email-already-in-use');
      }),
      fetchSignInMethods: vi.fn(async () => ['password']),
    });
    const result = await signUpWithEmail(auth, {
      email: 'ada@example.com',
      password: PASSWORD,
      displayName: 'Ada',
    });
    expect(result).toMatchObject({
      direction: 'use_existing_password',
      message: ACCOUNT_COPY.linkUsePassword,
      pendingPassword: null,
    });
  });
});

describe('requireVerifiedEmail', () => {
  it('reads email_verified from the ID token', async () => {
    expect(emailVerifiedClaimFromIdToken(jwt({ email_verified: true }))).toBe(true);
    expect(emailVerifiedClaimFromIdToken(jwt({ email_verified: false }))).toBe(false);
    expect(emailVerifiedClaimFromIdToken('not-a-token')).toBe(null);

    await expect(requireVerifiedEmail({
      email: 'ada@example.com',
      emailVerified: true,
      getIdToken: async () => jwt({ email_verified: false }),
    })).rejects.toBeInstanceOf(EmailNotVerifiedError);

    await expect(requireVerifiedEmail({
      email: 'ada@example.com',
      emailVerified: false,
      reload: vi.fn(async () => undefined),
      getIdToken: async () => jwt({ email_verified: true }),
    })).resolves.toEqual({ email: 'ada@example.com', email_verified: true });
  });

  it('falls back to the user flag only when the claim cannot be read', async () => {
    await expect(requireVerifiedEmail({
      email: 'ada@example.com',
      emailVerified: true,
      getIdToken: async () => 'not-a-jwt',
    })).resolves.toEqual({ email: 'ada@example.com', email_verified: true });

    await expect(requireVerifiedEmail({
      email: 'ada@example.com',
      emailVerified: false,
      getIdToken: async () => 'not-a-jwt',
    })).rejects.toMatchObject({ code: 'email_not_verified', message: ACCOUNT_COPY.unverified });
  });

  it('check-again stays unverified when the refreshed claim is false', async () => {
    const auth = client({
      refreshUser: vi.fn(async (user) => ({
        user: { ...user, emailVerified: true },
        idToken: jwt({ email_verified: false, email: user.email }),
      })),
    });
    const result = await confirmEmailVerified(auth, account({ emailVerified: false }));
    expect(result).toMatchObject({ code: 'email_not_verified', message: ACCOUNT_COPY.verifyNotYet });
  });
});
