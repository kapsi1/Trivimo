/**
 * A number with digit groups as spreadsheets export them ("12 345", "1 234 567,5" with U+00A0, U+202F or U+2009)
 * without the group separators. Only regular groups of three after the first one to three digits are accepted, so
 * "1 23" or "12 3456" stay unreadable instead of being joined into some other number.
 */
export function ungroupDigits(text: string): string {
  const value = text.trim();
  return /^\d{1,3}(?:[    ]\d{3})+(?:[.,]\d+)?$/.test(value) ? value.replace(/[    ]/g, '') : value;
}

/**
 * Decimal separator suggested from sample cells (already unquoted by the CSV parser, so "88,9" in quotes counts):
 * the one used by more cells that read as a decimal number (also with digit groups or a "%" sign). With no such
 * cell, a semicolon-separated file suggests a comma. Only a suggestion: the user sees it and can change it.
 */
export function guessDecimal(rows: string[][], delimiter: ',' | ';' | '\t'): '.' | ',' {
  let comma = 0, dot = 0;
  for (const row of rows) for (const cell of row) {
    const value = ungroupDigits(cell.trim().replace(/\s*%$/, ''));
    if (/^\d+,\d+$/.test(value)) comma++;
    else if (/^\d+\.\d+$/.test(value)) dot++;
  }
  return comma > dot ? ',' : dot > comma ? '.' : delimiter === ';' ? ',' : '.';
}
