export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== "string") {
      return Response.json({ error: "URL이 필요합니다" }, { status: 400 });
    }

    const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!idMatch) {
      return Response.json(
        { error: "유효한 Google Sheets URL이 아닙니다" },
        { status: 400 }
      );
    }

    const spreadsheetId = idMatch[1];
    const gidMatch = url.match(/gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : "0";

    // Try /export first (preserves merged cell headers), fallback to /gviz
    const urls = [
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`,
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`,
    ];

    let csvText = "";
    for (const csvUrl of urls) {
      try {
        const r = await fetch(csvUrl, { redirect: "follow" });
        if (r.ok) {
          const text = await r.text();
          if (
            text.length > 0 &&
            !text.trim().startsWith("<!DOCTYPE") &&
            !text.trim().startsWith("<html")
          ) {
            csvText = text;
            break;
          }
        }
      } catch {
        continue;
      }
    }

    if (!csvText) {
      return Response.json(
        {
          error:
            '시트를 가져올 수 없습니다. "링크가 있는 모든 사용자" 공유인지 확인하세요.',
        },
        { status: 400 }
      );
    }

    const allRows = parseCSV(csvText);

    if (allRows.length === 0) {
      return Response.json({ error: "빈 시트입니다" }, { status: 400 });
    }

    // Find header row: look for row containing email-related keyword
    const emailKeywords = ["이메일", "email", "e-mail", "mail"];
    let headerIndex = -1;

    for (let i = 0; i < allRows.length; i++) {
      const hasEmailKeyword = allRows[i].some((c) =>
        emailKeywords.some((k) => c.trim().toLowerCase().includes(k))
      );
      if (hasEmailKeyword) {
        headerIndex = i;
        break;
      }
    }

    // Fallback: row with the most non-empty cells in first 30 rows
    if (headerIndex === -1) {
      let maxNonEmpty = 0;
      for (let i = 0; i < Math.min(allRows.length, 30); i++) {
        const nonEmpty = allRows[i].filter((c) => c.trim()).length;
        if (nonEmpty > maxNonEmpty) {
          maxNonEmpty = nonEmpty;
          headerIndex = i;
        }
      }
    }

    if (headerIndex === -1) {
      return Response.json(
        { error: "헤더 행을 찾을 수 없습니다" },
        { status: 400 }
      );
    }

    const rawHeaders = allRows[headerIndex];
    const rawData = allRows.slice(headerIndex + 1);

    // Find column range with actual data (check headers AND data rows)
    let firstCol = rawHeaders.length;
    let lastCol = -1;

    // Check headers for non-empty
    for (let c = 0; c < rawHeaders.length; c++) {
      if (rawHeaders[c].trim()) {
        if (c < firstCol) firstCol = c;
        if (c > lastCol) lastCol = c;
      }
    }

    // Also check first few data rows to catch columns with data but empty headers
    for (const row of rawData.slice(0, 5)) {
      for (let c = 0; c < row.length; c++) {
        if (row[c].trim()) {
          if (c < firstCol) firstCol = c;
          if (c > lastCol) lastCol = c;
        }
      }
    }

    if (firstCol > lastCol) {
      return Response.json(
        { error: "데이터가 없는 시트입니다" },
        { status: 400 }
      );
    }

    // Slice columns, clean headers (replace newlines, trim)
    const headers = rawHeaders.slice(firstCol, lastCol + 1).map((h) =>
      cleanCell(h)
    );

    // For columns with empty headers but data, generate a label
    for (let i = 0; i < headers.length; i++) {
      if (!headers[i]) {
        // Check data to see if this column has values
        const hasData = rawData.some(
          (row) => row[firstCol + i] && row[firstCol + i].trim()
        );
        if (hasData) {
          headers[i] = `열${firstCol + i + 1}`;
        }
      }
    }

    // Filter out trailing columns that are both empty header AND no data
    while (headers.length > 0 && !headers[headers.length - 1]) {
      headers.pop();
    }

    const data = rawData
      .map((row) =>
        row
          .slice(firstCol, firstCol + headers.length)
          .map((c) => cleanCell(c))
      )
      .filter((row) => row.some((cell) => cell));

    // Remove "합 계" and summary rows
    const cleanData = data.filter((row) => {
      const firstCell = row.find((c) => c);
      return firstCell && !firstCell.includes("합 계") && !firstCell.includes("합계");
    });

    return Response.json({
      headers,
      data: cleanData,
      totalRows: cleanData.length,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// Clean cell value: trim whitespace/tabs, remove stray quotes, normalize
function cleanCell(value: string): string {
  let v = value.trim().replace(/\n/g, " ");
  // Remove wrapping stray quotes like "value" → value
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    v = v.slice(1, -1).trim();
  }
  // Remove leading-only or trailing-only stray quotes
  if (v.startsWith('"') && !v.includes('"', 1)) {
    v = v.slice(1).trim();
  }
  if (v.endsWith('"') && v.indexOf('"') === v.length - 1) {
    v = v.slice(0, -1).trim();
  }
  return v;
}

// CSV parser handling quoted fields with commas, newlines, and escaped quotes
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(current);
        current = "";
      } else if (char === "\n" || (char === "\r" && next === "\n")) {
        row.push(current);
        rows.push(row);
        row = [];
        current = "";
        if (char === "\r") i++;
      } else {
        current += char;
      }
    }
  }

  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}
