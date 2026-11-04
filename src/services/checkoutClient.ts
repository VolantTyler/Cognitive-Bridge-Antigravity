/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { authorizedAiHeaders, AiAccessError } from "./aiAccess";
import { CheckoutClientError, CheckoutViewStatus } from "../constants/checkoutCopy";

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
