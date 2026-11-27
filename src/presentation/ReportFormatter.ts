import type { FinancialReport } from "../application/dto/FinancialReport.js";

const WIDTH = 100;

function wrap(text: string, indent: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = indent;

  for (const word of words) {
    if (line.trim().length > 0 && line.length + word.length + 1 > WIDTH) {
      lines.push(line);
      line = indent;
    }
    line += (line.trim().length > 0 ? " " : "") + word;
  }

  if (line.trim().length > 0) {
    lines.push(line);
  }

  return lines.join("\n");
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function table(headers: readonly string[], rows: readonly (readonly string[])[], right: ReadonlySet<number> = new Set()): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const render = (cells: readonly string[]): string =>
    cells
      .map((cell, column) =>
        right.has(column) ? cell.padStart(widths[column]) : cell.padEnd(widths[column]),
      )
      .join("  ")
      .trimEnd();

  return [
    render(headers),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(render),
  ].join("\n");
}

function heading(title: string): string {
  return `\n${title}\n${"=".repeat(title.length)}`;
}

/** Human-readable terminal rendering of a FinancialReport. */
export function formatReport(report: FinancialReport): string {
  const out: string[] = [];

  out.push("THESORUM - Financial Reconciliation Report");
  out.push(`Run ${report.runId} | as of ${report.asOf}`);
  out.push(
    `Agents: Transaction Analyst [${report.dataQuality.source}] -> Exception Analyst [${report.exceptionAnalysis.source}]`,
  );

  out.push(heading("1. Input"));
  out.push(
    `Invoices:     ${report.input.invoicesImported} imported of ${report.input.invoicesRead} rows`,
  );
  out.push(
    `Transactions: ${report.input.transactionsImported} imported of ${report.input.transactionsRead} rows`,
  );
  if (report.input.validationIssues.length > 0) {
    out.push("Rejected rows:");
    for (const issue of report.input.validationIssues) {
      out.push(
        wrap(
          `- ${issue.recordType.toLowerCase()} row ${issue.rowNumber} (${issue.recordId ?? "no ID"}) [${issue.code}]: ${issue.message}`,
          "  ",
        ),
      );
    }
  }

  out.push(heading("2. Totals by currency"));
  out.push(
    table(
      ["CUR", "Invoiced", "Paid", "Outstanding", "Overdue", "Overpaid", "Not applied"],
      report.totalsByCurrency.map((t) => [
        t.currency,
        t.invoiced,
        t.paid,
        t.outstanding,
        t.overdue,
        t.overpaid,
        t.notApplied,
      ]),
      new Set([1, 2, 3, 4, 5, 6]),
    ),
  );
  out.push(
    "'Not applied' = transaction money that was not credited to any invoice (unmatched, held for review, duplicate or excess).",
  );

  out.push(heading("3. Invoices"));
  out.push(
    table(
      ["ID", "Number", "Supplier", "Status", "Expected", "Paid", "Open", "Cur"],
      report.invoices.map((i) => [
        i.invoiceId,
        i.invoiceNumber,
        cut(i.supplier, 28),
        i.isOverdue ? `${i.status}*` : i.status,
        i.expected,
        i.paid,
        i.outstanding,
        i.currency,
      ]),
      new Set([4, 5, 6]),
    ),
  );
  out.push("* = overdue");
  out.push(
    "Counts: " +
      Object.entries(report.invoiceStatusCounts)
        .map(([status, count]) => `${status} ${count}`)
        .join(", "),
  );

  out.push(heading("4. Transactions"));
  out.push(
    table(
      ["ID", "Date", "Amount", "Cur", "Status", "Reason", "Invoice"],
      report.transactions.map((t) => [
        t.transactionId,
        t.bookingDate,
        t.amount,
        t.currency,
        t.status,
        t.reason,
        t.invoiceId ?? "-",
      ]),
      new Set([2]),
    ),
  );
  out.push(
    "Counts: " +
      Object.entries(report.transactionStatusCounts)
        .map(([status, count]) => `${status} ${count}`)
        .join(", "),
  );

  out.push(heading("5. Review queue (human decisions required)"));
  out.push(
    `Anomalies: ${report.anomalyRiskCounts.HIGH} HIGH, ${report.anomalyRiskCounts.MEDIUM} MEDIUM, ${report.anomalyRiskCounts.LOW} LOW`,
  );
  out.push(`Exception Analyst: ${report.exceptionAnalysis.summary}`);

  for (const item of report.reviewQueue) {
    const anomaly = report.anomalies.find((a) => a.id === item.anomalyId);

    out.push("");
    out.push(
      `#${item.rank} [${item.priority}] ${item.anomalyId} ${item.type} - ${item.recordType.toLowerCase()} ${item.recordId}`,
    );
    out.push(wrap(`Finding: ${item.headline}`, "   "));

    if (anomaly) {
      const values = Object.entries(anomaly.values)
        .filter(([, value]) => value !== "")
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");
      out.push(wrap(`Values: ${values}`, "   "));
      if (anomaly.relatedRecordIds.length > 0) {
        out.push(`   Related: ${anomaly.relatedRecordIds.join(", ")}`);
      }
      out.push(wrap(`Action: ${item.recommendedAction}`, "   "));

      if (anomaly.aiInsight) {
        out.push(`   AI analysis [${anomaly.aiInsight.source}] (advisory):`);
        for (const cause of anomaly.aiInsight.likelyCauses) {
          out.push(wrap(`- ${cause}`, "     "));
        }
        if (anomaly.aiInsight.relatedObservationIds.length > 0) {
          out.push(`     Context: ${anomaly.aiInsight.relatedObservationIds.join(", ")}`);
        }
      }
    }
  }

  out.push(heading("6. Data-quality observations (Transaction Analyst)"));
  out.push(wrap(report.dataQuality.summary, ""));
  for (const observation of report.dataQuality.observations) {
    out.push(
      wrap(
        `- ${observation.id} [${observation.severity}] ${observation.message} Check: ${observation.suggestedCheck}`,
        "  ",
      ),
    );
  }

  out.push(heading("7. Agent collaboration trace"));
  for (const message of report.agentTrace) {
    out.push(
      wrap(
        `${String(message.sequence).padStart(2, "0")} ${message.from} -> ${message.to} [${message.kind}] ${message.summary}`,
        "",
      ).replace(/\n/g, "\n    "),
    );
  }

  out.push("");
  out.push(wrap(report.disclaimer, ""));

  return out.join("\n");
}
