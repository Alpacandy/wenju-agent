/** Full JSON Schema draft-07, 2019-09 and 2020-12 validation. */
const Ajv = require('ajv');
const Ajv2019 = require('ajv/dist/2019');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const options = { allErrors: true, strictSchema: true, strictTypes: false, strictTuples: false, allowUnionTypes: true, ownProperties: true, validateFormats: true, addUsedSchema: false };
const validators = [Ajv, Ajv2019, Ajv2020].map((Class) => addFormats(new Class(options)));
const cache = new WeakMap();
function compile(schema) {
  if (typeof schema !== 'boolean' && (!schema || typeof schema !== 'object')) throw new TypeError('schema must be an object or boolean');
  if (typeof schema === 'object' && cache.has(schema)) return cache.get(schema);
  const dialect = schema && schema.$schema || 'http://json-schema.org/draft-07/schema#';
  const index = /2020-12/.test(dialect) ? 2 : /2019-09/.test(dialect) ? 1 : /draft-07/.test(dialect) ? 0 : -1;
  if (index < 0) throw new Error('UNSUPPORTED_SCHEMA_DIALECT: ' + dialect);
  const validate = validators[index].compile(schema);
  if (typeof schema === 'object') cache.set(schema, validate);
  return validate;
}
function validateJsonSchema(value, schema, path = '$', options = {}) {
  try {
    const validate = compile(schema);
    if (validate(value)) return [];
    return (validate.errors || []).slice(0, options.maxErrors || 25).map((error) => ({
      path: path + error.instancePath, keyword: error.keyword, message: error.message, params: error.params
    }));
  } catch (error) {
    return [{ path, keyword: 'schema', message: error.message }];
  }
}
module.exports = { compile, validateJsonSchema };
