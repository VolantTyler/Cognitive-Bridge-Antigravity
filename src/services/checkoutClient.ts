/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { authorizedAiHeaders, AiAccessError } from "./aiAccess";
import { CheckoutClientError, CheckoutViewStatus } from "../constants/checkoutCopy";
import { TERMS_VERSION } from "../constants/paywallCopy";

function endpoint(path: string, functionName: string): string {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || "cognitive-bridge-ai";
    return `http://localhost:5001/${projectId}/us-central1/${functionName}`;
  }
  return path;
}

const STATUSES = new Set<CheckoutViewStatus>([
  "pending",
  "paid",
  "non_us_refunded",
  "non_us_refund_failed",
  "terms_not_accepted",
  "country_unconfirmed",
  "not_found",
]);

export async function loadCheckoutStatus(sessionId: string): Promise<CheckoutViewStatus> {
  let headers: Record<string, string>;
  try {
    headers = await authorizedAiHeaders();
  } catch (error) {
    if (error instanceof AiAccessError) throw new CheckoutClientError("signed_out");
    throw new CheckoutClientError("failed");
  }
  const response = await fetch(
    `${endpoint("/api/checkout/status", "checkoutStatus")}?session_id=${encodeURIComponent(sessionId)}`,
    { headers }
  );
  if (response.status === 404) throw new CheckoutClientError("not_found");
  if (response.status === 401) throw new CheckoutClientError("signed_out");
  if (!response.ok) throw new CheckoutClientError("failed");
  const body = await response.json() as { status?: unknown };
  if (typeof body.status === "string" && STATUSES.has(body.status as CheckoutViewStatus)) {
    return body.status as CheckoutViewStatus;
  }
  return "pending";
}

export class CheckoutStartError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null) {
    super(code ?? "checkout_failed");
    this.name = "CheckoutStartError";
    this.status = status;
    this.code = code;
  }
}

export async function startCheckout(): Promise<string> {
  let headers: Record<string, string>;
  try {
    headers = await authorizedAiHeaders();
  } catch (error) {
    if (error instanceof AiAccessError) throw new CheckoutStartError(401, "signed_out");
    throw new CheckoutStartError(401, "signed_out");
  }
  const response = await fetch(endpoint("/api/checkout", "createCheckout"), {
    method: "POST",
    headers,
    body: JSON.stringify({ termsAccepted: true, termsVersion: TERMS_VERSION }),
  });
  const body = await response.json().catch(() => ({})) as { url?: unknown; code?: unknown };
  const code = typeof body.code === "string" ? body.code : null;
  if (!response.ok || typeof body.url !== "string") {
    throw new CheckoutStartError(response.status, code);
  }
  return body.url;
}

export async function requestRestorePurchase(): Promise<boolean> {
  let headers: Record<string, string>;
  try {
    headers = await authorizedAiHeaders();
  } catch {
    return false;
  }
  const response = await fetch(endpoint("/api/checkout/restore", "restorePurchase"), {
    method: "POST",
    headers,
  });
  if (!response.ok) return false;
  const body = await response.json() as { restored?: unknown };
  return body.restored === true;
}
