import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
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
  productionCheckoutLogger,
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

  const openFailed = "Couldn't open checkout. You haven't been charged.";

  function consentedPost() {
    return {
      method: "POST" as const,
      headers: { authorization: "Bearer token" },
      body: { termsAccepted: true, termsVersion: TERMS_VERSION },
    };
  }

  function secretFree(serialized: string) {
    expect(serialized).not.toContain("ada@example.com");
    expect(serialized).not.toContain("price_from_env");
    expect(serialized).not.toContain("uid-1");
    expect(serialized).not.toContain("secret-canary");
    expect(serialized).not.toContain("pm_secret");
    expect(serialized).not.toContain("4242424242424242");
    expect(serialized).not.toContain("cognitive-bridge-ai.web.app");
  }

  it("logs a Stripe invalid request without secrets and returns stripe_invalid_request", async () => {
    const store = new MemoryStore();
    const logs = logger();
    let seen: Record<string, unknown> | undefined;
    const stripeError = new Stripe.errors.StripeInvalidRequestError({
      message: "Invalid request",
      type: "invalid_request_error",
      code: "resource_missing",
      param: "line_items[0][price]",
      statusCode: 400,
      requestId: "req_test_123",
      headers: { Authorization: "Bearer secret-canary" },
      payment_method: { id: "pm_secret" } as never,
    });
    Object.assign(stripeError, { rawCard: "4242424242424242" });
    const res = jsonRes();
    await handleCreateCheckout(consentedPost(), res, deps(store, {
      logger: logs,
      gateway: () => ({
        createSession: async (params) => {
          seen = params as unknown as Record<string, unknown>;
          throw stripeError;
        },
        refundNonUs: async () => undefined,
        retrieveSession: async () => null,
        findSucceededSessionIds: async () => [],
      }),
    }));
    expect(res.code).toBe(502);
    expect(res.body).toEqual({ error: openFailed, code: "stripe_invalid_request" });
    expect(logs.error).toHaveBeenCalledTimes(1);
    const details = logs.error.mock.calls[0][1] as Record<string, unknown>;
    expect(logs.error.mock.calls[0][0]).toBe("createCheckout failed");
    expect(details.branch).toBe("managedPayments off");
    expect(details.paramKeys).toEqual(Object.keys(seen ?? {}).sort());
    expect(details.paramKeys).toContain("customer_email");
    expect(details.paramKeys).toContain("custom_text");
    expect(details.paramKeys).not.toContain("automatic_tax");
    expect(details.stripe).toEqual({
      type: "StripeInvalidRequestError",
      code: "resource_missing",
      param: "line_items[0][price]",
      statusCode: 400,
      message: "Invalid request",
      requestId: "req_test_123",
    });
    expect(details.stripe).not.toHaveProperty("decline_code");
    expect(details).not.toHaveProperty("error");
    secretFree(JSON.stringify(details));
    secretFree(JSON.stringify(res.body));
    expect(JSON.stringify(res.body)).not.toContain("resource_missing");
    expect(JSON.stringify(res.body)).not.toContain("req_test_123");
    expect(store.consents).toEqual([]);
    expect(store.sessions.size).toBe(0);
  });

  it("maps Stripe error types to short codes and logs decline_code only when set", async () => {
    const cases: Array<{ error: unknown; code: string; decline?: string }> = [
      {
        error: new Stripe.errors.StripeCardError({
          message: "Your card was declined",
          type: "card_error",
          code: "card_declined",
          decline_code: "insufficient_funds",
          statusCode: 402,
          requestId: "req_card",
        }),
        code: "stripe_card",
        decline: "insufficient_funds",
      },
      {
        error: new Stripe.errors.StripeCardError({
          message: "Card error",
          type: "card_error",
          code: "card_declined",
          statusCode: 402,
          requestId: "req_card_bare",
        }),
        code: "stripe_card",
      },
      {
        error: new Stripe.errors.StripeRateLimitError({
          message: "Too many requests",
          type: "rate_limit_error",
          statusCode: 429,
          requestId: "req_rate",
        }),
        code: "stripe_rate_limit",
      },
      {
        error: new Stripe.errors.StripeAuthenticationError({
          message: "Invalid API key",
          type: "authentication_error",
          statusCode: 401,
          requestId: "req_auth",
        }),
        code: "stripe_authentication",
      },
      {
        error: new Stripe.errors.StripeAPIError({
          message: "Stripe unavailable",
          type: "api_error",
          statusCode: 500,
          requestId: "req_api",
        }),
        code: "stripe_api",
      },
      {
        error: new Stripe.errors.StripeConnectionError({ message: "Network down" }),
        code: "stripe_connection",
      },
      {
        error: new Stripe.errors.StripeIdempotencyError({
          message: "Keys differ",
          type: "idempotency_error",
          statusCode: 400,
          requestId: "req_idem",
        }),
        code: "stripe_idempotency",
      },
      {
        error: new Stripe.errors.StripePermissionError({
          message: "Not allowed",
          statusCode: 403,
          requestId: "req_perm",
        }),
        code: "stripe_permission",
      },
      {
        error: Object.assign(new Error("future"), {
          type: "StripeFutureError",
          raw: { apiKey: "secret-canary" },
        }),
        code: "stripe_error",
      },
    ];

    for (const item of cases) {
      const store = new MemoryStore();
      const logs = logger();
      const res = jsonRes();
      await handleCreateCheckout(consentedPost(), res, deps(store, {
        logger: logs,
        gateway: () => ({
          createSession: async () => {
            throw item.error;
          },
          refundNonUs: async () => undefined,
          retrieveSession: async () => null,
          findSucceededSessionIds: async () => [],
        }),
      }));
      expect(res.code).toBe(502);
      expect(res.body).toEqual({ error: openFailed, code: item.code });
      const details = logs.error.mock.calls[0][1] as { branch: string; stripe: Record<string, unknown> };
      expect(details.branch).toBe("managedPayments off");
      expect(typeof details.stripe.message).toBe("string");
      if (item.decline) expect(details.stripe.decline_code).toBe(item.decline);
      else expect(details.stripe).not.toHaveProperty("decline_code");
      secretFree(JSON.stringify(details));
      secretFree(JSON.stringify(res.body));
    }
  });

  it("redacts a key echoed in a Stripe message before logging it", async () => {
    const leaked = ["sk", "test", "leakedvalue"].join("_");
    const store = new MemoryStore();
    const logs = logger();
    const res = jsonRes();
    await handleCreateCheckout(consentedPost(), res, deps(store, {
      logger: logs,
      gateway: () => ({
        createSession: async () => {
          throw new Stripe.errors.StripeAuthenticationError({
            message: `Invalid API Key provided: ${leaked}`,
            type: "authentication_error",
            statusCode: 401,
            requestId: "req_auth_key",
          });
        },
        refundNonUs: async () => undefined,
        retrieveSession: async () => null,
        findSucceededSessionIds: async () => [],
      }),
    }));
    expect(res.body).toEqual({ error: openFailed, code: "stripe_authentication" });
    const details = logs.error.mock.calls[0][1] as { stripe: { message: string } };
    expect(details.stripe.message).toBe("Invalid API Key provided: [redacted]");
    expect(JSON.stringify(details)).not.toContain(leaked);
    expect(JSON.stringify(res.body)).not.toContain(leaked);
    expect(JSON.stringify(res.body)).not.toContain("Invalid API Key");
  });

  it("logs name, message, and stack for a non-Stripe failure", async () => {
    const store = new MemoryStore();
    const logs = logger();
    const failure = new Error("firestore unavailable");
    failure.name = "FirestoreError";
    const res = jsonRes();
    await handleCreateCheckout(consentedPost(), res, deps(store, {
      logger: logs,
      gateway: () => ({
        createSession: async () => {
          throw failure;
        },
        refundNonUs: async () => undefined,
        retrieveSession: async () => null,
        findSucceededSessionIds: async () => [],
      }),
    }));
    expect(res.body).toEqual({ error: openFailed, code: "checkout_failed" });
    const details = logs.error.mock.calls[0][1] as {
      branch: string;
      paramKeys: string[];
      error: { name: string; message: string; stack?: string };
    };
    expect(details.branch).toBe("managedPayments off");
    expect(details.paramKeys).toContain("mode");
    expect(details.error).toMatchObject({ name: "FirestoreError", message: "firestore unavailable" });
    expect(details.error.stack).toContain("firestore unavailable");
    expect(details).not.toHaveProperty("stripe");
    secretFree(JSON.stringify(details));
  });

  it("does not dump an unknown thrown value into the log", async () => {
    const store = new MemoryStore();
    const logs = logger();
    const res = jsonRes();
    await handleCreateCheckout(consentedPost(), res, deps(store, {
      logger: logs,
      gateway: () => ({
        createSession: async () => {
          throw { apiKey: "secret-canary", email: "ada@example.com" };
        },
        refundNonUs: async () => undefined,
        retrieveSession: async () => null,
        findSucceededSessionIds: async () => [],
      }),
    }));
    expect(res.body).toEqual({ error: openFailed, code: "checkout_failed" });
    const details = logs.error.mock.calls[0][1] as { error: { name: string; message: string } };
    expect(details.error).toEqual({ name: "Error", message: "Checkout failed" });
    secretFree(JSON.stringify(details));
  });

  it("logs the Managed Payments branch and param keys when that branch built the session", async () => {
    const store = new MemoryStore();
    const logs = logger();
    let seen: Record<string, unknown> | undefined;
    const res = jsonRes();
    await handleCreateCheckout(consentedPost(), res, deps(store, {
      logger: logs,
      config: () => ({
        priceId: "price_from_env",
        baseUrl: "https://cognitive-bridge-ai.web.app",
        paymentsEnabled: true,
        managedPayments: true,
        automaticTax: true,
      }),
      gateway: () => ({
        createSession: async (params) => {
          seen = params as unknown as Record<string, unknown>;
          throw new Stripe.errors.StripeInvalidRequestError({
            message: "Invalid request",
            type: "invalid_request_error",
            code: "parameter_unknown",
            param: "custom_text",
            statusCode: 400,
            requestId: "req_managed",
          });
        },
        refundNonUs: async () => undefined,
        retrieveSession: async () => null,
        findSucceededSessionIds: async () => [],
      }),
    }));
    expect(res.body).toEqual({ error: openFailed, code: "stripe_invalid_request" });
    const details = logs.error.mock.calls[0][1] as { branch: string; paramKeys: string[] };
    expect(details.branch).toBe("managedPayments on");
    expect(details.paramKeys).toEqual(Object.keys(seen ?? {}).sort());
    expect(details.paramKeys).toContain("managed_payments");
    expect(details.paramKeys).not.toContain("custom_text");
    expect(details.paramKeys).not.toContain("automatic_tax");
    expect(details.paramKeys).not.toContain("receipt_email");
    secretFree(JSON.stringify(details));
  });

  it("logs the same diagnostics when Stripe returns a session without a url", async () => {
    const store = new MemoryStore();
    const logs = logger();
    let seen: Record<string, unknown> | undefined;
    const res = jsonRes();
    await handleCreateCheckout(consentedPost(), res, deps(store, {
      logger: logs,
      gateway: () => ({
        createSession: async (params) => {
          seen = params as unknown as Record<string, unknown>;
          return { id: "cs_missing", url: null };
        },
        refundNonUs: async () => undefined,
        retrieveSession: async () => null,
        findSucceededSessionIds: async () => [],
      }),
    }));
    expect(res.code).toBe(502);
    expect(res.body).toEqual({ error: openFailed, code: "checkout_unavailable" });
    expect(logs.error).toHaveBeenCalledTimes(1);
    const details = logs.error.mock.calls[0][1] as {
      branch: string;
      paramKeys: string[];
      error: { name: string; message: string; stack?: string };
    };
    expect(logs.error.mock.calls[0][0]).toBe("createCheckout failed");
    expect(details.branch).toBe("managedPayments off");
    expect(details.paramKeys).toEqual(Object.keys(seen ?? {}).sort());
    expect(details.error.name).toBe("Error");
    expect(details.error.message).toBe("Checkout session missing url");
    expect(details.error.stack).toContain("Checkout session missing url");
    expect(details).not.toHaveProperty("stripe");
    secretFree(JSON.stringify(details));
    secretFree(JSON.stringify(res.body));
    expect(store.consents).toEqual([]);
    expect(store.sessions.size).toBe(0);
  });
});

describe("checkout failure logger", () => {
  it("writes structured failures as one JSON line and leaves other errors as text", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    productionCheckoutLogger().error("createCheckout failed", {
      branch: "managedPayments off",
      paramKeys: ["mode"],
      stripe: { type: "StripeInvalidRequestError", message: "Invalid request" },
    });
    expect(JSON.parse(String(spy.mock.calls[0][0]))).toEqual({
      message: "createCheckout failed",
      branch: "managedPayments off",
      paramKeys: ["mode"],
      stripe: { type: "StripeInvalidRequestError", message: "Invalid request" },
    });
    productionCheckoutLogger().error("restorePurchase failed");
    expect(spy.mock.calls[1][0]).toBe("restorePurchase failed");
    spy.mockRestore();
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
