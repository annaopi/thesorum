import { describe, expect, it } from "vitest";
import { AIAnalysisError } from "../../src/application/ports/AIAnalysisPort.js";
import type { DataQualityFacts } from "../../src/application/dto/DataQualityFacts.js";
import { AnthropicClient } from "../../src/infrastructure/ai/providers/AnthropicClient.js";
import {
  LlmAnalysisAdapter,
  extractJsonObject,
  maskIbans,
  parseDataQualityResponse,
} from "../../src/infrastructure/ai/LlmAnalysisAdapter.js";
import { IBANS } from "../helpers/builders.js";

const facts: DataQualityFacts = {
  invoiceCount: 1,
  transactionCount: 1,
  validationIssues: [],
  duplicateInvoiceGroups: [],
  duplicateTransactionGroups: [],
  transactionsWithoutReference: [],
  suppliersWithMultipleIbans: [{ supplierName: "Acme", ibans: [IBANS.acme, IBANS.other], invoiceIds: ["I-1"] }],
  ibansSharedBySuppliers: [],
};

interface Captured {
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}

function mockFetch(reply: { ok: boolean; status?: number; body: unknown }, captured: Captured = {}): typeof fetch {
  return (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    captured.url = url;
    captured.headers = init.headers;
    captured.body = init.body;
    return { ok: reply.ok, status: reply.status ?? 200, json: async () => reply.body };
  }) as unknown as typeof fetch;
}

function textReply(text: string): { ok: boolean; body: unknown } {
  return { ok: true, body: { content: [{ type: "text", text }] } };
}

function anthropic(apiKey: string, fetchFn: typeof fetch): LlmAnalysisAdapter {
  return new LlmAnalysisAdapter(new AnthropicClient({ apiKey, model: "test-model", timeoutMs: 5000, fetchFn }));
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe("LlmAnalysisAdapter", () => {
  it("sends masked IBANs and the API key, and parses a fenced JSON reply", async () => {
    const captured: Captured = {};
    const json = JSON.stringify({
      summary: "s",
      observations: [{ kind: "SUPPLIER_MULTIPLE_IBANS", severity: "WARNING", recordIds: ["I-1"], message: "two IBANs", suggestedCheck: "call" }],
    });
    const adapter = anthropic("k-123", mockFetch(textReply("```json\n" + json + "\n```"), captured));
    const result = await adapter.analyzeDataQuality(facts);

    expect(result.source).toBe("LLM");
    expect(result.observations[0]?.kind).toBe("SUPPLIER_MULTIPLE_IBANS");
    expect(captured.headers?.["x-api-key"]).toBe("k-123");
    expect(captured.body).toBeDefined();
    expect(captured.body?.includes(IBANS.acme)).toBe(false);
    expect(captured.body?.includes("DE89…3000")).toBe(true);
  });

  it("maps unknown enum values to safe defaults", () => {
    const parsed = parseDataQualityResponse({
      summary: "s",
      observations: [{ kind: "MADE_UP", severity: "EXTREME", recordIds: "nope", message: "m" }],
    });
    expect(parsed.observations[0]?.kind).toBe("GENERAL");
    expect(parsed.observations[0]?.severity).toBe("WARNING");
    expect(parsed.observations[0]?.recordIds).toEqual([]);
  });

  it("parses exception insights", async () => {
    const reply = textReply(
      JSON.stringify({ summary: "s", insights: [{ anomalyId: "ANM-001", likelyCauses: ["c"], recommendation: "r", suggestedPriority: "HIGH", relatedObservationIds: [] }] }),
    );
    const adapter = anthropic("k", mockFetch(reply));
    const result = await adapter.analyzeExceptions({
      runId: "R",
      asOf: "2026-12-01",
      anomalies: [],
      dataQuality: { source: "RULE_BASED", summary: "", observations: [] },
    });
    expect(result.insights[0]?.anomalyId).toBe("ANM-001");
    expect(result.insights[0]?.suggestedPriority).toBe("HIGH");
  });

  it("throws AIAnalysisError on HTTP errors, invalid JSON, wrong shape and network failure", async () => {
    const http = anthropic("k", mockFetch({ ok: false, status: 500, body: {} }));
    const bad = anthropic("k", mockFetch(textReply("sorry, no JSON here")));
    const shape = anthropic("k", mockFetch(textReply('{"summary":"s"}')));
    const down = anthropic(
      "k",
      (async () => {
        throw new Error("offline");
      }) as unknown as typeof fetch,
    );

    for (const adapter of [http, bad, shape, down]) {
      expect(await rejection(adapter.analyzeDataQuality(facts))).toBeDefined();
      expect((await rejection(adapter.analyzeDataQuality(facts))) instanceof AIAnalysisError).toBe(true);
    }
  });
});

describe("helpers", () => {
  it("maskIbans keeps country, check digits and last four characters", () => {
    expect(maskIbans(`pay ${IBANS.acme}, then ${IBANS.beta}.`)).toBe("pay DE89…3000, then NL91…4300.");
  });

  it("extractJsonObject finds the object inside prose", () => {
    expect(extractJsonObject('Here: {"a":1} done')).toEqual({ a: 1 });
  });
});
