import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalDate } from "../domain/value-objects/LocalDate.js";
import { createApplication } from "../infrastructure/bootstrap.js";

const root = fileURLToPath(new URL("./web/", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const asOf = process.env.THESORUM_AS_OF ?? new Date().toISOString().slice(0, 10);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/api/report") {
      const app = createApplication({
        invoicesPath: process.env.THESORUM_INVOICES ?? "data/sample/invoices.csv",
        transactionsPath: process.env.THESORUM_TRANSACTIONS ?? "data/sample/transactions.csv",
        aiMode: "auto",
        env: process.env,
      });
      const result = await app.workflow.run({ asOf: LocalDate.create(asOf) });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ report: result.report, aiMode: app.aiMode, aiDescription: app.aiDescription, aiWarning: app.aiWarning }));
      return;
    }
    const requested = url.pathname === "/" ? "index.html" : normalize(decodeURIComponent(url.pathname).replace(/^\/+/, ""));
    if (requested.startsWith("..")) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    const path = join(root, requested);
    const body = await readFile(path);
    const type = extname(path) === ".html" ? "text/html; charset=utf-8" : extname(path) === ".css" ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
    res.writeHead(200, { "content-type": type });
    res.end(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(port, () => process.stdout.write(`THESORUM dashboard: http://localhost:${port}\n`));
