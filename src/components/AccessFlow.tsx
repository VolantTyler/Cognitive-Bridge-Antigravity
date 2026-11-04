/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from "react";
import AccountAuthPanel from "./AccountAuthPanel";
import DemoExperience from "./DemoExperience";
import { AccountUser } from "../services/accountAuth";
import { ProductSurface } from "../access/productAccess";
import {
  AI_DISCLOSURE,
  ALREADY_PAID,
  BACK_TO_EXAMPLE,
  CHECKOUT_CANCELED_BANNER,
  CHECKOUT_OPEN_FAILED,
  FINAL_SALE,
  LOADING_ACCOUNT,
  PAYWALL_AGE,
  PAYWALL_BUTTON,
  PAYWALL_BUTTON_BUSY,
  PAYWALL_CAPTION,
  PAYWALL_FRAMING,
  PAYWALL_INCLUSIONS,
  PAYWALL_PRICE,
  PAYWALL_TITLE,
  PAYWALL_US,
  PAYWALL_VARIES,
  REDIRECT_BODY,
  REDIRECT_TITLE,
  TRY_AGAIN,
} from "../constants/paywallCopy";

const primaryClass =
  "min-h-11 w-full rounded-lg bg-button-brand px-4 text-sm font-semibold text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600";

export default function AccessFlow({
  phase,
  email,
  canceled,
  alertMessage,
  busy,
  onStartInterview,
  onUnlock,
  onBackToDemo,
  onRestore,
  onSignedIn,
  onCloseAuth,
  onRetryCheckout,
}: {
  phase: ProductSurface;
  email?: string | null;
  canceled: boolean;
  alertMessage: string | null;
  busy: boolean;
  onStartInterview: () => void;
  onUnlock: () => void;
  onBackToDemo: () => void;
  onRestore: () => void;
  onSignedIn: (user: AccountUser) => void;
  onCloseAuth: () => void;
  onRetryCheckout: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [phase]);

  if (phase === "loading") {
    return (
      <main className="mx-auto w-full max-w-[480px] px-5 py-16">
        <p role="status" className="text-sm text-text-secondary">{LOADING_ACCOUNT}</p>
      </main>
    );
  }
  if (phase === "demo") {
    return (
      <main>
        <DemoExperience email={email} onStart={onStartInterview} />
      </main>
    );
  }
  if (phase === "signin" || phase === "verify") {
    return (
      <main className="mx-auto w-full max-w-[480px] px-5 py-10">
        <AccountAuthPanel
          isOpen
          embedded
          initialView={phase === "verify" ? "verify" : "sign-in"}
          onClose={onCloseAuth}
          onSignedIn={onSignedIn}
        />
      </main>
    );
  }
  if (phase === "redirect") {
    return (
      <main className="mx-auto w-full max-w-[480px] px-5 py-16" data-screen="redirect">
        <h1 ref={headingRef} tabIndex={-1} className="text-[22px] font-semibold text-text-primary outline-none">
          {REDIRECT_TITLE}
        </h1>
        <p role="status" className="mt-4 text-sm leading-relaxed text-text-secondary">{REDIRECT_BODY}</p>
        <p className="mt-4 text-sm text-text-secondary" aria-hidden="true">
          <span className="motion-safe:inline-block motion-safe:animate-spin">…</span>
        </p>
        {alertMessage && (
          <>
            <p role="alert" className="mt-4 text-sm text-status-danger">{alertMessage || CHECKOUT_OPEN_FAILED}</p>
            <button type="button" className={`${primaryClass} mt-4`} onClick={onRetryCheckout}>{TRY_AGAIN}</button>
          </>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[480px] px-5 py-10" data-screen="paywall">
      <h1 ref={headingRef} tabIndex={-1} className="text-[22px] font-semibold text-text-primary outline-none">
        {PAYWALL_TITLE}
      </h1>
      {canceled && (
        <p role="status" className="mt-4 rounded-lg border border-border-primary p-3 text-sm text-text-secondary">
          {CHECKOUT_CANCELED_BANNER}
        </p>
      )}
      {alertMessage && (
        <p role="alert" className="mt-4 rounded-lg border border-red-700/40 p-3 text-sm text-status-danger">
          {alertMessage}
        </p>
      )}
      <p className="mt-4 text-base font-semibold text-text-primary">{PAYWALL_PRICE}</p>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-text-secondary">
        {PAYWALL_INCLUSIONS.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-text-secondary">{PAYWALL_US}</p>
      <p className="mt-3 text-sm text-text-secondary">{PAYWALL_VARIES}</p>
      <p className="mt-3 text-sm leading-relaxed text-text-secondary">{AI_DISCLOSURE}</p>
      <p className="mt-3 text-sm leading-relaxed text-text-secondary">{PAYWALL_FRAMING}</p>
      <p className="mt-3 text-sm text-text-secondary">{PAYWALL_AGE}</p>
      <div id="final-sale" className="mt-4 rounded-lg border-2 border-text-primary p-3 text-sm leading-relaxed text-text-primary">
        <strong>All sales are final</strong>
        {", "}
        {FINAL_SALE.replace(/^All sales are final, /, "")}
        {" "}
        <a href="/terms" className="underline">Terms</a>
      </div>
      <button
        type="button"
        className={`${primaryClass} mt-3`}
        aria-describedby="final-sale"
        disabled={busy}
        onClick={onUnlock}
      >
        {busy ? PAYWALL_BUTTON_BUSY : PAYWALL_BUTTON}
      </button>
      <p className="mt-2 text-xs leading-relaxed text-text-secondary">{PAYWALL_CAPTION}</p>
      <div className="mt-4 flex flex-col gap-2 text-sm">
        <button type="button" className="min-h-11 text-left text-text-secondary underline" onClick={onBackToDemo}>
          {BACK_TO_EXAMPLE}
        </button>
        <button type="button" className="min-h-11 text-left text-text-secondary underline" onClick={onRestore}>
          {ALREADY_PAID}
        </button>
      </div>
    </main>
  );
}
