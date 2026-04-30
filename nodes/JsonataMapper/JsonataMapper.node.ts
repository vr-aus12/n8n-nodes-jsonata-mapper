/* eslint-disable n8n-nodes-base/node-execute-block-wrong-error-thrown, @typescript-eslint/no-explicit-any */
import {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';

import jsonata from 'jsonata';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

type Transform =
	| { type: 'none' }
	| {
			type: 'preset';
			name:
				| 'lowercaseTrim'
				| 'uppercaseTrim'
				| 'trim'
				| 'toNumber'
				| 'toString'
				| 'toBoolean';
	  }
	| { type: 'javascript'; code: string };

export type MappingRule = {
	id?: string;
	sourceLabel?: string;
	target: string;
	expression: string;
	required?: boolean;
	defaultValue?: unknown;
	transform?: Transform;
	confidence?: number;
	reason?: string;
};

export type MappingConfig = {
	version?: string;
	engine?: 'jsonata';
	mappings: MappingRule[];
	validation?: {
		sourceSchema?: Record<string, unknown>;
		targetSchema?: Record<string, unknown>;
		schema?: Record<string, unknown>;
	};
	metadata?: {
		sourceName?: string;
		targetName?: string;
	};
};

type SchemaContext = {
	sourceSchema?: Record<string, unknown>;
	targetSchema?: Record<string, unknown>;
};

type LlmProvider =
	| 'openAiCompatible'
	| 'anthropic'
	| 'googleGemini'
	| 'ollama'
	| 'customHttp';

type GenericLlmCredentials = {
	baseUrl?: string;
	apiKey?: string;
	authHeaderName?: string;
	authHeaderPrefix?: string;
	extraHeaders?: string | Record<string, unknown>;
};

const DEFAULT_SOURCE_JSON_DOCUMENT = JSON.stringify(
	{
		customer: {
			firstName: 'John',
			lastName: 'Smith',
			email: ' JOHN.SMITH@EXAMPLE.COM ',
		},
		order: {
			total: '245.5',
		},
	},
	null,
	2,
);

const DEFAULT_TARGET_SAMPLE_JSON = JSON.stringify(
	{
		person: {
			givenName: '',
			familyName: '',
		},
		contact: {
			email: '',
		},
		purchase: {
			amount: 0,
		},
	},
	null,
	2,
);

const DEFAULT_MAPPING_CONFIG = JSON.stringify(
	{
		version: '1.1',
		engine: 'jsonata',
		mappings: [],
	},
	null,
	2,
);

const DEFAULT_EMPTY_JSON_OBJECT = '{}';

export class JsonataMapper implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'JSONata Mapper',
		name: 'jsonataMapper',
		icon: 'file:jsonataMapper.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Map JSON documents using JSONata, optional field transforms, JSON Schema validation, and AI auto-map suggestions',
		defaults: {
			name: 'JSONata Mapper',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'genericLlmApi',
				required: false,
				displayOptions: {
					show: {
						operation: ['generateAiMapping'],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'applyMapping',
				options: [
					{
						name: 'Apply Mapping',
						value: 'applyMapping',
						description: 'Transform source JSON into target JSON',
						action: 'Apply mapping',
					},
					{
						name: 'Generate AI Mapping',
						value: 'generateAiMapping',
						description:
							'Call a generic LLM provider to suggest JSONata mappings from JSON documents and/or schemas',
						action: 'Generate AI mapping',
					},
					{
						name: 'Generate AI Prompt Only',
						value: 'generateAiPromptOnly',
						description: 'Generate the AI prompt without calling an LLM',
						action: 'Generate AI mapping prompt',
					},
					{
						name: 'Validate Mapping',
						value: 'validateMapping',
						description: 'Validate mappings, schemas, and optionally transformed output',
						action: 'Validate mapping',
					},
				],
			},
			{
				displayName: 'Source Document Mode',
				name: 'sourceDocumentMode',
				type: 'options',
				default: 'inputItem',
				options: [
					{
						name: 'Paste Source JSON Document',
						value: 'pastedJson',
					},
					{
						name: 'Use Incoming Item JSON',
						value: 'inputItem',
					},
				],
				description:
					'Choose whether to map the incoming n8n item JSON or a pasted source JSON document',
			},
			{
				displayName: 'Source Field',
				name: 'sourceField',
				type: 'string',
				default: 'json',
				description:
					'Field path containing the source JSON. Use "JSON" for the whole item JSON.',
				displayOptions: {
					show: {
						sourceDocumentMode: ['inputItem'],
					},
				},
			},
			{
				displayName: 'Source JSON Document',
				name: 'sourceJsonDocument',
				type: 'json',
				default: DEFAULT_SOURCE_JSON_DOCUMENT,
				description:
					'A pasted source JSON document. Useful for design-time mapping and AI auto-map.',
				displayOptions: {
					show: {
						sourceDocumentMode: ['pastedJson'],
					},
				},
			},
			{
				displayName: 'Use Source JSON Schema',
				name: 'useSourceSchema',
				type: 'boolean',
				default: false,
				description:
					'Whether to provide a source JSON Schema for source validation and AI context',
			},
			{
				displayName: 'Source JSON Schema',
				name: 'sourceJsonSchema',
				type: 'json',
				default: DEFAULT_EMPTY_JSON_OBJECT,
				description:
					'JSON Schema describing the source document. If enabled, this must be a meaningful schema with validation rules. Draft-07 and Draft 2020-12 are supported.',
				displayOptions: {
					show: {
						useSourceSchema: [true],
					},
				},
			},
			{
				displayName: 'Use Target JSON Schema',
				name: 'useTargetSchema',
				type: 'boolean',
				default: false,
				description:
					'Whether to provide a target JSON Schema for output validation and AI context',
			},
			{
				displayName: 'Target JSON Schema',
				name: 'targetJsonSchema',
				type: 'json',
				default: DEFAULT_EMPTY_JSON_OBJECT,
				description:
					'JSON Schema describing the required target document. If enabled, this must be a meaningful schema with validation rules. Draft-07 and Draft 2020-12 are supported.',
				displayOptions: {
					show: {
						useTargetSchema: [true],
					},
				},
			},
			{
				displayName: 'Target Sample JSON',
				name: 'targetSampleJson',
				type: 'json',
				default: DEFAULT_TARGET_SAMPLE_JSON,
				description:
					'Sample target JSON. Used when no target schema is supplied, and as additional AI context.',
				displayOptions: {
					show: {
						operation: ['generateAiMapping', 'generateAiPromptOnly', 'validateMapping'],
					},
				},
			},
			{
				displayName: 'Mapping Config',
				name: 'mappingConfig',
				type: 'json',
				default: DEFAULT_MAPPING_CONFIG,
				description:
					'JSONata mapping configuration. Each mapping uses a target path and a JSONata expression.',
				displayOptions: {
					show: {
						operation: ['applyMapping', 'validateMapping'],
					},
				},
			},
			{
				displayName: 'Validate Source With Schema',
				name: 'validateSourceWithSchema',
				type: 'boolean',
				default: true,
				description:
					'Whether to validate source JSON against source schema when a schema is supplied either in the node or mapping config',
				displayOptions: {
					show: {
						operation: ['applyMapping', 'validateMapping'],
					},
				},
			},
			{
				displayName: 'Validate Output With Target Schema',
				name: 'validateOutputWithSchema',
				type: 'boolean',
				default: true,
				description:
					'Whether to validate mapped output against target schema when a schema is supplied either in the node or mapping config',
				displayOptions: {
					show: {
						operation: ['applyMapping', 'validateMapping'],
					},
				},
			},
			{
				displayName: 'Enable JavaScript Field Transforms',
				name: 'enableJavascriptTransforms',
				type: 'boolean',
				default: false,
				description:
					'Whether to allow field-level JavaScript transforms. Only enable in trusted/self-hosted environments.',
				displayOptions: {
					show: {
						operation: ['applyMapping'],
					},
				},
			},
			{
				displayName: 'LLM Provider',
				name: 'llmProvider',
				type: 'options',
				default: 'openAiCompatible',
				options: [
					{ name: 'Anthropic Claude Messages API', value: 'anthropic' },
					{ name: 'Custom HTTP JSON Endpoint', value: 'customHttp' },
					{ name: 'Google Gemini Generate Content API', value: 'googleGemini' },
					{ name: 'Ollama Local Chat API', value: 'ollama' },
					{ name: 'OpenAI-Compatible Chat Completions', value: 'openAiCompatible' },
				],
				description: 'Provider format used for AI auto-map. Credentials define base URL/API key/headers.',
				displayOptions: {
					show: {
						operation: ['generateAiMapping'],
					},
				},
			},
			{
				displayName: 'AI Model',
				name: 'aiModel',
				type: 'string',
				default: 'gpt-4.1-mini',
				description: 'Model name. For Gemini use gemini-2.5-flash or gemini-2.5-flash-lite. For OpenAI-compatible providers use the provider model ID.',
				displayOptions: {
					show: {
						operation: ['generateAiMapping'],
					},
				},
			},
			{
				displayName: 'Custom HTTP Path',
				name: 'customHttpPath',
				type: 'string',
				default: '',
				description: 'Optional path appended to Base URL for Custom HTTP JSON Endpoint. Leave blank to post to Base URL directly.',
				displayOptions: {
					show: {
						operation: ['generateAiMapping'],
						llmProvider: ['customHttp'],
					},
				},
			},
			{
				displayName: 'AI Temperature',
				name: 'aiTemperature',
				type: 'number',
				default: 0,
				typeOptions: {
					minValue: 0,
					maxValue: 2,
					numberPrecision: 2,
				},
				displayOptions: {
					show: {
						operation: ['generateAiMapping'],
					},
				},
			},
			{
				displayName: 'Return Debug Info',
				name: 'returnDebug',
				type: 'boolean',
				default: false,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0) as string;
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const item = items[itemIndex];
				const returnDebug = this.getNodeParameter('returnDebug', itemIndex) as boolean;
				const mappingConfig = ['applyMapping', 'validateMapping'].includes(operation)
					? parseJsonParameter<MappingConfig>(
							this.getNodeParameter('mappingConfig', itemIndex),
							'Mapping Config',
					  )
					: undefined;
				const sourceJson = getSourceJson(this, itemIndex, item);
				const schemaContext = getSchemaContext(this, itemIndex, mappingConfig);

				if (operation === 'generateAiPromptOnly') {
					const targetSampleJson = parseJsonParameter<object>(
						this.getNodeParameter('targetSampleJson', itemIndex),
						'Target Sample JSON',
					);

					returnData.push({
						json: {
							prompt: buildAiMappingPrompt(sourceJson, targetSampleJson, schemaContext),
						},
						pairedItem: { item: itemIndex },
					});

					continue;
				}

				if (operation === 'generateAiMapping') {
					const targetSampleJson = parseJsonParameter<object>(
						this.getNodeParameter('targetSampleJson', itemIndex),
						'Target Sample JSON',
					);

					const llmProvider = this.getNodeParameter('llmProvider', itemIndex) as LlmProvider;
					const aiModel = this.getNodeParameter('aiModel', itemIndex) as string;
					const aiTemperature = this.getNodeParameter('aiTemperature', itemIndex) as number;
					const customHttpPath = this.getNodeParameter('customHttpPath', itemIndex, '') as string;
					const credentials = (await this.getCredentials('genericLlmApi')) as GenericLlmCredentials;

					const prompt = buildAiMappingPrompt(sourceJson, targetSampleJson, schemaContext);
					const systemPrompt =
						'You create JSONata mapping configurations from JSON documents and JSON Schemas. Return valid JSON only. Do not include markdown.';

					const request = buildGenericLlmRequest({
						provider: llmProvider,
						model: aiModel,
						temperature: aiTemperature,
						systemPrompt,
						userPrompt: prompt,
						credentials,
						customHttpPath,
					});

					let llmResponse: unknown;

					try {
						// eslint-disable-next-line @n8n/community-nodes/no-http-request-with-manual-auth
						llmResponse = await this.helpers.httpRequest({
							method: 'POST',
							url: request.url,
							headers: request.headers,
							body: request.body,
							json: true,
						});
					} catch (error) {
						const e = error as { message?: string; response?: { statusCode?: number; status?: number; body?: unknown; data?: unknown } };
						const status = e.response?.statusCode ?? e.response?.status;
						const responseBody = e.response?.body ?? e.response?.data;
						throw new NodeOperationError(
							this.getNode(),
							`LLM request failed for provider ${llmProvider}${status ? ` with status ${status}` : ''}. ` +
								`URL: ${redactApiKeyFromUrl(request.url)}. ` +
								`Message: ${e.message ?? 'Unknown error'}. ` +
								`${responseBody ? `Response: ${JSON.stringify(responseBody)}` : ''}`,
							{ itemIndex },
						);
					}

					const content = extractLlmText(llmProvider, llmResponse);

					if (!content || typeof content !== 'string') {
						throw new NodeOperationError(
							this.getNode(),
							`LLM returned no text content for provider ${llmProvider}`,
							{ itemIndex },
						);
					}

					let generatedMappingConfig: MappingConfig;

					try {
						generatedMappingConfig = parseLlmJsonContent<MappingConfig>(content);
					} catch (error) {
						throw new NodeOperationError(
							this.getNode(),
							`LLM did not return valid JSON mapping config: ${(error as Error).message}`,
							{ itemIndex },
						);
					}

					returnData.push({
						json: {
							mappingConfig: generatedMappingConfig,
							...(returnDebug
								? {
										prompt,
										rawLlmResponse: llmResponse,
								  }
								: {}),
						} as IDataObject,
						pairedItem: { item: itemIndex },
					});

					continue;
				}

				if (operation === 'validateMapping') {
					const targetSampleJson = parseJsonParameter<object>(
						this.getNodeParameter('targetSampleJson', itemIndex),
						'Target Sample JSON',
					);

					const validateSourceWithSchema = this.getNodeParameter(
						'validateSourceWithSchema',
						itemIndex,
					) as boolean;

					const validateOutputWithSchema = this.getNodeParameter(
						'validateOutputWithSchema',
						itemIndex,
					) as boolean;

					const validation = validateMappingConfig(
						mappingConfig as MappingConfig,
						targetSampleJson,
						schemaContext,
					);

					let sourceValidation: IDataObject | undefined;

					if (validateSourceWithSchema && schemaContext.sourceSchema) {
						sourceValidation = validateAgainstSchema(
							schemaContext.sourceSchema,
							sourceJson,
						);
					}

					let outputValidation: IDataObject | undefined;

					if (validateOutputWithSchema && schemaContext.targetSchema) {
						const mapped = await applyMappingConfig(
							mappingConfig as MappingConfig,
							sourceJson,
							false,
							returnDebug,
						);
						outputValidation = validateAgainstSchema(
							schemaContext.targetSchema,
							mapped.output,
						);
					}

					const schemaValidationErrors: string[] = [];

					if (sourceValidation && sourceValidation.valid === false) {
						schemaValidationErrors.push(
							`Source JSON failed schema validation: ${JSON.stringify(
								sourceValidation.errors ?? sourceValidation.schemaErrors ?? [],
							)}`,
						);
					}

					if (outputValidation && outputValidation.valid === false) {
						schemaValidationErrors.push(
							`Mapped output failed target JSON Schema validation: ${JSON.stringify(
								outputValidation.errors ?? outputValidation.schemaErrors ?? [],
							)}`,
						);
					}

					returnData.push({
						json: {
							...validation,
							valid: Boolean(validation.valid) && schemaValidationErrors.length === 0,
							errors: [...((validation.errors as string[]) ?? []), ...schemaValidationErrors],
							...(sourceValidation ? { sourceValidation } : {}),
							...(outputValidation ? { outputValidation } : {}),
						} as IDataObject,
						pairedItem: { item: itemIndex },
					});

					continue;
				}

				if (operation === 'applyMapping') {
					const enableJavascriptTransforms = this.getNodeParameter(
						'enableJavascriptTransforms',
						itemIndex,
					) as boolean;

					const validateSourceWithSchema = this.getNodeParameter(
						'validateSourceWithSchema',
						itemIndex,
					) as boolean;

					const validateOutputWithSchema = this.getNodeParameter(
						'validateOutputWithSchema',
						itemIndex,
					) as boolean;

					if (validateSourceWithSchema && schemaContext.sourceSchema) {
						const sourceValidation = validateAgainstSchema(
							schemaContext.sourceSchema,
							sourceJson,
						);

						if (!sourceValidation.valid) {
							throw new NodeOperationError(
								this.getNode(),
								`Source JSON failed schema validation: ${JSON.stringify(
									sourceValidation.errors,
								)}`,
								{ itemIndex },
							);
						}
					}

					const result = await applyMappingConfig(
						mappingConfig as MappingConfig,
						sourceJson,
						enableJavascriptTransforms,
						returnDebug,
					);

					if (validateOutputWithSchema && schemaContext.targetSchema) {
						const schemaResult = validateAgainstSchema(
							schemaContext.targetSchema,
							result.output,
						);

						if (!schemaResult.valid) {
							throw new NodeOperationError(
								this.getNode(),
								`Mapped output failed target JSON Schema validation: ${JSON.stringify(
									schemaResult.errors,
								)}`,
								{ itemIndex },
							);
						}
					}

					const outputJson = (returnDebug
						? {
								mapped: result.output,
								debug: result.debug,
								sourceJsonUsedByMapper: sourceJson,
								sourceSchemaUsedByValidator: schemaContext.sourceSchema,
								targetSchemaUsedByValidator: schemaContext.targetSchema,
						  }
						: result.output) as IDataObject;

					returnData.push({
						json: outputJson,
						pairedItem: { item: itemIndex },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
						} as IDataObject,
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (error instanceof NodeOperationError) {
					throw error;
				}

				throw new NodeOperationError(this.getNode(), (error as Error).message, {
					itemIndex,
				});
			}
		}

		return [returnData];
	}
}


function pathToSegments(path: string): Array<string | number> {
	const segments: Array<string | number> = [];
	const pattern = /([^.[\]]+)|\[(\d+)\]/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(path)) !== null) {
		if (match[1] !== undefined) {
			segments.push(match[1]);
		} else if (match[2] !== undefined) {
			segments.push(Number(match[2]));
		}
	}

	return segments;
}

function getByPath(source: unknown, path: string): unknown {
	if (!path) return source;

	let current: any = source;

	for (const segment of pathToSegments(path)) {
		if (current === null || current === undefined) {
			return undefined;
		}

		current = current[segment as any];
	}

	return current;
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
	const segments = pathToSegments(path);
	if (segments.length === 0) return;

	let current: any = target;

	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index] as any;
		const isLast = index === segments.length - 1;
		const nextSegment = segments[index + 1];

		if (isLast) {
			current[segment] = value;
			return;
		}

		if (current[segment] === undefined || current[segment] === null || typeof current[segment] !== 'object') {
			current[segment] = typeof nextSegment === 'number' ? [] : {};
		}

		current = current[segment];
	}
}

function getSourceJson(
	ctx: IExecuteFunctions,
	itemIndex: number,
	item: INodeExecutionData,
): unknown {
	const mode = ctx.getNodeParameter('sourceDocumentMode', itemIndex) as string;

	if (mode === 'pastedJson') {
		return parseJsonParameter<unknown>(
			ctx.getNodeParameter('sourceJsonDocument', itemIndex),
			'Source JSON Document',
		);
	}

	const sourceField = ctx.getNodeParameter('sourceField', itemIndex) as string;
	return sourceField === 'json' ? item.json : getByPath(item.json, sourceField);
}

function getSchemaContext(
	ctx: IExecuteFunctions,
	itemIndex: number,
	mappingConfig?: MappingConfig,
): SchemaContext {
	const useSourceSchema = ctx.getNodeParameter('useSourceSchema', itemIndex) as boolean;
	const useTargetSchema = ctx.getNodeParameter('useTargetSchema', itemIndex) as boolean;

	const sourceSchemaFromNode = useSourceSchema
		? assertUsableSchema(
				parseJsonParameter<Record<string, unknown>>(
					ctx.getNodeParameter('sourceJsonSchema', itemIndex),
					'Source JSON Schema',
				),
				'Source JSON Schema',
		  )
		: undefined;

	const targetSchemaFromNode = useTargetSchema
		? assertUsableSchema(
				parseJsonParameter<Record<string, unknown>>(
					ctx.getNodeParameter('targetJsonSchema', itemIndex),
					'Target JSON Schema',
				),
				'Target JSON Schema',
		  )
		: undefined;

	return {
		sourceSchema: sourceSchemaFromNode ?? mappingConfig?.validation?.sourceSchema,
		targetSchema:
			targetSchemaFromNode ??
			mappingConfig?.validation?.targetSchema ??
			mappingConfig?.validation?.schema,
	};
}

export async function applyMappingConfig(
	mappingConfig: MappingConfig,
	sourceJson: unknown,
	enableJavascriptTransforms: boolean,
	returnDebug: boolean,
): Promise<{
	output: Record<string, unknown>;
	debug: Array<Record<string, unknown>>;
}> {
	if (!mappingConfig) {
		throw new Error('Mapping Config is required');
	}

	if (!Array.isArray(mappingConfig.mappings)) {
		throw new Error(
			`mappingConfig.mappings must be an array. Received: ${JSON.stringify(
				mappingConfig,
			)}`,
		);
	}

	const output: Record<string, unknown> = {};
	const debug: Array<Record<string, unknown>> = [];

	for (const rule of mappingConfig.mappings) {
		if (!rule.target || !rule.expression) {
			throw new Error(
				`Mapping rule must contain target and expression: ${JSON.stringify(rule)}`,
			);
		}

		let value: unknown;

		try {
			const expr = jsonata(rule.expression);
			value = normalizeJsonataValue(await expr.evaluate(sourceJson as any));
		} catch (error) {
			throw new Error(
				`Invalid or failed JSONata expression for target "${rule.target}": ${
					(error as Error).message
				}`,
			);
		}

		if (
			(value === undefined || value === null || value === '') &&
			rule.defaultValue !== undefined
		) {
			value = rule.defaultValue;
		}

		if (rule.required && (value === undefined || value === null || value === '')) {
			throw new Error(
				`Required mapping target "${rule.target}" produced no value. ` +
					`Expression: ${rule.expression}. ` +
					`Source JSON received by mapper: ${JSON.stringify(sourceJson)}`,
			);
		}

		value = runTransform(
			rule.transform,
			value,
			sourceJson,
			enableJavascriptTransforms,
		);

		setByPath(output, rule.target, value);

		if (returnDebug) {
			debug.push({
				id: rule.id,
				target: rule.target,
				expression: rule.expression,
				value,
				transform: rule.transform?.type ?? 'none',
			});
		}
	}

	return {
		output,
		debug,
	};
}

function runTransform(
	transform: Transform | undefined,
	value: unknown,
	sourceJson: unknown,
	enableJavascriptTransforms: boolean,
): unknown {
	if (!transform || transform.type === 'none') {
		return value;
	}

	if (transform.type === 'preset') {
		switch (transform.name) {
			case 'lowercaseTrim':
				return typeof value === 'string' ? value.toLowerCase().trim() : value;

			case 'uppercaseTrim':
				return typeof value === 'string' ? value.toUpperCase().trim() : value;

			case 'trim':
				return typeof value === 'string' ? value.trim() : value;

			case 'toNumber':
				return value === null || value === undefined || value === ''
					? null
					: Number(value);

			case 'toString':
				return value === null || value === undefined ? null : String(value);

			case 'toBoolean':
				if (typeof value === 'boolean') {
					return value;
				}

				if (typeof value === 'string') {
					return ['true', '1', 'yes', 'y'].includes(value.toLowerCase());
				}

				return Boolean(value);
		}
	}

	if (transform.type === 'javascript') {
		if (!enableJavascriptTransforms) {
			throw new Error('JavaScript transforms are disabled');
		}

		const fn = new Function('value', 'source', transform.code);
		return fn(value, sourceJson);
	}

	return value;
}

export function validateMappingConfig(
	mappingConfig: MappingConfig,
	targetSampleJson: object,
	schemas: SchemaContext,
): IDataObject {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!mappingConfig) {
		errors.push('mappingConfig is required');
	}

	if (!Array.isArray(mappingConfig?.mappings)) {
		errors.push('mappingConfig.mappings must be an array');
	}

	const targetPaths = schemas.targetSchema
		? schemaLeafPaths(schemas.targetSchema)
		: flattenLeafPaths(targetSampleJson);

	const sourcePaths = schemas.sourceSchema ? schemaLeafPaths(schemas.sourceSchema) : [];
	const mappedTargetPaths = new Set<string>();

	for (const [index, rule] of (mappingConfig?.mappings ?? []).entries()) {
		if (!rule.target) {
			errors.push(`mappings[${index}].target is required`);
		}

		if (!rule.expression) {
			errors.push(`mappings[${index}].expression is required`);
		}

		if (rule.target) {
			mappedTargetPaths.add(rule.target);
		}

		if (rule.expression) {
			try {
				jsonata(rule.expression);
			} catch (error) {
				errors.push(
					`mappings[${index}].expression is invalid JSONata: ${
						(error as Error).message
					}`,
				);
			}
		}

		if (
			rule.transform?.type === 'javascript' &&
			!rule.transform.code.includes('return')
		) {
			warnings.push(
				`mappings[${index}] JavaScript transform has no return statement`,
			);
		}
	}

	const unmappedTargetPaths = targetPaths.filter(
		(path) => !mappedTargetPaths.has(path),
	);

	return {
		valid: errors.length === 0,
		errors,
		warnings,
		sourcePaths,
		targetPaths,
		mappedTargetPaths: Array.from(mappedTargetPaths),
		unmappedTargetPaths,
	};
}

function createAjvForSchema(schema: Record<string, unknown>) {
	const schemaUri = typeof schema.$schema === 'string' ? schema.$schema : '';
	const ajv = schemaUri.includes('2020-12')
		? new Ajv2020({ allErrors: true, strict: false })
		: new Ajv({ allErrors: true, strict: false });

	addFormats(ajv);
	return ajv;
}

export function assertUsableSchema(
	schema: Record<string, unknown>,
	fieldName: string,
): Record<string, unknown> {
	if (isEmptyOrNonRestrictiveSchema(schema)) {
		throw new Error(
			`${fieldName} is enabled, but the schema is empty or non-restrictive. ` +
				'Provide a schema with properties, required fields, enum/const, composition keywords, additionalProperties=false, or other validation rules.',
		);
	}

	const schemaValidation = validateSchemaDefinition(schema, fieldName);

	if (!schemaValidation.valid) {
		throw new Error(
			`${fieldName} is not a valid JSON Schema: ${JSON.stringify(
				schemaValidation.errors ?? [],
			)}`,
		);
	}

	return schema;
}

export function isEmptyOrNonRestrictiveSchema(schema: unknown): boolean {
	if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
		return true;
	}

	const s = schema as Record<string, unknown>;
	const keys = Object.keys(s);

	if (keys.length === 0) {
		return true;
	}

	const metadataOnlyKeys = new Set([
		'$schema',
		'$id',
		'$comment',
		'title',
		'description',
		'examples',
		'definitions',
		'$defs',
	]);

	const nonMetadataKeys = keys.filter((key) => !metadataOnlyKeys.has(key));

	if (nonMetadataKeys.length === 0) {
		return true;
	}

	const hasNonEmptyObject = (value: unknown) =>
		Boolean(
			value &&
				typeof value === 'object' &&
				!Array.isArray(value) &&
				Object.keys(value as Record<string, unknown>).length > 0,
		);

	const hasNonEmptyArray = (value: unknown) => Array.isArray(value) && value.length > 0;

	const hasMeaningfulValidationRule =
		hasNonEmptyObject(s.properties) ||
		hasNonEmptyObject(s.patternProperties) ||
		hasNonEmptyObject(s.dependentSchemas) ||
		hasNonEmptyObject(s.propertyNames) ||
		hasNonEmptyArray(s.required) ||
		hasNonEmptyArray(s.enum) ||
		hasNonEmptyArray(s.oneOf) ||
		hasNonEmptyArray(s.anyOf) ||
		hasNonEmptyArray(s.allOf) ||
		hasNonEmptyArray(s.dependentRequired) ||
		s.const !== undefined ||
		s.not !== undefined ||
		s.if !== undefined ||
		s.then !== undefined ||
		s.else !== undefined ||
		s.$ref !== undefined ||
		s.items !== undefined ||
		s.contains !== undefined ||
		hasNonEmptyArray(s.prefixItems) ||
		s.additionalProperties === false ||
		typeof s.additionalProperties === 'object' ||
		s.minProperties !== undefined ||
		s.maxProperties !== undefined ||
		s.minItems !== undefined ||
		s.maxItems !== undefined ||
		s.uniqueItems !== undefined ||
		s.minLength !== undefined ||
		s.maxLength !== undefined ||
		s.pattern !== undefined ||
		s.minimum !== undefined ||
		s.maximum !== undefined ||
		s.exclusiveMinimum !== undefined ||
		s.exclusiveMaximum !== undefined ||
		s.multipleOf !== undefined ||
		s.format !== undefined;

	if (hasMeaningfulValidationRule) {
		return false;
	}

	const schemaType = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
	if (schemaType.length > 0 && !schemaType.includes('object')) {
		return false;
	}

	return true;
}

export function validateSchemaDefinition(
	schema: Record<string, unknown>,
	fieldName = 'JSON Schema',
): IDataObject {
	const normalizedSchema = parseJsonParameter<Record<string, unknown>>(
		schema,
		fieldName,
	);
	const ajv = createAjvForSchema(normalizedSchema);
	const valid = ajv.validateSchema(normalizedSchema) as boolean;

	return {
		valid,
		errors: ajv.errors ?? [],
	};
}

export function validateAgainstSchema(
	schema: Record<string, unknown>,
	data: unknown,
): IDataObject {
	const normalizedSchema = parseJsonParameter<Record<string, unknown>>(
		schema,
		'JSON Schema',
	);
	const schemaValidation = validateSchemaDefinition(normalizedSchema);

	if (!schemaValidation.valid) {
		return {
			valid: false,
			schemaValid: false,
			schemaErrors: schemaValidation.errors ?? [],
			errors: [
				{
					message: 'Invalid JSON Schema',
				},
			],
		};
	}

	const ajv = createAjvForSchema(normalizedSchema);
	const validate = ajv.compile(normalizedSchema);
	const valid = validate(data);

	return {
		valid,
		schemaValid: true,
		errors: validate.errors ?? [],
	};
}

function flattenLeafPaths(obj: any, prefix = ''): string[] {
	if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
		return prefix ? [prefix] : [];
	}

	let paths: string[] = [];

	for (const key of Object.keys(obj)) {
		const nextPath = prefix ? `${prefix}.${key}` : key;
		const value = obj[key];

		if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
			paths = paths.concat(flattenLeafPaths(value, nextPath));
		} else {
			paths.push(nextPath);
		}
	}

	return paths;
}

function schemaLeafPaths(schema: any, prefix = ''): string[] {
	if (!schema || typeof schema !== 'object') {
		return [];
	}

	if (schema.$ref) {
		return [];
	}

	const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

	if (type === 'array') {
		const itemPrefix = prefix ? `${prefix}[]` : '[]';
		return schema.items ? schemaLeafPaths(schema.items, itemPrefix) : [itemPrefix];
	}

	const properties = schema.properties;

	if (properties && typeof properties === 'object') {
		let paths: string[] = [];

		for (const key of Object.keys(properties)) {
			const nextPath = prefix ? `${prefix}.${key}` : key;
			const child = properties[key];
			const childPaths = schemaLeafPaths(child, nextPath);
			paths = paths.concat(childPaths.length ? childPaths : [nextPath]);
		}

		return paths;
	}

	return prefix ? [prefix] : [];
}

function buildAiMappingPrompt(
	sourceJson: unknown,
	targetSampleJson: unknown,
	schemas: SchemaContext,
): string {
	return `You are a JSON mapping assistant.

Create a JSONata mapping configuration that maps SOURCE_JSON to the TARGET structure.

You may receive both sample JSON documents and JSON Schemas. Use schemas as the authoritative field/type contract when present. Use sample documents to understand example values.

Return strict JSON only in this exact shape:
{
  "version": "1.1",
  "engine": "jsonata",
  "metadata": {
    "sourceName": "Source",
    "targetName": "Target"
  },
  "validation": {
    "sourceSchema": {},
    "targetSchema": {}
  },
  "mappings": [
    {
      "id": "map_001",
      "sourceLabel": "Human readable source label",
      "target": "target.path",
      "expression": "valid JSONata expression against source JSON",
      "required": false,
      "confidence": 0.95,
      "reason": "Brief reason"
    }
  ]
}

Rules:
- Use dot notation for target paths.
- JSONata expressions must evaluate against SOURCE_JSON directly.
- Do not invent source fields.
- Prefer direct JSONata paths when fields are equivalent.
- Use JSONata functions for common transformations: $trim(), $lowercase(), $uppercase(), $number(), $string(), $exists().
- Use sourceSchema and targetSchema in validation only if provided below; otherwise omit empty schema objects.
- Return JSON only. No markdown.

SOURCE_JSON_SAMPLE:
${JSON.stringify(sourceJson, null, 2)}

SOURCE_JSON_SCHEMA:
${JSON.stringify(schemas.sourceSchema ?? null, null, 2)}

TARGET_JSON_SAMPLE:
${JSON.stringify(targetSampleJson, null, 2)}

TARGET_JSON_SCHEMA:
${JSON.stringify(schemas.targetSchema ?? null, null, 2)}
`;
}

type BuildLlmRequestArgs = {
	provider: LlmProvider;
	model: string;
	temperature: number;
	systemPrompt: string;
	userPrompt: string;
	credentials: GenericLlmCredentials;
	customHttpPath?: string;
};

type BuiltLlmRequest = {
	url: string;
	headers: Record<string, string>;
	body: IDataObject;
};

function buildGenericLlmRequest(args: BuildLlmRequestArgs): BuiltLlmRequest {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...parseExtraHeaders(args.credentials.extraHeaders),
	};

	const baseUrl = normalizeBaseUrl(args.credentials.baseUrl);
	const apiKey = String(args.credentials.apiKey ?? '');
	const authHeaderName = String(args.credentials.authHeaderName ?? 'Authorization').trim();
	const authHeaderPrefix = String(args.credentials.authHeaderPrefix ?? 'Bearer').trim();

	const addBearerLikeAuth = () => {
		if (apiKey && authHeaderName) {
			headers[authHeaderName] = authHeaderPrefix ? authHeaderPrefix + ' ' + apiKey : apiKey;
		}
	};

	switch (args.provider) {
		case 'anthropic': {
			if (apiKey) headers['x-api-key'] = apiKey;
			headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01';
			return {
				url: (baseUrl || 'https://api.anthropic.com/v1') + '/messages',
				headers,
				body: {
					model: args.model,
					temperature: args.temperature,
					max_tokens: 4000,
					system: args.systemPrompt,
					messages: [{ role: 'user', content: args.userPrompt }],
				},
			};
		}

		case 'googleGemini': {
			const googleBaseUrl = normalizeGeminiBaseUrl(baseUrl);
			const geminiModel = normalizeGeminiModel(args.model);
			const separator = apiKey ? '?key=' + encodeURIComponent(apiKey) : '';
			return {
				url: googleBaseUrl + '/models/' + encodeURIComponent(geminiModel) + ':generateContent' + separator,
				headers,
				body: {
					generationConfig: {
						temperature: args.temperature,
						responseMimeType: 'application/json',
					},
					systemInstruction: {
						parts: [{ text: args.systemPrompt }],
					},
					contents: [
						{
							role: 'user',
							parts: [{ text: args.userPrompt }],
						},
					],
				},
			};
		}

		case 'ollama': {
			return {
				url: (baseUrl || 'http://host.docker.internal:11434') + '/api/chat',
				headers,
				body: {
					model: args.model,
					stream: false,
					options: { temperature: args.temperature },
					messages: [
						{ role: 'system', content: args.systemPrompt },
						{ role: 'user', content: args.userPrompt },
					],
				},
			};
		}

		case 'customHttp': {
			addBearerLikeAuth();
			const path = args.customHttpPath ? '/' + args.customHttpPath.replace(/^\/+/, '') : '';
			return {
				url: baseUrl + path,
				headers,
				body: {
					model: args.model,
					temperature: args.temperature,
					system: args.systemPrompt,
					prompt: args.userPrompt,
					messages: [
						{ role: 'system', content: args.systemPrompt },
						{ role: 'user', content: args.userPrompt },
					],
				},
			};
		}

		case 'openAiCompatible':
		default: {
			addBearerLikeAuth();
			return {
				url: (baseUrl || 'https://api.openai.com/v1') + '/chat/completions',
				headers,
				body: {
					model: args.model,
					temperature: args.temperature,
					response_format: { type: 'json_object' },
					messages: [
						{ role: 'system', content: args.systemPrompt },
						{ role: 'user', content: args.userPrompt },
					],
				},
			};
		}
	}
}

function extractLlmText(provider: LlmProvider, response: any): string | undefined {
	if (!response) return undefined;
	if (typeof response === 'string') return response;
	if (response.mappingConfig || response.mappings) return JSON.stringify(response.mappingConfig ?? response);

	switch (provider) {
		case 'anthropic':
			return response.content?.map((part: any) => part?.text).filter(Boolean).join('\n');
		case 'googleGemini':
			return response.candidates?.[0]?.content?.parts?.map((part: any) => part?.text).filter(Boolean).join('\n');
		case 'ollama':
			return response.message?.content ?? response.response;
		case 'customHttp':
			return response.mappingConfigJson ?? response.content ?? response.text ?? response.message?.content ?? response.choices?.[0]?.message?.content;
		case 'openAiCompatible':
		default:
			return response.choices?.[0]?.message?.content ?? response.output_text;
	}
}

function parseLlmJsonContent<T>(content: string): T {
	const withoutFence = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
	try {
		return JSON.parse(withoutFence) as T;
	} catch {
		const firstObject = withoutFence.indexOf('{');
		const lastObject = withoutFence.lastIndexOf('}');
		if (firstObject >= 0 && lastObject > firstObject) {
			return JSON.parse(withoutFence.slice(firstObject, lastObject + 1)) as T;
		}
		throw new Error('Response did not contain a valid JSON object');
	}
}

function normalizeBaseUrl(value: unknown): string {
	return String(value ?? '').trim().replace(/\/+$/, '');
}


function normalizeGeminiBaseUrl(value: unknown): string {
	let baseUrl = normalizeBaseUrl(value) || 'https://generativelanguage.googleapis.com/v1beta';

	// Users sometimes paste the full generateContent URL or a Base URL ending in /models.
	baseUrl = baseUrl.replace(/\/models\/[^/]+:generateContent(?:\?.*)?$/i, '');
	baseUrl = baseUrl.replace(/\/models$/i, '');

	return normalizeBaseUrl(baseUrl);
}

function normalizeGeminiModel(value: unknown): string {
	let model = String(value ?? '').trim();

	// Accept either "gemini-2.5-flash" or "models/gemini-2.5-flash".
	model = model.replace(/^models\//i, '');

	// If a full Gemini URL is accidentally pasted into the model field, extract the model id.
	const match = model.match(/\/models\/([^/:?]+):generateContent/i);
	if (match?.[1]) {
		model = match[1];
	}

	return model || 'gemini-2.5-flash';
}

function redactApiKeyFromUrl(url: string): string {
	return url.replace(/([?&]key=)[^&]+/i, '$1***');
}

function parseExtraHeaders(value: unknown): Record<string, string> {
	if (!value) return {};
	const parsed = typeof value === 'string' ? parseJsonParameter<Record<string, unknown>>(value, 'Extra Headers') : value;
	const headers: Record<string, string> = {};
	for (const [key, headerValue] of Object.entries(parsed as Record<string, unknown>)) {
		if (headerValue !== undefined && headerValue !== null) headers[key] = String(headerValue);
	}
	return headers;
}

export function normalizeJsonataValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((item) => normalizeJsonataValue(item));
	if (value !== null && typeof value === 'object') {
		const normalized: Record<string, unknown> = {};
		for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
			if (key === 'sequence') continue;
			normalized[key] = normalizeJsonataValue(childValue);
		}
		return normalized;
	}
	return value;
}

export function parseJsonParameter<T>(value: unknown, fieldName: string): T {
	if (typeof value === 'string') {
		try {
			return JSON.parse(value) as T;
		} catch {
			throw new Error(`${fieldName} must be valid JSON`);
		}
	}

	return value as T;
}
