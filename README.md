# THESORUM
<<<<<<< HEAD

Multi-agent invoice / bank-transaction reconciliation and anomaly detection (hackathon: *Agents in Finance*, Multi-Agent Systems track).

**Principle:** all money maths, validation and matching are deterministic and auditable. Two AI agents *explain* the results; they cannot approve, change or execute anything. The system only produces a report for human review.

## Quick start

Requires Node.js 20+.

```bash
npm install
npm run dashboard         # http://localhost:4173 — live dashboard, no API key required
```

The dashboard is a lightweight Node HTTP presentation adapter over the existing `ReconciliationWorkflow`. It runs the same CSV import, validation, deterministic matching, anomaly detection and agent-analysis pipeline as the CLI. The browser receives the generated `FinancialReport`; it does not calculate financial totals or make matching decisions. When no valid LLM configuration is present, the existing rule-based adapter is used. API credentials remain server-side.

Optional dashboard configuration: `PORT` (default `4173`), `THESORUM_AS_OF` (`YYYY-MM-DD`), `THESORUM_INVOICES` and `THESORUM_TRANSACTIONS` (CSV paths, relative to the project root).


```bash
npm install
npm test                  # unit + integration + end-to-end tests (Vitest)
npm run demo              # sample data, no API key, no network
npm start                 # same; uses the LLM agents if an LLM provider is configured (see below)
```

Useful options (after `--` when using `npm start`):

```bash
npm start -- --as-of 2026-12-01              # fixed reporting date (default: today, UTC)
npm start -- --no-ai                         # force demo mode even if a key is set
npm start -- --json                          # JSON report on stdout
npm start -- --out output/report.json        # also write the JSON report
npm start -- --invoices my/invoices.csv --transactions my/transactions.csv
npm run typecheck                            # strict TypeScript check
npm run build && npm run start:dist          # compiled run from dist/
```

Exit codes: `0` success, `1` input/processing error, `2` usage error.

### AI modes

| Mode | When | Behaviour |
|------|------|-----------|
| Demo (`RULE_BASED`) | no LLM configuration, or `--no-ai` | Deterministic template "agents"; no network, no API key needed. This is the default. |
| LLM (`LLM`) | `LLM_PROVIDER` + `LLM_API_KEY` + `LLM_MODEL` set | Both agents call the configured provider over plain `fetch` (no SDK). |
| Fallback (`RULE_BASED_FALLBACK`) | an LLM call fails (HTTP error, timeout, network, unusable output) | The workflow transparently uses the rule-based analysis and records a `FALLBACK` entry in the agent trace. Financial results are unaffected. |

An incomplete or invalid LLM configuration never stops the app: it runs in demo mode and prints a `Warning:` line on stderr (without secrets).

### Choosing an LLM provider

The provider is chosen only by environment variables (see `.env.example`):

| Variable | Meaning |
|----------|---------|
| `LLM_PROVIDER` | `anthropic` or `openai`. `openai` means the OpenAI *Chat Completions* protocol, so it also works with other providers or local servers that implement that protocol (set `LLM_BASE_URL`). |
| `LLM_API_KEY` | API key. Never logged and never part of an error message. |
| `LLM_MODEL` | Model name. Required, there is deliberately no default. |
| `LLM_BASE_URL` | Optional base URL without the endpoint path (`https`, or `http` for localhost only). Defaults: `https://api.openai.com/v1`, `https://api.anthropic.com`. |
| `LLM_TIMEOUT_MS` | Optional, default `45000`. |
| `LLM_MAX_TOKENS` | Optional, default `4096`. Sent as `max_tokens`. |
| `LLM_TEMPERATURE` | Optional, `0`..`2`. Not sent when unset (Anthropic then uses `0`). |

```bash
# OpenAI (or any OpenAI-compatible API: add LLM_BASE_URL)
LLM_PROVIDER=openai LLM_API_KEY=... LLM_MODEL=<model> npm start
# Anthropic
LLM_PROVIDER=anthropic LLM_API_KEY=... LLM_MODEL=<model> npm start
# Or keep the variables in .env (copy .env.example) and run:
npm run start:env
# Demo mode, no key, no network:
npm run demo
```

Migration: the old `ANTHROPIC_API_KEY` (optionally with `THESORUM_LLM_MODEL`) still enables the Anthropic provider on its own. A local OpenAI-compatible server that needs no key still requires a non-empty placeholder in `LLM_API_KEY`.

Not every LLM API speaks these two protocols (for example Google Gemini has its own). Such a provider needs its own small transport class; nothing else changes (see below). Only `anthropic` and `openai` are implemented and tested, and only against mocked HTTP: no live provider calls are made by the tests.

### AI architecture

```
AIAnalysisPort (application)           unchanged contract: analyzeDataQuality / analyzeExceptions
   ├─ RuleBasedAnalysisAdapter         deterministic demo mode and fallback
   └─ LlmAnalysisAdapter               provider-independent: prompts, IBAN masking,
        │                              JSON extraction + validation, AIAnalysisError
        └─ LlmClient (interface)       complete({system, user, maxTokens, temperature}) -> text
             ├─ AnthropicClient        Messages API: x-api-key header, `system` + `messages`, content[] text blocks
             └─ OpenAiCompatibleClient Chat Completions: Bearer header, messages[system,user], choices[0].message
   shared: providers/postJson.ts       timeout, HTTP-status and network-error normalisation
   LlmConfig.ts                        env -> config; picks the transport (the only provider `switch`)
```

To add a provider: implement `LlmClient` in `src/infrastructure/ai/providers/`, add a case to `createLlmClient` and the name to `parseProvider` in `LlmConfig.ts`, and add a test with a mocked `fetch`. Domain, application and workflow code are untouched.

Guarantees, independent of the provider:
- **IBANs are masked before any external call** (compact, space-grouped and lower-case forms, also inside free text; checksum is not required to mask). Only `DE89…3000`-style values leave the process.
- **LLM output is advisory only.** It is parsed strictly, then passed through `AgentOutputGuard` (known record IDs only, bounded text, insights only for existing anomalies, priority can be raised but never lowered). It cannot change statuses, amounts, risk levels or reconciliation results, and nothing in the system approves or executes payments.
- **Failures degrade, not crash:** any provider error becomes `AIAnalysisError` and triggers the rule-based fallback.
- **Secrets stay out of logs and errors;** the base URL must be `https` (plain `http` only for localhost) so financial data is not sent unencrypted to a remote host.
- Names and references from your files are sent to the provider (IBANs masked). Use demo mode if that is not acceptable for your data.

The agents sit behind `AIAnalysisPort`, so a Mozaik-backed adapter could also be added there. No existing Mozaik integration was found in the repository, so none is used.

## Input files

`data/sample/invoices.csv` — columns (all required):

```
id,invoice_number,supplier_name,amount,currency,iban,issue_date,due_date
I-001,INV-2026-001,Acme Office Supplies GmbH,1200.00,EUR,DE89 3704 0044 0532 0130 00,2026-10-01,2026-10-31
```

`data/sample/transactions.csv` — outgoing payments; `reference` is optional:

```
id,booking_date,amount,currency,beneficiary_name,beneficiary_iban,reference
T-001,2026-10-28,1200.00,EUR,Acme Office Supplies GmbH,DE89370400440532013000,Payment INV-2026-001
```

Rules: amounts are plain decimals (`1200.00`, no thousand separators, no more decimals than the currency allows); dates are `YYYY-MM-DD`; IBANs are checksum-validated; currencies: EUR, USD, RSD, HUF, JPY, KWD; IDs must be unique. Invalid rows are rejected individually with a reason and reported; they never stop the run. A missing required column, an unreadable file or an unclosed quote aborts with a clear error.

The sample data contains every scenario:

| Scenario | Sample records | Result |
|----------|----------------|--------|
| Full payment | I-001 / T-001 | `MATCHED`, invoice `PAID` |
| Partial payment | I-002 / T-002 (2000 of 5000) | `PARTIALLY_MATCHED`, anomaly `PARTIAL_PAYMENT` |
| Amount mismatch | I-003 / T-003 (2350 of 2400) | `AMOUNT_MISMATCH` (shortfall ≤ 5 %) |
| Duplicate invoice | I-004 / I-005 | I-005 `DUPLICATE`, excluded from totals |
| Unknown payment | T-007 | `UNMATCHED`, `UNKNOWN_PAYMENT` HIGH |
| IBAN change | T-006 vs I-006 | `REQUIRES_REVIEW`, `IBAN_MISMATCH` HIGH, not applied |
| Multiple payments, one invoice | I-007 / T-008 + T-009 | `PAID` |
| Duplicate transaction | T-010 / T-011 | T-011 held, `DUPLICATE_TRANSACTION` HIGH |
| Overpayment | I-009 / T-012 | `OVERPAYMENT`, 50.00 excess flagged |
| Ambiguous reference | T-013 → I-011 + I-012 | `REQUIRES_REVIEW`, nothing applied |
| Match without reference | T-014 → I-013 | `FIELD_MATCH_WITHOUT_REFERENCE` |
| Unpaid, overdue | I-010 | `UNPAID`, `OVERDUE_INVOICE` |
| Validation failures | I-016, T-016 | rejected with reason |

## Architecture

DDD + hexagonal + layered. Dependencies point inwards only: `presentation → infrastructure → application → domain`. The domain imports nothing from other layers and has no AI, I/O, CSV or database code.

```
src/
  domain/                      pure business model and rules
    DomainError.ts             error codes (UNKNOWN_CURRENCY ... INVALID_RECONCILIATION)
    value-objects/             Currency, Money (integer minor units), Iban, LocalDate, TransactionId
    entities/                  Invoice, Transaction, Payment (allocation of a transaction to an invoice)
    services/MatchingService   deterministic matching engine
    services/DuplicateDetector duplicate invoices / transactions
    ReconciliationResult.ts    MatchDecision, InvoiceSettlement, evidence types
    ReconciliationRun.ts       immutable aggregate, invariants checked on creation
    Anomaly.ts                 anomaly and risk types
  application/
    ports/                     InvoiceRepository, TransactionRepository, PaymentRepository,
                               InvoiceSource/TransactionSource, AIAnalysisPort
    usecases/                  Validate*/Import* (invoices, transactions), ProfileImportedData,
                               ReconcileTransactions, DetectAnomalies, GenerateFinancialReport
    workflow/                  ReconciliationWorkflow (orchestration), AgentOutputGuard
    dto/                       report, raw records, validation issues, agent trace
  infrastructure/              CSV parser + sources, in-memory repositories,
                               ai/ (RuleBasedAnalysisAdapter, LlmAnalysisAdapter, LlmClient, LlmConfig, providers/),
                               bootstrap (composition root)
  presentation/                cli.ts, ReportFormatter.ts
  index.ts                     entry point
```

### Pipeline

```
CSV ─► validate & normalise ─► data-quality facts ─► [Agent 1: Transaction Analyst] ─► observations
                                      │                                                    │
                                      ▼                                                    │
                       deterministic matching ─► anomaly detection ─► [Agent 2: Exception Analyst] ◄┘
                                                                              │
                                                                              ▼
                                                                      financial report
```

Agent 2 receives the deterministic anomalies **and** Agent 1's observations. Example of the hand-over: Agent 1 notes that supplier *Evergreen* uses two IBANs; Agent 2 uses this when explaining the HIGH `IBAN_MISMATCH` on T-006 (the new account may be a genuine change, but must be verified out-of-band). The hand-offs are listed in the report's *agent collaboration trace*.

### Matching rules (`MatchingService`)

Transactions are processed in booking-date/ID order; every decision carries a status, a reason code, evidence and an explanation.

1. **Duplicate transactions** (same IBAN, amount, currency, date, reference) — only the first is matched; copies are held for review.
2. **Candidates by reference:** invoices whose number appears as a standalone token in the reference (`INV-1` never matches `INV-10`). Several candidates are narrowed by beneficiary IBAN; otherwise → ambiguous, human review, nothing applied.
3. **No reference hit:** matched only if IBAN, supplier name, currency, exact outstanding amount and date (not before issue) all agree and exactly one invoice qualifies. Otherwise `UNMATCHED` (with related invoices listed as hints).
4. **IBAN or currency differs** from the invoice → `REQUIRES_REVIEW`, amount **not** applied.
5. **Amount:** partial → `PARTIALLY_MATCHED`; exact → `MATCHED`; more than outstanding → `OVERPAYMENT` (applied up to the invoice, excess flagged). Multiple payments accumulate.

Invoice statuses: `PAID`, `PARTIALLY_PAID`, `UNPAID`, `OVERPAID`, `REQUIRES_REVIEW`, `DUPLICATE` (plus an overdue flag against `--as-of`). Mapping to the four core statuses of the brief: `MATCHED`≈`PAID`/`MATCHED`, `PARTIALLY_MATCHED`≈`PARTIALLY_PAID`, `UNMATCHED`≈`UNPAID`/`UNMATCHED`, `REQUIRES_REVIEW`.

### Anomaly rules (`DetectAnomalies`)

| Type | Risk |
|------|------|
| `IBAN_MISMATCH`, `DUPLICATE_TRANSACTION` | HIGH |
| `UNKNOWN_PAYMENT` | HIGH if the account is on no invoice or amount ≥ 5000 (major units), else MEDIUM |
| `DUPLICATE_INVOICE` | HIGH if amount/IBAN conflict, else MEDIUM |
| `OVERPAYMENT` | HIGH if a whole invoice was paid again, else MEDIUM |
| `AMOUNT_MISMATCH` (shortfall ≤ 5 %), `CURRENCY_MISMATCH`, `AMBIGUOUS_MATCH`, `PAYMENT_BEFORE_ISSUE` | MEDIUM |
| `PARTIAL_PAYMENT` | MEDIUM if overdue, else LOW |
| `OVERDUE_INVOICE` | MEDIUM after 30 days, else LOW |
| `BENEFICIARY_NAME_MISMATCH` | LOW |

Each anomaly has an ID, the original invoice/transaction ID, related IDs, formatted values, explanation, risk and recommended action.

## AI agent responsibilities

| | Agent 1 — Transaction Analyst | Agent 2 — Exception Analyst |
|---|---|---|
| Input | Deterministic data-quality facts: validation failures, duplicate groups, missing references, suppliers with several IBANs, IBANs shared by suppliers | Deterministic anomalies + Agent 1's observations |
| Output | Structured observations (kind, severity, record IDs, message, suggested check) | Per-anomaly insights (likely causes, recommendation, suggested priority, linked observations) |
| Cannot | Approve/alter/execute payments; change data | Approve/alter/execute payments; change status, risk or amounts |

Safety: agent output is parsed strictly, then passed through `AgentOutputGuard`, which keeps only known record IDs, bounds text, drops insights for unknown anomalies, and lets the AI **raise but never lower** a priority. The review queue is sorted by that effective priority; risk levels and statuses always remain the deterministic ones. Text from input files is treated as data in the prompt.

## Example output

`npm run demo -- --as-of 2026-12-01` (excerpt; full output has 7 sections):

```
THESORUM - Financial Reconciliation Report
Run RUN-2026-12-01 | as of 2026-12-01
Agents: Transaction Analyst [RULE_BASED] -> Exception Analyst [RULE_BASED]

1. Input
Invoices:     15 imported of 16 rows
Transactions: 14 imported of 15 rows
Rejected rows:
  - invoice row 16 (I-016) [INVALID_INVOICE]: Invoice amount must be positive.
  - transaction row 15 (T-016) [INVALID_IBAN]: Invalid IBAN checksum.

2. Totals by currency
CUR  Invoiced      Paid  Outstanding  Overdue  Overpaid  Not applied
---  --------  --------  -----------  -------  --------  -----------
EUR  20600.00  10550.00     10050.00  7550.00     50.00      9850.00
USD   2500.00   2500.00         0.00     0.00      0.00         0.00

4. Transactions
ID     Date         Amount  Cur  Status             Reason                         Invoice
T-001  2026-10-28  1200.00  EUR  MATCHED            REFERENCE_AND_IBAN_MATCH       I-001
T-006  2026-11-10  3600.00  EUR  REQUIRES_REVIEW    IBAN_MISMATCH                  I-006
T-007  2026-11-12  4750.00  EUR  UNMATCHED          NO_CANDIDATE_INVOICE           -
T-011  2026-11-18   450.00  EUR  REQUIRES_REVIEW    DUPLICATE_TRANSACTION          -
T-012  2026-11-20   650.00  EUR  OVERPAYMENT        OVERPAYMENT                    I-009
...

5. Review queue (human decisions required)
Anomalies: 3 HIGH, 6 MEDIUM, 0 LOW

#1 [HIGH] ANM-001 IBAN_MISMATCH - transaction T-006
   Finding: Transaction T-006 references invoice INV-2026-006 but was paid to
   DE44500105175407324931, while the invoice expects AT88611904300234573201. 3600.00 EUR was not
   applied to the invoice and is held for review.
   Action: Do not release or accept this as settlement. Call the supplier on a known phone number to
   verify the account change before any further payment.
   AI analysis [RULE_BASED] (advisory):
     - Data-quality analysis (OBS-006) found that the same supplier already appears with several
     IBANs in the invoice data, so the new account may be a genuine change, but it must be verified
     out-of-band.
     ...

7. Agent collaboration trace
02 Workflow -> TransactionAnalystAgent [REQUEST] Deterministic data-quality facts: ...
05 AnomalyDetector -> ExceptionAnalystAgent [HANDOFF] 9 anomaly/anomalies, 3 HIGH risk.
06 TransactionAnalystAgent -> ExceptionAnalystAgent [HANDOFF] 6 data-quality observation(s) passed as context.
07 ExceptionAnalystAgent -> ReportGenerator [RESULT] 9 insight(s) [source: RULE_BASED].
```

## Tests

`npm test` runs `tests/unit` (value objects, entities, matching, duplicates, run invariants, validation, CSV, anomaly rules, agent guard, LLM adapter, Anthropic and OpenAI-compatible transports, LLM configuration, IBAN masking, timeouts, all with a mocked `fetch`), `tests/integration` (CSV → repositories → workflow; agent fallback; rogue-agent containment; repeatability) and `tests/e2e` (CLI on the sample data, JSON output, provider switching by environment, fallback on HTTP error / invalid JSON / timeout, demo mode, guard containment, no IBAN or key leakage, error exit codes). No test needs a network or API key.

## Scope and limitations

Synthetic data only; outgoing payments only (no refunds/credits); no currency conversion (cross-currency payments go to review); in-memory storage; no payment execution of any kind.

### Dashboard demo

```bash
npm run dashboard
```

Open `http://localhost:4173`. Use the left navigation to inspect the overview, invoice reconciliation, bank transactions, anomaly details and agent execution trace. The Refresh control reruns the workflow against the configured CSV inputs. This initial dashboard release intentionally uses the repository's existing CSV inputs; browser-based CSV upload is not included.

### Existing CLI and verification commands

```bash
npm run demo              # existing CLI, deterministic rule-based agents
npm start                 # existing CLI, LLM only when configured
npm test                  # existing Vitest suite
npm run typecheck         # strict TypeScript check
npm run build             # production TypeScript build
```
=======
### AI-Assisted Financial Reconciliation & Anomaly Detection

**THESORUM** is a financial reconciliation system designed to automate invoice and bank transaction matching, detect financial anomalies, validate financial data, and generate explainable reports with the support of AI agents.

Developed for the **Agents in Finance Hackathon - Multi-Agent Systems Track**.

---

## Overview

Financial reconciliation often involves manually comparing invoices with bank transactions, identifying discrepancies, investigating duplicates, and reviewing potentially suspicious payments.

THESORUM addresses this problem through a deterministic financial processing engine combined with AI-assisted analysis.

The system follows one central principle:

**Financial decisions are rule-based, deterministic, and auditable. AI provides explanations and recommendations, but never makes financial decisions or executes payments.**

## Key Features

- **Invoice & Transaction Matching** - Automatically matches invoices with corresponding bank transactions using references, amounts, currencies, beneficiary information, and IBANs.
- **Anomaly Detection** - Identifies duplicate records, partial payments, overpayments, amount discrepancies, unknown payments, IBAN mismatches, and overdue invoices.
- **Data Validation** - Validates imported financial records, including currencies, dates, amounts, identifiers, and IBAN checksums.
- **AI-Powered Analysis** - Uses two AI analysis roles to interpret data quality observations and investigate detected exceptions.
- **Human-in-the-Loop Review** - Flags high-risk and ambiguous cases for human verification instead of automatically accepting them.
- **Financial Reporting** - Generates structured financial reports with reconciliation results, detected anomalies, risk levels, and AI-generated insights.
- **Fallback Mechanism** - Automatically switches to rule-based analysis if an LLM provider is unavailable or returns invalid output.

## How It Works

The reconciliation workflow consists of several stages:

1. **Data Import** - Loads invoice and bank transaction records from CSV files.
2. **Validation** - Checks data integrity and rejects invalid records with explanations.
3. **Data Profiling** - Identifies data quality issues and relevant patterns.
4. **Reconciliation** - Matches invoices with transactions using deterministic business rules.
5. **Anomaly Detection** - Identifies discrepancies, duplicates, and potentially suspicious transactions.
6. **AI Analysis** - Provides contextual explanations and recommendations for detected issues.
7. **Output Guard** - Validates AI-generated responses and prevents agents from changing financial results.
8. **Report Generation** - Produces a structured financial report for human review.

## AI & Multi-Agent Architecture

THESORUM combines deterministic business logic with an AI-assisted multi-agent workflow.

The AI layer is designed around two analytical roles:

- **Transaction Analyst Agent** - Analyzes data quality, transaction patterns, and relevant observations.
- **Exception Analyst Agent** - Examines detected anomalies and provides contextual explanations and recommendations.

The agents communicate through structured messages and exchange analytical findings.

### AI Provider Support

The system supports:

- Anthropic API
- OpenAI Chat Completions API
- OpenAI-compatible API endpoints

The architecture separates provider-specific communication from application logic through a shared `LlmClient` interface.

### AI Safety & Reliability

- AI outputs are advisory only.
- IBANs are masked before external API calls.
- Agent responses are validated through `AgentOutputGuard`.
- Agents cannot modify transaction amounts, reconciliation decisions, payment statuses, or risk classifications.
- Invalid or unavailable AI responses trigger deterministic rule-based fallback.
- API keys and credentials are not included in logs or error messages.

The application does not authorize, approve, or execute payments.

## Architecture

The project follows **Domain-Driven Design (DDD)**, **Hexagonal Architecture**, and a layered architecture.

```text
src/
├── domain/
│   ├── entities/
│   ├── value-objects/
│   ├── services/
│   ├── Anomaly.ts
│   ├── ReconciliationResult.ts
│   └── ReconciliationRun.ts
│
├── application/
│   ├── dto/
│   ├── ports/
│   ├── usecases/
│   └── workflow/
│
├── infrastructure/
│   ├── ai/
│   │   ├── providers/
│   │   ├── LlmAnalysisAdapter.ts
│   │   ├── RuleBasedAnalysisAdapter.ts
│   │   └── LlmConfig.ts
│   ├── csv/
│   ├── persistence/
│   └── bootstrap.ts
│
└── presentation/
    ├── cli.ts
    └── ReportFormatter.ts

tests/
├── unit/
├── integration/
├── e2e/
└── helpers/

data/
└── sample/
```

### Architectural Principles

- Separation of business logic from infrastructure.
- Dependency inversion through application ports.
- Domain independence from AI providers and external services.
- Immutable domain models and explicit business invariants.
- Deterministic financial calculations using integer minor currency units.
- Testable and replaceable infrastructure adapters.

## Technology Stack

| Category | Technologies |
|---|---|
| Language | TypeScript |
| Runtime | Node.js |
| Architecture | DDD, Hexagonal Architecture, Layered Architecture |
| AI Integration | Anthropic API, OpenAI-compatible APIs |
| Data Processing | CSV |
| Testing | Vitest |
| Development | VS Code, npm, Git |

## Getting Started

### Prerequisites

- Node.js 20 or newer
- npm

### Installation

Clone the repository:

```bash
git clone https://github.com/YOUR-USERNAME/thesorum.git
cd thesorum
```

Install dependencies:

```bash
npm install
```

### Run in Demo Mode

The application includes synthetic sample data and can run without an API key or internet connection.

```bash
npm run demo
```

### Run with AI Analysis

Create a local environment configuration:

```bash
cp .env.example .env
```

Configure the provider:

```env
LLM_PROVIDER=openai
LLM_API_KEY=your_api_key
LLM_MODEL=your_model
```

Then run:

```bash
npm run start:env
```

Alternatively, configure an Anthropic provider:

```env
LLM_PROVIDER=anthropic
LLM_API_KEY=your_api_key
LLM_MODEL=your_model
```

**Never commit your `.env` file or expose API credentials.**

## Available Commands

| Command | Description |
|---|---|
| `npm start` | Run the application |
| `npm run demo` | Run without external AI services |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Check TypeScript types |
| `npm run build` | Compile the application |
| `npm run start:dist` | Run the compiled application |
| `npm run start:env` | Run with environment variables from `.env` |

### Additional Options

```bash
# Generate a JSON report
npm start -- --json

# Save the report to a file
npm start -- --out output/report.json

# Specify a reporting date
npm start -- --as-of 2026-12-01

# Import custom CSV files
npm start -- --invoices path/to/invoices.csv \
  --transactions path/to/transactions.csv
```

## Testing

The project includes three levels of automated testing:

- **Unit Tests** – Domain entities, value objects, matching algorithms, validation, anomaly detection, AI adapters, provider communication, and output protection.
- **Integration Tests** – CSV processing, repositories, reconciliation workflow, and AI fallback behavior.
- **End-to-End Tests** – Complete application execution, CLI output, provider configuration, error handling, and demo mode.

Tests use mocked HTTP requests and do not require live AI API calls or credentials.

Run the complete test suite:

```bash
npm test
```

## Sample Data

The repository includes synthetic invoice and bank transaction datasets.

The sample scenarios cover:

- Full and partial payments.
- Duplicate invoices and transactions.
- Amount mismatches.
- Unknown payments.
- IBAN discrepancies.
- Multiple payments for one invoice.
- Overpayments.
- Ambiguous references.
- Unpaid and overdue invoices.
- Invalid financial records.

All sample records are synthetic and do not represent real customers or financial transactions.

## Scope & Limitations

Current implementation:

- Supports outgoing payments.
- Uses in-memory repositories.
- Imports financial data through CSV files.
- Does not perform currency conversion.
- Does not execute or authorize payments.
- Requires human verification for flagged exceptions.

## Project Status

Developed as a hackathon project, with a focus on combining reliable financial business logic, modular software architecture, and responsible AI integration.

---

**THESORUM — Making financial reconciliation more transparent, explainable, and reliable.**
>>>>>>> cb5fa20d1af61e3418356281c77dec0abcdb870d
