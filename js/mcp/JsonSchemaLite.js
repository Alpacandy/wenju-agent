/**
 * JsonSchemaLite —— 解释型 JSON Schema 校验器（零代码生成，CSP 无 eval 环境可用）
 *
 * 动机（P7-H7 收紧）：浏览器侧原使用 libs/ajv/validator.bundle.js（Ajv 运行时编译 schema 为
 * 函数源码 → `new Function`），为满足它必须在主文档 CSP 开 `'unsafe-eval'`。本模块以**解释执行**
 * 覆盖工具 schema 实际使用的关键字子集，使运行时无需 eval；Ajv 保留为 Node 侧对照 oracle
 * （差分测试 tests/unit/test_schema_validator_differential.js 以真实工具 schema 语料对拍两者语义）。
 *
 * 支持关键字：$ref(局部) / type(含类型数组) / enum / const / properties / patternProperties /
 *   additionalProperties(false|schema) / required / items / additionalItems / minItems / maxItems /
 *   uniqueItems / contains / minLength / maxLength / pattern / format(常用子集) / minimum / maximum /
 *   exclusiveMinimum / exclusiveMaximum / multipleOf / allOf / anyOf / oneOf / not / boolean schema
 * 错误形状与 SchemaValidator.js 一致：{ path, keyword, message, params }（path 前缀由调用方给出）。
 * 未识别关键字按规范忽略（与 Ajv 的 strict 模式不同；本工程 schema 已由差分测试锁定一致性）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.TeachAgentSchema = { validateJsonSchema: api.validateJsonSchema, compile: api.compile, SUPPORTED_KEYWORDS: api.SUPPORTED_KEYWORDS }; root.JsonSchemaLite = api; }
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const SUPPORTED_KEYWORDS = ['$ref', 'type', 'enum', 'const', 'properties', 'patternProperties', 'additionalProperties', 'required', 'items', 'additionalItems', 'minItems', 'maxItems', 'uniqueItems', 'contains', 'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'allOf', 'anyOf', 'oneOf', 'not'];
  const MAX_DEPTH = 64;
  const patternCache = new Map();

  function _err(instancePath, keyword, message, params) {
    return { path: instancePath, keyword, message, params: params || {} };
  }

  function _typeOf(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value; // object | string | number | boolean | undefined
  }

  function _matchesType(value, type) {
    const actual = _typeOf(value);
    if (type === 'integer') return actual === 'number' && Number.isFinite(value) && Number.isInteger(value);
    if (type === 'number') return actual === 'number' && Number.isFinite(value);
    if (type === 'object') return actual === 'object';
    return actual === type;
  }

  /** 局部 $ref 解析（JSON Pointer：# / #/definitions/x / #/$defs/x） */
  function _resolveRef(ref, rootSchema) {
    if (typeof ref !== 'string' || ref.charAt(0) !== '#') return undefined;
    if (ref === '#') return rootSchema;
    const parts = ref.slice(1).split('/').filter(Boolean).map((p) => decodeURIComponent(p.replace(/~1/g, '/').replace(/~0/g, '~')));
    let node = rootSchema;
    for (const part of parts) {
      if (node == null || typeof node !== 'object') return undefined;
      node = node[part];
    }
    return node;
  }

  function _deepEqual(a, b) {
    if (a === b) return true;
    if (_typeOf(a) !== _typeOf(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => _deepEqual(v, b[i]));
    if (a && typeof a === 'object') {
      const ka = Object.keys(a); const kb = Object.keys(b);
      return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && _deepEqual(a[k], b[k]));
    }
    return false;
  }

  const FORMATS = {
    'date-time': (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && /T\d{2}:\d{2}/.test(v),
    date: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
    time: (v) => typeof v === 'string' && /^\d{2}:\d{2}(:\d{2})?/.test(v),
    email: (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    uri: (v) => typeof v === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(v),
    uuid: (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  };

  function _validate(value, schema, rootSchema, instancePath, out, depth) {
    if (out.length >= 25) return; // 上限与 SchemaValidator 的 maxErrors 一致
    if (depth > MAX_DEPTH) { out.push(_err(instancePath, 'depth', 'schema recursion depth exceeded')); return; }
    if (schema === true) return;
    if (schema === false) { out.push(_err(instancePath, 'false schema', 'boolean schema false rejects any value')); return; }
    if (!schema || typeof schema !== 'object') return;

    if (typeof schema.$ref === 'string') {
      const target = _resolveRef(schema.$ref, rootSchema);
      if (target === undefined) { out.push(_err(instancePath, '$ref', 'unresolvable $ref: ' + schema.$ref)); return; }
      _validate(value, target, rootSchema, instancePath, out, depth + 1);
      if (out.length) return;
    }

    // type
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t) => _matchesType(value, t))) {
        out.push(_err(instancePath, 'type', 'must be ' + types.join(' or '), { type: schema.type }));
        return; // 类型不符时后续关键字不再比较（与 Ajv 的短路一致）
      }
    }

    // const / enum
    if (schema.const !== undefined && !_deepEqual(value, schema.const)) out.push(_err(instancePath, 'const', 'must be equal to constant', { allowedValue: schema.const }));
    if (Array.isArray(schema.enum) && !schema.enum.some((c) => _deepEqual(value, c))) out.push(_err(instancePath, 'enum', 'must be equal to one of the allowed values', { allowedValues: schema.enum }));

    // 数值
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (typeof schema.minimum === 'number' && value < schema.minimum) out.push(_err(instancePath, 'minimum', 'must be >= ' + schema.minimum, { comparison: '>=', limit: schema.minimum }));
      if (typeof schema.maximum === 'number' && value > schema.maximum) out.push(_err(instancePath, 'maximum', 'must be <= ' + schema.maximum, { comparison: '<=', limit: schema.maximum }));
      if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) out.push(_err(instancePath, 'exclusiveMinimum', 'must be > ' + schema.exclusiveMinimum, { comparison: '>', limit: schema.exclusiveMinimum }));
      if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) out.push(_err(instancePath, 'exclusiveMaximum', 'must be < ' + schema.exclusiveMaximum, { comparison: '<', limit: schema.exclusiveMaximum }));
      if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
        const q = value / schema.multipleOf;
        if (Math.abs(q - Math.round(q)) > 1e-9) out.push(_err(instancePath, 'multipleOf', 'must be multiple of ' + schema.multipleOf, { multipleOf: schema.multipleOf }));
      }
    }

    // 字符串
    if (typeof value === 'string') {
      if (typeof schema.minLength === 'number' && value.length < schema.minLength) out.push(_err(instancePath, 'minLength', 'must NOT have fewer than ' + schema.minLength + ' characters', { limit: schema.minLength }));
      if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) out.push(_err(instancePath, 'maxLength', 'must NOT have more than ' + schema.maxLength + ' characters', { limit: schema.maxLength }));
      if (typeof schema.pattern === 'string') {
        let re = patternCache.get(schema.pattern);
        if (!re) { try { re = new RegExp(schema.pattern, 'u'); } catch (e) { re = new RegExp(schema.pattern); } patternCache.set(schema.pattern, re); }
        if (!re.test(value)) out.push(_err(instancePath, 'pattern', 'must match pattern "' + schema.pattern + '"', { pattern: schema.pattern }));
      }
      if (typeof schema.format === 'string' && FORMATS[schema.format] && !FORMATS[schema.format](value)) {
        out.push(_err(instancePath, 'format', 'must match format "' + schema.format + '"', { format: schema.format }));
      }
    }

    // 数组
    if (Array.isArray(value)) {
      if (typeof schema.minItems === 'number' && value.length < schema.minItems) out.push(_err(instancePath, 'minItems', 'must NOT have fewer than ' + schema.minItems + ' items', { limit: schema.minItems }));
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) out.push(_err(instancePath, 'maxItems', 'must NOT have more than ' + schema.maxItems + ' items', { limit: schema.maxItems }));
      if (schema.uniqueItems === true) {
        for (let i = 0; i < value.length; i += 1) for (let j = i + 1; j < value.length; j += 1) {
          if (_deepEqual(value[i], value[j])) { out.push(_err(instancePath, 'uniqueItems', 'must NOT have duplicate items (indexes ' + i + ' and ' + j + ' are equal)', { i, j })); i = value.length; break; }
        }
      }
      if (schema.items !== undefined && !Array.isArray(schema.items)) {
        value.forEach((item, idx) => _validate(item, schema.items, rootSchema, instancePath + '/' + idx, out, depth + 1));
      } else if (Array.isArray(schema.items)) {
        value.forEach((item, idx) => {
          if (idx < schema.items.length) _validate(item, schema.items[idx], rootSchema, instancePath + '/' + idx, out, depth + 1);
          else if (schema.additionalItems === false) out.push(_err(instancePath, 'additionalItems', 'must NOT have more than ' + schema.items.length + ' items', { limit: schema.items.length }));
          else if (schema.additionalItems && typeof schema.additionalItems === 'object') _validate(item, schema.additionalItems, rootSchema, instancePath + '/' + idx, out, depth + 1);
        });
      }
      if (schema.contains && typeof schema.contains === 'object') {
        const anyMatch = value.some((item) => { const sub = []; _validate(item, schema.contains, rootSchema, instancePath, sub, depth + 1); return sub.length === 0; });
        if (!anyMatch) out.push(_err(instancePath, 'contains', 'must contain at least 1 valid item(s)', {}));
      }
    }

    // 对象
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Array.isArray(schema.required)) {
        for (const name of schema.required) if (!Object.prototype.hasOwnProperty.call(value, name)) out.push(_err(instancePath, 'required', "must have required property '" + name + "'", { missingProperty: name }));
      }
      const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
      for (const [key, sub] of Object.entries(props)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) _validate(value[key], sub, rootSchema, instancePath + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'), out, depth + 1);
      }
      const patternProps = schema.patternProperties && typeof schema.patternProperties === 'object' ? schema.patternProperties : null;
      if (patternProps) {
        for (const [key, sub] of Object.entries(value)) {
          for (const [pat, subSchema] of Object.entries(patternProps)) {
            const re = patternCache.get(pat) || new RegExp(pat);
            patternCache.set(pat, re);
            if (re.test(key)) {
              _validate(sub, subSchema, rootSchema, instancePath + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'), out, depth + 1);
              break;
            }
          }
        }
      }
      if (schema.additionalProperties !== undefined) {
        for (const key of Object.keys(value)) {
          if (Object.prototype.hasOwnProperty.call(props, key)) continue;
          if (patternProps && Object.keys(patternProps).some((pat) => (patternCache.get(pat) || new RegExp(pat)).test(key))) continue;
          if (schema.additionalProperties === false) out.push(_err(instancePath, 'additionalProperties', 'must NOT have additional properties', { additionalProperty: key }));
          else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') _validate(value[key], schema.additionalProperties, rootSchema, instancePath + '/' + key, out, depth + 1);
        }
      }
    }

    // 组合关键字
    if (Array.isArray(schema.allOf)) for (const sub of schema.allOf) _validate(value, sub, rootSchema, instancePath, out, depth + 1);
    if (Array.isArray(schema.anyOf)) {
      const anyPass = schema.anyOf.some((sub) => { const t = []; _validate(value, sub, rootSchema, instancePath, t, depth + 1); return t.length === 0; });
      if (!anyPass) out.push(_err(instancePath, 'anyOf', 'must match a schema in anyOf', {}));
    }
    if (Array.isArray(schema.oneOf)) {
      const passCount = schema.oneOf.filter((sub) => { const t = []; _validate(value, sub, rootSchema, instancePath, t, depth + 1); return t.length === 0; }).length;
      if (passCount !== 1) out.push(_err(instancePath, 'oneOf', 'must match exactly one schema in oneOf', { passingSchemas: passCount }));
    }
    if (schema.not && typeof schema.not === 'object') {
      const t = []; _validate(value, schema.not, rootSchema, instancePath, t, depth + 1);
      if (t.length === 0) out.push(_err(instancePath, 'not', 'must NOT be valid', {}));
    }
  }

  /**
   * 校验入口（与 SchemaValidator.validateJsonSchema 同签名/同错误形状）
   * @returns {Array<{path:string, keyword:string, message:string, params:object}>}
   */
  function validateJsonSchema(value, schema, path = '$', options = {}) {
    const out = [];
    if (typeof schema !== 'boolean' && (!schema || typeof schema !== 'object')) {
      return [{ path, keyword: 'schema', message: 'schema must be an object or boolean' }];
    }
    _validate(value, schema, schema, '', out, 0);
    const max = options.maxErrors || 25;
    return out.slice(0, max).map((e) => ({ path: path + e.path, keyword: e.keyword, message: e.message, params: e.params }));
  }

  /** Ajv 兼容最小面：compile(schema) → validate(value)，errors 属性暴露最近错误 */
  function compile(schema, { strict = false } = {}) {
    const seen = new Set();
    const allowed = new Set([...SUPPORTED_KEYWORDS,'$schema','$id','$comment','$defs','definitions','title','description','default','examples','readOnly','writeOnly','deprecated']);
    function check(node, depth = 0) {
      if (typeof node === 'boolean') return;
      if (!node || typeof node !== 'object' || Array.isArray(node) || depth > MAX_DEPTH) throw new TypeError('Invalid JSON Schema declaration');
      if (seen.has(node)) return; seen.add(node);
      if (strict) {
        for (const key of Object.keys(node)) if (!allowed.has(key) && !key.startsWith('x-')) throw new TypeError('Unsupported JSON Schema keyword: '+key);
        if (node.format !== undefined && !Object.hasOwn(FORMATS,node.format)) throw new TypeError('Unsupported JSON Schema format: '+node.format);
        if (node.$ref !== undefined && (typeof node.$ref!=='string' || _resolveRef(node.$ref,schema)===undefined)) throw new TypeError('Unresolvable local JSON Schema reference');
        for(const key of ['minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf'])if(node[key]!==undefined && (!Number.isFinite(node[key]) || (key==='multipleOf' && node[key]<=0)))throw new TypeError('Invalid JSON Schema '+key);
        for(const key of ['minItems','maxItems','minLength','maxLength'])if(node[key]!==undefined && (!Number.isInteger(node[key]) || node[key]<0))throw new TypeError('Invalid JSON Schema '+key);
        if(node.enum!==undefined && (!Array.isArray(node.enum) || !node.enum.length))throw new TypeError('Invalid JSON Schema enum');
        if(node.pattern!==undefined && typeof node.pattern!=='string')throw new TypeError('Invalid JSON Schema pattern');
      }
      if (node.type !== undefined) {
        const types = Array.isArray(node.type) ? node.type : [node.type];
        if (!types.length || types.some(type=>!['null','boolean','object','array','number','integer','string'].includes(type))) throw new TypeError('Invalid JSON Schema type');
      }
      if (node.required !== undefined && (!Array.isArray(node.required) || node.required.some(key=>typeof key!=='string'))) throw new TypeError('Invalid JSON Schema required');
      if (node.pattern !== undefined) new RegExp(node.pattern, 'u');
      for (const key of ['properties','patternProperties','definitions','$defs']) if (node[key] !== undefined) {
        if (!node[key] || typeof node[key] !== 'object' || Array.isArray(node[key])) throw new TypeError('Invalid JSON Schema '+key);
        for (const child of Object.values(node[key])) check(child, depth+1);
      }
      for (const key of ['allOf','anyOf','oneOf']) if (node[key] !== undefined) {
        if (!Array.isArray(node[key]) || !node[key].length) throw new TypeError('Invalid JSON Schema '+key);
        node[key].forEach(child=>check(child,depth+1));
      }
      if (node.items !== undefined) { if (Array.isArray(node.items)) node.items.forEach(child=>check(child,depth+1)); else check(node.items,depth+1); }
      for (const key of ['additionalProperties','additionalItems','contains','not']) if (node[key] !== undefined) check(node[key],depth+1);
    }
    check(schema);
    const validate = (value) => {
      const errs = validateJsonSchema(value, schema);
      validate.errors = errs.length ? errs.map((e) => ({ instancePath: e.path.replace(/^\$/, ''), keyword: e.keyword, message: e.message, params: e.params })) : null;
      return errs.length === 0;
    };
    validate.errors = null;
    return validate;
  }

  return { validateJsonSchema, compile, SUPPORTED_KEYWORDS };
});
