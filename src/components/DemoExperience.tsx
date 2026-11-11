/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useId, useRef, useState } from "react";
import OceanCards from "./OceanCards";
import {
  DEMO_CARD_BARS,
  DEMO_CLOSING_LINE,
  DEMO_CLOSING_TITLE,
  DEMO_CTA,
  DEMO_CTA_CAPTION,
  DEMO_FRAMING,
  DEMO_HERO_LEDE,
  DEMO_HERO_TITLE,
  DEMO_HOW_BRIDGE,
  DEMO_HOW_MIRROR,
  DEMO_HOW_TAILOR,
  DEMO_REPLY_FOOTER,
  DEMO_RIBBON,
  DEMO_RIBBON_TAG,
  DEMO_SEE_EXAMPLE,
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
import type { OceanScores } from "../types";

const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-button-brand px-4 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600";

const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-text-primary bg-transparent px-4 text-sm font-semibold text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600";

const PEEK_TRAITS: { key: keyof OceanScores; label: string; rule: string }[] = [
  { key: "openness", label: "Open.", rule: "border-accent-purple" },
  { key: "conscientiousness", label: "Consc.", rule: "border-accent-blue" },
  { key: "extroversion", label: "Extra.", rule: "border-accent-yellow" },
  { key: "agreeableness", label: "Agree.", rule: "border-accent-green" },
  { key: "neuroticism", label: "Neuro.", rule: "border-accent-red" },
];

const REPLY_TABS = [
  { id: "none", tab: "No instructions", heading: "No instructions", body: DEMO_REPLY_NONE },
  { id: "A", tab: "Explorer", heading: "With The Explorer's instructions", body: DEMO_REPLY_EXPLORER },
  { id: "B", tab: "Planner", heading: "With The Planner's instructions", body: DEMO_REPLY_PLANNER },
] as const;

type ReplyTabId = (typeof REPLY_TABS)[number]["id"];

const HOW_IT_WORKS = [
  { title: "The Mirror", body: DEMO_HOW_MIRROR },
  { title: "The Tailor", body: DEMO_HOW_TAILOR },
  { title: "The Bridge", body: DEMO_HOW_BRIDGE },
] as const;

function previewLine(text: string): string {
  const max = 68;
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

export default function DemoExperience({
  onStart,
  email,
}: {
  onStart: () => void;
  email?: string | null;
}) {
  const [profile, setProfile] = useState<DemoProfileId>("A");
  const [replyTab, setReplyTab] = useState<ReplyTabId>("A");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Partial<Record<ReplyTabId, HTMLButtonElement | null>>>({});
  const titleId = useId();
  const example = DEMO_PROFILES[profile];
  const card = demoModelCard(profile);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function selectProfile(id: DemoProfileId) {
    setProfile(id);
    setReplyTab(id);
  }

  function moveReplyTab(current: ReplyTabId, key: string) {
    const index = REPLY_TABS.findIndex((tab) => tab.id === current);
    let next = index;
    if (key === "ArrowRight") next = (index + 1) % REPLY_TABS.length;
    else if (key === "ArrowLeft") next = (index - 1 + REPLY_TABS.length) % REPLY_TABS.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = REPLY_TABS.length - 1;
    else return;
    const id = REPLY_TABS[next].id;
    setReplyTab(id);
    tabRefs.current[id]?.focus();
  }

  return (
    <div className="mx-auto w-full max-w-[1000px] overflow-x-hidden px-4 py-8 sm:px-5" data-screen="demo">
      <section className="grid items-center gap-8 md:grid-cols-[1.2fr_1fr] md:gap-10">
        <div>
          <h1
            id="demo-title"
            tabIndex={-1}
            ref={headingRef}
            className="text-[1.75rem] font-bold leading-tight tracking-tight text-text-primary outline-none md:text-4xl"
          >
            {DEMO_HERO_TITLE}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-text-secondary md:text-[17px]">
            {DEMO_HERO_LEDE}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button type="button" className={`${primaryButtonClass} w-full sm:w-auto`} onClick={onStart}>
              {DEMO_CTA}
            </button>
            <a href="#example" className={`${secondaryButtonClass} w-full sm:w-auto`}>
              {DEMO_SEE_EXAMPLE}
            </a>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-text-muted">{DEMO_CTA_CAPTION}</p>
          {email && (
            <p role="status" className="mt-3 text-sm text-text-secondary">
              {SIGNED_IN_AS} {email}
            </p>
          )}
        </div>
        <div
          data-testid="hero-peek"
          aria-hidden="true"
          className="rounded-2xl border border-border-primary bg-bg-secondary p-4"
        >
          <p className="mb-2 text-sm text-text-muted">What you get</p>
          <div className="grid grid-cols-5 gap-1.5">
            {PEEK_TRAITS.map((trait) => (
              <div key={trait.key} className={`rounded-lg border-t-[3px] bg-bg-primary px-1 py-2 ${trait.rule}`}>
                <span className="block text-[10px] font-bold uppercase tracking-wide text-text-muted">{trait.label}</span>
                <b className="mt-1 block text-lg leading-none text-text-primary">{example.scores[trait.key]}</b>
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-lg bg-bg-primary px-3 py-2 font-mono text-[13px] leading-relaxed text-text-secondary">
            {previewLine(example.bullets[0]?.text ?? "")}
          </p>
        </div>
      </section>

      <section aria-labelledby={`${titleId}-how`} className="mt-12 border-t border-border-primary pt-10">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-status-brand">How it works</p>
        <h2 id={`${titleId}-how`} className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">
          Three steps
        </h2>
        <ol className="mt-5 grid list-none gap-4 p-0 md:grid-cols-3">
          {HOW_IT_WORKS.map((step, index) => (
            <li key={step.title} className="rounded-xl bg-bg-secondary p-4">
              <div
                aria-hidden="true"
                className="mb-3 flex h-7 w-7 items-center justify-center rounded-full bg-text-primary text-sm font-bold text-bg-primary"
              >
                {index + 1}
              </div>
              <h3 className="text-base font-semibold text-text-primary">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section
        id="example"
        aria-labelledby={`${titleId}-example`}
        className="mt-12 scroll-mt-16 border-t border-border-primary pt-10 max-md:flex max-md:max-h-[calc(100dvh-4rem)] max-md:flex-col"
      >
        <div className="flex shrink-0 flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-status-brand">Example</p>
            <h2 id={`${titleId}-example`} className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">
              See it with a sample profile
            </h2>
          </div>
          <div
            role="group"
            aria-label="Sample profile"
            className="inline-flex w-full rounded-[10px] border border-border-secondary bg-bg-secondary p-1 md:w-auto"
          >
            {(["A", "B"] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={profile === id}
                className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 md:flex-none md:px-4 ${
                  profile === id ? "bg-bg-primary text-text-primary shadow-sm" : "text-text-secondary"
                }`}
                onClick={() => selectProfile(id)}
              >
                {DEMO_PROFILES[id].title}
              </button>
            ))}
          </div>
        </div>

        <div
          data-testid="example-frame"
          className="mt-4 flex flex-col max-md:min-h-0 max-md:flex-1 max-md:overflow-hidden"
        >
          <div
            data-testid="example-panel"
            className="flex flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border-secondary bg-bg-secondary max-md:min-h-0 max-md:flex-1"
          >
            <div
              data-testid="example-ribbon"
              className="flex shrink-0 flex-wrap items-center gap-2 bg-bg-tertiary px-4 py-2.5 text-sm text-text-secondary"
            >
              <span className="rounded border border-status-warning px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-status-warning">
                {DEMO_RIBBON_TAG}
              </span>
              <span>{DEMO_RIBBON}</span>
            </div>
            <div
              data-testid="example-panel-body"
              className="space-y-6 px-3 py-4 max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto md:px-5 md:py-5"
            >
              <div>
                <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-text-primary">
                  {example.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{example.description}</p>
                <div className="mt-4">
                  <OceanCards scores={example.scores} />
                </div>
              </div>

              <div>
                <h3 id={`${titleId}-instructions`} className="text-[13px] font-bold uppercase tracking-[0.08em] text-text-primary">
                  Their instructions
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{example.activeTraits}</p>
                <ul
                  data-testid="instruction-list"
                  aria-labelledby={`${titleId}-instructions`}
                  className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-text-secondary"
                >
                  {example.bullets.map((bullet) => (
                    <li key={bullet.text}>
                      <span
                        data-testid="instruction-chip"
                        className="mr-1.5 inline-block whitespace-nowrap rounded border border-border-secondary px-1 align-middle text-[11px] leading-5 text-text-primary"
                      >
                        {bullet.strategy}
                      </span>
                      {bullet.text}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-text-primary">
                  Same question, three replies
                </h3>
                <div className="thread mt-3 overflow-hidden rounded-xl border border-border-primary bg-bg-primary">
                  <div className="flex justify-end px-4 pb-2 pt-4">
                    <p className="max-w-[32em] rounded-2xl rounded-br-sm bg-text-primary px-3.5 py-2.5 text-[15px] leading-snug text-bg-primary">
                      <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide">Question</span>
                      {DEMO_QUESTION}
                    </p>
                  </div>
                  <div
                    role="tablist"
                    aria-label="Replies"
                    className="flex gap-1 px-3 pb-3 md:hidden"
                  >
                    {REPLY_TABS.map((tab) => {
                      const selected = replyTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          ref={(node) => {
                            tabRefs.current[tab.id] = node;
                          }}
                          type="button"
                          role="tab"
                          id={`${titleId}-tab-${tab.id}`}
                          aria-selected={selected}
                          aria-controls={`${titleId}-panel-${tab.id}`}
                          tabIndex={selected ? 0 : -1}
                          className={`min-h-11 flex-1 rounded-lg border px-1.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 ${
                            selected
                              ? "border-text-primary bg-text-primary text-bg-primary"
                              : "border-border-secondary bg-bg-secondary text-text-secondary"
                          }`}
                          onClick={() => setReplyTab(tab.id)}
                          onKeyDown={(event) => {
                            if (event.key === "ArrowRight" || event.key === "ArrowLeft" || event.key === "Home" || event.key === "End") {
                              event.preventDefault();
                              moveReplyTab(tab.id, event.key);
                            }
                          }}
                        >
                          {tab.tab}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid border-t border-border-primary md:grid-cols-3">
                    {REPLY_TABS.map((tab, index) => {
                      const highlighted = tab.id === profile;
                      const shownOnNarrow = replyTab === tab.id;
                      return (
                        <div
                          key={tab.id}
                          role="tabpanel"
                          id={`${titleId}-panel-${tab.id}`}
                          aria-labelledby={`${titleId}-tab-${tab.id}`}
                          data-reply-column={tab.id === "A" ? "explorer" : tab.id === "B" ? "planner" : "none"}
                          data-selected={highlighted ? "true" : "false"}
                          className={`${shownOnNarrow ? "block" : "max-md:hidden"} px-4 py-3.5 text-sm leading-relaxed text-text-secondary md:block ${
                            index > 0 ? "md:border-l md:border-border-primary" : ""
                          } ${highlighted ? "bg-orange-500/10 shadow-[inset_0_3px_0_#c2410c]" : ""}`}
                        >
                          <h4 className="mb-2 hidden items-center gap-2 text-[13px] font-semibold text-text-primary md:flex">
                            <span
                              aria-hidden="true"
                              className={`h-2 w-2 rounded-full ${highlighted ? "bg-button-brand" : "bg-border-secondary"}`}
                            />
                            {tab.heading}
                          </h4>
                          <p className="whitespace-pre-line">{tab.body}</p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="border-t border-border-primary px-4 py-2.5 text-sm leading-relaxed text-text-muted">
                    {DEMO_REPLY_FOOTER}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-text-primary">
                  A model that may fit
                </h3>
                <article
                  data-testid="demo-model-card"
                  className="mt-3 grid gap-4 rounded-xl bg-bg-primary p-4 md:grid-cols-[1fr_1.2fr]"
                >
                  <div>
                    <p className="text-sm font-semibold text-text-primary">{card.modelId}</p>
                    <p className="mt-1 text-sm text-text-secondary">
                      {card.tierLabel}
                      {" · "}
                      {card.testedOn}
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-text-secondary">{card.sentence}</p>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {card.chips.map((chip) => (
                        <li key={chip} className="rounded border border-border-primary px-2 py-1 text-xs text-text-secondary">
                          {chip}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="space-y-3">
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
                    <p className="mt-3 text-xs text-text-secondary">{DEMO_CARD_BARS}</p>
                  </div>
                </article>
              </div>
            </div>
          </div>
          <p
            data-testid="example-disclaimer"
            role="status"
            className="shrink-0 rounded-b-2xl border border-border-secondary bg-bg-primary px-4 py-3 text-sm leading-relaxed text-text-secondary"
          >
            {DEMO_FRAMING}
          </p>
        </div>
      </section>

      <section className="py-12 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">{DEMO_CLOSING_TITLE}</h2>
        <p className="mt-2 text-sm text-text-muted">{DEMO_CLOSING_LINE}</p>
        <button type="button" className={`${primaryButtonClass} mt-4 min-w-[16rem]`} onClick={onStart}>
          {DEMO_CTA}
        </button>
      </section>
    </div>
  );
}
