import { runCli } from "./presentation/cli.js";

async function main(): Promise<void> {
  try {
    process.exitCode = await runCli(process.argv.slice(2), process.env);
  } catch (error) {
    console.error("THESORUM failed:", error);
    process.exitCode = 1;
  }
}

void main();
