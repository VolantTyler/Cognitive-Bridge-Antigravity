import { requireEmailVerified, verifyBearerToken, TokenVerifier, asGateError } from "./auth";
import { appCheckError, readHeader, GateError } from "./gate";
import {
  completeInterviewSlot,
  readAccessView,
  reserveInterviewSlot,
} from "./interviewStore";

export interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

export interface IncomingHttp {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  header?: (name: string) => string | undefined;
  body?: unknown;
}

export interface InterviewHttpDeps {
  verifyIdToken: TokenVerifier;
  verifyAppCheck: (token: string) => Promise<void>;
  enforceAppCheck: () => boolean;
  now: () => number;
  readAccess: typeof readAccessView;
  reserve: typeof reserveInterviewSlot;
  complete: typeof completeInterviewSlot;
}

function sendGate(res: JsonResponse, error: GateError): void {
  res.status(error.status).json({ error: error.message, code: error.code });
}

function sendFailure(res: JsonResponse, status: number, code: string, error: string): void {
  res.status(status).json({ error, code });
}

async function requireUser(req: IncomingHttp, deps: InterviewHttpDeps, verified: boolean) {
  if (deps.enforceAppCheck()) {
    const token = readHeader(req, "x-firebase-appcheck") ?? readHeader(req, "X-Firebase-AppCheck");
    if (!token) throw appCheckError();
    try {
      await deps.verifyAppCheck(token);
    } catch {
      throw appCheckError();
    }
  }
  const user = await verifyBearerToken(readHeader(req, "authorization"), deps.verifyIdToken);
  return verified ? requireEmailVerified(user) : user;
}

export async function handleAccessStatus(req: IncomingHttp, res: JsonResponse, deps: InterviewHttpDeps): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "GET") {
    sendFailure(res, 405, "method_not_allowed", "GET required.");
    return;
  }
  try {
    const user = await requireUser(req, deps, false);
    const access = await deps.readAccess(user.uid);
    res.status(200).json(access);
  } catch (error) {
    const gate = asGateError(error);
    if (gate) {
      sendGate(res, gate);
      return;
    }
    sendFailure(res, 500, "access_failed", "We couldn't confirm your access.");
  }
}

export async function handleReserveInterview(req: IncomingHttp, res: JsonResponse, deps: InterviewHttpDeps): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    sendFailure(res, 405, "method_not_allowed", "POST required.");
    return;
  }
  try {
    const user = await requireUser(req, deps, true);
    const outcome = await deps.reserve(user.uid, deps.now());
    res.status(200).json({
      reservationId: outcome.id,
      created: outcome.created,
      retake: outcome.retake,
      completed: outcome.ledger.completedIds.length,
      remaining: outcome.remaining,
    });
  } catch (error) {
    const gate = asGateError(error);
    if (gate) {
      sendGate(res, gate);
      return;
    }
    sendFailure(res, 500, "reserve_failed", "We couldn't start this interview. Try again.");
  }
}

export async function handleCompleteInterview(req: IncomingHttp, res: JsonResponse, deps: InterviewHttpDeps): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    sendFailure(res, 405, "method_not_allowed", "POST required.");
    return;
  }
  try {
    const user = await requireUser(req, deps, true);
    const body = req.body && typeof req.body === "object" ? req.body as { reservationId?: unknown } : {};
    const reservationId = typeof body.reservationId === "string" ? body.reservationId : null;
    const result = await deps.complete(user.uid, reservationId, deps.now());
    res.status(200).json(result);
  } catch (error) {
    const gate = asGateError(error);
    if (gate) {
      sendGate(res, gate);
      return;
    }
    sendFailure(res, 500, "complete_failed", "We couldn't save this interview. Try again.");
  }
}
