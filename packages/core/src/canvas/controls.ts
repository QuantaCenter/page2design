import type { DesignNode } from '../model/design.js';
import { paintText } from './text.js';

/** Paint the captured control state with native Canvas primitives and text. */
export function paintControl(context: CanvasRenderingContext2D, node: DesignNode) {
  const field = node.control!;
  const content = node.controlBox || node.contentBox;
  const x = content.x - node.box.x,
    y = content.y - node.box.y,
    w = content.width,
    h = content.height;
  const width = node.box.width,
    height = node.box.height;
  const fontSize = parseFloat(node.style['font-size']) || 13;
  const lineHeight = parseFloat(node.style['line-height']) || fontSize * 1.2;
  const native = node.style.appearance !== 'none';
  const accent = field.disabled
    ? '#c4c4c4'
    : field.accentColor && field.accentColor !== 'auto'
      ? field.accentColor
      : '#0075ff';
  const color = field.disabled
    ? node.style.color || '#666'
    : node.style['-webkit-text-fill-color'] || node.style.color || '#000';
  const round = (
    left: number,
    top: number,
    width: number,
    height: number,
    radius: number,
    fill: string,
    stroke?: string,
  ) => {
    context.beginPath();
    context.roundRect(
      left,
      top,
      Math.max(0, width),
      Math.max(0, height),
      Math.max(0, Math.min(radius, width / 2, height / 2)),
    );
    context.fillStyle = fill;
    context.fill();
    if (stroke) {
      context.strokeStyle = stroke;
      context.lineWidth = 1;
      context.stroke();
    }
  };
  context.save();
  context.font = `${node.style['font-style'] || 'normal'} ${node.style['font-weight'] || '400'} ${fontSize}px ${node.style['font-family'] || 'Arial'}`;
  context.textBaseline = 'alphabetic';
  context.fillStyle = color;
  const metrics = context.measureText('Hg国'),
    ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent,
    descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
  const baseline = y + (h - ascent - descent) / 2 + ascent;
  const text = (value: string, left = x, top = baseline, fill = color) => {
    context.fillStyle = fill;
    context.fillText(value, left, top);
  };
  if (field.type === 'checkbox' || field.type === 'radio') {
    if (native) {
      const size = Math.min(width, height),
        left = (width - size) / 2 + 0.5,
        top = (height - size) / 2 + 0.5;
      const selected = field.checked || field.indeterminate;
      round(
        left,
        top,
        size - 1,
        size - 1,
        field.type === 'radio' ? size / 2 : 2,
        selected && field.type !== 'radio' ? accent : '#fff',
        selected ? accent : '#767676',
      );
      if (selected) {
        context.strokeStyle = '#fff';
        context.lineWidth = Math.max(1.7, size * 0.13);
        context.lineCap = 'round';
        context.lineJoin = 'round';
        if (field.type === 'radio') {
          context.beginPath();
          context.arc(width / 2, height / 2, size * 0.27, 0, Math.PI * 2);
          context.fillStyle = accent;
          context.fill();
        } else {
          context.beginPath();
          if (field.indeterminate) {
            context.moveTo(width * 0.25, height / 2);
            context.lineTo(width * 0.75, height / 2);
          } else {
            context.moveTo(width * 0.22, height * 0.51);
            context.lineTo(width * 0.43, height * 0.71);
            context.lineTo(width * 0.79, height * 0.28);
          }
          context.stroke();
        }
      }
    }
  } else if (field.type === 'range' || field.type === 'progress' || field.type === 'meter') {
    const min = field.min ?? 0,
      max = field.max ?? (field.type === 'range' ? 100 : 1);
    const ratio = Math.max(0, Math.min(1, (Number(field.value) - min) / (max - min || 1)));
    if (native) {
      const bar = field.parts?.find((part) => part.role === '-webkit-meter-bar');
      const meterValue = field.parts?.find(
        (part) => part.role.startsWith('-webkit-meter-') && part.role.endsWith('-value'),
      );
      const track = Math.min(field.type === 'range' ? 8 : 10, height),
        top = bar ? Math.round(bar.box.y) - node.box.y : (height - track) / 2;
      const fill =
        field.type === 'meter' ? meterValue?.style['background-color'] || '#107c10' : accent;
      context.save();
      context.beginPath();
      context.roundRect(0, top, width, track, track / 2);
      context.clip();
      context.fillStyle = '#efefef';
      context.fillRect(0, top, width, track);
      context.fillStyle = fill;
      const start = field.indeterminate ? width * 0.3 : field.type === 'meter' ? 1 : 0;
      context.fillRect(
        start,
        top,
        field.indeterminate ? width * 0.4 : (width - (field.type === 'meter' ? 2 : 0)) * ratio,
        track,
      );
      context.restore();
      context.beginPath();
      context.roundRect(0.5, top + 0.5, width - 1, Math.max(0, track - 1), track / 2);
      context.strokeStyle = field.type === 'meter' ? '#cacaca' : 'rgba(118,118,118,.5)';
      context.lineWidth = 1;
      context.stroke();
      if (field.type === 'range') {
        const radius = Math.min(8, height / 2);
        context.beginPath();
        context.arc(radius + (width - radius * 2) * ratio, height / 2, radius, 0, Math.PI * 2);
        context.fillStyle = accent;
        context.fill();
      }
    }
  } else if (field.type === 'color') {
    if (native) round(0.5, 0.5, width - 1, height - 1, 2, '#efefef', '#767676');
    const swatch = field.parts?.find((part) => part.role === '-webkit-color-swatch')?.box;
    const left = swatch ? Math.round(swatch.x) - node.box.x : x + 2,
      top = swatch ? Math.round(swatch.y) - node.box.y : y + 2;
    const sw = swatch?.width || Math.max(0, w - 4),
      sh = swatch?.height || Math.max(0, h - 4);
    context.fillStyle = field.value || '#000';
    context.fillRect(left, top, sw, sh);
    context.strokeStyle = '#777';
    context.lineWidth = 1;
    context.strokeRect(left + 0.5, top + 0.5, Math.max(0, sw - 1), Math.max(0, sh - 1));
  } else if (field.type === 'select' && (field.multiple || (field.size || 0) > 1)) {
    context.beginPath();
    context.rect(x, y, w, h);
    context.clip();
    const rows = field.parts?.filter((part) => part.role === 'option');
    if (rows?.length) {
      rows.forEach((row, index) => {
        if (!field.options?.[index]?.selected) return;
        context.fillStyle = field.focused ? accent : '#cecece';
        context.fillRect(
          row.box.x - node.box.x,
          row.box.y - node.box.y,
          row.box.width,
          row.box.height,
        );
      });
    }
    for (const [index, option] of (field.options || []).entries()) {
      const top = y + index * lineHeight - (field.scrollTop || 0);
      if (option.selected && !rows?.length) {
        context.fillStyle = field.focused ? accent : '#cecece';
        context.fillRect(x, top, w, lineHeight);
      }
      if (!field.textRuns?.length)
        text(
          option.label,
          x + 2,
          top + (lineHeight - ascent - descent) / 2 + ascent,
          option.disabled ? '#888' : option.selected && field.focused ? '#fff' : color,
        );
    }
    if (field.textRuns?.length) paintText(context, { ...node, runs: field.textRuns });
  } else if (field.type !== 'image') {
    context.beginPath();
    context.rect(x, y, w, h);
    context.clip();
    let value = field.value;
    if (field.type === 'submit' && !value) value = 'Submit';
    if (field.type === 'reset' && !value) value = 'Reset';
    if (field.type === 'file') value = value || 'No file chosen';
    const placeholder = !value && !!field.placeholder;
    if (placeholder) {
      value = field.placeholder!;
      context.globalAlpha *= field.placeholderOpacity ?? 1;
    }
    const fill = placeholder ? field.placeholderColor || '#757575' : color;
    if (field.textRuns?.length) {
      if (field.type === 'file' && native) {
        const part = field.parts?.find((part) => part.role.includes('file-upload-button'));
        if (part)
          round(
            part.box.x - node.box.x,
            part.box.y - node.box.y,
            part.box.width,
            part.box.height,
            2,
            '#efefef',
            '#767676',
          );
      }
      paintText(context, { ...node, runs: field.textRuns });
    } else if (field.type === 'textarea') {
      const maxWidth = w - 1,
        lines: string[] = [];
      for (const paragraph of value.split('\n')) {
        let line = '';
        for (const part of Array.from(paragraph)) {
          if (line && context.measureText(line + part).width > maxWidth) {
            lines.push(line);
            line = '';
          }
          line += part;
        }
        lines.push(line);
      }
      lines.forEach((line, index) =>
        text(
          line,
          x - (field.scrollLeft || 0),
          y +
            (lineHeight - ascent - descent) / 2 +
            ascent +
            index * lineHeight -
            (field.scrollTop || 0),
          fill,
        ),
      );
    } else {
      const centered = ['button', 'submit', 'reset'].includes(field.type);
      const left = centered
        ? x + (w - context.measureText(value).width) / 2
        : x - (field.scrollLeft || 0) + (field.type === 'select' ? 2 : 0);
      text(value, left, baseline, fill);
    }
    if (field.type === 'select' && native) {
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(width - 16, height / 2 - 2);
      context.lineTo(width - 12, height / 2 + 2);
      context.lineTo(width - 8, height / 2 - 2);
      context.stroke();
    }
    for (const part of field.parts || []) {
      if (
        !part.role.includes('calendar-picker-indicator') &&
        !part.role.includes('search-cancel-button')
      )
        continue;
      const cx = part.box.x - node.box.x + part.box.width / 2,
        cy = part.box.y - node.box.y + part.box.height / 2;
      context.save();
      context.strokeStyle = color;
      context.fillStyle = color;
      context.lineWidth = 1.5;
      if (part.role.includes('search-cancel-button')) {
        context.beginPath();
        context.arc(cx, cy, 5, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = '#fff';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(cx - 2, cy - 2);
        context.lineTo(cx + 2, cy + 2);
        context.moveTo(cx + 2, cy - 2);
        context.lineTo(cx - 2, cy + 2);
        context.stroke();
      } else if (field.type === 'time') {
        context.beginPath();
        context.arc(cx, cy, 6, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.moveTo(cx, cy - 4);
        context.lineTo(cx, cy);
        context.lineTo(cx + 3, cy + 2);
        context.stroke();
      } else {
        context.strokeRect(cx - 5.5, cy - 4.5, 11, 10);
        context.beginPath();
        context.moveTo(cx - 5, cy - 1.5);
        context.lineTo(cx + 5, cy - 1.5);
        context.moveTo(cx - 3, cy - 6);
        context.lineTo(cx - 3, cy - 3);
        context.moveTo(cx + 3, cy - 6);
        context.lineTo(cx + 3, cy - 3);
        context.stroke();
        context.fillRect(cx - 2, cy + 1, 2, 2);
      }
      context.restore();
    }
    if (field.type === 'file' && native && !field.textRuns?.length) {
      context.restore();
      context.save();
      round(x, y, 82, h, 2, '#efefef', '#767676');
      context.font = `${fontSize}px ${node.style['font-family'] || 'Arial'}`;
      context.textBaseline = 'alphabetic';
      text('Choose File', x + 7, baseline);
    }
  }
  context.restore();
  if (field.focused && node.style['outline-style'] && node.style['outline-style'] !== 'none') {
    context.save();
    const line = parseFloat(node.style['outline-width']) || 1,
      offset = parseFloat(node.style['outline-offset']) || 0;
    context.strokeStyle = node.style['outline-color'] || accent;
    context.lineWidth = line;
    context.beginPath();
    context.roundRect(
      -offset - line / 2,
      -offset - line / 2,
      width + 2 * offset + line,
      height + 2 * offset + line,
      node.radius.map((radius) => Math.max(0, radius + offset + line / 2)),
    );
    context.stroke();
    context.restore();
  }
}
