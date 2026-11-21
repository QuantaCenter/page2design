import type { Clip, Rect } from '../model/design.js';
import type { TableCell, TablePart, TableSnapshot } from '../model/tables.js';

/** Runs in the target browser after DOM nodes have stable capture IDs. */
export function collectDomTables(options: { document: Document }): TableSnapshot[] {
  const document = options.document;
  const window = document.defaultView!;
  if (!window) throw new TypeError('The supplied document must have a rendering window.');
  const getComputedStyle = window.getComputedStyle.bind(window);
  const snapshots: TableSnapshot[] = [];
  const rect = (element: Element): Rect => {
    const box = element.getBoundingClientRect();
    return {
      x: box.x + window.scrollX,
      y: box.y + window.scrollY,
      width: box.width,
      height: box.height,
    };
  };
  const number = (value: string) => parseFloat(value) || 0;
  const part = (element: Element, priority: number, areas: Clip[] = []): TablePart => {
    const css = getComputedStyle(element);
    return {
      nodeId: element.getAttribute('data-page-to-design-id') || undefined,
      tag: element.tagName.toLowerCase(),
      box: rect(element),
      border: {
        top: number(css.borderTopWidth),
        right: number(css.borderRightWidth),
        bottom: number(css.borderBottomWidth),
        left: number(css.borderLeftWidth),
      },
      colors: [
        css.borderTopColor,
        css.borderRightColor,
        css.borderBottomColor,
        css.borderLeftColor,
      ],
      styles: [
        css.borderTopStyle,
        css.borderRightStyle,
        css.borderBottomStyle,
        css.borderLeftStyle,
      ],
      priority,
      areas,
    };
  };
  for (const table of Array.from(document.querySelectorAll('table'))) {
    const nodeId = table.getAttribute('data-page-to-design-id');
    if (!nodeId) continue;
    const css = getComputedStyle(table);
    const collapsed = css.borderCollapse === 'collapse';
    const rows = Array.from(table.rows).slice(0, 1500);
    const occupancy: number[] = [];
    const cells: TableCell[] = [];
    const rowCells = new Map<Element, TableCell[]>();
    rows.forEach((row, rowIndex) => {
      let column = 0;
      for (const cell of Array.from(row.cells)) {
        if (cells.length >= 6000) break;
        while ((occupancy[column] || 0) > rowIndex) column++;
        const rowSpan =
          cell.rowSpan ||
          rows.filter(
            (other, index) => index >= rowIndex && other.parentElement === row.parentElement,
          ).length;
        const colSpan = cell.colSpan;
        const hiddenEmpty =
          !collapsed &&
          getComputedStyle(cell).emptyCells === 'hide' &&
          /^[\t\n\f\r ]*$/.test(cell.textContent || '') &&
          !cell.children.length;
        const cellCss = getComputedStyle(cell);
        const radius = collapsed
          ? [0, 0, 0, 0]
          : [
              cellCss.borderTopLeftRadius,
              cellCss.borderTopRightRadius,
              cellCss.borderBottomRightRadius,
              cellCss.borderBottomLeftRadius,
            ].map(number);
        const item: TableCell = {
          ...part(cell, 6),
          row: rowIndex,
          column,
          rowSpan,
          colSpan,
          hiddenEmpty,
          radius,
        };
        cells.push(item);
        const owned = rowCells.get(row) || [];
        owned.push(item);
        rowCells.set(row, owned);
        for (let offset = 0; offset < colSpan; offset++)
          occupancy[column + offset] = rowIndex + rowSpan;
        column += colSpan;
      }
    });
    if (!cells.length) continue;
    const left = Math.min(...cells.map((cell) => cell.box.x));
    const top = Math.min(...cells.map((cell) => cell.box.y));
    const right = Math.max(...cells.map((cell) => cell.box.x + cell.box.width));
    const bottom = Math.max(...cells.map((cell) => cell.box.y + cell.box.height));
    const gridBox = { x: left, y: top, width: right - left, height: bottom - top };
    const rootPart = part(table, 1);
    rootPart.box = gridBox;
    const parts: TablePart[] = [rootPart];
    // Chromium suppresses the empty cell's own paint, while row/column layers
    // remain visible through it. Their coverage also follows cell corner radii.
    const areas = (owned: TableCell[]): Clip[] =>
      owned.map((cell) => ({ ...cell.box, radius: cell.radius }));
    for (const row of rows) parts.push(part(row, 5, areas(rowCells.get(row) || [])));
    for (const group of Array.from(table.children).filter((element) =>
      ['THEAD', 'TBODY', 'TFOOT'].includes(element.tagName),
    )) {
      const owned = cells.filter((cell) => rows[cell.row]?.parentElement === group);
      parts.push(part(group, 4, areas(owned)));
    }
    let column = 0;
    for (const group of Array.from(table.children).filter(
      (element) => element.tagName === 'COLGROUP',
    )) {
      const start = column;
      const columns = Array.from(group.children).filter(
        (element) => element.tagName === 'COL',
      ) as HTMLTableColElement[];
      if (columns.length) {
        for (const col of columns) {
          const end = column + col.span;
          parts.push(
            part(col, 3, areas(cells.filter((cell) => cell.column >= column && cell.column < end))),
          );
          column = end;
        }
      } else column += (group as HTMLTableColElement).span;
      parts.push(
        part(group, 2, areas(cells.filter((cell) => cell.column >= start && cell.column < column))),
      );
    }
    const tableBox = rect(table);
    const spacing = css.borderSpacing.split(/\s+/).map(number);
    const verticalSpacing = spacing[1] ?? spacing[0] ?? 0;
    const upperInset = number(css.borderTopWidth) + number(css.paddingTop) + verticalSpacing;
    const lowerInset = number(css.borderBottomWidth) + number(css.paddingBottom) + verticalSpacing;
    const paintBox = collapsed
      ? gridBox
      : {
          x: tableBox.x,
          y: top - upperInset,
          width: tableBox.width,
          height: bottom - top + upperInset + lowerInset,
        };
    snapshots.push({
      nodeId,
      collapsed,
      gridBox,
      paintBox,
      parts,
      cells,
      descendantIds: Array.from(table.querySelectorAll('[data-page-to-design-id]')).map((element) =>
        element.getAttribute('data-page-to-design-id')!,
      ),
    });
  }
  return snapshots;
}
