import { INTERVIEWS_ALLOWED } from "./checkoutConfig";

export type CheckoutOutcome =
  | "open"
  | "pending"
  | "granted"
  | "terms_not_accepted"
  | "non_us_refunded"
  | "non_us_refund_failed"
  | "country_unconfirmed"
  | "amount_missing"
  | "payment_intent_missing";

export interface CheckoutRecord {
  sessionId: string;
  uid: string;
  paymentIntentId: string | null;
  billingCountry: string | null;
  termsAccepted: boolean;
  outcome: CheckoutOutcome;
  manualRefundRequired: boolean;
  needsManualReview: boolean;
  amount: number | null;
  currency: string | null;
}

export interface EntitlementState {
  paid: boolean;
  provider: "stripe";
  sessionId: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  interviewsAllowed: number;
  activePaymentIntentIds: string[];
  disputeStatus: string | null;
  disputeId: string | null;
}

export interface EntitlementStamps {
  paidAt?: boolean;
  refundedAt?: boolean;
}

/** Server-written proof that this user accepted the current Terms and attested 18+. */
export interface CheckoutConsent {
  uid: string;
  termsVersion: string;
  attested18OrOlder: true;
  sessionId: string;
}

export interface BillingStore {
  claimEvent(id: string, type: string): Promise<"duplicate" | "start">;
  completeEvent(id: string): Promise<void>;
  readEntitlement(uid: string): Promise<EntitlementState | null>;
  writeEntitlement(uid: string, state: EntitlementState, stamps: EntitlementStamps): Promise<void>;
  writeCheckoutConsent(consent: CheckoutConsent): Promise<void>;
  readCheckoutConsent(sessionId: string): Promise<CheckoutConsent | null>;
  writeCheckoutRecord(record: CheckoutRecord): Promise<void>;
  readCheckoutRecord(sessionId: string): Promise<CheckoutRecord | null>;
  listCheckoutRecordsForUid(uid: string): Promise<CheckoutRecord[]>;
  findCheckoutByPaymentIntent(paymentIntentId: string): Promise<CheckoutRecord | null>;
}

export interface CheckoutLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface PaidSessionSnapshot {
  id: string;
  paymentStatus: string | null;
  uid: string | null;
  uidConflict: boolean;
  countryKind: "US" | "other" | "unconfirmed";
  country: string | null;
  termsOfService: string | null;
  paymentIntentId: string | null;
  amountTotal: number | null;
  currency: string | null;
}

export interface ChargeSnapshot {
  paymentIntentId: string | null;
  metadataUid: string | null;
  amount: number | null;
  amountRefunded: number | null;
  fullyRefunded: boolean;
}

export interface DisputeSnapshot {
  id: string;
  status: string | null;
  paymentIntentId: string | null;
  metadataUid: string | null;
}

export interface RefundFailedSnapshot {
  paymentIntentId: string | null;
  metadataReason: string | null;
}

export type CheckoutClientStatus =
  | "pending"
  | "paid"
  | "non_us_refunded"
  | "non_us_refund_failed"
  | "terms_not_accepted"
  | "country_unconfirmed"
  | "not_found";

export function clientStatusForRecord(
  record: CheckoutRecord | null,
  entitlementPaid: boolean
): CheckoutClientStatus {
  if (record?.outcome === "non_us_refunded") return "non_us_refunded";
  if (record?.outcome === "non_us_refund_failed") return "non_us_refund_failed";
  if (record?.outcome === "terms_not_accepted") return "terms_not_accepted";
  if (record?.outcome === "country_unconfirmed") return "country_unconfirmed";
  if (record?.outcome === "granted" || entitlementPaid) return "paid";
  if (!record) return "pending";
  return "pending";
}

export function emptyEntitlement(partial: {
  sessionId: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  activePaymentIntentIds: string[];
  paid: boolean;
}): EntitlementState {
  return {
    paid: partial.paid,
    provider: "stripe",
    sessionId: partial.sessionId,
    paymentIntentId: partial.paymentIntentId,
    amount: partial.amount,
    currency: partial.currency,
    interviewsAllowed: INTERVIEWS_ALLOWED,
    activePaymentIntentIds: partial.activePaymentIntentIds,
    disputeStatus: null,
    disputeId: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function idField(value: unknown): string | null {
  const direct = stringField(value);
  if (direct) return direct;
  const record = asRecord(value);
  return record ? stringField(record.id) : null;
}

export function normalizeBillingCountry(raw: string | null): "US" | "other" | "unconfirmed" {
  if (!raw) return "unconfirmed";
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "unconfirmed";
  if (code === "US") return "US";
  return "other";
}

export function snapshotCheckoutSession(object: Record<string, unknown>): PaidSessionSnapshot {
  const metadata = asRecord(object.metadata);
  const fromRef = stringField(object.client_reference_id);
  const fromMeta = metadata ? stringField(metadata.uid) : null;
  const uidConflict = Boolean(fromRef && fromMeta && fromRef !== fromMeta);
  const customer = asRecord(object.customer_details);
  const address = customer ? asRecord(customer.address) : null;
  const rawCountry = address ? stringField(address.country) : null;
  const consent = asRecord(object.consent);
  const currency = stringField(object.currency);
  return {
    id: stringField(object.id) ?? "",
    paymentStatus: stringField(object.payment_status),
    uid: uidConflict ? null : fromRef || fromMeta,
    uidConflict,
    countryKind: normalizeBillingCountry(rawCountry),
    country: rawCountry ? rawCountry.trim().toUpperCase() : null,
    termsOfService: consent ? stringField(consent.terms_of_service) : null,
    paymentIntentId: idField(object.payment_intent),
    amountTotal: numberField(object.amount_total),
    currency: currency ? currency.toLowerCase() : null,
  };
}

export function snapshotCharge(object: Record<string, unknown>): ChargeSnapshot {
  const metadata = asRecord(object.metadata);
  const amount = numberField(object.amount);
  const amountRefunded = numberField(object.amount_refunded);
  const fullyRefunded = object.refunded === true
    || (amount !== null && amount > 0 && amountRefunded !== null && amountRefunded >= amount);
  return {
    paymentIntentId: idField(object.payment_intent),
    metadataUid: metadata ? stringField(metadata.uid) : null,
    amount,
    amountRefunded,
    fullyRefunded,
  };
}

export function snapshotDispute(object: Record<string, unknown>): DisputeSnapshot {
  const metadata = asRecord(object.metadata);
  const charge = asRecord(object.charge);
  const chargeMeta = charge ? asRecord(charge.metadata) : null;
  return {
    id: stringField(object.id) ?? "",
    status: stringField(object.status),
    paymentIntentId: idField(object.payment_intent) || (charge ? idField(charge.payment_intent) : null),
    metadataUid: (metadata ? stringField(metadata.uid) : null)
      || (chargeMeta ? stringField(chargeMeta.uid) : null),
  };
}

export function snapshotRefundFailed(object: Record<string, unknown>): RefundFailedSnapshot {
  const metadata = asRecord(object.metadata);
  return {
    paymentIntentId: idField(object.payment_intent),
    metadataReason: metadata ? stringField(metadata.reason) : null,
  };
}

export function isFullRefund(charge: ChargeSnapshot): boolean {
  return charge.fullyRefunded;
}

export function isAlreadyRefundedError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return String((error as { code?: unknown }).code) === "charge_already_refunded";
}

export function termsWereAccepted(snapshot: PaidSessionSnapshot): boolean {
  return snapshot.termsOfService === "accepted";
}
