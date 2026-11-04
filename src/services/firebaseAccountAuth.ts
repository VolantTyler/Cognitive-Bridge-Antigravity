/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type ActionCodeSettings,
  type Auth,
  type AuthCredential,
  type User,
} from "firebase/auth";
import type { FirebaseError } from "firebase/app";
import { auth, googleProvider } from "./firebase";
import { authErrorCode, type AccountAuthClient, type AccountUser } from "./accountAuth";

/**
 * Binds the account flows to Firebase Auth.
 * Uses the existing Google provider (prompt: select_account).
 * Does not log passwords, credentials, or ID tokens.
 */
export function createFirebaseAccountAuthClient(
  authInstance: Auth = auth,
  provider: GoogleAuthProvider = googleProvider
): AccountAuthClient {
  let current: User | null = authInstance.currentUser;

  const wrap = (user: User): AccountUser => {
    current = user;
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      emailVerified: user.emailVerified,
      providerIds: user.providerData.map((entry) => entry.providerId),
    };
  };

  const requireCurrent = (account: AccountUser): User => {
    const live = authInstance.currentUser;
    if (live && live.uid === account.uid) return live;
    if (current && current.uid === account.uid) return current;
    throw Object.assign(new Error("No signed-in user"), { code: "auth/user-token-expired" });
  };

  return {
    currentUser() {
      if (authInstance.currentUser) return wrap(authInstance.currentUser);
      if (current) return wrap(current);
      return null;
    },
    async signInWithGoogle() {
      const result = await signInWithPopup(authInstance, provider);
      return wrap(result.user);
    },
    async createUser(email, password) {
      const result = await createUserWithEmailAndPassword(authInstance, email, password);
      return wrap(result.user);
    },
    async signInWithEmail(email, password) {
      const result = await signInWithEmailAndPassword(authInstance, email, password);
      return wrap(result.user);
    },
    async sendVerification(account) {
      const user = requireCurrent(account);
      const settings = actionCodeSettings();
      try {
        await sendEmailVerification(user, settings);
      } catch (error) {
        if (settings && authErrorCode(error) === "auth/unauthorized-continue-uri") {
          await sendEmailVerification(user);
          return;
        }
        throw error;
      }
    },
    async sendPasswordReset(email) {
      const settings = actionCodeSettings();
      try {
        await sendPasswordResetEmail(authInstance, email, settings);
      } catch (error) {
        if (settings && authErrorCode(error) === "auth/unauthorized-continue-uri") {
          await sendPasswordResetEmail(authInstance, email);
          return;
        }
        throw error;
      }
    },
    async updateDisplayName(account, displayName) {
      const user = requireCurrent(account);
      await updateProfile(user, { displayName });
      return wrap(user);
    },
    fetchSignInMethods(email) {
      return fetchSignInMethodsForEmail(authInstance, email);
    },
    async linkPassword(account, email, password) {
      const user = requireCurrent(account);
      const result = await linkWithCredential(user, EmailAuthProvider.credential(email, password));
      return wrap(result.user);
    },
    async linkGoogle(account, credential) {
      const user = requireCurrent(account);
      const result = await linkWithCredential(user, credential as AuthCredential);
      return wrap(result.user);
    },
    googleCredentialFromError(error) {
      const firebaseError = asFirebaseError(error);
      if (!firebaseError) return null;
      try {
        return GoogleAuthProvider.credentialFromError(firebaseError);
      } catch {
        return null;
      }
    },
    async signOut() {
      current = null;
      await firebaseSignOut(authInstance);
    },
    async refreshUser(account) {
      const user = requireCurrent(account);
      await user.reload();
      const idToken = await user.getIdToken(true);
      return { user: wrap(user), idToken };
    },
  };
}

function actionCodeSettings(): ActionCodeSettings | undefined {
  if (typeof window === "undefined") return undefined;
  const origin = window.location?.origin;
  if (!origin || origin === "null") return undefined;
  return { url: origin, handleCodeInApp: false };
}

function asFirebaseError(error: unknown): FirebaseError | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    return error as FirebaseError;
  }
  return null;
}
