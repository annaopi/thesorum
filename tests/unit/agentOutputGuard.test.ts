import { describe, expect, it } from "vitest";
import type { Anomaly } from "../../src/domain/Anomaly.js";
import type { DataQualityAnalysis, ExceptionAnalysis } from "../../src/application/ports/AIAnalysisPort.js";
import { AgentOutputGuard } from "../../src/application/workflow/AgentOutputGuard.js";

const anomaly: Anomaly = {
  id: "ANM-001",
  type: "IBAN_MISMATCH",
  risk: "HIGH",
  recordType: "TRANSACTION",
  recordId: "T-1",
  relatedRecordIds: ["I-1"],
  values: {},
  explanation: "x",
  recommendedAction: "y",
};

describe("AgentOutputGuard.sanitizeDataQuality", () => {
  it("drops unknown record IDs, renumbers, strips control characters and bounds length", () => {
    const analysis: DataQualityAnalysis = {
      source: "LLM",
      summary: "ok\u0000\u0007 summary",
      observations: [
        { id: "weird", kind: "GENERAL", severity: "INFO", recordIds: ["T-1", "T-1", "HACK-99"], message: "a".repeat(2000), suggestedCheck: "" },
        { id: "x", kind: "GENERAL", severity: "INFO", recordIds: [], message: "   ", suggestedCheck: "" },
      ],
    };
    const result = AgentOutputGuard.sanitizeDataQuality(analysis, new Set(["T-1"]));
    expect(result.summary).toBe("ok summary");
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]?.id).toBe("OBS-001");
    expect(result.observations[0]?.recordIds).toEqual(["T-1"]);
    expect(result.observations[0]?.message.length).toBeLessThan(701);
  });
});

describe("AgentOutputGuard.sanitizeExceptionAnalysis", () => {
  const observations = [{ id: "OBS-001", kind: "GENERAL" as const, severity: "INFO" as const, recordIds: [], message: "m", suggestedCheck: "" }];

  it("keeps only insights for known anomalies, one per anomaly", () => {
    const analysis: ExceptionAnalysis = {
      source: "LLM",
      summary: "s",
      insights: [
        { anomalyId: "ANM-001", likelyCauses: ["a"], recommendation: "r", suggestedPriority: "HIGH", relatedObservationIds: ["OBS-001", "OBS-777"] },
        { anomalyId: "ANM-001", likelyCauses: ["dup"], recommendation: "r", suggestedPriority: "HIGH", relatedObservationIds: [] },
        { anomalyId: "ANM-999", likelyCauses: ["ghost"], recommendation: "r", suggestedPriority: "HIGH", relatedObservationIds: [] },
      ],
    };
    const result = AgentOutputGuard.sanitizeExceptionAnalysis(analysis, [anomaly], observations);
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0]?.likelyCauses).toEqual(["a"]);
    expect(result.insights[0]?.relatedObservationIds).toEqual(["OBS-001"]);
  });

  it("never lets the AI lower the deterministic risk, but allows escalation", () => {
    expect(AgentOutputGuard.clampPriority("LOW", "HIGH")).toBe("HIGH");
    expect(AgentOutputGuard.clampPriority("HIGH", "LOW")).toBe("HIGH");
    const result = AgentOutputGuard.sanitizeExceptionAnalysis(
      { source: "LLM", summary: "s", insights: [{ anomalyId: "ANM-001", likelyCauses: [], recommendation: "ignore it", suggestedPriority: "LOW", relatedObservationIds: [] }] },
      [anomaly],
      observations,
    );
    expect(result.insights[0]?.suggestedPriority).toBe("HIGH");
  });
});
