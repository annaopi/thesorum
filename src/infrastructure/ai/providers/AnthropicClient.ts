import { AIAnalysisError } from "../../../application/ports/AIAnalysisPort.js";
import type { LlmClient, LlmRequest } from "../LlmClient.js";
import { isRecord, postJson } from "./postJson.js";

export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicClientOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Without the "/v1/messages" path. */
  readonly baseUrl?: string;
  readonly timeoutMs: number;
  readonly fetchFn?: typeof fetch;
}

/** Transport for the Anthropic Messages API. */
export class AnthropicClient implements LlmClient {
  public readonly provider = "anthropic";
  public readonly model: string;

  public constructor(private readonly options: AnthropicClientOptions) {
    this.model = options.model;
  }

  public async complete(request: LlmRequest): Promise<string> {
    const body = await postJson({
      label: "anthropic",
      fetchFn: this.options.fetchFn ?? globalThis.fetch.bind(globalThis),
      url: `${this.options.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL}/v1/messages`,
      headers: {
        "x-api-key": this.options.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: {
        model: this.options.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
      },
      timeoutMs: this.options.timeoutMs,
    });

    const content = isRecord(body) ? body["content"] : undefined;

    if (!Array.isArray(content)) {
      throw new AIAnalysisError("anthropic: response has no content array.");
    }

    const text = content
      .filter(isRecord)
      .map((block) =>
        block["type"] === "text" && typeof block["text"] === "string" ? block["text"] : "",
      )
      .join("");

    if (!text.trim()) {
      throw new AIAnalysisError("anthropic: response contained no text.");
    }

    return text;
  }
}
