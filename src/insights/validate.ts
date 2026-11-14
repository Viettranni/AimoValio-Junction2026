// Tool-input checks against the playbook's JSON Schemas (Python used jsonschema; this covers the keywords the
// insight playbook uses: type, enum, required, properties, additionalProperties, items, anyOf, minItems, min/max).
// A mismatch is 422 bad_input with what is expected and an example, as in the source.
import { GuardFailed } from './errors';

type TypeName = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** The JSON Schema subset the playbook uses; structurally a JSON Schema draft 7 (what the AI SDK takes). */
export interface JsonSchema {
  type?: TypeName | TypeName[];
  enum?: JsonValue[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  minItems?: number;
  minimum?: number;
  maximum?: number;
  description?: string;
  examples?: JsonValue[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function typeOk({ value, type }: { value: unknown; type: string }): boolean {
  switch (type) {
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number';
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}

const show = (v: unknown) => (typeof v === 'string' ? `'${v}'` : JSON.stringify(v));

/** The first error in `value`, with its path, or null. */
function check({ schema, value, path }: { schema: JsonSchema; value: unknown; path: string[] }): { path: string[]; message: string } | null {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeOk({ value, type }))) {
      return { path, message: `${show(value)} is not of type ${types.map((t) => `'${t}'`).join(', ')}` };
    }
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) return { path, message: `${show(value)} is not one of ${JSON.stringify(schema.enum)}` };
  if (schema.anyOf && !schema.anyOf.some((s) => check({ schema: s, value, path }) === null)) {
    return { path, message: `${show(value)} is not valid under any of the given schemas` };
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return { path, message: `${value} is less than the minimum of ${schema.minimum}` };
    if (schema.maximum !== undefined && value > schema.maximum) return { path, message: `${value} is greater than the maximum of ${schema.maximum}` };
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return { path, message: `${JSON.stringify(value)} should be non-empty` };
    if (schema.items) {
      for (const [i, item] of value.entries()) {
        const e = check({ schema: schema.items, value: item, path: [...path, String(i)] });
        if (e) return e;
      }
    }
  }
  if (isObject(value)) {
    for (const r of schema.required ?? []) if (!(r in value)) return { path, message: `'${r}' is a required property` };
    const props = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      const extra = Object.keys(value).filter((k) => !(k in props));
      if (extra.length) return { path, message: `Additional properties are not allowed (${extra.map((k) => `'${k}'`).join(', ')} ${extra.length === 1 ? 'was' : 'were'} unexpected)` };
    }
    for (const [k, s] of Object.entries(props)) {
      if (k in value) {
        const e = check({ schema: s, value: value[k], path: [...path, k] });
        if (e) return e;
      }
    }
  }
  return null;
}

/** A short, readable summary of an input schema: field -> 'type, required: description'. */
function expected(schema: JsonSchema): Record<string, string> {
  const req = new Set(schema.required ?? []);
  return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, p]) => {
    const t = p.type ?? (p.enum ? `one of ${p.enum.map((x) => (x === null ? 'None' : String(x))).join('|')}` : 'value');
    const text = `${Array.isArray(t) ? t.join('|') : t}${req.has(k) ? ', required' : ''}: ${p.description ?? ''}`;
    return [k, text.replace(/[: ]+$/, '')];
  }));
}

export function validateInput({ schema, tool, args }: { schema: JsonSchema | undefined; tool: string; args: unknown }): void {
  if (!schema) return;
  const e = check({ schema, value: args, path: [] });
  if (!e) return;
  const where = e.path.join('.');
  const examples = schema.examples ?? [];
  const example = examples.find((x) => isObject(x) && Object.keys(x).length) ?? examples[0] ?? {};
  throw new GuardFailed(`${tool}: ${where ? `${where}: ` : ''}${e.message}`, { guard: 'bad_input', fix: { expected: expected(schema), example } });
}
