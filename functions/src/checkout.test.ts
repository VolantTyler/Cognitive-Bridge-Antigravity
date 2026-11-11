import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHECKOUT_CONSENT_REQUIRED,
  TERMS_VERSION,
  buildCheckoutSessionCreateParams,
  checkoutIdempotencyKey,
  isStripeTestKey,
  loadCheckoutConfig,
  termsAcceptanceMessage,
  termsUrlForBase,
} from "./checkoutConfig";
import { createFirestoreBillingStore } from "./checkoutStore";
import { handleStripeEvent, restorePurchaseForUser } from "./checkoutEvents";
import {
  handleCheckoutStatus,
  handleCreateCheckout,
  handleStripeWebhook,
  CheckoutHttpDeps,
} from "./checkoutHttp";
import {
  BillingStore,
  CheckoutConsent,
  CheckoutRecord,
  EntitlementState,
  EntitlementStamps,
} from "./checkoutTypes";
import { GateError } from "./gate";

const testKey = ["sk", "test", "example"].join("_");
const liveKey = ["sk", "live", "example"].join("_");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

class MemoryStore implements BillingStore {
  events = new Map<string, { processed: boolean }>();
  entitlements = new Map<string, EntitlementState>();
  sessions = new Map<string, CheckoutRecord>();
  consents: CheckoutConsent[] = [];
  stamps = new Map<string, EntitlementStamps>();
  entitlementWrites = 0;

  async claimEvent(id: string): Promise<"duplicate" | "start"> {
    const existing = this.events.get(id);
    if (existing?.processed) return "duplicate";
    if (!existing) this.events.set(id, { processed: false });
    return "start";
  }

  async completeEvent(id: string): Promise<void> {
    this.events.set(id, { processed: true });
  }

  async readEntitlement(uid: string): Promise<EntitlementState | null> {
    return this.entitlements.get(uid) ?? null;
  }

  async writeEntitlement(uid: string, state: EntitlementState, stamps: EntitlementStamps): Promise<void> {
    this.entitlementWrites += 1;
    this.entitlements.set(uid, state);
    this.stamps.set(uid, stamps);
  }

  async writeCheckoutConsent(consent: CheckoutConsent): Promise<void> {
    this.consents.push(consent);
  }

  async readCheckoutConsent(sessionId: string): Promise<CheckoutConsent | null> {
    return this.consents.find((consent) => consent.sessionId === sessionId) ?? null;
  }

  async writeCheckoutRecord(record: CheckoutRecord): Promise<void> {
    this.sessions.set(record.sessionId, record);
  }

  async readCheckoutRecord(sessionId: string): Promise<CheckoutRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async listCheckoutRecordsForUid(uid: string): Promise<CheckoutRecord[]> {
    return [...this.sessions.values()].filter((record) => record.uid === uid);
  }

  async findCheckoutByPaymentIntent(paymentIntentId: string): Promise<CheckoutRecord | null> {
    for (const record of this.sessions.values()) {
      if (record.paymentIntentId === paymentIntentId) return record;
    }
    return null;
  }
}

function acceptTerms(store: MemoryStore, sessionId = "cs_123", uid = "uid-1") {
  store.consents.push({
    uid,
    termsVersion: TERMS_VERSION,
    attested18OrOlder: true,
    sessionId,
  });
}

function logger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

function paidObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "cs_123",
    payment_status: "paid",
    client_reference_id: "uid-1",
    metadata: { uid: "uid-1" },
    customer_details: { address: { country: "US" } },
    consent: { terms_of_service: "accepted" },
    payment_intent: "pi_123",
    amount_total: 600,
    currency: "usd",
    ...overrides,
  };
}

function jsonRes() {
  return {
    code: 0,
    body: undefined as unknown,
    status(code: number) {
      this.code = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
    },
  };
}

describe("checkout session params", () => {
  it("builds one payment-mode session from the configured price", () => {
    const termsUrl = "https://cognitive-bridge-ai.web.app/terms";
    const params = buildCheckoutSessionCreateParams({
      uid: "uid-1",
      email: "ada@example.com",
      priceId: "price_from_env",
      baseUrl: "https://cognitive-bridge-ai.web.app",
      managedPayments: false,
      automaticTax: false,
    });
    expect(params).toMatchObject({
      mode: "payment",
      line_items: [{ price: "price_from_env", quantity: 1 }],
      client_reference_id: "uid-1",
      billing_address_collection: "required",
      customer_email: "ada@example.com",
      metadata: { uid: "uid-1" },
      payment_intent_data: { metadata: { uid: "uid-1" }, receipt_email: "ada@example.com" },
      success_url: "https://cognitive-bridge-ai.web.app/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://cognitive-bridge-ai.web.app/?checkout=cancel",
    });
    expect(params.custom_text.terms_of_service_acceptance.message).toBe(
      `I agree to the [Terms](${termsUrl}) and I am 18 or older.`
    );
    expect(params.custom_text.terms_of_service_acceptance.message).toBe(termsAcceptanceMessage(termsUrl));
    expect("shipping_address_collection" in params).toBe(false);
    expect("consent_collection" in params).toBe(false);
    expect(params.automatic_tax).toBeUndefined();
    expect(params.managed_payments).toEqual({ enabled: false });

    const other = buildCheckoutSessionCreateParams({
      uid: "uid-1",
      email: null,
      priceId: "price_other",
      baseUrl: "https://cognitive-bridge-ai.web.app/",
      managedPayments: false,
      automaticTax: true,
    });
    expect(other.line_items[0].price).toBe("price_other");
    expect(other.managed_payments).toEqual({ enabled: false });
    expect(other.automatic_tax).toEqual({ enabled: true });
    expect(other.customer_email).toBeUndefined();
  });

  it("builds Managed Payments params without receipt email, tax, or custom text", () => {
    const params = buildCheckoutSessionCreateParams({
      uid: "uid-1",
      email: "ada@example.com",
      priceId: "price_from_env",
      baseUrl: "https://cognitive-bridge-ai.web.app",
      managedPayments: true,
      automaticTax: true,
    });
    expect(params).toEqual({
      mode: "payment",
      line_items: [{ price: "price_from_env", quantity: 1 }],
      client_reference_id: "uid-1",
      billing_address_collection: "required",
      success_url: "https://cognitive-bridge-ai.web.app/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://cognitive-bridge-ai.web.app/?checkout=cancel",
      metadata: { uid: "uid-1" },
      payment_intent_data: { metadata: { uid: "uid-1" } },
      customer_email: "ada@example.com",
      managed_payments: { enabled: true },
    });
    expect(params.payment_intent_data.receipt_email).toBeUndefined();
    expect(params.automatic_tax).toBeUndefined();
    expect(params.custom_text).toBeUndefined();
    expect("consent_collection" in params).toBe(false);
  });

  it("refuses a non-https terms URL and live secret keys", () => {
    expect(() => termsUrlForBase("http://localhost:3000")).toThrow(GateError);
    expect(isStripeTestKey(testKey)).toBe(true);
    expect(isStripeTestKey(liveKey)).toBe(false);
    expect(isStripeTestKey("")).toBe(false);
    expect(checkoutIdempotencyKey("uid-1", 15_000)).toBe(checkoutIdempotencyKey("uid-1", 29_999));
    expect(checkoutIdempotencyKey("uid-1", 15_000)).not.toBe(checkoutIdempotencyKey("uid-1", 30_000));
  });

  it("does not commit Stripe secret values", () => {
    const sourceDir = path.dirname(fileURLToPath(import.meta.url));
    const files = walk(sourceDir);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/sk_live_[A-Za-z0-9]/);
      expect(text, file).not.toMatch(/sk_test_[A-Za-z0-9]/);
      expect(text, file).not.toMatch(/whsec_[A-Za-z0-9]/);
    }
    const index = readFileSync(path.join(sourceDir, "index.ts"), "utf8");
    expect(index).toContain('defineSecret("STRIPE_SECRET_KEY")');
    expect(index).toContain('defineSecret("STRIPE_WEBHOOK_SECRET")');
    const copy = readFileSync(path.resolve(sourceDir, "../../src/constants/paywallCopy.ts"), "utf8");
    expect(copy).toContain(`export const TERMS_VERSION = "${TERMS_VERSION}"`);
  });
});

describe("stripe webhook", () => {
  async function deliver(
    store: MemoryStore,
    type: string,
    object: Record<string, unknown>,
    id: string,
    refunds = vi.fn(async () => undefined),
    logs = logger()
  ) {
    await handleStripeEvent({ id, type, data: { object } }, { store, logger: logs, refunds: { refundNonUs: refunds } });
    return { refunds, logs };
  }

  it("rejects a bad signature before writing anything", async () => {
    const store = new MemoryStore();
    const res = jsonRes();
    const deps = {
      config: () => ({
        priceId: "price_from_env",
        baseUrl: "https://cognitive-bridge-ai.web.app",
        paymentsEnabled: true,
        managedPayments: false,
        automaticTax: false,
      }),
      secretKey: () => testKey,
      webhookSecret: () => "webhook-secret",
      store,
      verifyIdToken: async () => ({ uid: "uid-1", email: null, email_verified: true }),
      verifyAppCheck: async () => undefined,
      enforceAppCheck: () => false,
      now: () => 0,
      gateway: () => {
        throw new Error("gateway should not be called");
      },
      logger: logger(),
      constructEvent: () => {
        throw new Error("bad signature for sig_header_value");
      },
    } satisfies CheckoutHttpDeps;
    await handleStripeWebhook({
      method: "POST",
      rawBody: Buffer.from("{}"),
      headers: { "stripe-signature": "sig_header_value" },
    }, res, deps);
    expect(res.code).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("sig_header_value");
    expect(store.entitlementWrites).toBe(0);
    expect(store.events.size).toBe(0);
  });

  it("ignores a duplicate event after the entitlement is written", async () => {
    const store = new MemoryStore();
    const logs = logger();
    acceptTerms(store);
    await deliver(store, "checkout.session.completed", paidObject(), "evt_1", vi.fn(), logs);
    await deliver(store, "checkout.session.completed", paidObject(), "evt_1", vi.fn(), logs);
    expect(store.entitlementWrites).toBe(1);
    expect(store.entitlements.get("uid-1")?.paid).toBe(true);
    expect(store.entitlements.get("uid-1")).toMatchObject({
      provider: "stripe",
      sessionId: "cs_123",
      paymentIntentId: "pi_123",
      amount: 600,
      currency: "usd",
      interviewsAllowed: 2,
    });
    expect(logs.info).toHaveBeenCalledWith("duplicate ignored");
    expect(logs.info).toHaveBeenCalledWith("analytics checkout_completed");
    const analytics = logs.info.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith("analytics "));
    expect(analytics.join(" ")).not.toMatch(/uid|@|uid-1/);
  });

  it("does not grant access without a stored consent record", async () => {
    const store = new MemoryStore();
    const refunds = vi.fn(async () => undefined);
    await deliver(store, "checkout.session.completed", paidObject({
      consent: { terms_of_service: "accepted" },
    }), "evt_terms", refunds);
    expect(store.entitlementWrites).toBe(0);
    expect(refunds).not.toHaveBeenCalled();
    expect(store.sessions.get("cs_123")?.outcome).toBe("terms_not_accepted");

    acceptTerms(store);
    await deliver(store, "checkout.session.completed", paidObject({
      consent: { terms_of_service: null },
    }), "evt_terms_recorded");
    expect(store.entitlements.get("uid-1")?.paid).toBe(true);
  });

  it("refunds a non-US billing country and does not grant access", async () => {
    const store = new MemoryStore();
    const refunds = vi.fn(async () => undefined);
    await deliver(store, "checkout.session.completed", paidObject({
      customer_details: { address: { country: "CA" } },
    }), "evt_ca", refunds);
    expect(refunds).toHaveBeenCalledWith("pi_123", "cs_123");
    expect(store.entitlementWrites).toBe(0);
    expect(store.sessions.get("cs_123")).toMatchObject({
      outcome: "non_us_refunded",
      manualRefundRequired: false,
      billingCountry: "CA",
    });
  });

  it("flags a manual refund when the refund call fails", async () => {
    const store = new MemoryStore();
    const logs = logger();
    const refunds = vi.fn(async () => {
      throw Object.assign(new Error("stripe down"), { code: "api_error" });
    });
    await deliver(store, "checkout.session.completed", paidObject({
      customer_details: { address: { country: "GB" } },
    }), "evt_gb", refunds, logs);
    expect(store.entitlementWrites).toBe(0);
    expect(store.sessions.get("cs_123")).toMatchObject({
      outcome: "non_us_refund_failed",
      manualRefundRequired: true,
    });
    expect(logs.error).toHaveBeenCalledWith("non_us_refund_failed session=cs_123 uid=uid-1");
  });

  it("revokes access on a full refund unless another paid session remains", async () => {
    const store = new MemoryStore();
    acceptTerms(store);
    acceptTerms(store, "cs_second");
    acceptTerms(store, "cs_third");
    await deliver(store, "checkout.session.completed", paidObject(), "evt_pay");
    await deliver(store, "charge.refunded", {
      payment_intent: "pi_123",
      amount: 600,
      amount_refunded: 600,
      refunded: true,
      metadata: { uid: "uid-1" },
    }, "evt_refund");
    expect(store.entitlements.get("uid-1")?.paid).toBe(false);
    expect(store.stamps.get("uid-1")?.refundedAt).toBe(true);

    await deliver(store, "checkout.session.completed", paidObject({
      id: "cs_second",
      payment_intent: "pi_second",
    }), "evt_second");
    await deliver(store, "checkout.session.completed", paidObject({
      id: "cs_third",
      payment_intent: "pi_third",
    }), "evt_third");
    await deliver(store, "charge.refunded", {
      payment_intent: "pi_second",
      amount: 600,
      amount_refunded: 600,
      refunded: true,
      metadata: { uid: "uid-1" },
    }, "evt_refund_one");
    expect(store.entitlements.get("uid-1")?.paid).toBe(true);
    expect(store.entitlements.get("uid-1")?.activePaymentIntentIds).toEqual(["pi_third"]);
  });

  it("does not revoke access on a partial refund", async () => {
    const store = new MemoryStore();
    const logs = logger();
    acceptTerms(store);
    await deliver(store, "checkout.session.completed", paidObject(), "evt_pay");
    await deliver(store, "charge.refunded", {
      payment_intent: "pi_123",
      amount: 600,
      amount_refunded: 100,
      refunded: false,
      metadata: { uid: "uid-1" },
    }, "evt_partial", vi.fn(), logs);
    expect(store.entitlements.get("uid-1")?.paid).toBe(true);
    expect(logs.info).toHaveBeenCalledWith("partial_refund_ignored");
  });

  it("logs a dispute when it opens and revokes access only when it is lost", async () => {
    const store = new MemoryStore();
    const logs = logger();
    acceptTerms(store);
    await deliver(store, "checkout.session.completed", paidObject(), "evt_pay");
    await deliver(store, "charge.dispute.created", {
      id: "dp_1",
      status: "needs_response",
      payment_intent: "pi_123",
    }, "evt_open", vi.fn(), logs);
    expect(store.entitlements.get("uid-1")?.paid).toBe(true);
    expect(store.entitlements.get("uid-1")?.disputeStatus).toBe("open");
    expect(logs.error).toHaveBeenCalledWith("dispute_opened dispute=dp_1 uid=uid-1");
    expect(logs.info).toHaveBeenCalledWith("analytics dispute_opened");
    const analytics = logs.info.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith("analytics "));
    expect(analytics.join(" ")).not.toMatch(/uid=|@|uid-1/);

    await deliver(store, "charge.dispute.closed", {
      id: "dp_1",
      status: "won",
      payment_intent: "pi_123",
    }, "evt_won");
    expect(store.entitlements.get("uid-1")?.paid).toBe(true);

    await deliver(store, "charge.dispute.closed", {
      id: "dp_1",
      status: "lost",
      payment_intent: "pi_123",
    }, "evt_lost");
    expect(store.entitlements.get("uid-1")?.paid).toBe(false);
    expect(store.entitlements.get("uid-1")?.disputeStatus).toBe("lost");
  });

  it("sets the manual refund flag when a non-US refund later fails", async () => {
    const store = new MemoryStore();
    await deliver(store, "checkout.session.completed", paidObject({
      customer_details: { address: { country: "FR" } },
    }), "evt_fr");
    await deliver(store, "refund.failed", {
      payment_intent: "pi_123",
      metadata: { reason: "non_us_billing" },
    }, "evt_fail");
    expect(store.sessions.get("cs_123")).toMatchObject({
      outcome: "non_us_refund_failed",
      manualRefundRequired: true,
    });
    expect(store.entitlements.has("uid-1")).toBe(false);
  });
});

describe("createCheckout", () => {
  function deps(store: MemoryStore, overrides: Partial<CheckoutHttpDeps> = {}): CheckoutHttpDeps {
    return {
      config: () => ({
        priceId: "price_from_env",
        baseUrl: "https://cognitive-bridge-ai.web.app",
        paymentsEnabled: true,
        managedPayments: false,
        automaticTax: false,
      }),
      secretKey: () => testKey,
      webhookSecret: () => "webhook-secret",
      store,
      verifyIdToken: async () => ({ uid: "uid-1", email: "ada@example.com", email_verified: true }),
      verifyAppCheck: async () => undefined,
      enforceAppCheck: () => false,
      now: () => 20_000,
      gateway: () => ({
        createSession: async () => ({ id: "cs_123", url: "https://checkout.stripe.com/c/pay/cs_123" }),
        refundNonUs: async () => undefined,
        retrieveSession: async () => null,
        findSucceededSessionIds: async () => [],
      }),
      logger: logger(),
      ...overrides,
    };
  }

  it("requires a verified email and refuses an existing entitlement", async () => {
    const store = new MemoryStore();
    const missing = jsonRes();
    await handleCreateCheckout({ method: "POST" }, missing, deps(store, {
      verifyIdToken: async () => {
        throw new Error("should not verify");
      },
    }));
    expect(missing.code).toBe(401);

    const unverified = jsonRes();
    await handleCreateCheckout({
      method: "POST",
      headers: { authorization: "Bearer token" },
    }, unverified, deps(store, {
      verifyIdToken: async () => ({ uid: "uid-1", email: "ada@example.com", email_verified: false }),
    }));
    expect(unverified.code).toBe(403);
    expect(unverified.body).toMatchObject({ code: "email_not_verified" });

    store.entitlements.set("uid-1", {
      paid: true,
      provider: "stripe",
      sessionId: "cs_old",
      paymentIntentId: "pi_old",
      amount: 600,
      currency: "usd",
      interviewsAllowed: 2,
      activePaymentIntentIds: ["pi_old"],
      disputeStatus: null,
      disputeId: null,
    });
    const conflict = jsonRes();
    await handleCreateCheckout({
      method: "POST",
      headers: { authorization: "Bearer token" },
    }, conflict, deps(store));
    expect(conflict.code).toBe(409);
    expect(conflict.body).toMatchObject({ code: "already_entitled" });
  });

  it("returns a Checkout URL and records the open session", async () => {
    const store = new MemoryStore();
    let seen: unknown;
    let idempotencyKey = "";
    const res = jsonRes();
    await handleCreateCheckout({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { termsAccepted: true, termsVersion: TERMS_VERSION },
    }, res, deps(store, {
      gateway: () => ({
        createSession: async (params, key) => {
          seen = params;
          idempotencyKey = key;
          return { id: "cs_123", url: "https://checkout.stripe.com/c/pay/cs_123" };
        },
        refundNonUs: async () => undefined,
        retrieveSession: async () => null,
        findSucceededSessionIds: async () => [],
      }),
    }));
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_123" });
    expect(idempotencyKey).toBe("cb-checkout-uid-1-1");
    expect(seen).toMatchObject({
      mode: "payment",
      billing_address_collection: "required",
      line_items: [{ price: "price_from_env", quantity: 1 }],
      managed_payments: { enabled: false },
      custom_text: {
        terms_of_service_acceptance: {
          message: "I agree to the [Terms](https://cognitive-bridge-ai.web.app/terms) and I am 18 or older.",
        },
      },
    });
    expect(store.sessions.get("cs_123")?.outcome).toBe("open");
    expect(store.consents).toEqual([{
      uid: "uid-1",
      termsVersion: TERMS_VERSION,
      attested18OrOlder: true,
      sessionId: "cs_123",
    }]);
  });

  it("rejects checkout without terms consent and does not call Stripe", async () => {
    const store = new MemoryStore();
    const createSession = vi.fn();
    const res = jsonRes();
    await handleCreateCheckout({
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { termsAccepted: false },
    }, res, deps(store, {
      gateway: () => ({
        createSession,
        refundNonUs: async () => undefined,
        retrieveSession: async () => null,
        findSucceededSessionIds: async () => [],
      }),
    }));
    expect(res.code).toBe(400);
    expect(res.body).toMatchObject({
      code: "terms_not_accepted",
      error: CHECKOUT_CONSENT_REQUIRED,
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(store.consents).toEqual([]);

    const missing = jsonRes();
    await handleCreateCheckout({
      method: "POST",
      headers: { authorization: "Bearer token" },
    }, missing, deps(store));
    expect(missing.code).toBe(400);
    expect(missing.body).toMatchObject({ error: CHECKOUT_CONSENT_REQUIRED });
  });

  it("writes the consent record with a server timestamp", async () => {
    const written = new Map<string, Record<string, unknown>>();
    const db = {
      collection(name: string) {
        return {
          doc(id: string) {
            return {
              async set(data: Record<string, unknown>) {
                written.set(`${name}/${id}`, data);
              },
            };
          },
        };
      },
    };
    const store = createFirestoreBillingStore(async () => db as never);
    await store.writeCheckoutConsent({
      uid: "uid-1",
      termsVersion: TERMS_VERSION,
      attested18OrOlder: true,
      sessionId: "cs_123",
    });
    const saved = written.get("checkout_consents/cs_123");
    expect(saved).toMatchObject({
      uid: "uid-1",
      termsVersion: TERMS_VERSION,
      attested18OrOlder: true,
      sessionId: "cs_123",
    });
    expect(saved?.acceptedAt).toBeTruthy();
    expect(typeof saved?.acceptedAt).not.toBe("string");
    expect(typeof saved?.acceptedAt).not.toBe("number");
  });

  it("returns 503 when the price id is empty and does not call Stripe", async () => {
    const store = new MemoryStore();
    const createSession = vi.fn();
    const res = jsonRes();
    await handleCreateCheckout({
      method: "POST",
      headers: { authorization: "Bearer token" },
    }, res, deps(store, {
      config: () => ({
        priceId: "",
        baseUrl: "https://cognitive-bridge-ai.web.app",
        paymentsEnabled: true,
        managedPayments: false,
        automaticTax: false,
      }),
      gateway: () => ({
        createSession,
        refundNonUs: async () => undefined,
        retrieveSession: async () => null,
        findSucceededSessionIds: async () => [],
      }),
    }));
    expect(res.code).toBe(503);
    expect(res.body).toMatchObject({ code: "payments_disabled" });
    expect(createSession).not.toHaveBeenCalled();
    expect(loadCheckoutConfig({
      STRIPE_PRICE_ID: "",
      PAYMENTS_ENABLED: "true",
    })).toMatchObject({ priceId: "", paymentsEnabled: true });
  });

  it("refuses a live secret key", async () => {
    const store = new MemoryStore();
    const res = jsonRes();
    const createSession = vi.fn();
    await handleCreateCheckout({
      method: "POST",
      headers: { authorization: "Bearer token" },
    }, res, deps(store, {
      secretKey: () => liveKey,
      gateway: () => ({
        createSession,
        refundNonUs: async () => undefined,
        retrieveSession: async () => null,
        findSucceededSessionIds: async () => [],
      }),
    }));
    expect(res.code).toBe(503);
    expect(res.body).toMatchObject({ code: "test_mode_only" });
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("checkout status and restore", () => {
  it("reports a failed non-US refund without treating it as paid", async () => {
    const store = new MemoryStore();
    store.sessions.set("cs_123", {
      sessionId: "cs_123",
      uid: "uid-1",
      paymentIntentId: "pi_123",
      billingCountry: "CA",
      termsAccepted: true,
      outcome: "non_us_refund_failed",
      manualRefundRequired: true,
      needsManualReview: true,
      amount: 600,
      currency: "usd",
    });
    const res = jsonRes();
    await handleCheckoutStatus({
      method: "GET",
      headers: { authorization: "Bearer token" },
      query: { session_id: "cs_123" },
    }, res, {
      config: () => ({
        priceId: "",
        baseUrl: "https://cognitive-bridge-ai.web.app",
        paymentsEnabled: false,
        managedPayments: false,
        automaticTax: false,
      }),
      secretKey: () => testKey,
      webhookSecret: () => "webhook-secret",
      store,
      verifyIdToken: async () => ({ uid: "uid-1", email: "ada@example.com", email_verified: true }),
      verifyAppCheck: async () => undefined,
      enforceAppCheck: () => false,
      now: () => 0,
      gateway: () => {
        throw new Error("no stripe");
      },
      logger: logger(),
    });
    expect(res.code).toBe(200);
    expect(res.body).toEqual({ status: "non_us_refund_failed" });
  });

  it("restores a paid US session the webhook missed", async () => {
    const store = new MemoryStore();
    store.sessions.set("cs_123", {
      sessionId: "cs_123",
      uid: "uid-1",
      paymentIntentId: null,
      billingCountry: null,
      termsAccepted: false,
      outcome: "open",
      manualRefundRequired: false,
      needsManualReview: false,
      amount: null,
      currency: null,
    });
    acceptTerms(store);
    const result = await restorePurchaseForUser("uid-1", {
      store,
      logger: logger(),
      refunds: { refundNonUs: async () => undefined },
      sessions: {
        retrieveSession: async () => ({
          id: "cs_123",
          paymentStatus: "paid",
          uid: "uid-1",
          uidConflict: false,
          countryKind: "US",
          country: "US",
          termsOfService: "accepted",
          paymentIntentId: "pi_123",
          amountTotal: 600,
          currency: "usd",
        }),
        findSucceededSessionIds: async () => [],
      },
    });
    expect(result.restored).toBe(true);
    expect(store.entitlements.get("uid-1")?.paid).toBe(true);
  });
});
