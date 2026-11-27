export interface RawRecord {
  readonly rowNumber: number;
  readonly fields: Readonly<Record<string, string>>;
}
