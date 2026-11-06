import * as cheerio from 'cheerio';

// Use daily cumulative values, independent of the scheduled reporting slot.
export function parseAbceReceiveTotal(html, displayDate) {
  const $ = cheerio.load(html);
  const normalize = (value) => String(value ?? '').replace(/\s+/g, '');
  const heading = $('h1,h2,h3,h4,h5,h6').toArray().find((el) =>
    normalize($(el).text()) === 'UF_MKT系データ(フォルダ別/日毎)');
  if (!heading) throw new Error('フォルダ別/日毎がありません。');
  const following = $(heading).nextAll();
  const table = following.filter('table').first().add(following.find('table').first()).first();
  const rows = table.find('tr').toArray().map((row) =>
    $(row).children('th,td').toArray().flatMap((cell) =>
      Array.from({ length: Number($(cell).attr('colspan') || 1) }, () => $(cell).text().trim())));
  const headers = ['A受信', 'B受信', 'C受信', 'E受信'];
  const header = rows.find((row) => headers.every((label) => row.map(normalize).includes(label)));
  const day = rows.find((row) => normalize(row[0]) === normalize(displayDate));
  if (!header || !day) throw new Error('BOX受信の見出しまたは対象日がありません。');
  return headers.reduce((sum, label) => {
    const indexes = header.map(normalize).flatMap((value, i) => value === label ? [i] : []);
    if (indexes.length !== 1) throw new Error(`${label}の列を一意に特定できません。`);
    const raw = normalize(day[indexes[0]]).replace(/,/g, '');
    if (!/^\d+$/.test(raw)) throw new Error(`${label}の受信数が不正です。`);
    return sum + Number(raw);
  }, 0);
}

export function abceReceiveWrites(sheetName, date, row, total) {
  // The layout change is currently authorized for November 6 only.
  if (date.iso !== '2026-11-06' || !Number.isSafeInteger(total) || total < 0) return [];
  return [{ range: `'${sheetName}'!AX${row}`, values: [[total]] }];
}
