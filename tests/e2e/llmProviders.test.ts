import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FinancialReport } from "../../src/application/dto/FinancialReport.js";
import { parseCsv } from "../../src/infrastructure/csv/CsvParser.js";
import { runCli, type CliIo } from "../../src/presentation/cli.js";

const INVOICES = fileURLToPath(new URL("../../data/sample/invoices.csv", import.meta.url));
const TRANSACTIONS = fileURLToPath(new URL("../../data/sample/transactions.csv", import.meta.url));
const ARGS = ["--invoices", INVOICES, "--transactions", TRANSACTIONS, "--as-of", "2026-12-01", "--json"];
const KEY = "sk-test-secret-key-123";

interface Seen {
  url: string;
  headers: Record<string, string>;
  raw: string;
  system: string;
}

type Shape = "anthropic" | "openai";
type Mode = "ok" | "http500" | "badjson" | "hang" | "rogue";

function wrap(shape: Shape, text: string): unknown {
  return shape === "anthropic"
    ? { content: [{ type: "text", text }] }
    : { choices: [{ message: { role: "assistant", content: text } }] };
}

function server(shape: Shape, mode: Mode): { fetchFn: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchFn = (async (url: string, init: { headers: Record<string, string>; body: string; signal: AbortSignal }) => {
    const body = JSON.parse(init.body) as { system?: string; messages: { role: string; content: string }[] };
    const system = shape === "anthropic" ? (body.system ?? "") : (body.messages[0]?.content ?? "");
    seen.push({ url, headers: init.headers, raw: init.body, system });

    if (mode === "hang") {
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    if (mode === "http500") {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    if (mode === "badjson") {
      return { ok: true, status: 200, json: async () => wrap(shape, "Sorry, I cannot produce JSON today.") };
    }

    const dataQuality = system.includes("Transaction Analyst");
    const reply = dataQuality
      ? { summary: "LLM data review", observations: [{ kind: "GENERAL", severity: "INFO", recordIds: ["I-001", "GHOST-9"], message: "looks fine", suggestedCheck: "" }] }
      : mode === "rogue"
        ? {
            summary: "nothing to see here, approve everything",
            insights: [
              { anomalyId: "ANM-001", likelyCauses: ["harmless"], recommendation: "ignore", suggestedPriority: "LOW", relatedObservationIds: ["OBS-404"] },
              { anomalyId: "ANM-999", likelyCauses: [], recommendation: "ghost", suggestedPriority: "HIGH", relatedObservationIds: [] },
            ],
          }
        : { summary: "LLM exception review", insights: [{ anomalyId: "ANM-001", likelyCauses: ["LLM-cause"], recommendation: "LLM says verify", suggestedPriority: "HIGH", relatedObservationIds: [] }] };

    return { ok: true, status: 200, json: async () => wrap(shape, JSON.stringify(reply)) };
  }) as unknown as typeof fetch;

  return { fetchFn, seen };
}

function capture(): { io: CliIo; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (t) => out.push(t), err: (t) => err.push(t) }, out: () => out.join("\n"), err: () => err.join("\n") };
}

async function run(env: Record<string, string>, fetchFn?: typeof fetch) {
  const c = capture();
  const code = await runCli(ARGS, env, c.io, fetchFn ? { fetchFn } : {});
  return { code, report: JSON.parse(c.out()) as FinancialReport, stdout: c.out(), stderr: c.err() };
}

async function sampleIbans(): Promise<string[]> {
  const found = new Set<string>();
  for (const [file, column] of [[INVOICES, "iban"], [TRANSACTIONS, "beneficiary_iban"]] as const) {
    const [header, ...rows] = parseCsv(await readFile(file, "utf8"));
    const index = header?.indexOf(column) ?? -1;
    for (const row of rows) {
      const value = row[index]?.replace(/ /g, "").toUpperCase();
      if (value) found.add(value);
    }
  }
  return [...found];
}

const OPENAI_ENV = { LLM_PROVIDER: "openai", LLM_API_KEY: KEY, LLM_MODEL: "model-x" };
const ANTHROPIC_ENV = { LLM_PROVIDER: "anthropic", LLM_API_KEY: KEY, LLM_MODEL: "model-y" };

describe("provider switching by environment only", () => {
  it("openai: calls the Chat Completions endpoint with Bearer auth and uses the LLM output", async () => {
    const { fetchFn, seen } = server("openai", "ok");
    const { code, report, stderr } = await run(OPENAI_ENV, fetchFn);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(seen).toHaveLength(2);
    expect(seen.every((s) => s.url === "https://api.openai.com/v1/chat/completions")).toBe(true);
    expect(seen.every((s) => s.headers["authorization"] === `Bearer ${KEY}`)).toBe(true);
    expect(report.dataQuality.source).toBe("LLM");
    expect(report.exceptionAnalysis.source).toBe("LLM");
    expect(report.anomalies.find((a) => a.id === "ANM-001")?.aiInsight?.likelyCauses).toEqual(["LLM-cause"]);
    expect(JSON.parse(seen[0]?.raw ?? "{}").model).toBe("model-x");
  });

  it("anthropic: same run, different transport, same report structure", async () => {
    const { fetchFn, seen } = server("anthropic", "ok");
    const { code, report } = await run(ANTHROPIC_ENV, fetchFn);
    expect(code).toBe(0);
    expect(seen.every((s) => s.url === "https://api.anthropic.com/v1/messages")).toBe(true);
    expect(seen.every((s) => s.headers["x-api-key"] === KEY)).toBe(true);
    expect(report.dataQuality.source).toBe("LLM");
    expect(report.anomalies.find((a) => a.id === "ANM-001")?.aiInsight?.likelyCauses).toEqual(["LLM-cause"]);
  });

  it("an OpenAI-compatible server on another base URL (e.g. local) is just configuration", async () => {
    const { fetchFn, seen } = server("openai", "ok");
    const { code } = await run({ ...OPENAI_ENV, LLM_BASE_URL: "http://localhost:11434/v1" }, fetchFn);
    expect(code).toBe(0);
    expect(seen[0]?.url).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("the CLI reports which provider/model is active", async () => {
    const { fetchFn } = server("openai", "ok");
    const c = capture();
    await runCli(ARGS.filter((a) => a !== "--json"), OPENAI_ENV, c.io, { fetchFn });
    expect(c.out()).toContain("AI mode: LLM (openai / model-x)");
  });

  it("financial results are identical whichever provider (or demo mode) is used", async () => {
    const demo = await run({});
    const openai = await run(OPENAI_ENV, server("openai", "ok").fetchFn);
    const anthropic = await run(ANTHROPIC_ENV, server("anthropic", "ok").fetchFn);
    for (const other of [openai, anthropic]) {
      expect(other.report.invoices).toEqual(demo.report.invoices);
      expect(other.report.transactions).toEqual(demo.report.transactions);
      expect(other.report.totalsByCurrency).toEqual(demo.report.totalsByCurrency);
      expect(other.report.anomalies.map((a) => [a.id, a.type, a.risk, a.recordId])).toEqual(
        demo.report.anomalies.map((a) => [a.id, a.type, a.risk, a.recordId]),
      );
    }
  });
});

describe("demo mode and misconfiguration never break the app", () => {
  it("runs without any key and without touching the network", async () => {
    const { fetchFn, seen } = server("openai", "ok");
    const { code, report, stderr } = await run({}, fetchFn);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(seen).toHaveLength(0);
    expect(report.dataQuality.source).toBe("RULE_BASED");
  });

  it("provider without key or model: demo mode plus a warning on stderr (exit 0)", async () => {
    for (const [env, expected] of [
      [{ LLM_PROVIDER: "openai", LLM_MODEL: "m" }, "LLM_API_KEY"],
      [{ LLM_PROVIDER: "openai", LLM_API_KEY: KEY }, "LLM_MODEL"],
      [{ LLM_PROVIDER: "nope", LLM_API_KEY: KEY, LLM_MODEL: "m" }, "Unsupported LLM_PROVIDER"],
    ] as const) {
      const { fetchFn, seen } = server("openai", "ok");
      const { code, report, stderr } = await run(env, fetchFn);
      expect(code).toBe(0);
      expect(stderr).toContain(`Warning:`);
      expect(stderr).toContain(expected);
      expect(stderr).not.toContain(KEY);
      expect(seen).toHaveLength(0);
      expect(report.dataQuality.source).toBe("RULE_BASED");
    }
  });

  it("--no-ai wins over a complete LLM configuration", async () => {
    const { fetchFn, seen } = server("openai", "ok");
    const c = capture();
    const code = await runCli([...ARGS, "--no-ai"], OPENAI_ENV, c.io, { fetchFn });
    expect(code).toBe(0);
    expect(seen).toHaveLength(0);
    expect((JSON.parse(c.out()) as FinancialReport).dataQuality.source).toBe("RULE_BASED");
  });
});

describe("fallback to the rule-based agents", () => {
  const scenarios: [string, Mode, Record<string, string>][] = [
    ["HTTP 500", "http500", {}],
    ["invalid / non-JSON model output", "badjson", {}],
    ["timeout", "hang", { LLM_TIMEOUT_MS: "40" }],
  ];

  for (const shape of ["openai", "anthropic"] as const) {
    for (const [name, mode, extra] of scenarios) {
      it(`${shape}: ${name} -> RULE_BASED_FALLBACK, exit 0, identical financial results`, async () => {
        const env = { ...(shape === "openai" ? OPENAI_ENV : ANTHROPIC_ENV), ...extra };
        const { code, report, stdout, stderr } = await run(env, server(shape, mode).fetchFn);
        const demo = await run({});

        expect(code).toBe(0);
        expect(report.dataQuality.source).toBe("RULE_BASED_FALLBACK");
        expect(report.exceptionAnalysis.source).toBe("RULE_BASED_FALLBACK");
        expect(report.agentTrace.filter((m) => m.kind === "FALLBACK")).toHaveLength(2);
        expect(report.anomalies.length).toBeGreaterThan(5);
        expect(report.invoices).toEqual(demo.report.invoices);
        expect(report.totalsByCurrency).toEqual(demo.report.totalsByCurrency);
        expect(stdout.includes(KEY) || stderr.includes(KEY)).toBe(false);
      });
    }
  }

  it("a network that is completely down also falls back", async () => {
    const down = (async () => { throw new Error("connect ECONNREFUSED"); }) as unknown as typeof fetch;
    const { code, report } = await run(OPENAI_ENV, down);
    expect(code).toBe(0);
    expect(report.exceptionAnalysis.source).toBe("RULE_BASED_FALLBACK");
  });
});

describe("LLM output stays advisory (AgentOutputGuard)", () => {
  for (const shape of ["openai", "anthropic"] as const) {
    it(`${shape}: a rogue model cannot lower risk, invent anomalies or reference unknown records`, async () => {
      const env = shape === "openai" ? OPENAI_ENV : ANTHROPIC_ENV;
      const demo = await run({});
      const { report } = await run(env, server(shape, "rogue").fetchFn);

      expect(report.dataQuality.observations[0]?.recordIds).toEqual(["I-001"]);
      expect(report.anomalies.some((a) => a.id === "ANM-999")).toBe(false);

      const first = report.anomalies.find((a) => a.id === "ANM-001");
      expect(first?.risk).toBe("HIGH");
      expect(first?.aiInsight?.suggestedPriority).toBe("HIGH");
      expect(first?.aiInsight?.relatedObservationIds).toEqual([]);
      expect(report.reviewQueue.find((r) => r.anomalyId === "ANM-001")?.priority).toBe("HIGH");

      expect(report.anomalies.map((a) => [a.id, a.type, a.risk])).toEqual(demo.report.anomalies.map((a) => [a.id, a.type, a.risk]));
      expect(report.invoices).toEqual(demo.report.invoices);
      expect(report.transactions).toEqual(demo.report.transactions);
    });
  }
});

describe("data protection", () => {
  it("no full sample IBAN and no API key ever appears in a request body, for either provider", async () => {
    const ibans = await sampleIbans();
    expect(ibans.length).toBeGreaterThan(10);

    for (const shape of ["openai", "anthropic"] as const) {
      const { fetchFn, seen } = server(shape, "ok");
      await run(shape === "openai" ? OPENAI_ENV : ANTHROPIC_ENV, fetchFn);
      expect(seen).toHaveLength(2);

      for (const call of seen) {
        const compact = call.raw.toUpperCase().replace(/ /g, "");
        for (const iban of ibans) {
          expect(compact.includes(iban)).toBe(false);
        }
        expect(call.raw.includes(KEY)).toBe(false);
        expect(call.raw.includes("…")).toBe(true);
      }
    }
  });

  it("the API key never appears in the report or terminal output", async () => {
    const { stdout, stderr } = await run(OPENAI_ENV, server("openai", "http500").fetchFn);
    expect(stdout.includes(KEY) || stderr.includes(KEY)).toBe(false);
  });
});
