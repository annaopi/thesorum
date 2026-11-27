import { AIAnalysisError } from "../../../application/ports/AIAnalysisPort.js";
import type { LlmClient, LlmRequest } from "../LlmClient.js";
import { isRecord, postJson } from "./postJson.js";

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

export interface OpenAiCompatibleClientOptions {
  readonly apiKey: string;
  readonly model: string;
  /** Without the "/chat/completions" path, e.g. "https://api.openai.com/v1". */
  readonly baseUrl?: string;
  readonly timeoutMs: number;
  readonly fetchFn?: typeof fetch;
}

/**
 * Transport for the OpenAI "Chat Completions" protocol. Works with OpenAI and
 * with any provider or local server that implements the same protocol
 * (set LLM_BASE_URL). JSON mode is deliberately not requested because not all
 * compatible servers accept it; the generic adapter extracts and validates the
 * JSON itself.
 */
export class OpenAiCompatibleClient implements LlmClient {
  public readonly provider = "openai";
  public readonly model: string;

  public constructor(private readonly options: OpenAiCompatibleClientOptions) {
    this.model = options.model;
  }

  public async complete(request: LlmRequest): Promise<string> {
    const body = await postJson({
      label: "openai",
      fetchFn: this.options.fetchFn ?? globalThis.fetch.bind(globalThis),
      url: `${this.options.baseUrl ?? OPENAI_DEFAULT_BASE_URL}/chat/completions`,
      headers: { authorization: `Bearer ${this.options.apiKey}` },
      body: {
        model: this.options.model,
        max_tokens: request.maxTokens,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
      },
      timeoutMs: this.options.timeoutMs,
    });

    const choices = isRecord(body) ? body["choices"] : undefined;
    const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
    const message = isRecord(first) ? first["message"] : undefined;
    const content = isRecord(message) ? message["content"] : undefined;

    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter(isRecord)
              .map((part) => (typeof part["text"] === "string" ? part["text"] : ""))
              .join("")
          : "";

    if (!text.trim()) {
      throw new AIAnalysisError("openai: response contained no message text.");
    }

    return text;
  }
}
