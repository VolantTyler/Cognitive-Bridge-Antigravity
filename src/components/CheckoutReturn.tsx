/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from "react";
import {
  BACK_TO_COGNITIVE_BRIDGE,
  CHECKOUT_CANCELED,
  CHECKOUT_CONFIRMED,
  CHECKOUT_CONFIRMING,
  CHECKOUT_NOT_GRANTED,
  CHECKOUT_RESTORE_FAILED,
  CHECKOUT_SIGN_IN,
  CHECKOUT_TIMEOUT,
  CHECKOUT_UNMATCHED,
  CheckoutClientError,
  CheckoutViewStatus,
  NON_US_HEADING,
  NON_US_REFUND_FAILED_BODY,
  NON_US_REFUNDED_BODY,
  RESTORE_PURCHASE,
} from "../constants/checkoutCopy";
import {
  APP_HOME,
  CHECKOUT_TIMEOUT_NEXT,
  DEMO_HOME,
  START_INTERVIEW,
  SUCCESS_CHAT,
  SUCCESS_ESTIMATE,
  SUCCESS_INTERVIEWS,
  SUCCESS_PRODUCT,
  SUCCESS_READY,
  SUCCESS_RECEIPT,
  AI_DISCLOSURE,
} from "../constants/paywallCopy";
import SiteFooter from "./SiteFooter";

const POLL_MS = 30_000;

export function CheckoutReturn({
  search,
  loadStatus,
  restore,
  initialPhase,
}: {
  search: string;
  loadStatus: (sessionId: string) => Promise<CheckoutViewStatus>;
  restore: () => Promise<boolean>;
  initialPhase?: CheckoutViewStatus;
}) {
  const params = new URLSearchParams(search);
  const checkout = params.get("checkout");
  const sessionId = params.get("session_id");
  const [phase, setPhase] = useState<CheckoutViewStatus>(
    initialPhase ?? (checkout === "cancel" ? "cancel" : "pending")
  );
  const [restoreFailed, setRestoreFailed] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (initialPhase || checkout !== "success" || !sessionId) return;
    let stopped = false;
    const started = Date.now();
    const poll = async () => {
      while (!stopped) {
        try {
          const status = await loadStatus(sessionId);
          if (stopped) return;
          if (status !== "pending") {
            setPhase(status);
            return;
          }
        } catch (error) {
          if (stopped) return;
          if (error instanceof CheckoutClientError && error.code === "signed_out") {
            setPhase("signin");
            return;
          }
          if (error instanceof CheckoutClientError && error.code === "not_found") {
            setPhase("not_found");
            return;
          }
        }
        if (Date.now() - started >= POLL_MS) {
          if (!stopped) setPhase("timeout");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [checkout, initialPhase, loadStatus, sessionId]);

  const heading = phase === "non_us_refunded" || phase === "non_us_refund_failed"
    ? NON_US_HEADING
    : phase === "paid"
      ? CHECKOUT_CONFIRMED
      : phase === "cancel"
        ? CHECKOUT_CANCELED
        : phase === "signin"
          ? CHECKOUT_SIGN_IN
          : phase === "timeout"
            ? CHECKOUT_TIMEOUT
            : phase === "pending"
              ? CHECKOUT_CONFIRMING
              : "We couldn't turn on access";

  const refundFailed = phase === "non_us_refund_failed";
  const nonUs = phase === "non_us_refunded" || refundFailed;
  const neutral = phase === "paid" || phase === "cancel" || phase === "pending" || phase === "timeout" || phase === "signin" || phase === "non_us_refunded";

  return (
    <div className="min-h-screen bg-bg-primary text-text-secondary flex flex-col font-sans" data-screen={phase}>
      <main className="flex-1 w-full max-w-md mx-auto px-5 py-16">
        <div role={neutral && !nonUs ? "status" : undefined}>
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold text-text-primary outline-none">
            {heading}
          </h1>
        </div>
        {phase === "non_us_refunded" && (
          <p role="status" className="mt-4 text-sm leading-relaxed border border-border-primary rounded-lg p-4">
            {NON_US_REFUNDED_BODY}
          </p>
        )}
        {refundFailed && (
          <p role="alert" className="mt-4 text-sm leading-relaxed rounded-lg p-4 bg-red-500/10 border border-red-500/20 text-status-danger">
            {NON_US_REFUND_FAILED_BODY}
          </p>
        )}
        {(phase === "terms_not_accepted" || phase === "country_unconfirmed") && (
          <p role="alert" className="mt-4 text-sm leading-relaxed rounded-lg p-4 bg-red-500/10 border border-red-500/20 text-status-danger">
            {CHECKOUT_NOT_GRANTED}
          </p>
        )}
        {phase === "not_found" && (
          <p role="alert" className="mt-4 text-sm leading-relaxed rounded-lg p-4 bg-red-500/10 border border-red-500/20 text-status-danger">
            {CHECKOUT_UNMATCHED}
          </p>
        )}
        {restoreFailed && (
          <p role="alert" className="mt-4 text-sm leading-relaxed">{CHECKOUT_RESTORE_FAILED}</p>
        )}
        {phase === "timeout" && (
          <p className="mt-4 text-sm leading-relaxed text-text-secondary">{CHECKOUT_TIMEOUT_NEXT}</p>
        )}
        {phase === "paid" && (
          <div className="mt-4 space-y-3 text-sm leading-relaxed text-text-secondary">
            <h2 className="text-lg font-semibold text-text-primary">{SUCCESS_READY}</h2>
            <p>{SUCCESS_INTERVIEWS}</p>
            <p>{SUCCESS_CHAT}</p>
            <p>{SUCCESS_ESTIMATE}</p>
            <p>{SUCCESS_PRODUCT}</p>
            <p>{SUCCESS_RECEIPT}</p>
            <p>{AI_DISCLOSURE}</p>
            <a href={APP_HOME} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-button-brand px-4 text-sm font-semibold text-white">
              {START_INTERVIEW}
            </a>
          </div>
        )}
        {phase === "timeout" && (
          <button
            type="button"
            className="mt-6 min-h-11 px-4 rounded-lg border border-border-primary text-sm text-text-primary"
            onClick={() => {
              void restore().then((ok) => {
                if (ok) {
                  setRestoreFailed(false);
                  setPhase("paid");
                } else {
                  setRestoreFailed(true);
                }
              });
            }}
          >
            {RESTORE_PURCHASE}
          </button>
        )}
        {nonUs && (
          <a
            href={DEMO_HOME}
            className="mt-6 inline-flex items-center justify-center min-h-11 px-4 rounded-lg border border-border-primary bg-bg-secondary text-sm text-text-primary"
          >
            {BACK_TO_COGNITIVE_BRIDGE}
          </a>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
