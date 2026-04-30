#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nodeModulePath = path.join(process.cwd(), 'dist', 'nodes', 'JsonataMapper', 'JsonataMapper.node.js');

if (!fs.existsSync(nodeModulePath)) {
  console.error('Build output not found. Run: npm run build');
  process.exit(1);
}

const {
  applyMappingConfig,
  parseJsonParameter,
  validateAgainstSchema,
  validateMappingConfig,
  validateSchemaDefinition,
  assertUsableSchema,
  isEmptyOrNonRestrictiveSchema,
} = require(nodeModulePath);

function test(name, fn) {
  tests.push({ name, fn });
}

const tests = [];

const source = {
  customer: {
    firstName: 'John',
    lastName: 'Smith',
    email: ' JOHN.SMITH@EXAMPLE.COM ',
    active: 'yes',
    age: '42',
  },
  order: {
    id: 'ORD-1001',
    total: '245.5',
    lines: [
      { sku: 'A1', qty: '2', price: '10.5' },
      { sku: 'B2', qty: '1', price: '25' },
    ],
  },
};

test('01 direct nested mapping creates nested target object', async () => {
  const { output } = await applyMappingConfig({ mappings: [
    { target: 'person.givenName', expression: 'customer.firstName', required: true },
    { target: 'person.familyName', expression: 'customer.lastName', required: true },
  ]}, source, false, false);

  assert.deepEqual(output, { person: { givenName: 'John', familyName: 'Smith' } });
});

test('02 JSONata functions trim/lowercase/number work', async () => {
  const { output } = await applyMappingConfig({ mappings: [
    { target: 'contact.email', expression: '$lowercase($trim(customer.email))', required: true },
    { target: 'purchase.amount', expression: '$number(order.total)', required: true },
  ]}, source, false, false);

  assert.deepEqual(output, {
    contact: { email: 'john.smith@example.com' },
    purchase: { amount: 245.5 },
  });
});

test('03 defaultValue is used when expression returns missing value', async () => {
  const { output } = await applyMappingConfig({ mappings: [
    { target: 'person.middleName', expression: 'customer.middleName', defaultValue: 'N/A' },
  ]}, source, false, false);

  assert.deepEqual(output, { person: { middleName: 'N/A' } });
});

test('04 required missing field throws useful error', async () => {
  await assert.rejects(
    () => applyMappingConfig({ mappings: [
      { target: 'person.middleName', expression: 'customer.middleName', required: true },
    ]}, source, false, false),
    /Required mapping target "person\.middleName" produced no value/
  );
});

test('05 preset transforms work', async () => {
  const { output } = await applyMappingConfig({ mappings: [
    { target: 'a', expression: 'customer.email', transform: { type: 'preset', name: 'lowercaseTrim' } },
    { target: 'b', expression: 'customer.firstName', transform: { type: 'preset', name: 'uppercaseTrim' } },
    { target: 'c', expression: 'customer.email', transform: { type: 'preset', name: 'trim' } },
    { target: 'd', expression: 'customer.age', transform: { type: 'preset', name: 'toNumber' } },
    { target: 'e', expression: 'order.total', transform: { type: 'preset', name: 'toString' } },
    { target: 'f', expression: 'customer.active', transform: { type: 'preset', name: 'toBoolean' } },
  ]}, source, false, false);

  assert.equal(output.a, 'john.smith@example.com');
  assert.equal(output.b, 'JOHN');
  assert.equal(output.c, 'JOHN.SMITH@EXAMPLE.COM');
  assert.equal(output.d, 42);
  assert.equal(output.e, '245.5');
  assert.equal(output.f, true);
});

test('06 JavaScript transform is blocked by default', async () => {
  await assert.rejects(
    () => applyMappingConfig({ mappings: [
      { target: 'x', expression: 'customer.firstName', transform: { type: 'javascript', code: 'return value + "!";' } },
    ]}, source, false, false),
    /JavaScript transforms are disabled/
  );
});

test('07 JavaScript transform works only when enabled', async () => {
  const { output } = await applyMappingConfig({ mappings: [
    { target: 'x', expression: 'customer.firstName', transform: { type: 'javascript', code: 'return value + " " + source.customer.lastName;' } },
  ]}, source, true, false);

  assert.equal(output.x, 'John Smith');
});

test('08 array projection with JSONata works', async () => {
  const { output } = await applyMappingConfig({ mappings: [
    { target: 'items', expression: 'order.lines.{"sku": sku, "quantity": $number(qty), "lineAmount": $number(qty) * $number(price)}' },
  ]}, source, false, false);

  assert.deepEqual(output, {
    items: [
      { sku: 'A1', quantity: 2, lineAmount: 21 },
      { sku: 'B2', quantity: 1, lineAmount: 25 },
    ],
  });
});

test('09 bracket path writes array target indexes', async () => {
  const { output } = await applyMappingConfig({ mappings: [
    { target: 'items[0].sku', expression: 'order.lines[0].sku' },
    { target: 'items[0].quantity', expression: '$number(order.lines[0].qty)' },
  ]}, source, false, false);

  assert.deepEqual(output, { items: [{ sku: 'A1', quantity: 2 }] });
});

test('10 invalid mapping config fails', async () => {
  await assert.rejects(
    () => applyMappingConfig({ mappings: {} }, source, false, false),
    /mappingConfig\.mappings must be an array/
  );
});

test('11 invalid mapping rule fails', async () => {
  await assert.rejects(
    () => applyMappingConfig({ mappings: [{ target: 'x' }] }, source, false, false),
    /Mapping rule must contain target and expression/
  );
});

test('12 invalid JSONata fails', async () => {
  await assert.rejects(
    () => applyMappingConfig({ mappings: [{ target: 'x', expression: '$number(' }] }, source, false, false),
    /Invalid or failed JSONata expression/
  );
});

test('13 JSON parameter parsing accepts object and string', () => {
  assert.deepEqual(parseJsonParameter({ a: 1 }, 'X'), { a: 1 });
  assert.deepEqual(parseJsonParameter('{"a":1}', 'X'), { a: 1 });
  assert.throws(() => parseJsonParameter('{bad}', 'X'), /X must be valid JSON/);
});

test('14 source schema validation pass/fail draft-07', () => {
  const schema = {
    type: 'object',
    required: ['customer'],
    properties: {
      customer: {
        type: 'object',
        required: ['firstName'],
        properties: { firstName: { type: 'string' } },
      },
    },
  };

  assert.equal(validateAgainstSchema(schema, source).valid, true);
  assert.equal(validateAgainstSchema(schema, { customer: {} }).valid, false);
});

test('15 target schema validation pass/fail draft-07', async () => {
  const targetSchema = {
    type: 'object',
    required: ['person', 'purchase'],
    properties: {
      person: {
        type: 'object',
        required: ['givenName'],
        properties: { givenName: { type: 'string' } },
      },
      purchase: {
        type: 'object',
        required: ['amount'],
        properties: { amount: { type: 'number' } },
      },
    },
  };

  const { output } = await applyMappingConfig({ mappings: [
    { target: 'person.givenName', expression: 'customer.firstName' },
    { target: 'purchase.amount', expression: '$number(order.total)' },
  ]}, source, false, false);

  assert.equal(validateAgainstSchema(targetSchema, output).valid, true);
  assert.equal(validateAgainstSchema(targetSchema, { person: { givenName: 'John' }, purchase: { amount: '245.5' } }).valid, false);
});

test('16 draft 2020-12 schema validation works', () => {
  const schema2020 = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['contact'],
    properties: {
      contact: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
        },
      },
    },
  };

  assert.equal(validateAgainstSchema(schema2020, { contact: { email: 'test@example.com' } }).valid, true);
  assert.equal(validateAgainstSchema(schema2020, { contact: { email: 'not-an-email' } }).valid, false);
});

test('17 mapping-config embedded target schema validates output', async () => {
  const mappingConfig = {
    validation: {
      targetSchema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        required: ['contact'],
        properties: {
          contact: {
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string', format: 'email' } },
          },
        },
      },
    },
    mappings: [
      { target: 'contact.email', expression: '$lowercase($trim(customer.email))' },
    ],
  };
  const { output } = await applyMappingConfig(mappingConfig, source, false, false);
  assert.equal(validateAgainstSchema(mappingConfig.validation.targetSchema, output).valid, true);
});

test('18 validateMappingConfig reports target paths and unmapped paths from schema', () => {
  const targetSchema = {
    type: 'object',
    properties: {
      person: { type: 'object', properties: { givenName: { type: 'string' }, familyName: { type: 'string' } } },
      contact: { type: 'object', properties: { email: { type: 'string' } } },
    },
  };
  const result = validateMappingConfig(
    { mappings: [{ target: 'person.givenName', expression: 'customer.firstName' }] },
    {},
    { targetSchema },
  );
  assert.equal(result.valid, true);
  assert.deepEqual(result.targetPaths, ['person.givenName', 'person.familyName', 'contact.email']);
  assert.deepEqual(result.unmappedTargetPaths, ['person.familyName', 'contact.email']);
});

test('19 debug output returns expression/value details', async () => {
  const { output, debug } = await applyMappingConfig({ mappings: [
    { id: 'm1', target: 'person.givenName', expression: 'customer.firstName' },
  ]}, source, false, true);

  assert.deepEqual(output, { person: { givenName: 'John' } });
  assert.deepEqual(debug, [{ id: 'm1', target: 'person.givenName', expression: 'customer.firstName', value: 'John', transform: 'none' }]);
});

test('20 invalid JSON Schema definition is reported', () => {
  const invalidSchema = { type: 123 };
  const schemaResult = validateSchemaDefinition(invalidSchema);
  assert.equal(schemaResult.valid, false);

  const dataResult = validateAgainstSchema(invalidSchema, source);
  assert.equal(dataResult.valid, false);
  assert.equal(dataResult.schemaValid, false);
  assert.ok(Array.isArray(dataResult.schemaErrors));
});

test('21 source schema catches invalid source data', () => {
  const schema = {
    type: 'object',
    required: ['customer'],
    properties: {
      customer: {
        type: 'object',
        required: ['firstName'],
        properties: { firstName: { type: 'string' } },
      },
    },
  };

  const valid = validateAgainstSchema(schema, source);
  assert.equal(valid.valid, true);

  const invalid = validateAgainstSchema(schema, { customer: {} });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.keyword === 'required'));
});

test('22 target schema catches mapped output type mismatch', async () => {
  const schema = {
    type: 'object',
    required: ['purchase'],
    properties: {
      purchase: {
        type: 'object',
        required: ['amount'],
        properties: { amount: { type: 'number' } },
      },
    },
  };

  const { output } = await applyMappingConfig({ mappings: [
    { target: 'purchase.amount', expression: 'order.total' },
  ]}, source, false, false);

  const invalid = validateAgainstSchema(schema, output);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.keyword === 'type'));
});

test('23 source schema toggle rejects missing or empty schema', () => {
  assert.equal(isEmptyOrNonRestrictiveSchema(undefined), true);
  assert.equal(isEmptyOrNonRestrictiveSchema({}), true);
  assert.throws(
    () => assertUsableSchema({}, 'Source JSON Schema'),
    /Source JSON Schema is enabled, but the schema is empty or non-restrictive/
  );
});

test('24 source schema toggle rejects non-restrictive empty object schema', () => {
  const emptyObjectSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: [],
    properties: {},
  };

  assert.equal(isEmptyOrNonRestrictiveSchema(emptyObjectSchema), true);
  assert.throws(
    () => assertUsableSchema(emptyObjectSchema, 'Source JSON Schema'),
    /empty or non-restrictive/
  );
});

test('25 target schema toggle rejects non-restrictive empty object schema', () => {
  const emptyObjectSchema = {
    type: 'object',
    properties: {},
  };

  assert.throws(
    () => assertUsableSchema(emptyObjectSchema, 'Target JSON Schema'),
    /Target JSON Schema is enabled, but the schema is empty or non-restrictive/
  );
});

test('26 meaningful schema is accepted by schema toggle validation', () => {
  const meaningfulSchema = {
    type: 'object',
    required: ['customer'],
    properties: {
      customer: {
        type: 'object',
        required: ['firstName'],
        properties: {
          firstName: { type: 'string' },
        },
      },
    },
  };

  assert.equal(isEmptyOrNonRestrictiveSchema(meaningfulSchema), false);
  assert.deepEqual(assertUsableSchema(meaningfulSchema, 'Source JSON Schema'), meaningfulSchema);
});

test('27 invalid but non-empty schema is rejected by schema toggle validation', () => {
  const invalidSchema = { type: 123, required: ['x'] };

  assert.throws(
    () => assertUsableSchema(invalidSchema, 'Target JSON Schema'),
    /Target JSON Schema is not a valid JSON Schema/
  );
});


test('28 package metadata has n8n community-node requirements', () => {
  const pkgPath = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  assert.equal(pkg.name, 'n8n-nodes-jsonata-mapper');
  assert.ok(pkg.keywords.includes('n8n-community-node-package'));
  assert.ok(Array.isArray(pkg.n8n.nodes));
  assert.ok(pkg.n8n.nodes.some((nodePath) => nodePath.includes('JsonataMapper.node.js')));
});

test('29 build output exists after npm run build', () => {
  const nodePath = path.join(process.cwd(), 'dist', 'nodes', 'JsonataMapper', 'JsonataMapper.node.js');
  const credentialPath = path.join(process.cwd(), 'dist', 'credentials', 'GenericLlmApi.credentials.js');
  assert.ok(fs.existsSync(nodePath), `Missing build output: ${nodePath}`);
  assert.ok(fs.existsSync(credentialPath), `Missing build output: ${credentialPath}`);
});

(async () => {
  let passed = 0;
  const failures = [];

  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`✅ ${name}`);
    } catch (error) {
      failures.push({ name, error });
      console.error(`❌ ${name}`);
      console.error(error.stack || error.message || error);
    }
  }

  console.log(`\n${passed}/${tests.length} tests passed.`);

  if (failures.length) {
    process.exitCode = 1;
  }
})();
