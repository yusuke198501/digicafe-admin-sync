import * as cheerio from 'cheerio';

function compact(value) {
  return String(value ?? '').replace(/\s/g, '').replace(/[年月.\-]/g, '/').replace(/日/g, '');
}

function dateKey(value) {
  const match = compact(value).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  return match ? `${Number(match[1])}/${Number(match[2])}/${Number(match[3])}` : '';
}

function numberValue(value) {
  const normalized = String(value ?? '').trim().replace(/[¥￥円\s]/g, '');
  if (!/^-?[\d,]+(?:\.\d+)?$/.test(normalized)) return null;
  const digits = normalized.replace(/,/g, '');
  const number = Number(digits);
  return Number.isFinite(number) ? number : null;
}

function tableRows($, table) {
  return $(table).find('tr').toArray().map((row) => $(row).children('th,td').toArray()
    .flatMap((cell) => {
      const colspan = Number($(cell).attr('colspan') ?? 1);
      const value = $(cell).text().replace(/\s+/g, ' ').trim();
      return Array.from({ length: Number.isFinite(colspan) && colspan > 0 ? colspan : 1 }, () => value);
    }));
}

/** Extract the exact-date グロス売上 value from the status/pt report. */
export function parseGrossSales(html, date) {
  const $ = cheerio.load(html);
  const expectedDate = dateKey(date.display ?? date.iso);
  const candidates = [];

  for (const table of $('table').toArray()) {
    const rows = tableRows($, table);

    // status/pt currently renders a grouped header: "グロス" is the parent
    // column group, and the following header row labels its first amount as
    // "売上" (not "グロス売上"). The date column is followed by the gross
    // sales column in that group.
    const grossGroupIndex = rows.findIndex((row) => row.some((cell) => compact(cell) === 'グロス'));
    if (grossGroupIndex >= 0) {
      for (const header of rows.slice(grossGroupIndex + 1, grossGroupIndex + 4)) {
        const headerLabel = (cell) => String(cell ?? '').replace(/\s/g, '');
        const dateIndex = header.findIndex((cell) => ['日時', '日付', '年月日'].includes(headerLabel(cell)));
        if (dateIndex < 0 || headerLabel(header[dateIndex + 1]) !== '売上') continue;
        for (const row of rows.slice(rows.indexOf(header) + 1)) {
          if (dateKey(row[dateIndex]) !== expectedDate) continue;
          const value = numberValue(row[dateIndex + 1]);
          if (value !== null) candidates.push(value);
        }
        break;
      }
    }

    // Tabular layout: a header contains the metric, with a separate date row.
    for (let headerIndex = 0; headerIndex < rows.length; headerIndex += 1) {
      const metricIndex = rows[headerIndex].findIndex((cell) => compact(cell) === 'グロス売上');
      if (metricIndex < 0) continue;
      for (const row of rows.slice(headerIndex + 1)) {
        if (dateKey(row[0]) !== expectedDate) continue;
        const value = numberValue(row[metricIndex]);
        if (value !== null) candidates.push(value);
      }
    }

    // Label/value layout: the filtered page may show one date's metric as rows.
    // If the date is printed in the same row, require it to match the requested day.
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const metricIndex = row.findIndex((cell) => compact(cell) === 'グロス売上');
      if (metricIndex < 0) continue;
      const rowHasDate = row.some((cell) => dateKey(cell) !== '');
      if (rowHasDate && !row.some((cell) => dateKey(cell) === expectedDate)) continue;
      const values = row.slice(metricIndex + 1).map(numberValue).filter((value) => value !== null);
      if (values.length) candidates.push(values[0]);
      else if (!rowHasDate) {
        const nextRow = rows[rowIndex + 1] ?? [];
        const nextRowDates = nextRow.map(dateKey).filter(Boolean);
        if (nextRowDates.length && !nextRowDates.includes(expectedDate)) continue;
        const value = nextRow.map(numberValue).find((item) => item !== null);
        if (value !== undefined) candidates.push(value);
      }
    }
  }

  if (!candidates.length) {
    throw new Error(`status/pt の ${date.display ?? date.iso} に「グロス売上」が見つかりません。`);
  }
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) {
    throw new Error(`status/pt の「グロス売上」が一意に決まりません。候補: ${unique.join(', ')}`);
  }
  return unique[0];
}
