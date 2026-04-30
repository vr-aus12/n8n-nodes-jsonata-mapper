import {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class GenericLlmApi implements ICredentialType {
	name = 'genericLlmApi';
	displayName = 'Generic LLM API';
	icon = 'file:genericLlmApi.svg' as const;
	documentationUrl = 'https://docs.n8n.io/credentials/';
	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			description: 'Optional base URL. Leave blank to use provider default. Examples: https://api.openai.com/v1, https://api.anthropic.com/v1, https://generativelanguage.googleapis.com/v1beta, http://host.docker.internal:11434',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'API key. Can be blank for local Ollama or unauthenticated custom endpoints.',
		},
		{
			displayName: 'Auth Header Name',
			name: 'authHeaderName',
			type: 'string',
			default: 'Authorization',
			description: 'Used by OpenAI-compatible and Custom HTTP providers. Anthropic/Gemini use provider-specific auth automatically.',
		},
		{
			displayName: 'Auth Header Prefix',
			name: 'authHeaderPrefix',
			type: 'string',
			default: 'Bearer',
			description: 'Example: Bearer. Leave empty if the header value should be just the API key.',
		},
		{
			displayName: 'Extra Headers JSON',
			name: 'extraHeaders',
			type: 'json',
			default: '{}',
			description: 'Optional extra headers as JSON object.',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl || "https://api.openai.com/v1"}}',
			url: '/',
			method: 'GET',
		},
	};

}
