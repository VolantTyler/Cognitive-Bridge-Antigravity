/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ACCOUNT_COPY,
  ACCOUNT_DISPLAY_NAME_MAX,
  ACCOUNT_PASSWORD_MIN_LENGTH,
  EMAIL_NOT_VERIFIED_MESSAGE,
  GOOGLE_PROVIDER_ID,
  PASSWORD_PROVIDER_ID,
} from "../constants/accountCopy";

/**
 * Checkout will call requireVerifiedEmail before createCheckout.
 * Google accounts already have emailVerified. Password accounts must
 * finish the email link first. This does not gate /api/chat.
 */
export class EmailNotVerifiedError extends Error {
  readonly code = "email_not_verified" as const;

  constructor() {
    super(EMAIL_NOT_VERIFIED_MESSAGE);
    this.name = "EmailNotVerifiedError";
  }
}

export interface AccountUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  providerIds: string[];
}

export interface VerifiableUser {
  email: string | null;
  emailVerified: boolean;
  reload?: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}

/** Firebase Auth calls the screen needs. Tests pass a fake. */
export interface AccountAuthClient {
  currentUser: () => AccountUser | null;
  signInWithGoogle: () => Promise<AccountUser>;
  createUser: (email: string, password: string) => Promise<AccountUser>;
  signInWithEmail: (email: string, password: string) => Promise<AccountUser>;
  sendVerification: (user: AccountUser) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updateDisplayName: (user: AccountUser, displayName: string) => Promise<AccountUser>;
  /**
   * Called only after auth/email-already-in-use. Empty or a thrown
   * auth/operation-not-allowed means enumeration protection is on.
   */
  fetchSignInMethods: (email: string) => Promise<string[]>;
  linkPassword: (user: AccountUser, email: string, password: string) => Promise<AccountUser>;
  linkGoogle: (user: AccountUser, credential: unknown) => Promise<AccountUser>;
  googleCredentialFromError: (error: unknown) => unknown | null;
  signOut: () => Promise<void>;
  refreshUser: (user: AccountUser) => Promise<{ user: AccountUser; idToken: string }>;
}

export type AccountEvent =
  | { name: "signin_started"; method: "google" | "password" }
  | { name: "signin_completed"; method: "google" | "password" }
  | { name: "email_verification_sent" }
  | { name: "email_verified" }
  | { name: "password_reset_requested" };

export type AccountLogger = (event: AccountEvent) => void;

export type AccountErrorCode =
  | "password_too_short"
  | "invalid_email"
  | "display_name_too_long"
  | "wrong_credentials"
  | "too_many_attempts"
  | "email_not_verified"
  | "google_cancelled"
  | "network"
  | "email_mismatch"
  | "link_failed"
  | "generic";

export type LinkDirection = "password_onto_google" | "google_onto_password" | "use_existing_password";

export type AccountFlowResult =
  | {
      ok: true;
      status: "signed_in";
      method: "google" | "password";
      user: AccountUser;
      linked: boolean;
    }
  | {
      ok: true;
      status: "verify_email";
      user: AccountUser;
      email: string;
      verificationSent: boolean;
      message: string | null;
      tone: "error" | "status" | null;
    }
  | {
      ok: true;
      status: "reset_sent";
      message: string;
    }
  | {
      ok: false;
      status: "needs_link";
      direction: LinkDirection;
      email: string;
      message: string;
      /** Held in memory so a Google sign-in can link this password. Never render it. */
      pendingPassword: string | null;
      pendingGoogleCredential: unknown | null;
      knownMethods: string[] | null;
    }
  | {
      ok: false;
      status: "error";
      code: AccountErrorCode;
      message: string;
      field: "email" | "password" | "displayName" | null;
    };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function authErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function authErrorEmail(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const record = error as { email?: unknown; customData?: { email?: unknown } };
  if (typeof record.customData?.email === "string") return record.customData.email;
  if (typeof record.email === "string") return record.email;
  return null;
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!email || email.length > 200 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Reads the email_verified claim. Does not check the signature; the server does that. */
export function emailVerifiedClaimFromIdToken(idToken: string): boolean | null {
  const parts = idToken.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const json = JSON.parse(decodeBase64Url(parts[1])) as { email_verified?: unknown };
    return typeof json.email_verified === "boolean" ? json.email_verified : null;
  } catch {
    return null;
  }
}

export async function requireVerifiedEmail(user: VerifiableUser): Promise<{ email: string; email_verified: true }> {
  if (user.reload) {
    try {
      await user.reload();
    } catch {
      // The refreshed ID token below is the claim checkout will trust.
    }
  }
  let token = "";
  try {
    token = await user.getIdToken(true);
  } catch {
    throw new EmailNotVerifiedError();
  }
  const claim = emailVerifiedClaimFromIdToken(token);
  const verified = claim === true || (claim === null && user.emailVerified === true);
  if (!verified || !user.email) throw new EmailNotVerifiedError();
  return { email: user.email, email_verified: true };
}

export async function signUpWithEmail(
  client: AccountAuthClient,
  input: { email: string; password: string; displayName: string },
  log?: AccountLogger
): Promise<AccountFlowResult> {
  const email = normalizeEmail(input.email);
  if (!email) return fieldError("invalid_email", ACCOUNT_COPY.invalidEmail, "email");
  const passwordError = passwordTooShort(input.password);
  if (passwordError) return passwordError;
  const displayName = input.displayName.trim();
  if ([...displayName].length > ACCOUNT_DISPLAY_NAME_MAX) {
    return fieldError("display_name_too_long", ACCOUNT_COPY.displayNameTooLong, "displayName");
  }

  emit(log, { name: "signin_started", method: "password" });
  try {
    let user = await client.createUser(email, input.password);
    if (displayName) {
      try {
        user = await client.updateDisplayName(user, displayName);
      } catch {
        // The name is cosmetic. The account still exists.
      }
    }
    return sendVerificationResult(client, user, email, log);
  } catch (error) {
    if (authErrorCode(error) === "auth/email-already-in-use") {
      return respondToExistingEmail(client, email, input.password);
    }
    return mapAuthError(error);
  }
}

export async function signInWithEmail(
  client: AccountAuthClient,
  input: { email: string; password: string },
  log?: AccountLogger
): Promise<AccountFlowResult> {
  const email = normalizeEmail(input.email);
  if (!email) return fieldError("invalid_email", ACCOUNT_COPY.invalidEmail, "email");
  const passwordError = passwordTooShort(input.password);
  if (passwordError) return passwordError;

  emit(log, { name: "signin_started", method: "password" });
  try {
    const user = await client.signInWithEmail(email, input.password);
    return finishSignedIn(user, "password", log, false);
  } catch (error) {
    if (authErrorCode(error) === "auth/email-already-in-use") {
      return respondToExistingEmail(client, email, input.password);
    }
    return mapAuthError(error);
  }
}

export async function signInWithGoogle(
  client: AccountAuthClient,
  pending: Extract<AccountFlowResult, { status: "needs_link" }> | null,
  log?: AccountLogger
): Promise<AccountFlowResult> {
  emit(log, { name: "signin_started", method: "google" });
  try {
    const googleUser = await client.signInWithGoogle();
    if (pending?.direction === "password_onto_google" && pending.pendingPassword) {
      if (!sameEmail(googleUser.email, pending.email)) {
        try {
          await client.signOut();
        } catch {
          // Still tell them the Google account does not match.
        }
        return fieldError("email_mismatch", ACCOUNT_COPY.emailMismatch, null);
      }
      try {
        const linked = await client.linkPassword(googleUser, pending.email, pending.pendingPassword);
        return finishSignedIn(linked, "google", log, true);
      } catch (linkError) {
        const code = authErrorCode(linkError);
        if (code === "auth/provider-already-linked" || code === "auth/email-already-in-use") {
          return finishSignedIn(googleUser, "google", log, true);
        }
        return fieldError("link_failed", ACCOUNT_COPY.linkFailed, null);
      }
    }
    return finishSignedIn(googleUser, "google", log, false);
  } catch (error) {
    if (authErrorCode(error) === "auth/account-exists-with-different-credential") {
      return googleConflict(client, error);
    }
    return mapAuthError(error);
  }
}

export async function linkWithPassword(
  client: AccountAuthClient,
  pending: Extract<AccountFlowResult, { status: "needs_link" }>,
  password: string,
  log?: AccountLogger
): Promise<AccountFlowResult> {
  const email = normalizeEmail(pending.email);
  if (!email) return fieldError("invalid_email", ACCOUNT_COPY.invalidEmail, "email");
  const passwordError = passwordTooShort(password);
  if (passwordError) return passwordError;

  emit(log, { name: "signin_started", method: "password" });
  try {
    const user = await client.signInWithEmail(email, password);
    if (pending.direction === "google_onto_password" && pending.pendingGoogleCredential) {
      try {
        const linked = await client.linkGoogle(user, pending.pendingGoogleCredential);
        return finishSignedIn(linked, "password", log, true);
      } catch (linkError) {
        const code = authErrorCode(linkError);
        if (code === "auth/provider-already-linked") {
          return finishSignedIn(user, "password", log, true);
        }
        return fieldError("link_failed", ACCOUNT_COPY.linkFailed, null);
      }
    }
    return finishSignedIn(user, "password", log, false);
  } catch (error) {
    return mapAuthError(error);
  }
}

export async function requestPasswordReset(
  client: AccountAuthClient,
  emailInput: string,
  log?: AccountLogger
): Promise<AccountFlowResult> {
  const email = normalizeEmail(emailInput);
  if (!email) return fieldError("invalid_email", ACCOUNT_COPY.invalidEmail, "email");
  try {
    await client.sendPasswordReset(email);
  } catch (error) {
    const code = authErrorCode(error);
    // Same confirmation when the address is missing. Do not disable throttling.
    if (code === "auth/user-not-found" || code === "auth/invalid-credential") {
      emit(log, { name: "password_reset_requested" });
      return resetSent();
    }
    return mapAuthError(error);
  }
  emit(log, { name: "password_reset_requested" });
  return resetSent();
}

export async function resendVerificationEmail(
  client: AccountAuthClient,
  user: AccountUser,
  log?: AccountLogger
): Promise<AccountFlowResult> {
  try {
    await client.sendVerification(user);
  } catch (error) {
    const mapped = mapAuthError(error);
    if (mapped.code === "generic") {
      return verifyResult(user, user.email ?? "", false, ACCOUNT_COPY.sendFailed, "error");
    }
    return mapped;
  }
  emit(log, { name: "email_verification_sent" });
  return verifyResult(user, user.email ?? "", true, ACCOUNT_COPY.verifyResent, "status");
}

export async function confirmEmailVerified(
  client: AccountAuthClient,
  user: AccountUser,
  log?: AccountLogger
): Promise<AccountFlowResult> {
  let fresh: AccountUser;
  let idToken: string;
  try {
    const refreshed = await client.refreshUser(user);
    fresh = refreshed.user;
    idToken = refreshed.idToken;
  } catch (error) {
    return mapAuthError(error);
  }
  try {
    await requireVerifiedEmail({
      email: fresh.email,
      emailVerified: fresh.emailVerified,
      getIdToken: async () => idToken,
    });
  } catch (error) {
    if (error instanceof EmailNotVerifiedError) {
      return fieldError("email_not_verified", ACCOUNT_COPY.verifyNotYet, null);
    }
    return fieldError("generic", ACCOUNT_COPY.generic, null);
  }
  emit(log, { name: "email_verified" });
  const method = fresh.providerIds.includes(PASSWORD_PROVIDER_ID) ? "password" : "google";
  emit(log, { name: "signin_completed", method });
  return { ok: true, status: "signed_in", method, user: fresh, linked: false };
}

function resetSent(): AccountFlowResult {
  return { ok: true, status: "reset_sent", message: ACCOUNT_COPY.resetSent };
}

async function sendVerificationResult(
  client: AccountAuthClient,
  user: AccountUser,
  email: string,
  log: AccountLogger | undefined
): Promise<AccountFlowResult> {
  try {
    await client.sendVerification(user);
  } catch {
    return verifyResult(user, user.email ?? email, false, ACCOUNT_COPY.sendFailed, "error");
  }
  emit(log, { name: "email_verification_sent" });
  return verifyResult(user, user.email ?? email, true, null, null);
}

async function respondToExistingEmail(
  client: AccountAuthClient,
  email: string,
  password: string
): Promise<AccountFlowResult> {
  const methods = await lookupSignInMethods(client, email);
  const hasGoogle = !!methods?.includes(GOOGLE_PROVIDER_ID);
  const hasPassword = !!methods?.includes(PASSWORD_PROVIDER_ID);
  if (methods && hasPassword && !hasGoogle) {
    return {
      ok: false,
      status: "needs_link",
      direction: "use_existing_password",
      email,
      message: ACCOUNT_COPY.linkUsePassword,
      pendingPassword: null,
      pendingGoogleCredential: null,
      knownMethods: methods,
    };
  }
  return {
    ok: false,
    status: "needs_link",
    direction: "password_onto_google",
    email,
    message: methods && hasGoogle && !hasPassword ? ACCOUNT_COPY.linkGoogle : ACCOUNT_COPY.linkEither,
    pendingPassword: password,
    pendingGoogleCredential: null,
    knownMethods: methods,
  };
}

function googleConflict(client: AccountAuthClient, error: unknown): AccountFlowResult {
  // The error already says another provider owns the email. Do not fetch methods.
  const email = normalizeEmail(authErrorEmail(error) ?? "") ?? (authErrorEmail(error) ?? "").trim();
  return {
    ok: false,
    status: "needs_link",
    direction: "google_onto_password",
    email,
    message: ACCOUNT_COPY.linkPassword,
    pendingPassword: null,
    pendingGoogleCredential: client.googleCredentialFromError(error),
    knownMethods: null,
  };
}

async function lookupSignInMethods(client: AccountAuthClient, email: string): Promise<string[] | null> {
  try {
    const methods = await client.fetchSignInMethods(email);
    if (!Array.isArray(methods) || methods.length === 0) return null;
    return methods;
  } catch {
    return null;
  }
}

function finishSignedIn(
  user: AccountUser,
  method: "google" | "password",
  log: AccountLogger | undefined,
  linked: boolean
): AccountFlowResult {
  if (!user.emailVerified) {
    return verifyResult(user, user.email ?? "", false, ACCOUNT_COPY.unverified, "error");
  }
  emit(log, { name: "signin_completed", method });
  return { ok: true, status: "signed_in", method, user, linked };
}

function verifyResult(
  user: AccountUser,
  email: string,
  verificationSent: boolean,
  message: string | null,
  tone: "error" | "status" | null
): AccountFlowResult {
  return {
    ok: true,
    status: "verify_email",
    user,
    email,
    verificationSent,
    message,
    tone,
  };
}

function passwordTooShort(password: string): AccountFlowResult | null {
  if (password.length >= ACCOUNT_PASSWORD_MIN_LENGTH) return null;
  return fieldError("password_too_short", ACCOUNT_COPY.passwordTooShort, "password");
}

function fieldError(
  code: AccountErrorCode,
  message: string,
  field: "email" | "password" | "displayName" | null
): AccountFlowResult {
  return { ok: false, status: "error", code, message, field };
}

function mapAuthError(error: unknown): Extract<AccountFlowResult, { status: "error" }> {
  const code = authErrorCode(error);
  if (
    code === "auth/wrong-password" ||
    code === "auth/invalid-credential" ||
    code === "auth/user-not-found" ||
    code === "auth/invalid-login-credentials"
  ) {
    return { ok: false, status: "error", code: "wrong_credentials", message: ACCOUNT_COPY.wrongCredentials, field: "password" };
  }
  if (code === "auth/too-many-requests") {
    return { ok: false, status: "error", code: "too_many_attempts", message: ACCOUNT_COPY.tooManyAttempts, field: null };
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request" || code === "auth/popup-blocked") {
    return { ok: false, status: "error", code: "google_cancelled", message: ACCOUNT_COPY.googleCancelled, field: null };
  }
  if (code === "auth/network-request-failed") {
    return { ok: false, status: "error", code: "network", message: ACCOUNT_COPY.network, field: null };
  }
  if (code === "auth/weak-password") {
    return { ok: false, status: "error", code: "password_too_short", message: ACCOUNT_COPY.passwordTooShort, field: "password" };
  }
  if (code === "auth/invalid-email") {
    return { ok: false, status: "error", code: "invalid_email", message: ACCOUNT_COPY.invalidEmail, field: "email" };
  }
  return { ok: false, status: "error", code: "generic", message: ACCOUNT_COPY.generic, field: null };
}

function sameEmail(actual: string | null, expected: string): boolean {
  return !!actual && actual.trim().toLowerCase() === expected.trim().toLowerCase();
}

function emit(log: AccountLogger | undefined, event: AccountEvent) {
  try {
    log?.(event);
  } catch {
    // Analytics must not block sign-in.
  }
}

function decodeBase64Url(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
