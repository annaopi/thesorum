import { DEFAULT_MAX_TOKENS } from "./LlmAnalysisAdapter.js";
import type { LlmClient } from "./LlmClient.js";
import { AnthropicClient } from "./providers/AnthropicClient.js";
import { OpenAiCompatibleClient } from "./providers/OpenAiCompatibleClient.js";

export type LlmProvider = "anthropic" | "openai";

export interface LlmConfig {
  readonly provider: LlmProvider;
  readonly apiKey: string;
  readonly model: string;
  /** Provider base URL without the endpoint path; undefined = provider default. */
  readonly baseUrl: string | undefined;
  readonly timeoutMs: number;
  readonly maxTokens: number;
  readonly temperature: number | undefined;
}

/** Either a usable config, or nothing (demo mode) with an optional human-readable reason. */
export interface LlmConfigResult {
  readonly config?: LlmConfig;
  readonly warning?: string;
}

export const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Only used by the legacy path (ANTHROPIC_API_KEY without any LLM_* variable)
 * so that existing setups keep working. The new LLM_* configuration has no
 * default model: it must be chosen explicitly.
 */
export const LEGACY_ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5-5";

type Env = Readonly<Record<string, string | undefined>>;

function read(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function parseProvider(value: string): LlmProvider | undefined {
  switch (value.toLowerCase()) {
    case "anthropic":
      return "anthropic";
    case "openai":
    case "openai-compatible":
      return "openai";
    default:
      return undefined;
  }
}

/** Financial data must not travel over plain HTTP to a remote host. */
function parseBaseUrl(raw: string): string | undefined {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }

  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const allowed = url.protocol === "https:" || (url.protocol === "http:" && local);

  if (!allowed || url.username || url.password) {
    return undefined;
  }

  return raw.replace(/\/+$/, "");
}

function parsePositiveInt(raw: string | undefined, fallback: number): number | undefined {
  if (raw === undefined) {
    return fallback;
  }

  return /^\d+$/.test(raw) && Number(raw) > 0 && Number.isSafeInteger(Number(raw))
    ? Number(raw)
    : undefined;
}

/**
 * Reads the LLM configuration from environment variables:
 *   LLM_PROVIDER      anthropic | openai (alias: openai-compatible)
 *   LLM_API_KEY       API key
 *   LLM_MODEL         model name (required, no default)
 *   LLM_BASE_URL      optional; base URL of the provider (https, or http for localhost)
 *   LLM_TIMEOUT_MS    optional, default 45000
 *   LLM_MAX_TOKENS    optional, default 4096
 *   LLM_TEMPERATURE   optional, 0..2; omitted from requests when unset
 * Legacy (kept for migration): ANTHROPIC_API_KEY, THESORUM_LLM_MODEL.
 *
 * Never throws and never puts secrets in the returned warning. Anything
 * missing or invalid yields no config (demo mode) plus a reason.
 */
export function resolveLlmConfig(env: Env): LlmConfigResult {
  const providerText = read(env, "LLM_PROVIDER");
  const genericKey = read(env, "LLM_API_KEY");
  const legacyKey = read(env, "ANTHROPIC_API_KEY");

  if (!providerText && !genericKey && !legacyKey) {
    return {};
  }

  let provider: LlmProvider;
  let apiKey: string | undefined;
  let model: string | undefined;

  if (!providerText) {
    if (genericKey) {
      return {
        warning:
          "LLM_API_KEY is set but LLM_PROVIDER is missing (use anthropic or openai). Running in demo mode.",
      };
    }

    // Legacy configuration: ANTHROPIC_API_KEY (+ optional THESORUM_LLM_MODEL).
    provider = "anthropic";
    apiKey = legacyKey;
    model =
      read(env, "LLM_MODEL") ??
      read(env, "THESORUM_LLM_MODEL") ??
      LEGACY_ANTHROPIC_DEFAULT_MODEL;
  } else {
    const parsed = parseProvider(providerText);

    if (!parsed) {
      return {
        warning: `Unsupported LLM_PROVIDER "${providerText}" (supported: anthropic, openai). Running in demo mode.`,
      };
    }

    provider = parsed;
    apiKey = genericKey ?? (provider === "anthropic" ? legacyKey : undefined);
    model = read(env, "LLM_MODEL") ?? (provider === "anthropic" ? read(env, "THESORUM_LLM_MODEL") : undefined);
  }

  if (!apiKey) {
    return { warning: `LLM_PROVIDER=${provider} but LLM_API_KEY is not set. Running in demo mode.` };
  }

  if (!model) {
    return { warning: `LLM_PROVIDER=${provider} but LLM_MODEL is not set. Running in demo mode.` };
  }

  const baseUrlText = read(env, "LLM_BASE_URL");
  const baseUrl = baseUrlText !== undefined ? parseBaseUrl(baseUrlText) : undefined;

  if (baseUrlText !== undefined && baseUrl === undefined) {
    return {
      warning:
        "LLM_BASE_URL is invalid: it must be an https URL (http is allowed only for localhost) without credentials. Running in demo mode.",
    };
  }

  const timeoutMs = parsePositiveInt(read(env, "LLM_TIMEOUT_MS"), DEFAULT_TIMEOUT_MS);
  const maxTokens = parsePositiveInt(read(env, "LLM_MAX_TOKENS"), DEFAULT_MAX_TOKENS);

  if (timeoutMs === undefined || maxTokens === undefined) {
    return { warning: "LLM_TIMEOUT_MS and LLM_MAX_TOKENS must be positive integers. Running in demo mode." };
  }

  const temperatureText = read(env, "LLM_TEMPERATURE");
  const temperature = temperatureText !== undefined ? Number(temperatureText) : undefined;

  if (temperature !== undefined && !(Number.isFinite(temperature) && temperature >= 0 && temperature <= 2)) {
    return { warning: "LLM_TEMPERATURE must be a number between 0 and 2. Running in demo mode." };
  }

  return { config: { provider, apiKey, model, baseUrl, timeoutMs, maxTokens, temperature } };
}

/** Selects the transport for the configured provider. Adding a provider = one new case here. */
export function createLlmClient(config: LlmConfig, fetchFn?: typeof fetch): LlmClient {
  const common = {
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs,
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
    ...(fetchFn !== undefined ? { fetchFn } : {}),
  };

  switch (config.provider) {
    case "anthropic":
      return new AnthropicClient(common);
    case "openai":
      return new OpenAiCompatibleClient(common);
  }
}
