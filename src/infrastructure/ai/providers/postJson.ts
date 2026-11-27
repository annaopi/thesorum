import { AIAnalysisError } from "../../../application/ports/AIAnalysisPort.js";

export interface PostJsonOptions {
  /** Provider label used in error messages. */
  readonly label: string;
  readonly fetchFn: typeof fetch;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly timeoutMs: number;
}

/**
 * Shared HTTPS plumbing for all transports: timeout, HTTP-status handling and
 * error normalisation. Error messages never contain headers (API keys),
 * request bodies (financial data) or response bodies.
 */
export async function postJson(options: PostJsonOptions): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await options.fetchFn(options.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...options.headers },
      body: JSON.stringify(options.body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AIAnalysisError(`${options.label}: request failed with HTTP ${response.status}.`);
    }

    try {
      return await response.json();
    } catch {
      throw new AIAnalysisError(`${options.label}: response body is not valid JSON.`);
    }
  } catch (error: unknown) {
    if (error instanceof AIAnalysisError) {
      throw error;
    }

    if (controller.signal.aborted) {
      throw new AIAnalysisError(`${options.label}: request timed out after ${options.timeoutMs} ms.`);
    }

    const reason = error instanceof Error ? error.message : String(error);
    throw new AIAnalysisError(`${options.label}: request failed: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
