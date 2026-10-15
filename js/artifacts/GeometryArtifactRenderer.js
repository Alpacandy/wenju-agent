/** Geometry previews use one metric scale and keep annotation outside the drawing. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeometryArtifactRenderer = api.GeometryArtifactRenderer;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const LIMITS = Object.freeze({ shapes: 128, vertices: 512, coordinate: 1e6, label: 512, expression: 256, samples: 240 });
  const PALETTE = ['#2563eb', '#059669', '#db2777', '#d97706', '#7c3aed', '#0891b2'];
  const NAMES = { polygon: '多边形', rectangle: '矩形', diamond: '菱形', circle: '圆', function_curve: '函数曲线', vector: '向量', arrow: '向量' };
  const escape = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const format = value => Number(value.toPrecision(5)).toString();
  const pixel = value => Number(value.toFixed(3));

  function number(value, fallback) {
    const candidate = value === undefined ? fallback : value;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || Math.abs(candidate) > LIMITS.coordinate) {
      throw new Error('坐标与尺寸必须是有限数值，绝对值不得超过 1000000');
    }
    return candidate;
  }

  function point(value) {
    if (!Array.isArray(value) || value.length !== 2) throw new Error('顶点必须是 [x, y]');
    return [number(value[0]), number(value[1])];
  }

  function color(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const candidate = value.trim();
    if (/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(candidate)) return candidate;
    if (/^(?:transparent|none|black|white|red|green|blue|orange|purple|gray|grey|pink|cyan|teal|navy)$/i.test(candidate)) return candidate;
    const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?|\.\d+))?\s*\)$/i.exec(candidate);
    if (rgb && rgb.slice(1, 4).every(v => Number(v) <= 255) && Number(rgb[4] ?? 1) <= 1) {
      return rgb[4] === undefined ? `rgb(${rgb[1]},${rgb[2]},${rgb[3]})` : `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${rgb[4]})`;
    }
    return fallback;
  }

  // A bounded arithmetic grammar, not JavaScript: no property access, assignments or dynamic code.
  function parseExpression(source) {
    if (typeof source !== 'string' || !source.trim() || source.length > LIMITS.expression) throw new Error('函数表达式为空或超过 256 个字符');
    const functions = { sin: [Math.sin, 1], cos: [Math.cos, 1], tan: [Math.tan, 1], asin: [Math.asin, 1], acos: [Math.acos, 1], atan: [Math.atan, 1], abs: [Math.abs, 1], sqrt: [Math.sqrt, 1], exp: [Math.exp, 1], log: [Math.log, 1], log10: [Math.log10, 1], floor: [Math.floor, 1], ceil: [Math.ceil, 1], pow: [Math.pow, 2], min: [Math.min, 2], max: [Math.max, 2] };
    const tokens = [];
    const pattern = /\s*(?:(\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|((?:Math\.)?[A-Za-z][A-Za-z0-9]*)|(\*\*|[+\-*/^(),]))/iy;
    let offset = 0;
    while (offset < source.length) {
      if (!source.slice(offset).trim()) break;
      pattern.lastIndex = offset;
      const match = pattern.exec(source);
      if (!match || match.index !== offset) throw new Error('仅支持 x、算术运算和常用数学函数');
      tokens.push(match[1] ? { type: 'number', value: Number(match[1]) } : { type: match[2] ? 'name' : 'operator', value: match[2] || match[3] });
      offset = pattern.lastIndex;
      if (tokens.length > 128) throw new Error('函数表达式过于复杂');
    }
    let cursor = 0;
    const peek = () => tokens[cursor] && tokens[cursor].value;
    const consume = value => { if (peek() !== value) throw new Error(`表达式缺少 ${value}`); cursor++; };
    function primary(depth) {
      if (depth > 24) throw new Error('函数表达式嵌套超过 24 层');
      const token = tokens[cursor++];
      if (!token) throw new Error('函数表达式不完整');
      if (token.type === 'number') {
        if (!Number.isFinite(token.value)) throw new Error('函数包含非有限常数');
        return () => token.value;
      }
      if (token.value === '(') { const inner = expression(0, depth + 1); consume(')'); return inner; }
      if (token.value === '+' || token.value === '-') {
        const inner = expression(3, depth + 1);
        return x => token.value === '-' ? -inner(x) : inner(x);
      }
      if (token.type === 'name') {
        const name = token.value.replace(/^Math\./, '');
        if (name === 'x' && token.value === 'x') return x => x;
        if (name === 'PI' || name === 'pi') return () => Math.PI;
        if (name === 'E' || name === 'e') return () => Math.E;
        const fn = Object.prototype.hasOwnProperty.call(functions, name) ? functions[name] : null;
        if (!fn) throw new Error(`不支持的函数或符号：${name}`);
        consume('(');
        const args = [expression(0, depth + 1)];
        while (peek() === ',') { cursor++; args.push(expression(0, depth + 1)); if (args.length > 2) throw new Error('函数参数过多'); }
        consume(')');
        if (args.length !== fn[1]) throw new Error(`${name} 的参数数量应为 ${fn[1]}`);
        return x => fn[0](...args.map(arg => arg(x)));
      }
      throw new Error('函数表达式存在未知符号');
    }
    function expression(minPrecedence, depth) {
      let left = primary(depth);
      const precedences = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3, '**': 3 };
      while (Object.prototype.hasOwnProperty.call(precedences, peek()) && precedences[peek()] >= minPrecedence) {
        const op = tokens[cursor++].value;
        const right = expression(precedences[op] + (op === '^' || op === '**' ? 0 : 1), depth + 1);
        const previous = left;
        left = x => {
          const a = previous(x), b = right(x);
          if (op === '+') return a + b;
          if (op === '-') return a - b;
          if (op === '*') return a * b;
          if (op === '/') return a / b;
          return a ** b;
        };
      }
      return left;
    }
    const evaluate = expression(0, 0);
    if (cursor !== tokens.length) throw new Error('函数表达式包含未消费符号');
    return evaluate;
  }

  function normalize(raw, index, diagnostics) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('图元必须是对象');
    const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : '';
    if (!Object.prototype.hasOwnProperty.call(NAMES, type)) throw new Error('不支持的图元类型');
    const label = typeof raw.label === 'string' ? raw.label.slice(0, LIMITS.label) : `${NAMES[type]} ${index + 1}`;
    if (typeof raw.label === 'string' && raw.label.length > LIMITS.label) diagnostics.push({ code: 'LABEL_TRUNCATED', index, message: '标签超过 512 个字符，显示前 512 个字符' });
    const stroke = color(raw.strokeColor, PALETTE[index % PALETTE.length]);
    const fill = color(raw.fillColor, stroke);
    const shape = { type, index, label, stroke, fill, fillOpacity: raw.fillColor ? 1 : 0.09, points: [], detail: NAMES[type] };
    if (type === 'function_curve') {
      const domain = raw.domain === undefined ? [-4, 4] : point(raw.domain);
      if (domain[0] >= domain[1]) throw new Error('函数定义域须满足 minX < maxX');
      const evaluate = parseExpression(raw.expression);
      let gaps = 0;
      for (let i = 0; i <= LIMITS.samples; i++) {
        const x = domain[0] + (domain[1] - domain[0]) * i / LIMITS.samples;
        const y = evaluate(x);
        if (!Number.isFinite(y) || Math.abs(y) > LIMITS.coordinate) { shape.points.push(null); gaps++; }
        else shape.points.push([x, y]);
      }
      if (!shape.points.some(Boolean)) throw new Error('函数在定义域内没有可显示的有限采样值');
      if (gaps) diagnostics.push({ code: 'CURVE_DOMAIN_GAP', index, message: `${gaps} 个采样点无有限值，曲线已断开` });
      shape.detail = `y = ${raw.expression} · [${domain.map(format).join(', ')}]`;
      return shape;
    }
    if (type === 'circle') {
      shape.center = [number(raw.centerX, 0), number(raw.centerY, 0)];
      shape.radius = number(raw.radius, 1.5);
      if (shape.radius < 0) throw new Error('圆半径不能为负数');
      shape.points = [[shape.center[0] - shape.radius, shape.center[1] - shape.radius], [shape.center[0] + shape.radius, shape.center[1] + shape.radius]];
      shape.detail = `圆心 (${shape.center.map(format).join(', ')}) · r = ${format(shape.radius)}`;
      return shape;
    }
    if (raw.vertices !== undefined) {
      if (!Array.isArray(raw.vertices) || raw.vertices.length < 1 || raw.vertices.length > LIMITS.vertices) throw new Error('顶点数量须介于 1 和 512');
      shape.points = raw.vertices.map(point);
    } else if (type === 'vector' || type === 'arrow') {
      shape.points = [point(raw.from || [0, 0]), point(raw.to || [raw.x, raw.y])];
    } else if (type === 'diamond' || type === 'rectangle') {
      const cx = number(raw.centerX, 0), cy = number(raw.centerY, 0);
      const w = number(raw.width, 3), h = number(raw.height, type === 'rectangle' ? 2 : 3);
      if (w < 0 || h < 0) throw new Error('图形宽度与高度不能为负数');
      shape.points = type === 'rectangle' ? [[cx - w / 2, cy + h / 2], [cx + w / 2, cy + h / 2], [cx + w / 2, cy - h / 2], [cx - w / 2, cy - h / 2]] : [[cx, cy + h / 2], [cx + w / 2, cy], [cx, cy - h / 2], [cx - w / 2, cy]];
    } else throw new Error('多边形需要顶点坐标');
    shape.detail = `${NAMES[type]} · ${shape.points.length} 个顶点`;
    return shape;
  }

  function niceStep(span) {
    const base = 10 ** Math.floor(Math.log10(span / 7));
    const ratio = span / 7 / base;
    return (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * base;
  }

  class GeometryArtifactRenderer {
    static compileExpression(source) {
      const evaluate = parseExpression(source);
      return x => {
        if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError('函数自变量必须是有限数值');
        return evaluate(x);
      };
    }

    static render(shapes, options = {}) {
      const diagnostics = [];
      const source = Array.isArray(shapes) ? shapes : [];
      if (!Array.isArray(shapes)) diagnostics.push({ code: 'INVALID_SHAPES', message: '图元列表必须是数组' });
      if (source.length > LIMITS.shapes) diagnostics.push({ code: 'SHAPE_LIMIT_EXCEEDED', message: '最多显示 128 个图元' });
      const normalized = [];
      source.slice(0, LIMITS.shapes).forEach((raw, index) => {
        try { normalized.push(normalize(raw, index, diagnostics)); }
        catch (error) { diagnostics.push({ code: raw && raw.type === 'function_curve' ? 'INVALID_CURVE' : 'INVALID_SHAPE', index, message: error.message }); }
      });
      const width = Number.isFinite(options.width) ? Math.max(240, Math.min(4096, options.width)) : 800;
      const height = Number.isFinite(options.height) ? Math.max(220, Math.min(4096, options.height)) : 520;
      const margin = { left: 44, top: 30, right: 30, bottom: 36 };
      const points = normalized.flatMap(shape => shape.points.filter(Boolean));
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      points.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
      if (!points.length) { minX = -1; maxX = 1; minY = -1; maxY = 1; }
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
      const plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
      const scale = Math.min(plotWidth / (spanX * 1.22), plotHeight / (spanY * 1.22));
      const center = [margin.left + plotWidth / 2, margin.top + plotHeight / 2];
      const screen = ([x, y]) => [pixel(center[0] + (x - cx) * scale), pixel(center[1] - (y - cy) * scale)];
      const left = cx - plotWidth / 2 / scale, right = cx + plotWidth / 2 / scale;
      const bottom = cy - plotHeight / 2 / scale, top = cy + plotHeight / 2 / scale;
      const axisX = Math.max(margin.left, Math.min(width - margin.right, screen([0, 0])[0]));
      const axisY = Math.max(margin.top, Math.min(height - margin.bottom, screen([0, 0])[1]));
      const grid = [];
      const step = niceStep(Math.max(right - left, top - bottom));
      const line = (x1, y1, x2, y2, stroke, lineWidth = 1) => `<line x1="${pixel(x1)}" y1="${pixel(y1)}" x2="${pixel(x2)}" y2="${pixel(y2)}" stroke="${stroke}" stroke-width="${lineWidth}" vector-effect="non-scaling-stroke"/>`;
      for (let x = Math.ceil(left / step) * step, i = 0; x <= right && i < 24; x += step, i++) {
        const px = screen([x, 0])[0];
        grid.push(line(px, margin.top, px, height - margin.bottom, '#edf0f3'));
        grid.push(`<text x="${px}" y="${height - 14}" text-anchor="middle" font-size="11" fill="#77818e">${format(Math.abs(x) < step * 1e-8 ? 0 : x)}</text>`);
      }
      for (let y = Math.ceil(bottom / step) * step, i = 0; y <= top && i < 24; y += step, i++) {
        const py = screen([0, y])[1];
        grid.push(line(margin.left, py, width - margin.right, py, '#edf0f3'));
        grid.push(`<text x="${margin.left - 9}" y="${py + 4}" text-anchor="end" font-size="11" fill="#77818e">${format(Math.abs(y) < step * 1e-8 ? 0 : y)}</text>`);
      }
      if (left <= 0 && right >= 0) grid.push(line(axisX, margin.top, axisX, height - margin.bottom, '#bac3ce'));
      if (bottom <= 0 && top >= 0) grid.push(line(margin.left, axisY, width - margin.right, axisY, '#bac3ce'));
      const selection = Number.isInteger(options.selectedIndex) && normalized.some(shape => shape.index === options.selectedIndex) ? options.selectedIndex : null;
      const occupied = [];
      const badges = [];
      const rendered = normalized.map(shape => {
        const selected = shape.index === selection;
        const opacity = selection !== null && !selected ? 0.35 : 1;
        const stroke = `stroke="${shape.stroke}" stroke-width="${selected ? 3 : 2}" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"`;
        let geometry, anchor;
        if (shape.type === 'circle') {
          const [x, y] = screen(shape.center);
          geometry = `<circle cx="${x}" cy="${y}" r="${pixel(Math.max(shape.radius * scale, shape.radius === 0 ? 3 : 0))}" fill="${shape.fill}" fill-opacity="${shape.fillOpacity}" ${stroke}/>`;
          anchor = [x + shape.radius * scale * 0.707, y - shape.radius * scale * 0.707];
        } else {
          const finite = shape.points.filter(Boolean);
          let begun = false;
          const commands = shape.points.map(pt => {
            if (!pt) { begun = false; return ''; }
            const [x, y] = screen(pt), command = begun ? 'L' : 'M'; begun = true;
            return `${command}${x} ${y}`;
          }).join(' ');
          const closed = shape.type !== 'function_curve' && shape.type !== 'vector' && shape.type !== 'arrow' && finite.length > 2;
          geometry = `<path d="${commands}${closed ? ' Z' : ''}" fill="${closed ? shape.fill : 'none'}" fill-opacity="${shape.fillOpacity}" ${stroke}/>`;
          if (finite.length === 1 || finite.every(p => p[0] === finite[0][0] && p[1] === finite[0][1])) {
            const [x, y] = screen(finite[0]); geometry += `<circle cx="${x}" cy="${y}" r="3" fill="${shape.stroke}"/>`;
          }
          if ((shape.type === 'vector' || shape.type === 'arrow') && finite.length >= 2) {
            const end = screen(finite[finite.length - 1]), start = screen(finite[finite.length - 2]);
            const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
            geometry += `<path d="M${pixel(end[0] - 9 * Math.cos(angle - 0.45))} ${pixel(end[1] - 9 * Math.sin(angle - 0.45))} L${end[0]} ${end[1]} L${pixel(end[0] - 9 * Math.cos(angle + 0.45))} ${pixel(end[1] - 9 * Math.sin(angle + 0.45))}" fill="none" ${stroke}/>`;
          }
          anchor = screen(finite.reduce((best, p) => p[1] > best[1] || (p[1] === best[1] && p[0] > best[0]) ? p : best, finite[0]));
        }
        const offsets = [[16, -16], [16, 16], [-16, -16], [-16, 16], [34, 0], [-34, 0], [0, -36], [0, 36]];
        const badge = offsets.map(([x, y]) => [anchor[0] + x, anchor[1] + y]).find(([x, y]) => x > 14 && x < width - 14 && y > 14 && y < height - 14 && occupied.every(p => Math.hypot(x - p[0], y - p[1]) >= 27));
        if (badge) {
          occupied.push(badge);
          const [x, y] = badge.map(pixel);
          badges.push(`<g data-shape-index="${shape.index}" class="geometry-number" opacity="${opacity}">${line(anchor[0], anchor[1], x, y, shape.stroke)}<circle cx="${x}" cy="${y}" r="11" fill="white" stroke="${shape.stroke}" vector-effect="non-scaling-stroke"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="${shape.stroke}">${shape.index + 1}</text></g>`);
        } else diagnostics.push({ code: 'ANNOTATION_DENSITY', index: shape.index, message: '编号空间不足，请通过图例选择图元' });
        const coordinateTitle = shape.type === 'circle' ? shape.detail : shape.points.length <= 12 ? shape.points.filter(Boolean).map(p => `(${p.map(format).join(', ')})`).join(' · ') : shape.detail;
        return { selected, html: `<g class="geometry-shape${selected ? ' is-selected' : ''}" data-shape-index="${shape.index}" tabindex="0" role="button" aria-label="${escape(shape.label)}" opacity="${opacity}"><title>${escape(`${shape.index + 1}. ${shape.label}\n${coordinateTitle}`)}</title>${geometry}</g>` };
      });
      const title = typeof options.title === 'string' ? options.title.slice(0, LIMITS.label) : '几何预览';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="geometry-artifact-svg" viewBox="0 0 ${width} ${height}" width="100%" style="display:block;background:#fff;aspect-ratio:${width}/${height};font-family:Inter,system-ui,sans-serif" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title><rect width="${width}" height="${height}" fill="white"/><g class="geometry-grid" aria-hidden="true">${grid.join('')}</g>${rendered.sort((a, b) => Number(a.selected) - Number(b.selected)).map(item => item.html).join('')}<g class="geometry-annotations" aria-hidden="true">${badges.join('')}</g></svg>`;
      const legend = normalized.map(shape => `<button type="button" class="geometry-legend-item${shape.index === selection ? ' is-selected' : ''}" data-shape-index="${shape.index}" aria-pressed="${shape.index === selection}" style="--shape-color:${shape.stroke}"><span class="geometry-legend-number">${shape.index + 1}</span><span class="geometry-legend-copy"><span class="geometry-legend-label">${escape(shape.label)}</span><span class="geometry-legend-detail">${escape(shape.detail)}</span></span></button>`).join('');
      const notices = diagnostics.length ? `<ul class="geometry-diagnostics" role="status">${diagnostics.map(d => `<li data-diagnostic-code="${d.code}">${d.index === undefined ? '' : `图元 ${d.index + 1}：`}${escape(d.message)}</li>`).join('')}</ul>` : '';
      const html = `<section class="geometry-artifact" aria-label="${escape(title)}"><div class="geometry-plot">${svg}</div><div class="geometry-legend" aria-label="图元列表">${legend || '<p class="geometry-empty">没有可显示的图元</p>'}</div>${notices}</section>`;
      return { html, svg, diagnostics };
    }
  }

  return { GeometryArtifactRenderer };
});
