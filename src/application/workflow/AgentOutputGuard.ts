import type { Anomaly, RiskLevel } from "../../domain/Anomaly.js";
import { RISK_ORDER } from "../../domain/Anomaly.js";
import type {
  DataObservation,
  DataQualityAnalysis,
  ExceptionAnalysis,
  ExceptionInsight,
} from "../ports/AIAnalysisPort.js";

const MAX_TEXT_LENGTH = 700;
const MAX_OBSERVATIONS = 30;
const MAX_CAUSES = 5;

function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return stripped.length > MAX_TEXT_LENGTH
    ? `${stripped.slice(0, MAX_TEXT_LENGTH - 1)}…`
    : stripped;
}

/**
 * Trust boundary between the AI agents and the rest of the system.
 * Whatever an agent returns is reduced to: known record IDs only, bounded text,
 * and priorities that can raise but never lower the deterministic risk.
 */
export class AgentOutputGuard {
  public static sanitizeDataQuality(
    analysis: DataQualityAnalysis,
    knownRecordIds: ReadonlySet<string>,
  ): DataQualityAnalysis {
    const observations: DataObservation[] = analysis.observations
      .filter((observation) => cleanText(observation.message).length > 0)
      .slice(0, MAX_OBSERVATIONS)
      .map((observation, index) => ({
        id: `OBS-${String(index + 1).padStart(3, "0")}`,
        kind: observation.kind,
        severity: observation.severity,
        recordIds: [...new Set(observation.recordIds)].filter((id) =>
          knownRecordIds.has(id),
        ),
        message: cleanText(observation.message),
        suggestedCheck: cleanText(observation.suggestedCheck),
      }));

    return {
      source: analysis.source,
      summary: cleanText(analysis.summary),
      observations,
    };
  }

  public static sanitizeExceptionAnalysis(
    analysis: ExceptionAnalysis,
    anomalies: readonly Anomaly[],
    observations: readonly DataObservation[],
  ): ExceptionAnalysis {
    const anomalyById = new Map(anomalies.map((anomaly) => [anomaly.id, anomaly]));
    const observationIds = new Set(observations.map((observation) => observation.id));
    const seen = new Set<string>();
    const insights: ExceptionInsight[] = [];

    for (const insight of analysis.insights) {
      const anomaly = anomalyById.get(insight.anomalyId);

      if (!anomaly || seen.has(insight.anomalyId)) {
        continue;
      }

      seen.add(insight.anomalyId);
      insights.push({
        anomalyId: anomaly.id,
        likelyCauses: insight.likelyCauses
          .map(cleanText)
          .filter((cause) => cause.length > 0)
          .slice(0, MAX_CAUSES),
        recommendation: cleanText(insight.recommendation),
        suggestedPriority: AgentOutputGuard.clampPriority(
          insight.suggestedPriority,
          anomaly.risk,
        ),
        relatedObservationIds: insight.relatedObservationIds.filter((id) =>
          observationIds.has(id),
        ),
      });
    }

    return {
      source: analysis.source,
      summary: cleanText(analysis.summary),
      insights,
    };
  }

  /** The AI may escalate a priority but can never downgrade the deterministic risk. */
  public static clampPriority(suggested: RiskLevel, deterministic: RiskLevel): RiskLevel {
    return RISK_ORDER[suggested] >= RISK_ORDER[deterministic] ? suggested : deterministic;
  }
}
