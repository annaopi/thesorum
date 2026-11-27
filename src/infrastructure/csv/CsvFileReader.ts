import { readFile } from "node:fs/promises";
import { ImportError } from "../../application/errors.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type TextFileReader = (path: string) => Promise<string>;

export const readTextFile: TextFileReader = async (path) => {
  let text: string;

  try {
    text = await readFile(path, "utf8");
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ImportError(`Cannot read file "${path}": ${reason}`);
  }

  if (Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) {
    throw new ImportError(`File "${path}" exceeds the ${MAX_FILE_BYTES} byte limit.`);
  }

  return text;
};
