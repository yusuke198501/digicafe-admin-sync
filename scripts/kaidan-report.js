import * as cheerio from 'cheerio';

function normalized(value) {
  return String(value ?? '').replace(/\s/g, '').trim();
}

function expandedRows($, table) {
  return $(table).find('tr').toArray().map((row) => $(row).children('th,td').toArray()
    .flatMap((cell) => {
      const colspan = Number($(cell).attr('colspan') ?? 1);
      const value = $(cell).text().replace(/\s+/g, ' ').trim();
      return Array.from({ length: Number.isFinite(colspan) && colspan > 0 ? colspan : 1 }, () => value);
    }));
}

function metricHeaderIndex(row, kind) {
  const patterns = kind === 'registration'
    ? [/^(男性)?(新規)?登録(数)?$/]
    : [/^(男性)?(年認|年確|年齢確認|年齢認証)(完了)?(数)?$/];
  return row.findIndex((cell) => patterns.some((pattern) => pattern.test(normalized(cell))));
}

function dateRowMatches(value, date) {
  const cell = normalized(value);
  if (!cell) return false;
  if (cell.startsWith(date.iso) || cell.startsWith(date.display)) return true;
  return cell.startsWith(date.label);
}

function numericCell(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`「${label}」の値が空です。`);
  if (text === '-' || text === '－') return 0;
  const parsed = Number(text.replace(/,/g, '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(parsed)) throw new Error(`「${label}」が数値ではありません: ${text}`);
  return parsed;
}

function labelValue(rows, kind) {
  const pattern = kind === 'registration'
    ? /(男性)?(新規)?登録(数)?/
    : /(男性)?(年認|年確|年齢確認|年齢認証)(完了)?(数)?/;
  for (const row of rows) {
    for (let index = 0; index < row.length; index += 1) {
      if (!pattern.test(normalized(row[index]))) continue;
      const value = row.slice(index + 1).find((cell) => /^-?[\d,]+(?:\.\d+)?$/.test(String(cell ?? '').trim())
        || ['-', '－'].includes(String(cell ?? '').trim()));
      if (value !== undefined) return numericCell(value, normalized(row[index]));
    }
  }
  return null;
}

function safeSchemaPreview($, tables, date) {
  const headings = $('h1,h2,h3,h4,h5,h6').toArray()
    .map((heading) => $(heading).text().replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const tableHeaders = $('table').toArray().map((table) => $(table).find('th').toArray()
    .map((cell) => $(cell).text().replace(/\s+/g, ' ').trim())
    .filter(Boolean).slice(0, 16)).filter((row) => row.length);
  const dateRowNumbers = tables.flatMap((rows) => rows
    .filter((row) => row.some((cell) => dateRowMatches(cell, date)))
    .map((row) => row.filter((cell) => dateRowMatches(cell, date)
      || /^-?[\d,]+(?:\.\d+)?$/.test(String(cell ?? '').trim())
      || ['-', '－'].includes(String(cell ?? '').trim())))).filter((row) => row.length);
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const bodyFlags = {
    length: bodyText.length,
    hasRegistrationTerm: bodyText.includes('登録'),
    hasAgeVerificationTerm: /年認|年確|年齢/.test(bodyText),
    hasNoResultsTerm: /該当なし|該当データ|データがありません|検索結果はありません|0件/.test(bodyText),
    hasLoginForm: $('input[type="password"]').length > 0,
  };
  return `title=${JSON.stringify($('title').text().trim())}; headings=${JSON.stringify(headings)}; table_headers=${JSON.stringify(tableHeaders)}; target_date_rows=${JSON.stringify(dateRowNumbers)}; body_flags=${JSON.stringify(bodyFlags)}`;
}

/**
 * Parses the male daily-registration report for the selected report date.
 * It supports a date-column table or a single-day summary returned by the
 * same filtered endpoint. Ambiguous multi-date tables are rejected.
 */
export function parseKaidanMetrics(html, date) {
  const $ = cheerio.load(html);
  const tables = $('table').toArray().map((table) => expandedRows($, table));
  let registration = null;
  let ageVerification = null;

  for (const rows of tables) {
    for (let headerIndex = 0; headerIndex < rows.length; headerIndex += 1) {
      const registrationIndex = metricHeaderIndex(rows[headerIndex], 'registration');
      const ageIndex = metricHeaderIndex(rows[headerIndex], 'age');
      if (registrationIndex < 0 || ageIndex < 0) continue;

      const dataRows = rows.slice(headerIndex + 1).filter((row) => row[registrationIndex] !== undefined
        && row[ageIndex] !== undefined
        && (/^-?[\d,]+(?:\.\d+)?$/.test(String(row[registrationIndex]).trim()) || ['-', '－'].includes(String(row[registrationIndex]).trim()))
        && (/^-?[\d,]+(?:\.\d+)?$/.test(String(row[ageIndex]).trim()) || ['-', '－'].includes(String(row[ageIndex]).trim())));
      const datedRows = dataRows.filter((row) => row.some((cell) => dateRowMatches(cell, date)));
      let selected = datedRows.length === 1 ? datedRows[0] : null;
      if (datedRows.length > 1) throw new Error(`${date.display} に一致する登録・年確データが複数あります。`);
      if (!selected && dataRows.length === 1) selected = dataRows[0];
      if (!selected && dataRows.length > 1) {
        throw new Error(`${date.display} の登録・年確データを日別表から特定できません。`);
      }
      if (!selected) continue;

      const candidateRegistration = numericCell(selected[registrationIndex], '男性登録数');
      const candidateAgeVerification = numericCell(selected[ageIndex], '男性年認完了数');
      if (registration !== null && registration !== candidateRegistration) {
        throw new Error('男性登録数の候補が複数見つかり、値が一致しません。');
      }
      if (ageVerification !== null && ageVerification !== candidateAgeVerification) {
        throw new Error('男性年認完了数の候補が複数見つかり、値が一致しません。');
      }
      registration = candidateRegistration;
      ageVerification = candidateAgeVerification;
    }
  }

  // Some report variants show each metric as a label/value row, with the
  // date filter reducing the page to a single selected day.
  if (registration === null || ageVerification === null) {
    const tableRows = tables.flat();
    const rowRegistration = labelValue(tableRows, 'registration');
    const rowAgeVerification = labelValue(tableRows, 'age');
    if (registration === null) registration = rowRegistration;
    if (ageVerification === null) ageVerification = rowAgeVerification;
  }

  if (registration === null || ageVerification === null) {
    throw new Error(`${date.display} の男性登録数・男性年認完了数を管理画面から特定できません。${safeSchemaPreview($, tables, date)}`);
  }
  return { registrations: registration, ageVerifications: ageVerification };
}
