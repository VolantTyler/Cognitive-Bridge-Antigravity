export type ProductSurface = "loading" | "demo" | "paywall" | "signin" | "verify" | "redirect" | "app";

export function resolveSurface(input: {
  authReady: boolean;
  signedIn: boolean;
  paid: boolean;
  legacy: boolean;
  hasSavedResults: boolean;
  view: string | null;
  canceled: boolean;
}): ProductSurface {
  if (!input.authReady) {
    if (input.canceled || input.view === "paywall") return "paywall";
    if (input.view === "app") return "loading";
    return "demo";
  }
  if (input.canceled) return "paywall";
  if (input.view === "demo") return "demo";
  if (input.view === "paywall") return input.paid ? "app" : "paywall";
  if (input.view === "app") {
    if (input.paid || (input.legacy && input.hasSavedResults)) return "app";
    return input.signedIn ? "paywall" : "demo";
  }
  if (!input.signedIn) return "demo";
  if (input.paid) return "app";
  if (input.legacy && input.hasSavedResults) return "app";
  return "demo";
}

export type CheckoutIntent =
  | { phase: "redirect" }
  | { phase: "verify" }
  | { phase: "app" }
  | { phase: "paywall"; alert: string };

export function phaseAfterUnlock(input: { signedIn: boolean; emailVerified: boolean }): "signin" | "verify" | "checkout" {
  if (!input.signedIn) return "signin";
  if (!input.emailVerified) return "verify";
  return "checkout";
}

export function interpretCheckoutResponse(status: number, code: string | null): CheckoutIntent {
  if (status === 409 || code === "already_entitled") return { phase: "app" };
  if (status === 403 || code === "email_not_verified") return { phase: "verify" };
  if (status === 401) return { phase: "paywall", alert: "Your session ended. Sign in to save your progress." };
  if (status >= 200 && status < 300) return { phase: "redirect" };
  return { phase: "paywall", alert: "Couldn't open checkout. You haven't been charged." };
}

export function canUseLiveInterview(input: { paid: boolean; remaining: number; inProgress: boolean }): boolean {
  return input.paid && (input.remaining > 0 || input.inProgress);
}

export function canUseLiveChat(paid: boolean): boolean {
  return paid;
}

/** Paid accounts with no interviews left should not see the start-interview pitch. */
export function showMirrorInvite(input: {
  paid: boolean;
  interviewsRemaining: number;
  inProgress: boolean;
}): boolean {
  return !(input.paid && input.interviewsRemaining <= 0 && !input.inProgress);
}
