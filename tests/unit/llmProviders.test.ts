import { describe, expect, it } from "vitest";
import { AIAnalysisError } from "../../src/application/ports/AIAnalysisPort.js";
import type { DataQualityFacts } from "../../src/application/dto/DataQualityFacts.js";
import { LlmAnalysisAdapter, maskIbans } from "../../src/infrastructure/ai/LlmAnalysisAdapter.js";
import { createLlmClient, resolveLlmConfig } from "../../src/infrastructure/ai/LlmConfig.js";
import { AnthropicClient } from "../../src/infrastructure/ai/providers/AnthropicClient.js";
import { OpenAiCompatibleClient } from "../../src/infrastructure/ai/providers/OpenAiCompatibleClient.js";
import { IBANS } from "../helpers/builders.js";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  raw: string;
}

function recorder(reply: { ok?: boolean; status?: number; body: unknown }): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown>, raw: init.body });
    return { ok: reply.ok ?? true, status: reply.status ?? 200, json: async () => reply.body };
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

const request = { system: "SYS", user: "USER", maxTokens: 321 };
const SECRET = "sk-super-secret-key";

describe("AnthropicClient", () => {
  it("sends the Messages API request and parses text blocks", async () => {
    const { fetchFn, calls } = recorder({ body: { content: [{ type: "text", text: "he" }, { type: "tool_use" }, { type: "text", text: "llo" }] } });
    const client = new AnthropicClient({ apiKey: SECRET, model: "m-1", timeoutMs: 1000, fetchFn });
    expect(await client.complete({ ...request, temperature: 0.3 })).toBe("hello");

    const call = calls[0];
    expect(call?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call?.headers["x-api-key"]).toBe(SECRET);
    expect(call?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(call?.headers["authorization"]).toBeUndefined();
    expect(call?.body).toEqual({
      model: "m-1",
      max_tokens: 321,
      temperature: 0.3,
      system: "SYS",
      messages: [{ role: "user", content: "USER" }],
    });
  });

  it("honours a custom base URL and defaults temperature to 0", async () => {
    const { fetchFn, calls } = recorder({ body: { content: [{ type: "text", text: "x" }] } });
    await new AnthropicClient({ apiKey: "k", model: "m", baseUrl: "https://proxy.example/anthropic", timeoutMs: 1000, fetchFn }).complete(request);
    expect(calls[0]?.url).toBe("https://proxy.example/anthropic/v1/messages");
    expect(calls[0]?.body["temperature"]).toBe(0);
  });

  it("rejects responses without text", async () => {
    for (const body of [{}, { content: [] }, { content: [{ type: "text", text: "  " }] }]) {
      const { fetchFn } = recorder({ body });
      const error = await rejection(new AnthropicClient({ apiKey: "k", model: "m", timeoutMs: 1000, fetchFn }).complete(request));
      expect(error instanceof AIAnalysisError).toBe(true);
    }
  });
});

describe("OpenAiCompatibleClient", () => {
  it("sends a Chat Completions request with Bearer auth and parses the message", async () => {
    const { fetchFn, calls } = recorder({ body: { choices: [{ message: { role: "assistant", content: "{\"ok\":true}" } }] } });
    const client = new OpenAiCompatibleClient({ apiKey: SECRET, model: "gpt-x", timeoutMs: 1000, fetchFn });
    expect(await client.complete(request)).toBe("{\"ok\":true}");

    const call = calls[0];
    expect(call?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call?.headers["authorization"]).toBe(`Bearer ${SECRET}`);
    expect(call?.headers["x-api-key"]).toBeUndefined();
    expect(call?.headers["anthropic-version"]).toBeUndefined();
    expect(call?.body).toEqual({
      model: "gpt-x",
      max_tokens: 321,
      messages: [
        { role: "system", content: "SYS" },
        { role: "user", content: "USER" },
      ],
    });
  });

  it("omits temperature unless set, supports a custom base URL and content-part arrays", async () => {
    const { fetchFn, calls } = recorder({ body: { choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] } });
    const client = new OpenAiCompatibleClient({ apiKey: "k", model: "m", baseUrl: "http://localhost:11434/v1", timeoutMs: 1000, fetchFn });
    expect(await client.complete(request)).toBe("ab");
    expect(calls[0]?.url).toBe("http://localhost:11434/v1/chat/completions");
    expect("temperature" in (calls[0]?.body ?? {})).toBe(false);
    await client.complete({ ...request, temperature: 0 });
    expect(calls[1]?.body["temperature"]).toBe(0);
  });

  it("rejects responses without message text", async () => {
    for (const body of [{}, { choices: [] }, { choices: [{ message: { content: null } }] }, { choices: [{ message: { content: "" } }] }]) {
      const { fetchFn } = recorder({ body });
      const error = await rejection(new OpenAiCompatibleClient({ apiKey: "k", model: "m", timeoutMs: 1000, fetchFn }).complete(request));
      expect(error instanceof AIAnalysisError).toBe(true);
    }
  });
});

describe("error normalisation (shared by all transports)", () => {
  const clients = (fetchFn: typeof fetch, timeoutMs = 1000) => [
    new AnthropicClient({ apiKey: SECRET, model: "m", timeoutMs, fetchFn }),
    new OpenAiCompatibleClient({ apiKey: SECRET, model: "m", timeoutMs, fetchFn }),
  ];

  it("HTTP errors become AIAnalysisError with the status but no secrets or body", async () => {
    const { fetchFn } = recorder({ ok: false, status: 401, body: { error: `bad key ${SECRET}` } });
    for (const client of clients(fetchFn)) {
      const error = await rejection(client.complete(request));
      expect(error instanceof AIAnalysisError).toBe(true);
      expect((error as Error).message).toContain("HTTP 401");
      expect((error as Error).message).not.toContain(SECRET);
    }
  });

  it("a non-JSON body becomes AIAnalysisError", async () => {
    const fetchFn = (async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } })) as unknown as typeof fetch;
    for (const client of clients(fetchFn)) {
      expect((await rejection(client.complete(request))) instanceof AIAnalysisError).toBe(true);
    }
  });

  it("network failures and timeouts become AIAnalysisError", async () => {
    const down = (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as unknown as typeof fetch;
    const hanging = (async (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;

    for (const client of clients(down)) {
      const error = await rejection(client.complete(request));
      expect(error instanceof AIAnalysisError).toBe(true);
      expect((error as Error).message).toContain("ENOTFOUND");
    }
    for (const client of clients(hanging, 25)) {
      const error = await rejection(client.complete(request));
      expect(error instanceof AIAnalysisError).toBe(true);
      expect((error as Error).message).toContain("timed out");
    }
  });
});

describe("IBAN masking before any external call", () => {
  it("masks compact, spaced, lower-case and embedded IBANs", () => {
    const text = `a ${IBANS.acme} b ${IBANS.beta.toLowerCase()} c DE89 3704 0044 0532 0130 00 d "ref:${IBANS.other}"`;
    const masked = maskIbans(text);
    expect(masked).toBe('a DE89…3000 b NL91…4300 c DE89…3000 d "ref:DE44…4931"');
  });

  it("leaves ordinary identifiers alone", () => {
    expect(maskIbans("INV-2026-001 T-006 2026-10-31 1200.00 EUR I-015")).toBe("INV-2026-001 T-006 2026-10-31 1200.00 EUR I-015");
  });

  it("the adapter sends no full IBAN to any provider, even when it hides in free text", async () => {
    const facts: DataQualityFacts = {
      invoiceCount: 1,
      transactionCount: 1,
      validationIssues: [
        { recordType: "TRANSACTION", rowNumber: 1, recordId: "T-1", field: null, code: "INVALID_TRANSACTION", message: `paid to de89 3704 0044 0532 0130 00 and ${IBANS.other}` },
      ],
      duplicateInvoiceGroups: [],
      duplicateTransactionGroups: [],
      transactionsWithoutReference: [],
      suppliersWithMultipleIbans: [{ supplierName: "Acme", ibans: [IBANS.acme, IBANS.other], invoiceIds: ["I-1"] }],
      ibansSharedBySuppliers: [],
    };
    const reply = { summary: "s", observations: [] };

    const a = recorder({ body: { content: [{ type: "text", text: JSON.stringify(reply) }] } });
    const o = recorder({ body: { choices: [{ message: { content: JSON.stringify(reply) } }] } });
    await new LlmAnalysisAdapter(new AnthropicClient({ apiKey: "k", model: "m", timeoutMs: 1000, fetchFn: a.fetchFn })).analyzeDataQuality(facts);
    await new LlmAnalysisAdapter(new OpenAiCompatibleClient({ apiKey: "k", model: "m", timeoutMs: 1000, fetchFn: o.fetchFn })).analyzeDataQuality(facts);

    for (const raw of [a.calls[0]?.raw ?? "", o.calls[0]?.raw ?? ""]) {
      expect(raw.length).toBeGreaterThan(0);
      for (const iban of [IBANS.acme, IBANS.other]) {
        expect(raw.includes(iban)).toBe(false);
      }
      expect(raw.toUpperCase().replace(/ /g, "").includes("DE89370400440532013000")).toBe(false);
      expect(raw.includes("DE89…3000")).toBe(true);
    }
  });
});

describe("resolveLlmConfig", () => {
  it("returns nothing (demo mode, no warning) when nothing is configured", () => {
    expect(resolveLlmConfig({})).toEqual({});
    expect(resolveLlmConfig({ LLM_MODEL: "x" })).toEqual({});
  });

  it("supports the legacy ANTHROPIC_API_KEY setup", () => {
    const { config, warning } = resolveLlmConfig({ ANTHROPIC_API_KEY: "k", THESORUM_LLM_MODEL: "legacy-model" });
    expect(warning).toBeUndefined();
    expect(config).toMatchObject({ provider: "anthropic", apiKey: "k", model: "legacy-model", timeoutMs: 45000, maxTokens: 4096 });
    expect(resolveLlmConfig({ ANTHROPIC_API_KEY: "k" }).config?.model.length).toBeGreaterThan(0);
  });

  it("reads the generic LLM_* variables for both providers", () => {
    const openai = resolveLlmConfig({
      LLM_PROVIDER: "OpenAI",
      LLM_API_KEY: "k",
      LLM_MODEL: "m",
      LLM_BASE_URL: "https://api.example.com/v1/",
      LLM_TIMEOUT_MS: "1500",
      LLM_MAX_TOKENS: "900",
      LLM_TEMPERATURE: "0.2",
    });
    expect(openai.config).toEqual({
      provider: "openai",
      apiKey: "k",
      model: "m",
      baseUrl: "https://api.example.com/v1",
      timeoutMs: 1500,
      maxTokens: 900,
      temperature: 0.2,
    });
    expect(resolveLlmConfig({ LLM_PROVIDER: "openai-compatible", LLM_API_KEY: "k", LLM_MODEL: "m" }).config?.provider).toBe("openai");
    expect(resolveLlmConfig({ LLM_PROVIDER: "anthropic", LLM_API_KEY: "k", LLM_MODEL: "m" }).config?.temperature).toBeUndefined();
  });

  it("lets provider=anthropic reuse ANTHROPIC_API_KEY, but never for other providers", () => {
    expect(resolveLlmConfig({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", LLM_MODEL: "m" }).config?.apiKey).toBe("k");
    expect(resolveLlmConfig({ LLM_PROVIDER: "openai", ANTHROPIC_API_KEY: "k", LLM_MODEL: "m" }).config).toBeUndefined();
  });

  it("explains every misconfiguration with a warning and no config", () => {
    const cases: Record<string, Record<string, string>> = {
      "LLM_PROVIDER is missing": { LLM_API_KEY: "k" },
      "Unsupported LLM_PROVIDER": { LLM_PROVIDER: "gemini", LLM_API_KEY: "k", LLM_MODEL: "m" },
      "LLM_API_KEY is not set": { LLM_PROVIDER: "openai", LLM_MODEL: "m" },
      "LLM_MODEL is not set": { LLM_PROVIDER: "openai", LLM_API_KEY: "k" },
      "LLM_BASE_URL is invalid": { LLM_PROVIDER: "openai", LLM_API_KEY: "k", LLM_MODEL: "m", LLM_BASE_URL: "http://evil.example/v1" },
      "positive integers": { LLM_PROVIDER: "openai", LLM_API_KEY: "k", LLM_MODEL: "m", LLM_TIMEOUT_MS: "-5" },
      "LLM_TEMPERATURE": { LLM_PROVIDER: "openai", LLM_API_KEY: "k", LLM_MODEL: "m", LLM_TEMPERATURE: "9" },
    };
    for (const [expected, env] of Object.entries(cases)) {
      const result = resolveLlmConfig(env);
      expect(result.config).toBeUndefined();
      expect(result.warning).toContain(expected);
    }
  });

  it("accepts https and localhost http base URLs, rejects credentials and garbage", () => {
    const base = { LLM_PROVIDER: "openai", LLM_API_KEY: "k", LLM_MODEL: "m" };
    expect(resolveLlmConfig({ ...base, LLM_BASE_URL: "http://localhost:11434/v1" }).config?.baseUrl).toBe("http://localhost:11434/v1");
    expect(resolveLlmConfig({ ...base, LLM_BASE_URL: "http://127.0.0.1:8080" }).config?.baseUrl).toBe("http://127.0.0.1:8080");
    expect(resolveLlmConfig({ ...base, LLM_BASE_URL: "https://user:pw@api.example/v1" }).config).toBeUndefined();
    expect(resolveLlmConfig({ ...base, LLM_BASE_URL: "not a url" }).config).toBeUndefined();
  });

  it("never leaks the API key into a warning", () => {
    const env = { LLM_PROVIDER: "gemini", LLM_API_KEY: SECRET, LLM_MODEL: "m", LLM_BASE_URL: "http://x.example" };
    expect(resolveLlmConfig(env).warning ?? "").not.toContain(SECRET);
    expect(resolveLlmConfig({ ...env, LLM_PROVIDER: "openai" }).warning ?? "").not.toContain(SECRET);
  });
});

describe("createLlmClient (provider switching by configuration)", () => {
  it("selects the transport from the config without touching anything else", async () => {
    const base = { LLM_API_KEY: "k", LLM_MODEL: "m" };
    const a = resolveLlmConfig({ ...base, LLM_PROVIDER: "anthropic" }).config;
    const o = resolveLlmConfig({ ...base, LLM_PROVIDER: "openai" }).config;
    if (!a || !o) {
      throw new Error("configs expected");
    }
    expect(createLlmClient(a) instanceof AnthropicClient).toBe(true);
    expect(createLlmClient(o) instanceof OpenAiCompatibleClient).toBe(true);
    expect(createLlmClient(o).model).toBe("m");

    const sameReply = { summary: "s", observations: [{ kind: "GENERAL", severity: "INFO", recordIds: [], message: "m", suggestedCheck: "" }] };
    const viaAnthropic = recorder({ body: { content: [{ type: "text", text: JSON.stringify(sameReply) }] } });
    const viaOpenAi = recorder({ body: { choices: [{ message: { content: JSON.stringify(sameReply) } }] } });
    const facts: DataQualityFacts = { invoiceCount: 0, transactionCount: 0, validationIssues: [], duplicateInvoiceGroups: [], duplicateTransactionGroups: [], transactionsWithoutReference: [], suppliersWithMultipleIbans: [], ibansSharedBySuppliers: [] };

    const r1 = await new LlmAnalysisAdapter(createLlmClient(a, viaAnthropic.fetchFn)).analyzeDataQuality(facts);
    const r2 = await new LlmAnalysisAdapter(createLlmClient(o, viaOpenAi.fetchFn)).analyzeDataQuality(facts);
    expect(r1).toEqual(r2);
    expect(viaAnthropic.calls[0]?.url).toContain("/v1/messages");
    expect(viaOpenAi.calls[0]?.url).toContain("/chat/completions");
  });
});
