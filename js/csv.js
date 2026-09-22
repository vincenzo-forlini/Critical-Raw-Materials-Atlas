/**
 * CSV parsing.
 *
 * This file exists because the database is meant to be edited in a spreadsheet,
 * and spreadsheets are careless with CSV. In particular:
 *
 *  - Excel on an Italian (or German, French, Spanish…) locale writes `;` as the
 *    delimiter, not `,`. So the delimiter is sniffed per file rather than assumed.
 *  - Excel writes a UTF-8 BOM, which would otherwise end up glued to the first
 *    column name, turning `id` into `﻿id` and breaking every lookup.
 *  - Fields may be quoted, may contain the delimiter, may contain newlines, and
 *    may contain doubled quotes as an escape.
 *
 * Runs unchanged in the browser and in Node, so the site and the validator apply
 * exactly the same rules.
 */

const CANDIDATE_DELIMITERS = [',', ';', '\t'];

/** Strip a UTF-8 BOM if present. */
export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Guess the delimiter from the header line, ignoring anything inside quotes.
 * Whichever candidate appears most often wins; ties fall back to a comma.
 */
export function sniffDelimiter(text) {
  const firstLine = readFirstLogicalLine(text);
  let best = ',';
  let bestCount = 0;
  for (const d of CANDIDATE_DELIMITERS) {
    const count = countOutsideQuotes(firstLine, d);
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function readFirstLogicalLine(text) {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      return text.slice(0, i);
    }
  }
  return text;
}

function countOutsideQuotes(line, delimiter) {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && ch === delimiter) {
      count++;
    }
  }
  return count;
}

/**
 * Parse CSV into rows of raw string cells.
 * @returns {{ rows: string[][], lines: number[], delimiter: string }}
 *          `lines[i]` is the 1-based source line where row `i` began, so errors
 *          can point the user at the right line of their spreadsheet.
 */
export function parseRows(text, delimiter) {
  const src = stripBom(text);
  const d = delimiter || sniffDelimiter(src);

  const rows = [];
  const lines = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let rowHasContent = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // Skip blank lines — trailing newlines are not empty records.
    if (rowHasContent || row.some((c) => c !== '')) {
      rows.push(row);
      lines.push(rowStartLine);
    }
    row = [];
    rowHasContent = false;
    rowStartLine = line;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      rowHasContent = true;
    } else if (ch === d) {
      endField();
    } else if (ch === '\r') {
      // handled by the \n that follows; lone \r also ends a row
      if (src[i + 1] !== '\n') {
        line++;
        endRow();
      }
    } else if (ch === '\n') {
      line++;
      endRow();
    } else {
      field += ch;
      if (ch.trim() !== '') rowHasContent = true;
    }
  }

  // Whatever is left after the final newline.
  if (field !== '' || row.length > 0) endRow();

  return { rows, lines, delimiter: d };
}

/**
 * Parse CSV into objects keyed by header name.
 * @returns {{ headers: string[], records: object[], delimiter: string }}
 *          Each record carries a non-enumerable `_line` for error messages.
 */
export function parseCsv(text) {
  const { rows, lines, delimiter } = parseRows(text);
  if (rows.length === 0) return { headers: [], records: [], delimiter };

  const headers = rows[0].map((h) => h.trim());
  const records = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const rec = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      rec[key] = (cells[c] ?? '').trim();
    }
    Object.defineProperty(rec, '_line', { value: lines[i], enumerable: false });
    records.push(rec);
  }

  return { headers, records, delimiter };
}

/* ------------------------------------------------------------------ values */

const TRUTHY = new Set([
  'x', 'X', '1', 'true', 'yes', 'y', '✓', '✔', 'si', 'sì', 'ja', 'oui', 'vero', 'wahr',
]);

/** Is a tick-column cell ticked? Blank means no. */
export function isTicked(value) {
  if (value == null) return false;
  return TRUTHY.has(String(value).trim().toLowerCase()) || TRUTHY.has(String(value).trim());
}

/**
 * Split a multi-value cell. `|` rather than `;`, because `;` may be the
 * delimiter itself on a European Excel install.
 */
export function splitList(value) {
  if (!value) return [];
  return String(value)
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Split `Label::value` pairs, e.g. `China::68|Chile::24`.
 * @returns {{label: string, value: string}[]}
 */
export function splitPairs(value) {
  return splitList(value).map((item) => {
    const idx = item.indexOf('::');
    if (idx === -1) return { label: item, value: '' };
    return { label: item.slice(0, idx).trim(), value: item.slice(idx + 2).trim() };
  });
}

/** Parse a number, returning null rather than NaN for blank or malformed cells. */
export function toNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  // Accept a decimal comma: a European spreadsheet may well write 0,4
  const n = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function toBool(value) {
  return isTicked(value);
}

/**
 * Normalise a name for matching: lowercase, accents stripped, punctuation
 * collapsed to single hyphens. `Light Rare Earths` and `light-rare-earths`
 * both become `light-rare-earths`, so column headings can stay readable.
 */
/**
 * Letters that carry their mark inside the glyph rather than as a combining
 * accent. NFD leaves these whole, so the sweep below turned them into hyphens:
 * Głogów came out as "g-ogow" and Reyðarfjörður as "rey-arfjor-ur". Those still
 * matched themselves, so nothing was broken — but they would not have matched a
 * hand-typed "Glogow" in another file, which is a trap worth closing in a
 * dataset meant to be edited in a spreadsheet.
 */
const TRANSLITERATE = {
  ł: 'l', ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss',
  ð: 'd', đ: 'd', þ: 'th', ı: 'i', ŀ: 'l',
};

export function normaliseKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, (ch) => TRANSLITERATE[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
