import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FinancialReport } from "../../src/application/dto/FinancialReport.js";
import { runCli, type CliIo } from "../../src/presentation/cli.js";

const INVOICES = fileURLToPath(new URL("../../data/sample/invoices.csv", import.meta.url));
const TRANSACTIONS = fileURLToPath(new URL("../../data/sample/transactions.csv", import.meta.url));
const BASE = ["--invoices", INVOICES, "--transactions", TRANSACTIONS, "--as-of", "2026-12-01"];

function capture(): { io: CliIo; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t) => out.push(t), err: (t) => err.push(t) }, out: () => out.join("\n"), err: () => err.join("\n") };
}

async function json(extra: string[] = [], env: Record<string, string | undefined> = {}, options = {}): Promise<{ code: number; report: FinancialReport; text: string }> {
  const c = capture();
  const code = await runCli([...BASE, "--json", ...extra], env, c.io, options);
  return { code, report: JSON.parse(c.out()) as FinancialReport, text: c.out() };
}

describe("CLI end to end (sample data)", () => {
  it("prints a readable report covering every scenario and exits 0", async () => {
    const c = capture();
    const code = await runCli([...BASE, "--no-ai"], {}, c.io);
    const text = c.out();
    expect(code).toBe(0);
    for (const needle of [
      "Financial Reconciliation Report",
      "Totals by currency",
      "Review queue",
      "IBAN_MISMATCH",
      "UNKNOWN_PAYMENT",
      "DUPLICATE_INVOICE",
      "DUPLICATE_TRANSACTION",
      "PARTIAL_PAYMENT",
      "AMOUNT_MISMATCH",
      "OVERPAYMENT",
      "AMBIGUOUS_MATCH",
      "FIELD_MATCH_WITHOUT_REFERENCE",
      "Agent collaboration trace",
      "TransactionAnalystAgent -> ExceptionAnalystAgent",
      "never approves",
      "AI mode: DEMO",
    ]) {
      expect(text).toContain(needle);
    }
  });

  it("JSON output has the expected scenario outcomes and traceability", async () => {
    const { code, report } = await json();
    expect(code).toBe(0);
    const find = (type: string) => report.anomalies.find((a) => a.type === type);

    expect(find("IBAN_MISMATCH")).toMatchObject({ risk: "HIGH", recordId: "T-006", relatedRecordIds: ["I-006"] });
    expect(find("UNKNOWN_PAYMENT")).toMatchObject({ risk: "HIGH", recordId: "T-007" });
    expect(find("DUPLICATE_INVOICE")).toMatchObject({ recordId: "I-005", relatedRecordIds: ["I-004"] });
    expect(find("DUPLICATE_TRANSACTION")).toMatchObject({ risk: "HIGH", recordId: "T-011" });
    expect(find("PARTIAL_PAYMENT")).toMatchObject({ recordId: "I-002" });
    expect(find("AMOUNT_MISMATCH")).toMatchObject({ recordId: "I-003" });
    expect(find("OVERPAYMENT")).toMatchObject({ recordId: "T-012" });

    const status = (id: string) => report.invoices.find((i) => i.invoiceId === id)?.status;
    expect(status("I-001")).toBe("PAID");
    expect(status("I-007")).toBe("PAID");
    expect(status("I-006")).toBe("REQUIRES_REVIEW");
    expect(status("I-005")).toBe("DUPLICATE");
    expect(status("I-010")).toBe("UNPAID");

    expect(report.input.validationIssues.map((i) => i.recordId)).toEqual(["I-016", "T-016"]);
    for (const anomaly of report.anomalies) {
      expect(anomaly.explanation.length).toBeGreaterThan(0);
      expect(anomaly.recommendedAction.length).toBeGreaterThan(0);
      expect(anomaly.aiInsight).not.toBeNull();
    }

    const eur = report.totalsByCurrency.find((t) => t.currency === "EUR");
    expect(eur).toMatchObject({ invoiced: "20600.00", paid: "10550.00", outstanding: "10050.00", overpaid: "50.00", notApplied: "9850.00" });
    expect(eur?.invoiced).toBe(String(Number(eur?.paid) + Number(eur?.outstanding)) + ".00");
  });

  it("is deterministic across runs", async () => {
    const first = await json();
    const second = await json();
    expect(second.text).toBe(first.text);
  });

  it("writes the JSON report with --out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thesorum-"));
    const file = join(dir, "report.json");
    const c = capture();
    const code = await runCli([...BASE, "--no-ai", "--out", file], {}, c.io);
    expect(code).toBe(0);
    const written = JSON.parse(await readFile(file, "utf8")) as FinancialReport;
    expect(written.runId).toBe("RUN-2026-12-01");
    expect(c.out()).toContain(file);
  });

  it("uses the LLM agents when a key is configured and labels the output", async () => {
    const bodies: string[] = [];
    const fetchFn = (async (_url: string, init: { body: string }) => {
      bodies.push(init.body);
      const request = JSON.parse(init.body) as { system: string };
      const reply = request.system.includes("Transaction Analyst")
        ? { summary: "LLM data review", observations: [] }
        : { summary: "LLM exception review", insights: [{ anomalyId: "ANM-001", likelyCauses: ["LLM-cause"], recommendation: "LLM says verify", suggestedPriority: "HIGH", relatedObservationIds: [] }] };
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(reply) }] }) };
    }) as unknown as typeof fetch;

    const { code, report } = await json([], { ANTHROPIC_API_KEY: "test-key" }, { fetchFn });
    expect(code).toBe(0);
    expect(report.dataQuality.source).toBe("LLM");
    expect(report.exceptionAnalysis.source).toBe("LLM");
    expect(report.anomalies.find((a) => a.id === "ANM-001")?.aiInsight?.likelyCauses).toEqual(["LLM-cause"]);
    expect(bodies).toHaveLength(2);
    expect(bodies.every((body) => !body.includes("DE44500105175407324931"))).toBe(true);
  });

  it("falls back gracefully when the LLM is unavailable", async () => {
    const fetchFn = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    const { code, report } = await json([], { ANTHROPIC_API_KEY: "test-key" }, { fetchFn });
    expect(code).toBe(0);
    expect(report.dataQuality.source).toBe("RULE_BASED_FALLBACK");
    expect(report.exceptionAnalysis.source).toBe("RULE_BASED_FALLBACK");
    expect(report.anomalies.length).toBeGreaterThan(5);
  });

  it("--no-ai never calls the network even with a key present", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      throw new Error("should not be called");
    }) as unknown as typeof fetch;
    const { code, report } = await json(["--no-ai"], { ANTHROPIC_API_KEY: "test-key" }, { fetchFn });
    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(report.dataQuality.source).toBe("RULE_BASED");
  });
});

describe("CLI errors", () => {
  it("--help exits 0", async () => {
    const c = capture();
    expect(await runCli(["--help"], {}, c.io)).toBe(0);
    expect(c.out()).toContain("Usage");
  });

  it("usage errors exit 2", async () => {
    for (const argv of [["--bogus"], ["--invoices"], [...BASE.slice(0, 6), "--as-of", "2026-02-30"]]) {
      const c = capture();
      expect(await runCli(argv, {}, c.io)).toBe(2);
      expect(c.err().length).toBeGreaterThan(0);
    }
  });

  it("a missing input file exits 1 with a clear message", async () => {
    const c = capture();
    const code = await runCli(["--invoices", "/no/such/file.csv", "--transactions", TRANSACTIONS], {}, c.io);
    expect(code).toBe(1);
    expect(c.err()).toContain("Cannot read file");
  });

  it("a CSV with missing columns exits 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "thesorum-"));
    const bad = join(dir, "bad.csv");
    await writeFile(bad, "id,amount\n1,2\n", "utf8");
    const c = capture();
    expect(await runCli(["--invoices", bad, "--transactions", TRANSACTIONS], {}, c.io)).toBe(1);
    expect(c.err()).toContain("missing required column");
  });
});
