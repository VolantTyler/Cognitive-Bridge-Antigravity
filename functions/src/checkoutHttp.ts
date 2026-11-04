import { requireEmailVerified, verifyBearerToken, TokenVerifier, asGateError } from "./auth";
import { appCheckError, readHeader, GateError } from "./gate";
import {
  CheckoutConfig,
  assertStripeTestKey,
  buildCheckoutSessionCreateParams,
  checkoutIdempotencyKey,
  isStripeTestKey,
} from "./checkoutConfig";
import { handleStripeEvent, restorePurchaseForUser, EventDeps } from "./checkoutEvents";
import { BillingStore, CheckoutLogger, clientStatusForRecord } from "./checkoutTypes";
import { StripeGateway, constructStripeEvent } from "./stripeGateway";

export interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

export interface IncomingHttp {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  header?: (name: string) => string | undefined;
  rawBody?: Buffer | string;
  query?: Record<string, unknown>;
}

export interface CheckoutHttpDeps {
  config: () => CheckoutConfig;
  secretKey: () => string;
  webhookSecret: () => string;
  store: BillingStore;
  verifyIdToken: TokenVerifier;
  verifyAppCheck: (token: string) => Promise<void>;
  enforceAppCheck: () => boolean;
  now: () => number;
  gateway: () => StripeGateway;
  logger: CheckoutLogger;
  constructEvent?: typeof constructStripeEvent;
}

const consoleLogger: CheckoutLogger = {
  info(message) {
    console.info(message);
  },
  error(message) {
    console.error(message);
  },
};

export function productionCheckoutLogger(): CheckoutLogger {
  return consoleLogger;
}

function sendGate(res: JsonResponse, error: GateError): void {
  res.status(error.status).json({ error: error.message, code: error.code });
}

function sendFailure(res: JsonResponse, status: number, code: string, error: string): void {
  res.status(status).json({ error, code });
}

async function requireCheckoutUser(req: IncomingHttp, deps: CheckoutHttpDeps) {
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
  return requireEmailVerified(user);
}

function queryString(req: IncomingHttp, name: string): string | null {
  const value = req.query?.[name];
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : null;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function eventDeps(deps: CheckoutHttpDeps, refunds: EventDeps["refunds"]): EventDeps {
  return { store: deps.store, logger: deps.logger, refunds };
}

export async function handleCreateCheckout(
  req: IncomingHttp,
  res: JsonResponse,
  deps: CheckoutHttpDeps
): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    sendFailure(res, 405, "method_not_allowed", "POST required.");
    return;
  }
  try {
    const user = await requireCheckoutUser(req, deps);
    const config = deps.config();
    if (!config.paymentsEnabled || !config.priceId) {
      throw new GateError(503, "payments_disabled", "Checkout is not open yet.");
    }
    assertStripeTestKey(deps.secretKey());
    const entitlement = await deps.store.readEntitlement(user.uid);
    if (entitlement?.paid) {
      throw new GateError(409, "already_entitled", "This account already has access.");
    }
    const params = buildCheckoutSessionCreateParams({
      uid: user.uid,
      email: user.email,
      priceId: config.priceId,
      baseUrl: config.baseUrl,
      managedPayments: config.managedPayments,
      automaticTax: config.automaticTax,
    });
    const session = await deps.gateway().createSession(params, checkoutIdempotencyKey(user.uid, deps.now()));
    if (!session.url) {
      throw new GateError(502, "checkout_unavailable", "Couldn't open checkout. You haven't been charged.");
    }
    await deps.store.writeCheckoutRecord({
      sessionId: session.id,
      uid: user.uid,
      paymentIntentId: null,
      billingCountry: null,
      termsAccepted: false,
      outcome: "open",
      manualRefundRequired: false,
      needsManualReview: false,
      amount: null,
      currency: null,
    });
    res.status(200).json({ url: session.url });
  } catch (error) {
    const gate = asGateError(error);
    if (gate) {
      sendGate(res, gate);
      return;
    }
    deps.logger.error("createCheckout failed");
    sendFailure(res, 502, "checkout_failed", "Couldn't open checkout. You haven't been charged.");
  }
}

export async function handleRestorePurchase(
  req: IncomingHttp,
  res: JsonResponse,
  deps: CheckoutHttpDeps
): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    sendFailure(res, 405, "method_not_allowed", "POST required.");
    return;
  }
  try {
    const user = await requireCheckoutUser(req, deps);
    assertStripeTestKey(deps.secretKey());
    const gateway = deps.gateway();
    const result = await restorePurchaseForUser(user.uid, {
      ...eventDeps(deps, gateway),
      sessions: gateway,
    });
    res.status(200).json(result);
  } catch (error) {
    const gate = asGateError(error);
    if (gate) {
      sendGate(res, gate);
      return;
    }
    deps.logger.error("restorePurchase failed");
    sendFailure(res, 500, "restore_failed", "We couldn't confirm your access.");
  }
}

export async function handleCheckoutStatus(
  req: IncomingHttp,
  res: JsonResponse,
  deps: CheckoutHttpDeps
): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "GET") {
    sendFailure(res, 405, "method_not_allowed", "GET required.");
    return;
  }
  try {
    const user = await requireCheckoutUser(req, deps);
    const sessionId = queryString(req, "session_id");
    if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      sendFailure(res, 400, "bad_request", "Missing checkout session.");
      return;
    }
    const record = await deps.store.readCheckoutRecord(sessionId);
    if (record && record.uid !== user.uid) {
      sendFailure(res, 404, "not_found", "We couldn't match this payment to your account.");
      return;
    }
    const entitlement = await deps.store.readEntitlement(user.uid);
    const sameSession = entitlement?.sessionId === sessionId && entitlement.paid;
    res.status(200).json({
      status: clientStatusForRecord(record, sameSession),
    });
  } catch (error) {
    const gate = asGateError(error);
    if (gate) {
      sendGate(res, gate);
      return;
    }
    deps.logger.error("checkoutStatus failed");
    sendFailure(res, 500, "status_failed", "We couldn't confirm your access.");
  }
}

export async function handleStripeWebhook(
  req: IncomingHttp,
  res: JsonResponse,
  deps: CheckoutHttpDeps
): Promise<void> {
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    sendFailure(res, 405, "method_not_allowed", "POST required.");
    return;
  }
  const signature = readHeader(req, "stripe-signature");
  if (!signature || !req.rawBody) {
    sendFailure(res, 400, "invalid_signature", "Invalid Stripe signature.");
    return;
  }
  let event: { id: string; type: string; data: { object: Record<string, unknown> } };
  try {
    const construct = deps.constructEvent ?? constructStripeEvent;
    event = construct(req.rawBody, signature, deps.webhookSecret());
  } catch {
    sendFailure(res, 400, "invalid_signature", "Invalid Stripe signature.");
    return;
  }
  try {
    const secretKey = deps.secretKey();
    const gateway = isStripeTestKey(secretKey) ? deps.gateway() : null;
    await handleStripeEvent(event, eventDeps(deps, {
      async refundNonUs(paymentIntentId, sessionId) {
        if (!gateway) {
          const error = new Error("not_test_mode");
          throw Object.assign(error, { code: "not_test_mode" });
        }
        await gateway.refundNonUs(paymentIntentId, sessionId);
      },
    }));
    res.status(200).json({ received: true });
  } catch {
    sendFailure(res, 500, "webhook_failed", "Webhook handler failed.");
  }
}
