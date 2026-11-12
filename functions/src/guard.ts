import { verifyBearerToken, TokenVerifier } from "./auth";
import { reserveInterviewForChat } from "./interviewStore";
import { isRequestableModel, normalizeModelName } from "./modelRouter";
import {
  GateConfig,
  GateError,
  HeaderSource,
  VerifiedUser,
  appCheckError,
  configFromEnv,
  inputCharCount,
  inputTooLongError,
  interviewsPausedError,
  isBridgeChatFeature,
  isInterviewFeature,
  paymentRequiredError,
  readHeader,
  sanitizeFeature,
  sanitizeSessionId,
  usEasternDay,
} from "./gate";

export interface GuardDeps {
  config: () => GateConfig;
  verifyIdToken: TokenVerifier;
  readPaid: (uid: string) => Promise<boolean>;
  reserveBridgeChat: (uid: string, day: string, cap: number) => Promise<void>;
  assertUnderCostCap: (uid: string, day: string, capUsd: number) => Promise<void>;
  reserveInterview: (uid: string, feature: string) => Promise<void>;
  verifyAppCheck: (token: string) => Promise<void>;
  now: () => Date;
}

export interface GuardContext {
  uid: string | null;
  email: string | null;
  email_verified: boolean;
  feature: string;
  sessionId: string | null;
  reservationId: string | null;
}

/**
 * Interview reservation ids are `iv_<base36>_<base36>` and the ledger rejects
 * anything longer than 80 characters. Drop the field when it is not that shape.
 */
const RESERVATION_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function sanitizeReservationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!RESERVATION_RE.test(trimmed)) return null;
  return trimmed;
}

export interface GuardRequest extends HeaderSource {
  method?: string;
  body?: unknown;
}

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

async function enforceAppCheck(req: GuardRequest, config: GateConfig, deps: GuardDeps): Promise<void> {
  if (!config.enforceAppCheck) return;
  const token = readHeader(req, "x-firebase-appcheck") ?? readHeader(req, "X-Firebase-AppCheck");
  if (!token) throw appCheckError();
  try {
    await deps.verifyAppCheck(token);
  } catch {
    throw appCheckError();
  }
}

async function enforceIdentity(req: GuardRequest, config: GateConfig, deps: GuardDeps): Promise<VerifiedUser | null> {
  if (config.mode === "off") return null;
  const user = await verifyBearerToken(readHeader(req, "authorization"), deps.verifyIdToken);
  if (config.mode === "paid" && !config.allowlist.has(user.uid)) {
    const paid = await deps.readPaid(user.uid);
    if (!paid) throw paymentRequiredError();
  }
  return user;
}

export async function guardChat(req: GuardRequest, deps: GuardDeps): Promise<GuardContext> {
  if (req.method && req.method.toUpperCase() !== "POST") {
    throw new GateError(405, "method_not_allowed", "POST required.");
  }
  const config = deps.config();
  await enforceAppCheck(req, config, deps);
  const user = await enforceIdentity(req, config, deps);
  const body = asRecord(req.body);
  const feature = sanitizeFeature(body.feature);
  const sessionId = sanitizeSessionId(body.sessionId);
  const reservationId = sanitizeReservationId(body.reservationId);

  if (config.interviewsPaused && isInterviewFeature(feature)) {
    throw interviewsPausedError();
  }

  if (!Array.isArray(body.messages)) {
    throw new GateError(400, "bad_request", "Bad Request: 'messages' array is required.");
  }
  const requestedModel = normalizeModelName(typeof body.modelName === "string" ? body.modelName : undefined);
  if (!isRequestableModel(requestedModel)) {
    throw new GateError(400, "bad_request", `Bad Request: Model '${requestedModel}' is not allowed.`);
  }
  if (inputCharCount(body.messages, body.systemInstruction) > config.maxInputChars) {
    throw inputTooLongError();
  }

  // Allowlist skips entitlements only. The dollar cap applies to every signed-in uid.
  if (user) {
    await deps.assertUnderCostCap(user.uid, usEasternDay(deps.now()), config.dailyUserCostCapUsd);
  }
  if (user && isBridgeChatFeature(feature)) {
    await deps.reserveBridgeChat(user.uid, usEasternDay(deps.now()), config.bridgeDailyCap);
  }
  if (user && isInterviewFeature(feature)) {
    await deps.reserveInterview(user.uid, feature);
  }

  return {
    uid: user?.uid ?? null,
    email: user?.email ?? null,
    email_verified: user?.email_verified ?? false,
    feature,
    sessionId,
    reservationId,
  };
}

export async function guardJudge(req: GuardRequest, deps: GuardDeps): Promise<GuardContext> {
  if (req.method && req.method.toUpperCase() !== "POST") {
    throw new GateError(405, "method_not_allowed", "POST required.");
  }
  const config = deps.config();
  await enforceAppCheck(req, config, deps);
  const user = await enforceIdentity(req, config, deps);
  const body = asRecord(req.body);
  const feature = sanitizeFeature(body.feature);
  // Mirror chat sends "mirror". The mirror judge step sends "judge".
  // Both stay paused together. Bridge judgment sends "bridge" and stays up.
  if (config.interviewsPaused && (isInterviewFeature(feature) || feature.toLowerCase() === "judge")) {
    throw interviewsPausedError();
  }
  if (user) {
    await deps.assertUnderCostCap(user.uid, usEasternDay(deps.now()), config.dailyUserCostCapUsd);
  }
  return {
    uid: user?.uid ?? null,
    email: user?.email ?? null,
    email_verified: user?.email_verified ?? false,
    feature,
    sessionId: sanitizeSessionId(body.sessionId),
    reservationId: sanitizeReservationId(body.reservationId),
  };
}

export function defaultGuardDeps(overrides: Partial<GuardDeps> = {}): GuardDeps {
  return {
    config: () => configFromEnv(),
    verifyIdToken: async (token: string) => {
      const { verifyIdTokenWithAdmin } = await import("./auth");
      return verifyIdTokenWithAdmin(token);
    },
    readPaid: async (uid: string) => {
      const { readEntitlementPaid } = await import("./adminStore");
      return readEntitlementPaid(uid);
    },
    reserveBridgeChat: async (uid: string, day: string, cap: number) => {
      const { reserveBridgeChatSlot } = await import("./adminStore");
      return reserveBridgeChatSlot(uid, day, cap);
    },
    assertUnderCostCap: async (uid: string, day: string, capUsd: number) => {
      const { readDailyCostMicros } = await import("./adminStore");
      const { assertUnderDailyCostCap } = await import("./dailyCost");
      const spentMicros = await readDailyCostMicros(uid, day);
      await assertUnderDailyCostCap({ spentMicros, capUsd });
    },
    reserveInterview: reserveInterviewForChat,
    verifyAppCheck: async (token: string) => {
      const { verifyAppCheckToken } = await import("./adminStore");
      return verifyAppCheckToken(token);
    },
    now: () => new Date(),
    ...overrides,
  };
}
