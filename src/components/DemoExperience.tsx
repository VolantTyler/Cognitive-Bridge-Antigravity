/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useId, useRef, useState } from "react";
import OceanCards from "./OceanCards";
import {
  DEMO_BADGE,
  DEMO_CARD_BADGE_EXAMPLE,
  DEMO_CARD_BADGE_HYPOTHESIS,
  DEMO_CARD_BARS,
  DEMO_CARD_HEADER,
  DEMO_CTA,
  DEMO_CTA_CAPTION,
  DEMO_EXCHANGE_CAPTION,
  DEMO_EXCHANGE_INTRO,
  DEMO_EXCHANGE_SOURCE,
  DEMO_FRAMING,
  DEMO_PROFILE_LABEL,
  DEMO_SUB,
  SIGNED_IN_AS,
} from "../constants/paywallCopy";
import {
  DEMO_PROFILES,
  DEMO_QUESTION,
  DEMO_REPLY_EXPLORER,
  DEMO_REPLY_NONE,
  DEMO_REPLY_PLANNER,
  DemoProfileId,
  demoModelCard,
} from "../demo/demoContent";

const buttonClass =
  "min-h-11 w-full rounded-lg bg-button-brand px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600";

export default function DemoExperience({
  onStart,
  email,
}: {
  onStart: () => void;
  email?: string | null;
}) {
  const [profile, setProfile] = useState<DemoProfileId>("A");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const example = DEMO_PROFILES[profile];
  const card = demoModelCard(profile);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-5 py-8" data-screen="demo">
      <p className="inline-flex rounded border border-status-warning px-2 py-1 text-xs font-semibold text-status-warning">
        {DEMO_BADGE}
      </p>
      <h1
        id="demo-title"
        tabIndex={-1}
        ref={headingRef}
        className="mt-4 text-[22px] font-semibold leading-snug text-text-primary outline-none"
      >
        {example.title}
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-secondary">{DEMO_SUB}</p>
      {email && (
        <p role="status" className="mt-3 text-sm text-text-secondary">
          {SIGNED_IN_AS} {email}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Example profiles">
        {(["A", "B"] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={profile === id}
            className={`min-h-11 rounded-lg border px-3 text-sm ${profile === id ? "border-text-primary text-text-primary" : "border-border-primary text-text-secondary"}`}
            onClick={() => setProfile(id)}
          >
            Example {id}: {DEMO_PROFILES[id].title}
          </button>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 min-[720px]:[grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
        <section aria-labelledby={`${titleId}-traits`} className="min-w-0 w-full col-span-full rounded-xl border border-border-primary bg-bg-secondary px-3 py-4">
          <p className="text-xs font-semibold text-status-warning">{DEMO_BADGE}</p>
          <h2 id={`${titleId}-traits`} className="mt-2 text-base font-semibold text-text-primary">Trait cards</h2>
          <p className="mt-2 text-xs leading-relaxed text-text-secondary">{DEMO_PROFILE_LABEL}</p>
          <p className="mt-2 text-sm text-text-secondary">{example.description}</p>
          <div className="mt-4">
            <OceanCards scores={example.scores} />
          </div>
        </section>
        <section aria-labelledby={`${titleId}-tailor`} className="rounded-xl border border-border-primary bg-bg-secondary p-4">
          <p className="text-xs font-semibold text-status-warning">{DEMO_BADGE}</p>
          <h2 id={`${titleId}-tailor`} className="mt-2 text-base font-semibold text-text-primary">Example instructions</h2>
          <p className="mt-2 text-xs leading-relaxed text-text-secondary">{DEMO_PROFILE_LABEL}</p>
          <p className="mt-3 text-sm text-text-secondary">{example.activeTraits}</p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-text-secondary">
            {example.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </section>
        <section aria-labelledby={`${titleId}-exchange`} className="rounded-xl border border-border-primary bg-bg-secondary p-4">
          <p className="text-xs font-semibold text-status-warning">{DEMO_BADGE}</p>
          <h2 id={`${titleId}-exchange`} className="mt-2 text-base font-semibold text-text-primary">Example replies</h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">{DEMO_EXCHANGE_INTRO}</p>
          <p className="mt-3 text-sm font-medium text-text-primary">{DEMO_QUESTION}</p>
        </section>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Reply title="No instructions" body={DEMO_REPLY_NONE} />
        <Reply title="Tailored to The Explorer" body={DEMO_REPLY_EXPLORER} />
        <Reply title="Tailored to The Planner" body={DEMO_REPLY_PLANNER} />
      </div>
      <p className="mt-3 text-sm text-text-secondary">{DEMO_EXCHANGE_CAPTION}</p>
      <p className="mt-1 text-sm text-text-secondary">{DEMO_EXCHANGE_SOURCE}</p>
      <article className="mt-6 rounded-xl border border-border-primary bg-bg-secondary p-4" data-testid="demo-model-card">
        <div className="flex flex-wrap gap-2">
          <span className="rounded border border-status-warning px-2 py-1 text-xs font-semibold text-status-warning">{DEMO_CARD_BADGE_EXAMPLE}</span>
          <span className="rounded border border-status-warning px-2 py-1 text-xs font-semibold text-status-warning">{DEMO_CARD_BADGE_HYPOTHESIS}</span>
        </div>
        <h2 className="mt-3 text-base font-semibold text-text-primary">{card.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">{DEMO_CARD_HEADER}</p>
        <p className="mt-2 text-sm text-text-secondary">{DEMO_CARD_BARS}</p>
        <p className="mt-3 text-sm font-medium text-text-primary">{card.modelId}</p>
        <p className="text-sm text-text-secondary">{card.tierLabel}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {card.chips.map((chip) => (
            <li key={chip} className="rounded border border-border-primary px-2 py-1 text-xs text-text-secondary">{chip}</li>
          ))}
        </ul>
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">{card.sentence}</p>
        <div className="mt-4 space-y-3">
          {card.rows.map((row) => (
            <div key={row.label}>
              <div className="flex justify-between gap-3 text-xs text-text-secondary">
                <span>{row.label}</span>
                <span>{row.caption}</span>
              </div>
              <div className="relative mt-1 h-2 rounded bg-bg-tertiary" role="img" aria-label={row.ariaLabel}>
                <div className="absolute inset-y-0 rounded bg-green-700/30" style={{ left: "50%", right: 0 }} />
                <div
                  className="absolute inset-y-0 bg-text-primary/70"
                  style={{ left: `${row.low}%`, width: `${Math.max(row.high - row.low, 1)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-secondary">{card.testedOn}</p>
      </article>
      <p role="status" className="mt-6 rounded-lg border border-border-primary p-4 text-sm leading-relaxed text-text-secondary">
        {DEMO_FRAMING}
      </p>
      <div className="mx-auto mt-6 max-w-[480px]">
        <button type="button" className={buttonClass} onClick={onStart}>
          {DEMO_CTA}
        </button>
        <p className="mt-2 text-center text-xs leading-relaxed text-text-secondary">{DEMO_CTA_CAPTION}</p>
      </div>
    </div>
  );
}

function Reply({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-xl border border-border-primary bg-bg-secondary p-4">
      <p className="text-xs font-semibold text-status-warning">{DEMO_BADGE}</p>
      <h3 className="mt-2 text-sm font-semibold text-text-primary">{title}</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{body}</p>
    </section>
  );
}
