import { runCli } from "./presentation/cli.js";

process.exitCode = await runCli(process.argv.slice(2), process.env);
