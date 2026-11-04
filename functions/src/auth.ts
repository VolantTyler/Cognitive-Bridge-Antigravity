import { GateError, VerifiedUser, bearerToken, unauthenticatedError } from "./gate";

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
  } catch {
    throw unauthenticatedError();
  }
  if (!decoded || typeof decoded.uid !== "string" || decoded.uid.length === 0) {
    throw unauthenticatedError();
  }
  return {
    uid: decoded.uid,
    email: typeof decoded.email === "string" ? decoded.email : null,
    email_verified: decoded.email_verified === true,
  };
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
    email_verified: decoded.email_verified,
  };
}

export function asGateError(error: unknown): GateError | null {
  return error instanceof GateError ? error : null;
}
