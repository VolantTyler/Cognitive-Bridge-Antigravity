import { EMAIL_NOT_VERIFIED_CODE, EMAIL_NOT_VERIFIED_MESSAGE } from "./accountCopy";
import { GateError, VerifiedUser, bearerToken, sessionExpiredError, unauthenticatedError } from "./gate";

export interface DecodedToken {
  uid?: string;
  email?: string;
  email_verified?: boolean;
}

export type TokenVerifier = (token: string) => Promise<DecodedToken>;

export async function verifyBearerToken(
  authorizationHeader: string | undefined,
  verify: TokenVerifier
): Promise<VerifiedUser> {
  const token = bearerToken(authorizationHeader);
  if (!token) throw unauthenticatedError();
  let decoded: DecodedToken;
  try {
    decoded = await verify(token);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "auth/id-token-expired" || code === "auth/user-token-expired") {
      throw sessionExpiredError();
    }
    throw unauthenticatedError();
  }
  if (!decoded || typeof decoded.uid !== "string" || decoded.uid.length === 0) {
    throw unauthenticatedError();
  }
  return {
    uid: decoded.uid,
    email: typeof decoded.email === "string" ? decoded.email : null,
    email_verified: emailVerifiedFromToken(decoded),
  };
}

/**
 * True only when the verified ID token's email_verified claim is true.
 * A missing claim is unverified. Checkout calls requireEmailVerified.
 * chatProxy and judgeProxy do not.
 */
export function emailVerifiedFromToken(decoded: { email_verified?: boolean }): boolean {
  return decoded.email_verified === true;
}

export function requireEmailVerified(user: VerifiedUser): VerifiedUser {
  if (!emailVerifiedFromToken(user)) {
    throw new GateError(403, EMAIL_NOT_VERIFIED_CODE, EMAIL_NOT_VERIFIED_MESSAGE);
  }
  return user;
}

export async function verifyIdTokenWithAdmin(token: string): Promise<DecodedToken> {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  if (getApps().length === 0) {
    initializeApp();
  }
  const decoded = await getAuth().verifyIdToken(token);
  return {
    uid: decoded.uid,
    email: decoded.email,
    email_verified: emailVerifiedFromToken(decoded),
  };
}

export function asGateError(error: unknown): GateError | null {
  return error instanceof GateError ? error : null;
}
