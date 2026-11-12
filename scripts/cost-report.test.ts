import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  USAGE_READ_FIELDS,
  buildReport,
  costForRow,
  filterUsageRows,
  firebaseProjectId,
  formatSummary,
  formatSummaryMarkdown,
  loadPricing,
  parseCostReportFilters,
  parseReservationIds,
  percentile,
  projectUsageRow,
  readUsageRows,
  redactEmails,
  safeErrorMessage,
  shortUidHash,
  summarizeSessions,
  writeGitHubStepSummary,
  type UsageDb,
  type UsageQuery,
  type UsageRow,
} from "./cost-report";

const workflowPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.github/workflows/cost-report.yml"
);

describe("cost report", () => {
  it("reports median and p90 tokens and placeholder dollars per session", () => {
    const table = loadPricing();
    expect(table.placeholder).toBe(true);
    expect(table.comment).toMatch(/PLACEHOLDER/);

    const summary = summarizeSessions([
      { sessionId: "a", model: "gemini-2.5-flash", promptTokens: 1_000_000, completionTokens: 0, feature: "mirror" },
      { sessionId: "a", model: "jev-latest", promptTokens: 0, completionTokens: 0, feature: "judge" },
      { sessionId: "b", model: "gemini-2.5-flash", promptTokens: 0, completionTokens: 2_000_000, feature: "bridge" },
      { sessionId: null, model: "gemini-2.5-flash", promptTokens: 50, completionTokens: 50 },
    ], table);

    expect(summary.interviewCount).toBe(2);
    expect(summary.skippedWithoutSession).toBe(1);
    expect(summary.medianTokens).toBe(percentile([1_000_000, 2_000_000], 0.5));
    expect(summary.p90Tokens).toBe(percentile([1_000_000, 2_000_000], 0.9));
    const flash = table.models["gemini-2.5-flash"];
    expect(costForRow(
      { model: "gemini-2.5-flash", promptTokens: 1_000_000, completionTokens: 0 },
      table
    )).toBeCloseTo(flash.inputPerMillionUsd);
    const mirror = summary.interviews.find((item) => item.id === "a");
    expect(mirror?.calls).toBe(2);
    expect(mirror?.usdByFeature.judge).toBe(0);
    expect(mirror?.usd).toBeCloseTo(flash.inputPerMillionUsd);
    expect(summary.medianUsd).toBeGreaterThan(0);
    expect(summary.p90Usd).toBeGreaterThanOrEqual(summary.medianUsd);
  });

  it("groups by reservationId, falls back to sessionId, and prices judge rows at $0", () => {
    const table = loadPricing();
    const summary = summarizeSessions([
      { reservationId: "iv-1", sessionId: "tab", feature: "mirror", model: "gemini-2.5-flash", promptTokens: 1_000_000, completionTokens: 0 },
      { reservationId: "iv-1", sessionId: "tab", feature: "judge", model: "jev-latest", promptTokens: 0, completionTokens: 0 },
      { reservationId: "iv-2", sessionId: "tab", feature: "chat", model: "gemini-2.5-flash", promptTokens: 0, completionTokens: 1_000_000 },
      { reservationId: "   ", sessionId: "legacy", feature: "mirror", model: "gemini-2.5-flash", promptTokens: 500_000, completionTokens: 0 },
      { feature: "judge", model: "jev-latest", promptTokens: 10, completionTokens: 10 },
    ], table);

    expect(summary.interviewCount).toBe(3);
    expect(summary.skippedWithoutSession).toBe(1);
    const byId = Object.fromEntries(summary.interviews.map((item) => [item.id, item]));
    expect(byId["iv-1"].calls).toBe(2);
    expect(byId["iv-1"].tokens).toBe(1_000_000);
    expect(byId["iv-1"].usdByFeature.mirror).toBeCloseTo(table.models["gemini-2.5-flash"].inputPerMillionUsd);
    expect(byId["iv-1"].usdByFeature.judge).toBe(0);
    expect(byId["iv-1"].usd).toBeCloseTo(byId["iv-1"].usdByFeature.mirror);
    expect(byId["iv-2"].usd).toBeCloseTo(table.models["gemini-2.5-flash"].outputPerMillionUsd);
    expect(byId["iv-2"].id).not.toBe("tab");
    expect(byId.legacy.tokens).toBe(500_000);
    expect(summary.medianUsd).toBeCloseTo(byId["iv-1"].usd);
    expect(summary.p90Usd).toBeGreaterThan(summary.medianUsd);

    const text = formatSummary(summary, table);
    expect(text).toMatch(/PLACEHOLDERS/);
    expect(text).toMatch(/Jev judge rows record \$0/);
    expect(text).toContain("iv-1");
    expect(text).toContain("iv-2");
    expect(text).toContain(`Median estimated USD per interview: ${summary.medianUsd.toFixed(6)}`);
    expect(text).toContain(`P90 estimated USD per interview: ${summary.p90Usd.toFixed(6)}`);
  });

  it("filters by since, until, and reservation ids before the overall median", () => {
    const table = loadPricing();
    const rows: UsageRow[] = [
      { reservationId: "iv-1", uid: "user-a", feature: "mirror", model: "gemini-2.5-flash", promptTokens: 100, completionTokens: 10, ts: "2026-01-01T00:00:00.000Z" },
      { reservationId: "iv-2", uid: "user-b", feature: "mirror", model: "gemini-2.5-flash", promptTokens: 300, completionTokens: 0, ts: "2026-02-01T12:00:00.000Z" },
      { reservationId: "iv-3", uid: "user-c", feature: "chat", model: "gemini-2.5-flash", promptTokens: 500, completionTokens: 0, ts: "2026-03-01T23:59:59.999Z" },
      { reservationId: "iv-4", sessionId: "orphan", feature: "mirror", model: "gemini-2.5-flash", promptTokens: 900, completionTokens: 0 },
    ];

    const february = parseCostReportFilters([], {
      COST_REPORT_SINCE: "2026-02-01",
      COST_REPORT_UNTIL: "2026-02-01",
    });
    expect(february.since?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(february.until?.toISOString()).toBe("2026-02-01T23:59:59.999Z");
    const feb = buildReport(rows, february, table);
    expect(feb.interviews.map((item) => item.id)).toEqual(["iv-2"]);
    expect(feb.medianTokens).toBe(300);
    expect(feb.p90Tokens).toBe(300);

    const ids = parseCostReportFilters(
      ["--since", "2026-01-15T00:00:00.000Z", "--reservation-ids", "iv-2, iv-3, iv-2"],
      { COST_REPORT_SINCE: "2026-01-01", COST_REPORT_RESERVATION_IDS: "iv-1" }
    );
    expect(ids.since?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(ids.reservationIds).toEqual(["iv-2", "iv-3"]);
    const selected = buildReport(rows, ids, table);
    expect(selected.interviews.map((item) => item.id)).toEqual(["iv-2", "iv-3"]);
    expect(selected.medianTokens).toBe(percentile([300, 500], 0.5));
    expect(selected.p90Tokens).toBe(percentile([300, 500], 0.9));

    const stamped = filterUsageRows(rows, parseCostReportFilters(["--since=2026-01-01T00:00:00.000Z"], {}));
    expect(stamped.map((row) => row.reservationId)).toEqual(["iv-1", "iv-2", "iv-3"]);

    const open = filterUsageRows(rows, parseCostReportFilters([], {}));
    expect(open).toHaveLength(4);
  });

  it("accepts Firestore timestamps and inclusive ISO bounds", () => {
    const instant = new Date("2026-06-15T12:30:00.000Z");
    const seconds = Math.floor(instant.getTime() / 1000);
    const filters = parseCostReportFilters(["--since", instant.toISOString(), "--until", instant.toISOString()], {});
    const kept = filterUsageRows([
      { reservationId: "iv-seconds", ts: { seconds, nanoseconds: 0 } },
      { reservationId: "iv-date", ts: { toDate: () => instant } },
      { reservationId: "iv-ms", ts: instant.getTime() },
      { reservationId: "iv-early", ts: { seconds: seconds - 1, nanoseconds: 0 } },
    ], filters);
    expect(kept.map((row) => row.reservationId)).toEqual(["iv-seconds", "iv-date", "iv-ms"]);
  });

  it("rejects bad bounds and reservation ids without echoing them", () => {
    expect(() => parseCostReportFilters(["--since", "2026-02-31"], {})).toThrow(/Invalid since/);
    expect(() => parseCostReportFilters(["--until", "yesterday"], {})).toThrow(/Invalid until/);
    expect(() => parseCostReportFilters(["--since", "2026-03-02", "--until", "2026-03-01"], {})).toThrow(/since is after until/);
    expect(() => parseCostReportFilters(["--bogus=super-secret-value"], {})).toThrow(/Unknown argument/);
    expect(() => parseReservationIds("iv-1, person@example.com")).toThrow(/Invalid reservation id/);
    try {
      parseReservationIds("person@example.com");
      throw new Error("expected reservation parser to throw");
    } catch (error) {
      expect(String(error)).not.toContain("person@example.com");
    }
    try {
      parseCostReportFilters(["--bogus=super-secret-value"], {});
      throw new Error("expected argument parser to throw");
    } catch (error) {
      expect(String(error)).not.toContain("super-secret-value");
    }
  });

  it("prints per-interview hash, span, feature counts, model flags, tokens, and USD", () => {
    const table = loadPricing();
    const email = "person@example.com";
    const uid = "firebaseUidAbc123XYZ";
    const transcript = "secret interview transcript zephyr-quartz";
    const summary = summarizeSessions([
      {
        reservationId: "iv-9",
        sessionId: "sess",
        uid,
        feature: "mirror",
        model: "gemini-2.5-flash",
        promptTokens: 1_000,
        completionTokens: 40,
        ts: "2026-04-02T15:00:00.000Z",
      },
      {
        reservationId: "iv-9",
        sessionId: "sess",
        uid: email,
        feature: "judge",
        model: "jev-latest",
        promptTokens: 0,
        completionTokens: 0,
        ts: "2026-04-02T15:04:05.000Z",
      },
      {
        reservationId: "iv-9",
        uid,
        feature: "bridge",
        model: "models/gemini-3.1-pro-preview",
        promptTokens: 2_000,
        completionTokens: 80,
        ts: "2026-04-02T16:00:00.000Z",
      },
      {
        reservationId: "iv-9",
        uid,
        feature: transcript,
        model: `${transcript} mentions gemini-3.1-pro-preview`,
        promptTokens: 5,
        completionTokens: 5,
        ts: "2026-04-02T16:05:00.000Z",
      },
      {
        sessionId: email,
        uid: email,
        feature: "chat",
        model: "gemini-2.5-flash-lite",
        promptTokens: 10,
        completionTokens: 1,
        ts: "2026-04-03T00:00:00.000Z",
      },
    ], table);

    const interview = summary.interviews.find((item) => item.id === "iv-9");
    expect(interview?.promptTokens).toBe(3005);
    expect(interview?.completionTokens).toBe(125);
    expect(interview?.callsByFeature.mirror).toBe(1);
    expect(interview?.callsByFeature.judge).toBe(1);
    expect(interview?.callsByFeature.bridge).toBe(1);
    expect(interview?.callsByModel["gemini-2.5-flash"]).toBe(1);
    expect(interview?.callsByModel["gemini-3.1-pro-preview"]).toBe(2);
    expect(interview?.callsByModel["jev-latest"]).toBe(1);
    expect(interview?.proPreviewCalls).toBe(2);
    expect(interview?.firstTs).toBe("2026-04-02T15:00:00.000Z");
    expect(interview?.lastTs).toBe("2026-04-02T16:05:00.000Z");
    expect(interview?.uidHashes).toEqual([shortUidHash(email), shortUidHash(uid)].sort());
    expect(interview?.uidHashes.join(",")).not.toContain(uid);
    expect(interview?.uidHashes.join(",")).not.toContain(email);

    const filters = parseCostReportFilters([], { COST_REPORT_RESERVATION_IDS: "iv-9" });
    const text = formatSummary(summary, table, filters);
    const markdown = formatSummaryMarkdown(summary, table, filters);
    for (const output of [text, markdown]) {
      expect(output).not.toContain(email);
      expect(output).not.toContain(uid);
      expect(output).not.toContain(transcript);
      expect(output).not.toContain("zephyr-quartz");
      expect(output).toContain(shortUidHash(uid));
      expect(output).toContain(shortUidHash(email));
      expect(output).toContain("gemini-3.1-pro-preview=2[FLAG gemini-3.1-pro-preview]");
      expect(output).toContain("jev-latest=1[FLAG non-default-model]");
      expect(output).toContain("gemini-2.5-flash-lite=1[FLAG non-default-model]");
      expect(output).toContain("non-default-model,gemini-3.1-pro-preview");
      expect(output).toContain("bridge=1");
      expect(output).toContain("judge=1");
      expect(output).toContain("mirror=1");
      expect(output).toContain("2026-04-02T15:00:00.000Z");
      expect(output).toContain("2026-04-02T16:05:00.000Z");
      expect(output).toContain("3005");
      expect(output).toContain("125");
      expect(output).toContain(`Median estimated USD per interview: ${summary.medianUsd.toFixed(6)}`);
      expect(output).toContain(`P90 estimated USD per interview: ${summary.p90Usd.toFixed(6)}`);
      expect(output).toContain("Overall:");
      expect(output).toContain(`gemini-3.1-pro-preview calls: ${summary.proPreviewCalls}`);
    }
    expect(text).toContain("promptTokens=3005");
    expect(text).toContain("completionTokens=125");
    expect(text).toContain("first=2026-04-02T15:00:00.000Z");
    expect(text).toContain("last=2026-04-02T16:05:00.000Z");
    expect(text).toContain("gemini-2.5-flash=1");
    expect(text).not.toContain("gemini-2.5-flash=1[FLAG");
    expect(markdown).toContain("| Interview | UID hash |");
    expect(markdown).toContain(`id_${shortUidHash(email)}`);
    expect(summary.proPreviewCalls).toBe(2);
    expect(summary.nonDefaultModelCalls).toBe(4);
  });

  it("reads only usage fields and drops message content before formatting", async () => {
    expect([...USAGE_READ_FIELDS]).toEqual([
      "uid",
      "sessionId",
      "reservationId",
      "feature",
      "model",
      "promptTokens",
      "completionTokens",
      "ts",
    ]);
    const selected: string[] = [];
    const payload = {
      uid: "firebaseUidAbc123XYZ",
      sessionId: "sess",
      reservationId: "iv-1",
      feature: "mirror",
      model: "gemini-2.5-flash",
      promptTokens: 3,
      completionTokens: 4,
      ts: "2026-01-02T00:00:00.000Z",
      email: "person@example.com",
      messages: [{ content: "leak-this-transcript" }],
      prompt: "system prompt leak-this-transcript",
    };
    const query: UsageQuery = {
      select(...fields: string[]) {
        selected.push(...fields);
        return query;
      },
      async get() {
        return { docs: [{ data: () => payload }] };
      },
    };
    const db: UsageDb = {
      collection(name: string) {
        expect(name).toBe("usage_server");
        return query;
      },
    };
    const rows = await readUsageRows(db);
    expect(selected).toEqual([...USAGE_READ_FIELDS]);
    expect(rows[0]).toEqual({
      uid: payload.uid,
      sessionId: payload.sessionId,
      reservationId: payload.reservationId,
      feature: payload.feature,
      model: payload.model,
      promptTokens: payload.promptTokens,
      completionTokens: payload.completionTokens,
      ts: payload.ts,
    });
    expect(rows[0]).not.toHaveProperty("email");
    expect(rows[0]).not.toHaveProperty("messages");
    expect(JSON.stringify(rows)).not.toContain("leak-this-transcript");
    expect(JSON.stringify(rows)).not.toContain("person@example.com");

    const projected = projectUsageRow(payload);
    expect(projected).not.toHaveProperty("email");
    const text = formatSummary(summarizeSessions(rows, loadPricing()));
    expect(text).not.toContain("firebaseUidAbc123XYZ");
    expect(text).toContain(shortUidHash("firebaseUidAbc123XYZ"));
    expect(text).toContain("flags=-");
  });

  it("appends the markdown report to GITHUB_STEP_SUMMARY and redacts auth errors", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cost-report-"));
    const file = path.join(dir, "summary.md");
    try {
      const summary = summarizeSessions([
        { reservationId: "iv-1", model: "gemini-2.5-flash", promptTokens: 10, completionTokens: 2, feature: "mirror" },
      ], loadPricing());
      const markdown = formatSummaryMarkdown(summary);
      writeGitHubStepSummary(markdown, { GITHUB_STEP_SUMMARY: file });
      writeGitHubStepSummary("second", { GITHUB_STEP_SUMMARY: file });
      writeGitHubStepSummary("not-written", {});
      const written = readFileSync(file, "utf8");
      expect(written.startsWith(markdown)).toBe(true);
      expect(written.endsWith("second\n")).toBe(true);
      expect(written).toContain("Median estimated USD per interview:");
      expect(written).not.toContain("not-written");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(safeErrorMessage(new Error("-----BEGIN PRIVATE KEY-----\nabc"))).toBe("cost report failed during authentication");
    expect(safeErrorMessage(new Error('{"private_key":"hidden"}'))).toBe("cost report failed during authentication");
    const redacted = safeErrorMessage(new Error("user person@example.com failed"));
    expect(redacted).not.toContain("person@example.com");
    expect(redacted).toContain("[redacted-email]");
    expect(redactEmails("ok")).toBe("ok");
  });

  it("uses the deploy project id unless the environment sets one", () => {
    expect(firebaseProjectId({})).toBe("cognitive-bridge-ai");
    expect(firebaseProjectId({ GOOGLE_CLOUD_PROJECT: "cognitive-bridge-ai" })).toBe("cognitive-bridge-ai");
    expect(firebaseProjectId({ GCLOUD_PROJECT: "other-project" })).toBe("other-project");
  });

  it("keeps the workflow manual, read-only, and on the deploy service account", () => {
    const yaml = readFileSync(workflowPath, "utf8");
    expect(yaml).toMatch(/workflow_dispatch:/);
    expect(yaml).toMatch(/since:/);
    expect(yaml).toMatch(/until:/);
    expect(yaml).toMatch(/reservation_ids:/);
    expect(yaml).toMatch(/required: false/);
    expect(yaml).not.toMatch(/^\s*(push|pull_request|schedule):/m);
    expect(yaml).toContain("secrets.FIREBASE_SERVICE_ACCOUNT_COGNITIVE_BRIDGE_AI");
    expect(yaml).toContain("google-github-actions/auth@v2");
    expect(yaml).toContain("credentials_json:");
    expect(yaml).toContain("project_id: cognitive-bridge-ai");
    expect(yaml).toContain("GOOGLE_CLOUD_PROJECT: cognitive-bridge-ai");
    expect(yaml).toContain("npx tsx scripts/cost-report.ts");
    expect(yaml).not.toMatch(/\becho\b/i);
    expect(yaml).not.toContain("set -x");
    expect(yaml).not.toMatch(/firebase-tools|firestore:delete|action-hosting-deploy|deploy --only/);
    expect(yaml).toContain("${{ secrets.FIREBASE_SERVICE_ACCOUNT_COGNITIVE_BRIDGE_AI }}");
    expect(yaml.match(/secrets\.FIREBASE_SERVICE_ACCOUNT_COGNITIVE_BRIDGE_AI/g)).toHaveLength(2);
  });
});
