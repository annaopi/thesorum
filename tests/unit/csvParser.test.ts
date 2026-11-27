import { describe, expect, it } from "vitest";
import { ImportError } from "../../src/application/errors.js";
import { parseCsv, readCsvRecords } from "../../src/infrastructure/csv/CsvParser.js";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, embedded commas and newlines", () => {
    expect(parseCsv('a,"b,c","say ""hi""","l1\nl2"\n1,2,3,4')).toEqual([
      ["a", "b,c", 'say "hi"', "l1\nl2"],
      ["1", "2", "3", "4"],
    ]);
  });

  it("handles CRLF, BOM, trailing newline and blank lines", () => {
    expect(parseCsv("﻿a,b\r\n\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("keeps empty fields", () => {
    expect(parseCsv("a,b,c\n1,,")).toEqual([["a", "b", "c"], ["1", "", ""]]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a,b\n"oops,1')).toThrow(ImportError);
  });
});

describe("readCsvRecords", () => {
  it("maps rows to header-keyed records with 1-based row numbers", () => {
    const records = readCsvRecords("ID , Name\nx,y\nz,w", "test", ["id", "name"]);
    expect(records).toEqual([
      { rowNumber: 1, fields: { id: "x", name: "y" } },
      { rowNumber: 2, fields: { id: "z", name: "w" } },
    ]);
  });

  it("throws ImportError for missing columns, empty files and over-long rows", () => {
    expect(() => readCsvRecords("id\n1", "test", ["id", "name"])).toThrow("missing required column");
    expect(() => readCsvRecords("", "test", ["id"])).toThrow(ImportError);
    expect(() => readCsvRecords("id,name\n1,2,3", "test", ["id", "name"])).toThrow("3 values");
  });

  it("passes short rows through so validation can report the missing fields", () => {
    const [record] = readCsvRecords("id,name\n1", "test", ["id", "name"]);
    expect(record?.fields).toEqual({ id: "1" });
  });
});
