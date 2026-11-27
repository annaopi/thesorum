import { ImportError } from "../../application/errors.js";
import type { RawRecord } from "../../application/dto/RawRecord.js";

/**
 * Minimal RFC 4180 CSV parser: quoted fields, escaped quotes (""), embedded
 * commas and newlines, CRLF/LF, optional BOM. Blank lines are skipped.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = (): void => {
    row.push(field);
    field = "";
    fieldWasQuoted = false;
  };

  const endRow = (): void => {
    endField();
    if (!(row.length === 1 && row[0] === "" && !fieldWasQuoted)) {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n") {
      endRow();
    } else if (char === "\r") {
      if (text[i + 1] === "\n") {
        i += 1;
      }
      endRow();
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw new ImportError("CSV is malformed: a quoted field is never closed.");
  }

  if (field !== "" || row.length > 0) {
    endRow();
  }

  return rows;
}

/**
 * Converts CSV text into header-keyed raw records. Throws ImportError when
 * required columns are missing or a row has more cells than the header.
 * Rows with fewer cells are passed on; validation reports the missing fields.
 */
export function readCsvRecords(
  text: string,
  label: string,
  requiredColumns: readonly string[],
): RawRecord[] {
  const rows = parseCsv(text);
  const [headerRow, ...dataRows] = rows;

  if (!headerRow) {
    throw new ImportError(`${label}: file is empty (a header row is required).`);
  }

  const header = headerRow.map((name) => name.trim().toLowerCase());
  const missing = requiredColumns.filter((column) => !header.includes(column));

  if (missing.length > 0) {
    throw new ImportError(
      `${label}: missing required column(s): ${missing.join(", ")}. Found: ${header.join(", ")}.`,
    );
  }

  return dataRows.map((cells, index): RawRecord => {
    const rowNumber = index + 1;

    if (cells.length > header.length) {
      throw new ImportError(
        `${label}: row ${rowNumber} has ${cells.length} values but the header has ${header.length} columns (unquoted comma?).`,
      );
    }

    const fields: Record<string, string> = {};
    header.forEach((column, columnIndex) => {
      const value = cells[columnIndex];
      if (value !== undefined) {
        fields[column] = value;
      }
    });

    return { rowNumber, fields };
  });
}
