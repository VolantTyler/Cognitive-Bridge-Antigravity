/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from "react";
import { CheckoutViewStatus } from "../constants/checkoutCopy";
import { parseLocation } from "../routes";
import { CheckoutReturn } from "./CheckoutReturn";
import { PrivacyPage, TermsPage } from "./LegalPages";

export function StandaloneRoutes({
  pathname,
  search,
  app,
  loadStatus,
  restore,
  header,
}: {
  pathname: string;
  search: string;
  app: ReactNode;
  loadStatus: (sessionId: string) => Promise<CheckoutViewStatus>;
  restore: () => Promise<boolean>;
  header?: ReactNode;
}) {
  const route = parseLocation(pathname, search);
  if (route.name === "terms") return <TermsPage />;
  if (route.name === "privacy") return <PrivacyPage />;
  if (route.name === "checkout") {
    return <CheckoutReturn search={route.search} loadStatus={loadStatus} restore={restore} header={header} />;
  }
  return <>{app}</>;
}
