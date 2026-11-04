import Stripe from "stripe";
import {
  CheckoutSessionCreateParams,
  assertStripeTestKey,
  isSafeStripeQueryUid,
} from "./checkoutConfig";
import { PaidSessionSnapshot, snapshotCheckoutSession } from "./checkoutTypes";

const API_VERSION: Stripe.LatestApiVersion = "2026-10-28.endive";

export interface CreatedCheckoutSession {
  id: string;
  url: string | null;
}

export interface StripeGateway {
  createSession(params: CheckoutSessionCreateParams, idempotencyKey: string): Promise<CreatedCheckoutSession>;
  refundNonUs(paymentIntentId: string, sessionId: string): Promise<void>;
  retrieveSession(sessionId: string): Promise<PaidSessionSnapshot | null>;
  findSucceededSessionIds(uid: string): Promise<string[]>;
}

function toPlain(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function constructStripeEvent(
  rawBody: Buffer | string,
  signature: string,
  webhookSecret: string
): { id: string; type: string; data: { object: Record<string, unknown> } } {
  const event = Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  return {
    id: event.id,
    type: event.type,
    data: { object: toPlain(event.data.object) },
  };
}

export function createStripeGateway(secretKey: string): StripeGateway {
  assertStripeTestKey(secretKey);
  const stripe = new Stripe(secretKey, { apiVersion: API_VERSION });
  return {
    async createSession(params, idempotencyKey) {
      const session = await stripe.checkout.sessions.create(params, { idempotencyKey });
      return { id: session.id, url: session.url };
    },
    async refundNonUs(paymentIntentId, sessionId) {
      await stripe.refunds.create({
        payment_intent: paymentIntentId,
        reason: "requested_by_customer",
        metadata: { reason: "non_us_billing" },
      }, { idempotencyKey: `non-us-${sessionId}` });
    },
    async retrieveSession(sessionId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        return snapshotCheckoutSession(toPlain(session));
      } catch {
        return null;
      }
    },
    async findSucceededSessionIds(uid) {
      if (!isSafeStripeQueryUid(uid)) return [];
      const found = await stripe.paymentIntents.search({
        query: `metadata['uid']:'${uid}' AND status:'succeeded'`,
        limit: 10,
      });
      const ids: string[] = [];
      for (const paymentIntent of found.data) {
        const sessions = await stripe.checkout.sessions.list({
          payment_intent: paymentIntent.id,
          limit: 1,
        });
        const session = sessions.data[0];
        if (session?.id) ids.push(session.id);
      }
      return ids;
    },
  };
}
