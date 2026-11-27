/**
 * Provider-neutral contract between the generic analysis adapter and a concrete
 * LLM transport. A transport turns this request into its provider's HTTP call
 * and returns the model's plain text. It must throw AIAnalysisError (and never
 * include API keys or response bodies in the message) on any failure.
 */
export interface LlmRequest {
  readonly system: string;
  readonly user: string;
  /** Upper bound for generated tokens. */
  readonly maxTokens: number;
  /** Omitted when undefined so providers that restrict it use their default. */
  readonly temperature?: number;
}

export interface LlmClient {
  /** Short provider label for diagnostics */
  readonly provider: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<string>;
}
