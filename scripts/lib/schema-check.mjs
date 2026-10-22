// Minimal, dependency-free JSON Schema (draft 2020-12) checker.
// Supports only the keywords our two schemas use:
//   type, const, enum, required, properties, additionalProperties:false,
//   items, minItems, minLength, pattern, minimum, exclusiveMinimum, $ref (#/$defs/...)
// If a schema starts using another keyword, this throws so nobody gets a silent pass.

const SUPPORTED = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'description',
  'type', 'const', 'enum', 'required', 'properties', 'additionalProperties',
  'items', 'minItems', 'minLength', 'pattern', 'minimum', 'exclusiveMinimum',
]);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function typeMatches(want, v) {
  const got = typeOf(v);
  if (want === 'number') return got === 'number' || got === 'integer';
  return want === got;
}

export function checkSchema(schema, data) {
  const errors = [];
  const root = schema;

  function resolve(ref) {
    if (!ref.startsWith('#/')) throw new Error(`Unsupported $ref: ${ref}`);
    return ref.slice(2).split('/').reduce((o, k) => o[k], root);
  }

  function walk(s, v, path) {
    for (const k of Object.keys(s)) {
      if (!SUPPORTED.has(k)) throw new Error(`schema-check: unsupported keyword "${k}" at ${path}`);
    }
    if (s.$ref) return walk(resolve(s.$ref), v, path);
    if (s.type && !typeMatches(s.type, v)) {
      errors.push(`${path}: expected ${s.type}, got ${typeOf(v)}`);
      return;
    }
    if ('const' in s && v !== s.const) errors.push(`${path}: must be ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.includes(v)) errors.push(`${path}: must be one of ${s.enum.join(', ')} (got ${JSON.stringify(v)})`);
    if (typeof v === 'string') {
      if (s.minLength != null && v.length < s.minLength) errors.push(`${path}: must not be empty`);
      if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) errors.push(`${path}: "${v}" does not match ${s.pattern}`);
    }
    if (typeof v === 'number') {
      if (s.minimum != null && v < s.minimum) errors.push(`${path}: must be >= ${s.minimum}`);
      if (s.exclusiveMinimum != null && !(v > s.exclusiveMinimum)) errors.push(`${path}: must be > ${s.exclusiveMinimum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems != null && v.length < s.minItems) errors.push(`${path}: needs at least ${s.minItems} item(s)`);
      if (s.items) v.forEach((item, i) => walk(s.items, item, `${path}[${i}]`));
    }
    if (typeOf(v) === 'object') {
      for (const r of s.required || []) if (!(r in v)) errors.push(`${path}: missing "${r}"`);
      const props = s.properties || {};
      for (const [k, val] of Object.entries(v)) {
        if (props[k]) walk(props[k], val, `${path}.${k}`);
        else if (s.additionalProperties === false) errors.push(`${path}: unexpected field "${k}"`);
      }
    }
  }

  walk(schema, data, '$');
  return errors;
}
