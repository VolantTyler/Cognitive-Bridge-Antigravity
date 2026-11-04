/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { auth, getAppCheckToken } from "./firebase";
import {
  AI_ACCESS_MESSAGES,
  AiAccessCode,
  SERVER_CODE_TO_CLIENT,
  ServerAccessCode,
} from "../constants/aiAccess";

const SESSION_STORAGE_KEY = "cb.aiSessionId";
const SESSION_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Typed lock the future paywall UI can switch on. Message text comes from AI_ACCESS_MESSAGES. */
export class AiAccessError extends Error {
  readonly code: AiAccessCode;

  constructor(code: AiAccessCode) {
    super(AI_ACCESS_MESSAGES[code]);
    this.name = "AiAccessError";
    this.code = code;
  }
}

export function isAiAccessError(error: unknown): error is AiAccessError {
  return error instanceof AiAccessError;
}

export function aiAccessErrorFromResponse(
  status: number,
  payload: { code?: unknown } | null
): AiAccessError | null {
  if (payload && typeof payload.code === "string" && payload.code in SERVER_CODE_TO_CLIENT) {
    return new AiAccessError(SERVER_CODE_TO_CLIENT[payload.code as ServerAccessCode]);
  }
  if (status === 401) return new AiAccessError("signed_out");
  return null;
}

export function getAiSessionId(): string {
  try {
    if (typeof sessionStorage !== "undefined") {
      const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (existing && SESSION_RE.test(existing)) return existing;
      const created = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `s${Date.now()}`;
      sessionStorage.setItem(SESSION_STORAGE_KEY, created);
      return created;
    }
  } catch {
    // sessionStorage can throw in private mode. Fall through to an in-memory id.
  }
  return `s${Date.now()}`;
}

export async function authorizedAiHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new AiAccessError("signed_out");
  let token = "";
  try {
    token = await user.getIdToken();
  } catch {
    throw new AiAccessError("signed_out");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  const appCheck = await getAppCheckToken();
  if (appCheck) headers["X-Firebase-AppCheck"] = appCheck;
  return headers;
}
