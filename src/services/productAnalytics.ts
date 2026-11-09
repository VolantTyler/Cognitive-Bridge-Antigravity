import { logAnalyticsEvent } from "./firebase";
import { sanitizeAnalyticsParams } from "./analyticsSanitize";

export type ProductEventName =
  | "demo_started"
  | "demo_completed"
  | "paywall_viewed"
  | "signin_started"
  | "signin_completed"
  | "email_verification_sent"
  | "email_verified"
  | "password_reset_requested"
  | "checkout_started"
  | "checkout_canceled"
  | "interview_started"
  | "interview_completed"
  | "retake_started"
  | "chat_cap_hit"
  | "report_viewed";

export function logProductEvent(name: ProductEventName, params?: Record<string, unknown>): void {
  logAnalyticsEvent(name, sanitizeAnalyticsParams(params));
}
