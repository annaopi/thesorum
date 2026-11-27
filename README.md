# THESORUM
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
