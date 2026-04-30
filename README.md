# n8n-nodes-jsonata-mapper

A community node for n8n that maps, transforms, and validates JSON documents using JSONata expressions and JSON Schema.

This node is designed for integration workflows where data from one JSON structure needs to be transformed into another structure in a controlled, repeatable, and testable way.

## Features

- Map source JSON fields to target JSON paths
- Use JSONata expressions for flexible transformations
- Support nested target paths using dot notation
- Convert, clean, and reshape JSON data
- Validate source JSON using JSON Schema
- Validate mapped output using target JSON Schema
- Support default values for missing fields
- Support required field checks
- Optional preset transforms
- Optional JavaScript field transforms for trusted self-hosted environments
- AI-assisted mapping generation using generic LLM providers
- Debug output for troubleshooting mappings

## Supported LLM Providers

The AI mapping feature supports multiple LLM providers:

- OpenAI-compatible Chat Completions APIs
- OpenRouter
- Anthropic Claude Messages API
- Google Gemini Generate Content API
- Ollama local models
- Custom HTTP JSON endpoints

The AI feature can generate JSONata mapping configurations from source JSON, target JSON, and optional JSON Schemas.

## Installation

Install this package from n8n Community Nodes:

```text
n8n-nodes-jsonata-mapper
```

In n8n:

```text
Settings → Community Nodes → Install
```

Enter:

```text
n8n-nodes-jsonata-mapper
```

## Node Name

After installation, search for:

```text
JSONata Mapper
```

## Basic Usage

Create a workflow like this:

```text
Manual Trigger
   ↓
JSONata Mapper
```

Select:

```text
Operation: Apply Mapping
Source Document Mode: Paste Source JSON Document
```

Example source JSON:

```json
{
  "customer": {
    "firstName": "John",
    "lastName": "Smith",
    "email": " JOHN.SMITH@EXAMPLE.COM "
  },
  "order": {
    "total": "245.5"
  }
}
```

Example mapping config:

```json
{
  "version": "1.1",
  "engine": "jsonata",
  "mappings": [
    {
      "target": "person.givenName",
      "expression": "customer.firstName",
      "required": true
    },
    {
      "target": "person.familyName",
      "expression": "customer.lastName",
      "required": true
    },
    {
      "target": "contact.email",
      "expression": "$lowercase($trim(customer.email))",
      "required": true
    },
    {
      "target": "purchase.amount",
      "expression": "$number(order.total)",
      "required": false
    }
  ]
}
```

Output:

```json
{
  "person": {
    "givenName": "John",
    "familyName": "Smith"
  },
  "contact": {
    "email": "john.smith@example.com"
  },
  "purchase": {
    "amount": 245.5
  }
}
```

## Mapping Config Format

```json
{
  "version": "1.1",
  "engine": "jsonata",
  "mappings": [
    {
      "id": "map_001",
      "sourceLabel": "Customer First Name",
      "target": "person.givenName",
      "expression": "customer.firstName",
      "required": true,
      "defaultValue": "Unknown"
    }
  ]
}
```

### Mapping Fields

| Field | Required | Description |
|---|---:|---|
| `target` | Yes | Target JSON path using dot notation |
| `expression` | Yes | JSONata expression evaluated against source JSON |
| `required` | No | Fails execution if the expression returns empty |
| `defaultValue` | No | Value used when expression returns empty |
| `transform` | No | Optional preset or JavaScript transform applied after JSONata |
| `sourceLabel` | No | Human-readable source field label |
| `confidence` | No | Useful for AI-generated mappings |
| `reason` | No | Explanation for AI-generated mappings |

## JSONata Examples

### Direct field mapping

```json
{
  "target": "person.givenName",
  "expression": "customer.firstName"
}
```

### Trim and lowercase email

```json
{
  "target": "contact.email",
  "expression": "$lowercase($trim(customer.email))"
}
```

### Convert string to number

```json
{
  "target": "purchase.amount",
  "expression": "$number(order.total)"
}
```

### Array projection

```json
{
  "target": "items",
  "expression": "order.lines.{\"sku\": sku, \"quantity\": qty, \"lineAmount\": $number(price) * $number(qty)}"
}
```

## Preset Transforms

Preset transforms can be used after the JSONata expression is evaluated.

```json
{
  "target": "contact.email",
  "expression": "customer.email",
  "transform": {
    "type": "preset",
    "name": "lowercaseTrim"
  }
}
```

Supported preset transforms:

```text
lowercaseTrim
uppercaseTrim
trim
toNumber
toString
toBoolean
```

## JavaScript Field Transforms

JavaScript field transforms are an optional advanced feature. For most mappings, use JSONata or preset transforms first.

A JavaScript transform runs **after** the JSONata expression has produced a value.

The execution order is:

```text
Source JSON
  ↓
JSONata expression
  ↓
Default value check
  ↓
Required field check
  ↓
Optional preset or JavaScript transform
  ↓
Write to target path
```

### When to use JavaScript transforms

Use JavaScript transforms only when JSONata or preset transforms are not enough, for example:

- Complex business calculations
- Special date formatting
- Conditional formatting rules
- Custom lookup logic
- Data cleanup that is easier to express in JavaScript

### How it works

A JavaScript transform receives two variables:

| Variable | Meaning |
|---|---|
| `value` | The value returned by the JSONata expression |
| `source` | The full source JSON document |

The code must return the final value.

Example:

```json
{
  "target": "purchase.amountWithTax",
  "expression": "order.total",
  "transform": {
    "type": "javascript",
    "code": "return Number(value) * 1.1;"
  }
}
```

If the source JSON is:

```json
{
  "order": {
    "total": "245.5"
  }
}
```

The output is:

```json
{
  "purchase": {
    "amountWithTax": 270.05
  }
}
```

### Using full source JSON inside JavaScript

```json
{
  "target": "customer.displayName",
  "expression": "customer.firstName",
  "transform": {
    "type": "javascript",
    "code": "return value + ' ' + source.customer.lastName;"
  }
}
```

### JavaScript transforms are disabled by default

To use JavaScript transforms, enable this node option:

```text
Enable JavaScript Field Transforms
```

If this option is off and a mapping contains `"type": "javascript"`, the node will fail with an error. This is intentional.

### Security note

JavaScript transforms execute user-provided JavaScript. Keep them disabled unless you are running in a trusted self-hosted environment and you trust the mapping configuration.

Safer alternatives are:

- JSONata expressions
- Preset transforms
- Separate n8n Code node with controlled code

## JSON Schema Validation

You can validate the source JSON, mapped output, or both.

When `Use Source JSON Schema` or `Use Target JSON Schema` is enabled, the node now checks that the corresponding schema is actually provided and meaningful. Empty schemas such as `{}` or non-restrictive object schemas such as `{ "type": "object", "properties": {} }` are rejected with a clear error.

This prevents a common mistake where schema validation appears to be enabled, but the schema does not actually validate anything.

A meaningful schema should include validation rules such as:

- non-empty `properties`
- non-empty `required`
- `additionalProperties: false`
- `enum` or `const`
- `oneOf`, `anyOf`, or `allOf`
- type-specific rules such as `format`, `pattern`, `minLength`, `minimum`, or `maximum`


### Source JSON Schema Example

```json
{
  "type": "object",
  "required": ["customer", "order"],
  "properties": {
    "customer": {
      "type": "object",
      "required": ["firstName", "lastName", "email"],
      "properties": {
        "firstName": { "type": "string" },
        "lastName": { "type": "string" },
        "email": { "type": "string", "format": "email" }
      }
    },
    "order": {
      "type": "object",
      "required": ["total"],
      "properties": {
        "total": { "type": "string" }
      }
    }
  }
}
```

Enable:

```text
Use Source JSON Schema: true
Validate Source With Schema: true
```

### Target JSON Schema Example

```json
{
  "type": "object",
  "required": ["person", "contact", "purchase"],
  "properties": {
    "person": {
      "type": "object",
      "required": ["givenName", "familyName"],
      "properties": {
        "givenName": { "type": "string" },
        "familyName": { "type": "string" }
      }
    },
    "contact": {
      "type": "object",
      "required": ["email"],
      "properties": {
        "email": {
          "type": "string",
          "format": "email"
        }
      }
    },
    "purchase": {
      "type": "object",
      "required": ["amount"],
      "properties": {
        "amount": { "type": "number" }
      }
    }
  }
}
```

Enable:

```text
Use Target JSON Schema: true
Validate Output With Target Schema: true
```

## AI-Assisted Mapping

The node can generate mapping suggestions using an LLM.

Select:

```text
Operation: Generate AI Mapping
```

Provide:

- Source JSON document
- Target sample JSON
- Optional source JSON Schema
- Optional target JSON Schema
- LLM provider credentials

The AI returns a mapping config that can be reviewed and used with the `Apply Mapping` operation.

## LLM Provider Examples

### OpenAI-compatible

```text
Provider: OpenAI-Compatible Chat Completions
Base URL: https://api.openai.com/v1
Model: gpt-4.1-mini
```

### OpenRouter

```text
Provider: OpenAI-Compatible Chat Completions
Base URL: https://openrouter.ai/api/v1
Model: openai/gpt-4o-mini
```

### Anthropic Claude

```text
Provider: Anthropic Claude Messages API
Base URL: https://api.anthropic.com/v1
Model: claude-3-5-sonnet-latest
```

### Google Gemini

```text
Provider: Google Gemini Generate Content API
Base URL: https://generativelanguage.googleapis.com/v1beta
Model: gemini-1.5-flash
```

### Ollama

```text
Provider: Ollama Local Chat API
Base URL: http://host.docker.internal:11434
Model: llama3.1
```

When using Docker, `host.docker.internal` is usually required to reach Ollama running on the host machine.

## Operations

| Operation | Description |
|---|---|
| Apply Mapping | Applies the JSONata mapping and returns transformed JSON |
| Validate Mapping | Validates mapping config, JSONata expressions, schemas, and optionally output |
| Generate AI Mapping | Calls a configured LLM provider to generate mappings |
| Generate AI Prompt Only | Returns the prompt without calling an LLM |

## Debugging

Turn on:

```text
Return Debug Info
```

This returns:

```json
{
  "mapped": {},
  "debug": [],
  "sourceJsonUsedByMapper": {}
}
```

Use this to troubleshoot:

- Which expression ran
- What value was produced
- Whether a transform was applied
- Which source JSON was used

Turn it off for clean production output.

## Current External Libraries

This package uses current stable library versions in `package.json`:

| Library | Purpose |
|---|---|
| `jsonata` | JSON expression and transformation engine |
| `ajv` | JSON Schema validation |
| `ajv-formats` | Email, date, URI and other JSON Schema format validation |
| `lodash.get` | Reading nested source paths for incoming n8n items |
| `lodash.set` | Writing nested target paths |

The package currently targets JSONata 2.x and Ajv 8.x.

## Local Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm run test:all
```

## Release

This package includes an n8n-style release script.

Before release, build and test locally:

```bash
npm install
npm run test:all
```

Log in to npm:

```bash
npm login
npm whoami
```

Run the release command:

```bash
npm run release
```

The release script uses `n8n-node release`. For a direct npm publish flow, you can also run:

```bash
npm publish
```

Package author is set to `@vvrr174`.
## Testing

The package includes tests for:

- Direct nested mappings
- JSONata functions
- Default values
- Required fields
- Preset transforms
- JavaScript transform enable/disable behavior
- Array projections
- Bracket path array targets
- Invalid config handling
- Invalid JSONata expressions
- Source JSON Schema validation
- Target JSON Schema validation
- Empty/non-restrictive schema toggle rejection
- Invalid schema definition rejection
- Email format validation
- AI mapping prompt generation
- Package metadata validation

Run:

```bash
npm run test:all
```

## Docker Testing With n8n

Create a temporary n8n container:

```bash
docker run -d \
  --name n8n-test \
  -p 5680:5678 \
  -v n8n_test_data:/home/node/.n8n \
  n8nio/n8n:latest
```

Copy the package into the container:

```bash
docker cp ./n8n-nodes-jsonata-mapper n8n-test:/home/node/.n8n/nodes/n8n-nodes-jsonata-mapper
```

Install inside the container:

```bash
docker exec -it n8n-test sh
cd /home/node/.n8n/nodes
npm install ./n8n-nodes-jsonata-mapper
exit
```

Restart:

```bash
docker restart n8n-test
```

Open:

```text
http://localhost:5680
```

Search for:

```text
JSONata Mapper
```

## Security Notes

JavaScript transforms execute user-provided JavaScript. Keep them disabled unless you are running in a trusted self-hosted environment.

For most mappings, JSONata expressions and preset transforms are safer and should be preferred.

## License

MIT

## npm Build and Release Notes

This package can be built and published with standard npm commands.

```bash
npm install
npm run build
npm run test:all
npm pack --dry-run
npm publish
```

The `release` script uses npm directly:

```bash
npm run release
```

This package does not require `@n8n/node-cli` for normal npm publishing.
