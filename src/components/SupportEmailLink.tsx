/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ReactNode } from "react";
import { SUPPORT_EMAIL } from "../constants/checkoutCopy";

/** Long address wraps inside a 360px column instead of forcing horizontal scroll. */
export const SUPPORT_EMAIL_LINK_CLASS = "underline underline-offset-2 [overflow-wrap:anywhere]";

export function SupportEmailLink() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className={SUPPORT_EMAIL_LINK_CLASS}>
      {SUPPORT_EMAIL}
    </a>
  );
}

/** Splits a sentence that already contains the support address and links that address. */
export function withSupportEmail(text: string): ReactNode {
  const parts = text.split(SUPPORT_EMAIL);
  if (parts.length === 1) return text;
  return parts.map((part, index) => (
    <span key={index}>
      {part}
      {index < parts.length - 1 ? <SupportEmailLink /> : null}
    </span>
  ));
}
