/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, type ReactNode } from "react";
import SiteFooter from "./SiteFooter";

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Cognitive Bridge`;
    headingRef.current?.focus();
    return () => {
      document.title = previous;
    };
  }, [title]);

  return (
    <div className="min-h-screen bg-bg-primary text-text-secondary flex flex-col font-sans">
      <header className="border-b border-border-primary px-5 py-4">
        <a href="/" className="text-sm font-semibold tracking-tight text-text-primary">
          Cognitive Bridge
        </a>
      </header>
      <main className="flex-1 w-full max-w-2xl mx-auto px-5 py-10">
        <p role="status" className="text-sm text-text-muted mb-6">
          Some items in brackets are still being confirmed.
        </p>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-semibold text-text-primary outline-none border-l-2 border-status-brand pl-3"
        >
          {title}
        </h1>
        <div className="mt-6 space-y-4 text-sm leading-relaxed">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-text-primary pt-4">{heading}</h2>
      {children}
    </section>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms">
      <p>These notes explain, in plain words, what you get and how it works. Please read them before you buy.</p>
      <Section heading="What you're buying">
        <p>
          "Cognitive Bridge: Personal Interview and Results" costs $6, paid once. It is not a subscription.
          It is offered to US residents only, and you must be 18 or older to buy. One purchase per account.
        </p>
        <p>
          Your billing address must be in the 50 US states or Washington, D.C. Purchases with a billing address anywhere else, including US territories such as Puerto Rico or Guam, are refunded and access is not turned on.
        </p>
        <p>Your purchase includes:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>One AI-led interview, plus one retake.</li>
          <li>Estimated scores on five broad traits: Openness, Conscientiousness, Extraversion, Agreeableness, and Neuroticism.</li>
          <li>AI instructions written from those scores.</li>
          <li>A side-by-side chat to try those instructions: up to 50 messages a day, resets at midnight US Eastern.</li>
          <li>An untested model suggestion.</li>
        </ul>
        <p>There is no downloadable report. Your results are shown in the app.</p>
      </Section>
      <Section heading="All sales are final">
        <p>
          [SALES FINAL / REFUND WORDING, pending legal check] All sales are final, except duplicate charges, charges where you didn't get access, purchases with a billing address outside the US (these are refunded automatically), or where the law requires a refund.
        </p>
      </Section>
      <Section heading="What this is, and what it isn't">
        <p>
          Experimental and untested design hypothesis. Not therapy, and not a psychological, clinical, or medical assessment.
          Don't use it to make decisions about health, hiring, or relationships.
        </p>
      </Section>
      <Section heading="Your scores are an AI's estimate">
        <p>
          An AI scores your answers. Because of that, your scores can differ from one run to the next, including on your retake.
        </p>
      </Section>
      <Section heading="Your data and AI providers">
        <p>
          To produce your questions, scores, and chat replies, your interview answers and chat messages are sent to AI providers:
          Google (Gemini on Vertex AI) and Typesafe, which is used to check the scoring.
        </p>
        <p>
          When you're signed in, your progress and results are saved to your account. If you aren't signed in, your progress is kept
          only while the page is open, and is copied to your account when you sign in.
        </p>
        <p>
          We also record basic usage events (for example, which section you open or when you sign in) to understand how the app is used.
          Details are on the <a className="underline underline-offset-2" href="/privacy">Privacy page</a>.
        </p>
      </Section>
      <Section heading="Payment">
        <p>
          Payment is handled on a checkout page hosted by Stripe. You accept these Terms on Stripe Checkout.
          Stripe emails your receipt to the address you used at checkout.
        </p>
      </Section>
      <Section heading="Availability">
        <p>New interviews may sometimes be paused. If that happens, your results are still available if you're signed in.</p>
      </Section>
      <Section heading="Contact">
        <p>Questions, or a payment problem? Contact us at [SUPPORT EMAIL, pending Tyler].</p>
      </Section>
      <Section heading="Governing law">
        <p>[GOVERNING LAW / LEGAL CHECK, pending Tyler] New Jersey law governs these terms.</p>
      </Section>
    </LegalLayout>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy">
      <p>
        Cognitive Bridge is an experiment. It is not a clinical or diagnostic product.
        It is offered to adults (18+) in the United States.
      </p>
      <Section heading="What we collect">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <span className="font-medium text-text-primary">Sign-in:</span> you can use the app as a guest, or sign in with Google
            or with an email and password. Firebase Authentication (a Google service) handles sign-in and gives the app an account ID.
          </li>
          <li>
            <span className="font-medium text-text-primary">Email and password sign-in:</span> we collect your email address and an
            optional display name (shown in the app). Your password is handled by Firebase Authentication. We send emails to verify
            your address and, if you ask, to reset your password. If you use both Google and a password with the same email, the app
            can link them into one account.
          </li>
          <li>
            <span className="font-medium text-text-primary">Your session, if signed in:</span> your personality scores, your chat
            messages with the app, your comparison (Bridge) messages, and which section you were last on are saved to your account.
          </li>
          <li>
            <span className="font-medium text-text-primary">Usage records:</span> for each AI request we record your account ID, a
            random session ID, which feature you used, which AI model ran, how many word pieces ("tokens") went in and out, and the
            time. We also keep a daily estimate of AI cost per account and a daily count of chats. These records do not include your
            message text.
          </li>
          <li>
            <span className="font-medium text-text-primary">Feedback:</span> if you send feedback, we save the name (or "Anonymous"),
            email address and message you type.
          </li>
          <li>
            <span className="font-medium text-text-primary">Payment:</span> Stripe hosts checkout. We do not receive or store your card details. We store whether your account paid, the amount and currency, your billing country, whether you accepted the Terms, Stripe payment and checkout IDs, and any refund or dispute status.
          </li>
        </ul>
        <p>
          If you try to create an account with an email that already has one, we tell you that address is already registered so you can sign in and keep a single account. We do not say whether an email is registered when you sign in or reset a password.
        </p>
      </Section>
      <Section heading="Who processes it">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <span className="font-medium text-text-primary">Google:</span> hosts the app's sign-in, database and server code (Firebase),
            and runs the AI model (Gemini through Google Cloud Vertex AI). Your messages and the app's instructions are sent to Google
            to generate replies.
          </li>
          <li>
            <span className="font-medium text-text-primary">Typesafe:</span> to check the app's own results, the app sends Typesafe your
            interview conversation and scores, or a Bridge question with its two replies and your scores.
          </li>
          <li>
            <span className="font-medium text-text-primary">Stripe:</span> hosts the checkout page and processes the payment. Stripe receives your account email (we fill it in for you), and the name, billing address and card details you enter there, and emails your receipt.
          </li>
        </ul>
      </Section>
      <Section heading="What stays in your browser vs your account">
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <span className="font-medium text-text-primary">Guests:</span> your session is kept in the open page and is not saved to an
            account. If you sign in later, your current guest session is copied to your new account.
          </li>
          <li>
            <span className="font-medium text-text-primary">In your browser storage:</span> your light/dark theme choice, a random
            session ID for the current tab, and optional settings for a local AI server you set up yourself.
          </li>
          <li>
            <span className="font-medium text-text-primary">Your account:</span> everything listed under "Your session" above.
          </li>
        </ul>
      </Section>
      <Section heading="Usage events">
        <p>
          The app uses Google Analytics (through Firebase). It starts when a page loads, before you sign in or click anything.
          There is no consent step. It sets cookies in your browser (`_ga` and a session cookie) and sends usage data to Google,
          such as which section you open, signing in or out, sending feedback, and changing AI settings.
        </p>
      </Section>
      <Section heading="Requesting deletion">
        <p>
          To ask us to delete your account data, email [SUPPORT EMAIL, pending Tyler]. We'll review and process your request. We may keep payment records.
        </p>
      </Section>
      <Section heading="Contact">
        <p>Questions about this page: [SUPPORT EMAIL, pending Tyler].</p>
      </Section>
    </LegalLayout>
  );
}
