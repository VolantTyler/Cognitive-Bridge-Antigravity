/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { APP_VERSION_LABEL } from "../appVersion";

export default function SiteFooter({
  modelLabel,
  onOpenReleaseNotes,
}: {
  modelLabel?: string;
  onOpenReleaseNotes?: () => void;
}) {
  return (
    <footer className="h-auto md:h-auto border-t border-border-primary px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-3 text-[9px] uppercase tracking-[0.3em] font-bold text-text-muted-darker bg-bg-primary transition-colors duration-300">
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 md:gap-4 text-center">
        <a
          href="https://tylerstahl.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-text-primary transition-colors"
        >
          Tyler J. Stahl
        </a>
        <span className="text-border-primary">/</span>
        <a
          href="https://www.linkedin.com/in/tyler-j-stahl"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-text-primary transition-colors"
        >
          LinkedIn
        </a>
        {onOpenReleaseNotes && (
          <>
            <span className="text-border-primary">/</span>
            <button
              onClick={onOpenReleaseNotes}
              className="hover:text-text-primary transition-colors cursor-pointer border-0 bg-transparent uppercase tracking-[0.3em] font-bold text-[9px] text-text-muted-darker"
              title="View Release Notes"
            >
              Cognitive Bridge {APP_VERSION_LABEL}
            </button>
          </>
        )}
      </div>
      <nav aria-label="Legal" className="normal-case tracking-normal text-xs font-medium text-text-muted">
        {APP_VERSION_LABEL}
        {" · "}
        <a href="/terms" className="hover:text-text-primary underline-offset-2 hover:underline">Terms</a>
        {" · "}
        <a href="/privacy" className="hover:text-text-primary underline-offset-2 hover:underline">Privacy</a>
      </nav>
      {modelLabel && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 md:gap-4 text-center">
          <span className="text-text-muted">{modelLabel}</span>
          <span className="text-border-primary">/</span>
          <span>Procedural Skills Engine</span>
        </div>
      )}
    </footer>
  );
}
