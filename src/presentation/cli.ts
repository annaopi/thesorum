import { writeFile } from "node:fs/promises";
import { ImportError } from "../application/errors.js";
import { DomainError } from "../domain/DomainError.js";
import { LocalDate } from "../domain/value-objects/LocalDate.js";
import { createApplication } from "../infrastructure/bootstrap.js";
import type { AIAnalysisPort } from "../application/ports/AIAnalysisPort.js";
import { formatReport } from "./ReportFormatter.js";

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export interface CliOptions {
  readonly fetchFn?: typeof fetch;
  readonly aiOverride?: AIAnalysisPort;
  readonly today?: string;
}

const DEFAULT_IO: CliIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

export const USAGE = `THESORUM - multi-agent invoice / bank transaction reconciliation

Usage: npm start -- [options]

Options:
  --invoices <file>       Invoices CSV      (default: data/sample/invoices.csv)
  --transactions <file>   Transactions CSV  (default: data/sample/transactions.csv)
  --as-of <YYYY-MM-DD>    Reporting date for overdue checks (default: today, UTC)
  --no-ai                 Demo mode: rule-based agents, no network calls
  --json                  Print the report as JSON instead of text
  --out <file>            Also write the JSON report to a file
  --help                  Show this help

Environment (LLM agents; without them the app runs in demo mode):
  LLM_PROVIDER            anthropic | openai (openai also covers OpenAI-compatible APIs)
  LLM_API_KEY             API key for the chosen provider
  LLM_MODEL               Model name (required, no default)
  LLM_BASE_URL            Optional provider base URL (https; http only for localhost)
  LLM_TIMEOUT_MS          Optional request timeout, default 45000
  LLM_MAX_TOKENS          Optional output token limit, default 4096
  LLM_TEMPERATURE         Optional, 0..2 (omitted from requests when unset)
  Legacy: ANTHROPIC_API_KEY (+ THESORUM_LLM_MODEL) still enables the Anthropic provider.

Exit codes: 0 success, 1 input/processing error, 2 usage error`;

interface ParsedArgs {
  invoices: string;
  transactions: string;
  asOf: string | undefined;
  noAi: boolean;
  json: boolean;
  out: string | undefined;
  help: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const args: ParsedArgs = {
    invoices: "data/sample/invoices.csv",
    transactions: "data/sample/transactions.csv",
    asOf: undefined,
    noAi: false,
    json: false,
    out: undefined,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`Option ${arg} requires a value.`);
      }
      i += 1;
      return next;
    };

    switch (arg) {
      case "--invoices":
        args.invoices = value();
        break;
      case "--transactions":
        args.transactions = value();
        break;
      case "--as-of":
        args.asOf = value();
        break;
      case "--out":
        args.out = value();
        break;
      case "--no-ai":
        args.noAi = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new UsageError(`Unknown option: ${arg}`);
    }
  }

  return args;
}

/** Runs the CLI and returns the process exit code. Never throws. */
export async function runCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: CliIo = DEFAULT_IO,
  options: CliOptions = {},
): Promise<number> {
  let args: ParsedArgs;

  try {
    args = parseArgs(argv);
  } catch (error: unknown) {
    io.err(error instanceof Error ? error.message : String(error));
    io.err("Run with --help for usage.");
    return 2;
  }

  if (args.help) {
    io.out(USAGE);
    return 0;
  }

  try {
    const asOf = LocalDate.create(args.asOf ?? options.today ?? new Date().toISOString().slice(0, 10));
    const { workflow, aiMode, aiDescription, aiWarning } = createApplication({
      invoicesPath: args.invoices,
      transactionsPath: args.transactions,
      aiMode: args.noAi ? "demo" : "auto",
      env,
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
      ...(options.aiOverride ? { aiOverride: options.aiOverride } : {}),
    });

    if (aiWarning) {
      io.err(`Warning: ${aiWarning}`);
    }

    const { report } = await workflow.run({ asOf });
    const json = JSON.stringify(report, null, 2);

    if (args.out) {
      await writeFile(args.out, `${json}\n`, "utf8");
    }

    if (args.json) {
      io.out(json);
    } else {
      io.out(formatReport(report));
      io.out(`\nAI mode: ${aiMode}${aiDescription ? ` (${aiDescription})` : ""}${args.out ? ` | JSON report written to ${args.out}` : ""}`);
    }

    return 0;
  } catch (error: unknown) {
    if (error instanceof ImportError || error instanceof DomainError) {
      io.err(`Error: ${error.message}`);
      return error instanceof DomainError && !(error instanceof ImportError) ? 2 : 1;
    }

    io.err(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
