// Ported from the user-provided DC Google Apps Script. Pure parsing only.
function parseAdCodeDailyValues(html, target) {
  return parseAdCodeValuesAtColumn(html, (header) => dateCellMatches(header, target), formatDate(target));
}

function parseAdCodeTotalValues(html) {
  return parseAdCodeValuesAtColumn(html, isAdCodeTotalHeader, '合計');
}

function parseAdCodeValuesAtColumn(html, matchesHeader, columnName) {
  const mainTable = balancedHtmlTables(html)
    .filter((table) => table.openings === 1
      && stripTags(table.html).includes('アクセス(unique)')
      && stripTags(table.html).includes('広告コード'))
    .sort((left, right) => right.html.length - left.html.length)[0];
  if (!mainTable) throw new Error('広告コード集計表の外側テーブルが見つかりません。');

  const outerRows = directTableRows(mainTable.html);
  const headerIndex = outerRows.findIndex((row) => directTableCells(row)
    .some((cell) => matchesHeader(tableCellText(cell))));
  if (headerIndex === -1) throw new Error(`広告コード集計表に ${columnName} の列が見つかりません。`);
  const headerCells = directTableCells(outerRows[headerIndex]);
  const valueCellIndex = headerCells.findIndex((cell) => matchesHeader(tableCellText(cell)));
  const result = new Map();
  for (let rowIndex = headerIndex + 1; rowIndex < outerRows.length; rowIndex += 1) {
    const cells = directTableCells(outerRows[rowIndex]);
    if (cells.length <= valueCellIndex) continue;
    const code = adCodeFromCell(tableCellText(cells[0]));
    if (!code) continue;
    // 各セルには指標ごとの div が7個並ぶ。セル全文を読まないこと。
    const items = directDivTexts(cells[1]);
    const values = directDivTexts(cells[valueCellIndex]);
    items.forEach((item, index) => {
      const label = normalizeMetricLabel(item);
      if (label && index < values.length) result.set(adCodeMetricKey(code, label), sheetValue(values[index]));
    });
  }
  if (result.size === 0) throw new Error(`広告コード明細表に ${columnName} の値が見つかりません。`);
  return result;
}

function isAdCodeTotalHeader(value) {
  return normalizeLabel(value) === '合計';
}

function adCodeColumnValues(rows, source) {
  const values = Array.from({ length: rows.length }, () => ['']);
  const sheetKeys = [];
  let matched = 0;
  rows.forEach(([codeCell, itemCell], index) => {
    const currentCode = adCodeForCurrentMonthDataRow(rows, index);
    const key = adCodeMetricKey(currentCode, itemCell);
    if (currentCode && itemCell) sheetKeys.push(key);
    if (!source.has(key)) return;
    values[index][0] = source.get(key);
    matched += 1;
  });
  return { values, matched, sheetKeys };
}

function directTableRows(tableHtml) {
  const tags = tableHtml.matchAll(/<\/?(?:table|tr)\b[^>]*>/gi);
  const rows = [];
  let tableDepth = 0;
  let rowStart = -1;
  for (const tagMatch of tags) {
    const tag = tagMatch[0];
    if (/^<table\b/i.test(tag)) {
      tableDepth += 1;
    } else if (/^<\/table/i.test(tag)) {
      tableDepth -= 1;
    } else if (/^<tr\b/i.test(tag) && tableDepth === 1) {
      rowStart = tagMatch.index;
    } else if (/^<\/tr/i.test(tag) && tableDepth === 1 && rowStart !== -1) {
      rows.push(tableHtml.slice(rowStart, tagMatch.index + tag.length));
      rowStart = -1;
    }
  }
  return rows;
}

function directTableCells(rowHtml) {
  const tags = rowHtml.matchAll(/<\/?(?:table|td|th)\b[^>]*>/gi);
  const cells = [];
  let tableDepth = 0;
  let cellStart = -1;
  let cellTag = '';
  for (const tagMatch of tags) {
    const tag = tagMatch[0];
    if (/^<table\b/i.test(tag)) {
      tableDepth += 1;
    } else if (/^<\/table/i.test(tag)) {
      tableDepth -= 1;
    } else if (/^<(td|th)\b/i.test(tag) && tableDepth === 0 && cellStart === -1) {
      cellStart = tagMatch.index;
      cellTag = /^<td\b/i.test(tag) ? 'td' : 'th';
    } else if (new RegExp(`^<\\/${cellTag}`, 'i').test(tag) && tableDepth === 0 && cellStart !== -1) {
      cells.push(rowHtml.slice(cellStart, tagMatch.index + tag.length));
      cellStart = -1;
      cellTag = '';
    }
  }
  return cells;
}

function directDivTexts(cellHtml) {
  const values = [];
  const divPattern = /<div\b[^>]*>([\s\S]*?)<\/div>/gi;
  let match;
  while ((match = divPattern.exec(cellHtml)) !== null) {
    const value = tableCellText(match[1]);
    values.push(value);
  }
  return values;
}

function balancedHtmlTables(html) {
  const tokens = html.matchAll(/<\/?table\b[^>]*>/gi);
  const stack = [];
  const tables = [];
  for (const token of tokens) {
    const tag = token[0];
    if (/^<table\b/i.test(tag)) {
      stack.push({ start: token.index, depth: stack.length });
      continue;
    }
    const opening = stack.pop();
    if (!opening) continue;
    const end = token.index + tag.length;
    const tableHtml = html.slice(opening.start, end);
    tables.push({
      html: tableHtml,
      start: opening.start,
      depth: opening.depth,
      openings: (tableHtml.match(/<table\b/gi) || []).length,
    });
  }
  return tables;
}

function adCodeForCurrentMonthDataRow(rows, rowIndex) {
  const codeCell = String(rows[rowIndex][0] || '').trim();
  if (isAdCodeMarker(codeCell)) {
    for (let next = rowIndex + 1; next < rows.length; next += 1) {
      const nextCell = String(rows[next][0] || '').trim();
      if (!nextCell) continue;
      return adCodeFromCell(nextCell);
    }
    return '';
  }

  const ownCode = adCodeFromCell(codeCell);
  if (ownCode) return ownCode;
  for (let previous = rowIndex - 1; previous >= 1; previous -= 1) {
    const previousCell = String(rows[previous][0] || '').trim();
    if (!previousCell) continue;
    return isAdCodeMarker(previousCell)
      ? adCodeForCurrentMonthDataRow(rows, previous)
      : adCodeFromCell(previousCell);
  }
  return '';
}

function isAdCodeMarker(value) {
  return normalizeLabel(String(value || '')) === String.fromCharCode(24195, 21578, 12467, 12540, 12489);
}

function adCodeFromCell(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const lines = text.split(/\s*\n\s*/).filter(Boolean);
  const withoutLabel = lines.filter((line) => line !== '広告コード');
  if (withoutLabel.length > 0) {
    return withoutLabel[withoutLabel.length - 1].replace(/^広告コード\s*[:：]?\s*/, '').trim();
  }
  return text === '広告コード' ? '' : text;
}

function adCodeMetricKey(code, metric) {
  const normalizedCode = adCodeLookupKey(code);
  const normalizedMetric = normalizeMetricLabel(metric);
  return `${normalizedCode}|${normalizedMetric}`;
}

function adCodeLookupKey(code) {
  return normalizeLabel(adCodeFromCell(code)).toLowerCase();
}

function normalizeMetricLabel(value) {
  // 取得元は「アクセス(unique)」、シート側は「アクセス」または
  // 「アクセス数」と表記されることがあるため、照合用のキーを統一する。
  const label = normalizeLabel(String(value || ''))
    .replace(/[（(]unique[)）]/i, '');
  return /^アクセス(?:数)?$/.test(label) ? 'アクセス' : label;
}

function tableCellText(html) {
  return html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function sheetValue(value) {
  const compact = value.replace(/\s/g, '');
  return /^-?[\d,]+$/.test(compact) ? Number(compact.replace(/,/g, '')) : value;
}

function dateCellMatches(value, targetDate) {
  if (value === undefined || value === null) return false;
  const text = String(value).replace(/\s/g, '');
  const iso = formatDate(targetDate);
  const slash = iso.replace(/-/g, '/');
  const japanese = `${targetDate.getFullYear()}年${targetDate.getMonth() + 1}月${targetDate.getDate()}日`;
  return text === iso || text === slash || text === japanese || text === String(targetDate.getDate());
}

function parseGrossSales(html, targetDate) {
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = tableCells(row);
    if (cells[0] !== targetDate) continue;
    if (cells.length < 2) throw new Error(`${targetDate} の集計行の列数が不足しています。`);

    const value = numberText(cells[1]);
    if (!/^-?\d+$/.test(value)) throw new Error(`グロスの売上を数値として読めません: ${cells[1]}`);
    return Number(value);
  }
  if (/ログイン/.test(html)) throw new Error('Digicafeへのログインが必要です。ID/PWまたはログイン仕様を確認してください。');
  throw new Error(`${targetDate} の集計行が見つかりません。`);
}

function parsePaidMaleTotalUsagePoints(html, targetDate) {
  return Math.abs(paidMaleStatusValue(html, '全利用Pt', targetDate)) * 10;
}

function paidMaleStatusValue(html, label, targetDate) {
  const tables = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || [];
  const found = [];
  for (const table of tables) {
    const rows = table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const groupRow = rows.find(row => tableCells(row).some(cell => normalizeLabel(cell) === '有料男性'));
    if (!groupRow) continue;
    const groups = [...groupRow.matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)]
      .flatMap(match => {
        const span = match[1].match(/\bcolspan\s*=\s*["']?(\d+)/i);
        return Array(span ? Number(span[1]) : 1).fill(normalizeLabel(stripTags(match[2])));
      });
    const header = rows.map(tableCells).find(cells => cells.some(cell => normalizeLabel(cell) === normalizeLabel(label)));
    if (!header) continue;
    const indices = header.map((cell, index) => normalizeLabel(cell) === normalizeLabel(label) && groups[index] === '有料男性' ? index : -1).filter(index => index >= 0);
    if (indices.length !== 1) throw new Error('有料男性の対象列を一意に特定できません: ' + label);
    const matching = rows.map(tableCells).filter(cells => normalizeLabel(cells[0] || '') === (targetDate || '合計'));
    if (matching.length !== 1) throw new Error('対象行を一意に特定できません: ' + label);
    const text = numberText(matching[0][indices[0]] || '');
    if (!/^-?\d+$/.test(text)) throw new Error('数値として読めません: ' + label);
    found.push(Number(text));
  }
  if (found.length !== 1) throw new Error('有料男性の値を一意に取得できません: ' + label);
  return found[0];
}

function parsePaidMalePayersTotal(html) {
  return paidMaleStatusValue(html, '課金者数', null);
}

function parseTotalReceivedMailCount(html) {
  const tables = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || [];
  // 画面には「全体送受信データ」の表が送信・受信の順で横並びになる。
  // 2つ目（右側）が受信データなので、そのメール総数を使う。
  const summaryTables = tables.filter((item) => /全体送受信データ|全体受信データ/.test(stripTags(item)));
  const totals = summaryTables
    .map((table) => mailTotalInTable(table))
    .filter((value) => value !== null);
  if (totals.length >= 2) return totals[1];
  if (totals.length === 1) return totals[0];
  if (/ログイン/.test(html)) throw new Error('Digicafeへのログインが必要です。ID/PWまたはログイン仕様を確認してください。');
  throw new Error('「全体送受信データ」の「メール総数」が見つかりません。');
}

function mailTotalInTable(table) {
  const rows = table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];

  // 項目名と値が同じ行にあるレイアウト（メール総数 | 123）の場合。
  for (const row of rows) {
    const cells = tableCells(row);
    const labelIndex = cells.indexOf('メール総数');
    if (labelIndex === -1) continue;
    for (let valueIndex = labelIndex + 1; valueIndex < cells.length; valueIndex += 1) {
      const value = numberInText(cells[valueIndex]);
      if (value !== null) return value;
    }
  }

  // メール総数が列見出しで、値が次のデータ行にあるレイアウトの場合。
  for (let headerIndex = 0; headerIndex < rows.length; headerIndex += 1) {
    const headerCells = tableCells(rows[headerIndex]);
    const mailColumn = headerCells.indexOf('メール総数');
    if (mailColumn === -1) continue;

    for (let dataIndex = headerIndex + 1; dataIndex < rows.length; dataIndex += 1) {
      const dataCells = tableCells(rows[dataIndex]);
      if (dataCells.length <= mailColumn) continue;
      const value = numberInText(dataCells[mailColumn]);
      if (value !== null) return value;
    }
  }
  return null;
}

function parseUfMktReceiveTotal(html, targetDate) {
  // 表題はtable内ではなく、直前の <h3> に出力される。
  const headingIndex = html.indexOf('UF_MKT系データ');
  if (headingIndex === -1) throw new Error('「UF_MKT系データ(フォルダ別/日毎)」の見出しが見つかりません。');
  const section = html.slice(headingIndex);
  // 入れ子のtableやレイアウト用tableがあっても、以降の各表を順に確認する。
  const tables = section.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || [];
  if (tables.length === 0) throw new Error('「UF_MKT系データ(フォルダ別/日毎)」の直後に表が見つかりません。');
  for (const table of tables) {
    const value = labeledNumberForDate(table, '受信合計', targetDate);
    if (value !== null) return value;
  }
  throw new Error(`「UF_MKT系データ(フォルダ別/日毎)」の ${formatDate(targetDate)} の「受信合計」が見つかりません。`);
}

function labeledNumberForDate(table, label, targetDate) {
  const rows = table.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const normalizedLabel = normalizeLabel(label);
  const target = formatDate(targetDate).replace(/-/g, '/');
  for (let headerIndex = 0; headerIndex < rows.length; headerIndex += 1) {
    const headerCells = tableCells(rows[headerIndex]);
    const labelIndex = headerCells.findIndex((cell) => normalizeLabel(cell) === normalizedLabel);
    if (labelIndex === -1) continue;

    for (let dataIndex = headerIndex + 1; dataIndex < rows.length; dataIndex += 1) {
      const dataCells = tableCells(rows[dataIndex]);
      if (dataCells.length <= labelIndex || dataCells[0] !== target) continue;
      const value = numberInText(dataCells[labelIndex]);
      if (value !== null) return value;
    }
  }
  return null;
}

function tableCells(row) {
  return [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((match) => stripTags(match[1]));
}

function numberText(value) {
  return value.replace(/[￥¥,\s]/g, '');
}

function numberInText(value) {
  const matched = value.match(/-?[\d,]+/);
  return matched ? Number(matched[0].replace(/,/g, '')) : null;
}

function normalizeLabel(value) {
  return value.replace(/\s/g, '');
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').trim();
}

function formatDate(date) { return date.toISOString().slice(0,10); }
export { parseAdCodeDailyValues, parseAdCodeTotalValues, parseAdCodeValuesAtColumn, isAdCodeTotalHeader, adCodeColumnValues, directTableRows, directTableCells, directDivTexts, balancedHtmlTables, adCodeForCurrentMonthDataRow, isAdCodeMarker, adCodeFromCell, adCodeMetricKey, adCodeLookupKey, normalizeMetricLabel, tableCellText, sheetValue, dateCellMatches, parseGrossSales, parsePaidMaleTotalUsagePoints, paidMaleStatusValue, parsePaidMalePayersTotal, parseTotalReceivedMailCount, mailTotalInTable, parseUfMktReceiveTotal, labeledNumberForDate, tableCells, numberText, numberInText, normalizeLabel, stripTags };
