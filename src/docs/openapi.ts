export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Postcode Resolution Service API',
    version: '1.0.0',
    description:
      'Resolves postal addresses and exposes authenticated audit-log and resolution-statistics endpoints.',
  },
  servers: [{ url: '/', description: 'Current server' }],
  tags: [
    { name: 'System', description: 'Service health' },
    { name: 'Resolution', description: 'Postal-code resolution' },
    { name: 'Operations', description: 'Authenticated audit and statistics endpoints' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Check service health',
        description: 'Checks that the API can connect to PostgreSQL.',
        operationId: 'getHealth',
        responses: {
          '200': {
            description: 'The service and database are available.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' },
                example: { status: 'ok' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/v1/postcode/resolve': {
      post: {
        tags: ['Resolution'],
        summary: 'Resolve a postal code',
        description:
          'Resolves the most likely postal code and country for an address. The resource_id is recorded only for audit correlation and is not sent to the model.',
        operationId: 'resolvePostcode',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ResolutionRequest' },
              example: {
                resource_id: 'shipment-123',
                address: '16 Lebuh Tenggiri 2, Seberang Jaya',
                phone: '0176710714',
                debug: false,
              },
            },
          },
        },
        responses: {
          '200': {
            description:
              'The request completed. The status is SUCCESS when confidence meets the configured threshold, otherwise AMBIGUOUS.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ResolutionResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/InvalidRequest' },
          '502': {
            description: 'The resolution provider or audit persistence operation failed.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ResolutionResponse' },
                example: { status: 'FAILED', confidence_score: 0, data: null },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/v1/resolution-logs': {
      get: {
        tags: ['Operations'],
        summary: 'List resolution audit logs',
        description:
          'Returns the newest matching audit logs. These records contain addresses, phone numbers, model usage, and estimated cost.',
        operationId: 'listResolutionLogs',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/LogsLimit' },
          { $ref: '#/components/parameters/From' },
          { $ref: '#/components/parameters/To' },
        ],
        responses: {
          '200': {
            description: 'The newest matching audit logs.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ResolutionLogsResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/InvalidRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '503': { $ref: '#/components/responses/LogsNotConfigured' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
    '/v1/resolution-stats': {
      get: {
        tags: ['Operations'],
        summary: 'Get resolution success and failure rates',
        description:
          'Calculates rates from the newest matching audit logs. AMBIGUOUS and FAILED are both counted as failures.',
        operationId: 'getResolutionStats',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/StatsLimit' },
          { $ref: '#/components/parameters/From' },
          { $ref: '#/components/parameters/To' },
        ],
        responses: {
          '200': {
            description: 'Resolution outcome counts and rates.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ResolutionStatsResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/InvalidRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '503': { $ref: '#/components/responses/LogsNotConfigured' },
          '500': { $ref: '#/components/responses/InternalServerError' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'The value configured in LOGS_API_KEY.',
      },
    },
    parameters: {
      From: {
        name: 'from',
        in: 'query',
        required: false,
        description: 'Include records created at or after this ISO-8601 timestamp.',
        schema: { type: 'string', format: 'date-time' },
      },
      To: {
        name: 'to',
        in: 'query',
        required: false,
        description: 'Include records created at or before this ISO-8601 timestamp.',
        schema: { type: 'string', format: 'date-time' },
      },
      LogsLimit: {
        name: 'limit',
        in: 'query',
        required: false,
        description: 'Maximum number of audit logs to return.',
        schema: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
      },
      StatsLimit: {
        name: 'limit',
        in: 'query',
        required: false,
        description: 'Maximum number of recent logs included in the calculation.',
        schema: { type: 'integer', minimum: 1, maximum: 100000, default: 1000 },
      },
    },
    responses: {
      InvalidRequest: {
        description: 'The request body or query parameters are invalid.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      },
      Unauthorized: {
        description: 'The x-api-key header is missing or incorrect.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: { status: 'FAILED', error: 'Unauthorized' },
          },
        },
      },
      LogsNotConfigured: {
        description: 'LOGS_API_KEY is not configured on the server.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: { status: 'FAILED', error: 'Log endpoint is not configured' },
          },
        },
      },
      InternalServerError: {
        description: 'An unexpected server error occurred.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
            example: { status: 'FAILED', error: 'Internal server error' },
          },
        },
      },
    },
    schemas: {
      HealthResponse: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', enum: ['ok'] } },
      },
      ErrorResponse: {
        type: 'object',
        required: ['status', 'error'],
        properties: {
          status: { type: 'string', enum: ['FAILED'] },
          error: { type: 'string' },
          details: { type: 'object', additionalProperties: true },
        },
      },
      ResolutionRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['resource_id', 'address', 'phone'],
        properties: {
          resource_id: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            description: 'Caller identifier stored only in the audit log.',
          },
          address: { type: 'string', minLength: 5, maxLength: 500 },
          phone: {
            type: 'string',
            minLength: 6,
            maxLength: 30,
            description: 'May be used as a weak country or regional clue.',
          },
          debug: {
            type: 'boolean',
            default: false,
            description: 'Include provider and detected-rule information in the response.',
          },
        },
      },
      ResolvedAddress: {
        type: 'object',
        required: [
          'address_line1',
          'district',
          'city',
          'state',
          'postcode',
          'central_postcode',
          'country',
          'country_code',
          'phone',
        ],
        properties: {
          address_line1: { type: 'string' },
          district: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          postcode: { type: 'string', minLength: 1, maxLength: 16 },
          central_postcode: { type: 'string', minLength: 1, maxLength: 16 },
          country: { type: 'string', minLength: 2, maxLength: 100 },
          country_code: {
            type: 'string',
            minLength: 2,
            maxLength: 2,
            description: 'ISO 3166-1 alpha-2 country code.',
          },
          phone: { type: 'string' },
        },
      },
      DebugInfo: {
        type: 'object',
        required: ['detected_rules', 'provider', 'model'],
        properties: {
          detected_rules: { type: 'array', items: { type: 'string' } },
          provider: { type: 'string' },
          model: { type: 'string' },
        },
      },
      ResolutionResponse: {
        type: 'object',
        required: ['status', 'confidence_score', 'data'],
        properties: {
          status: { type: 'string', enum: ['SUCCESS', 'AMBIGUOUS', 'FAILED'] },
          confidence_score: { type: 'number', minimum: 0, maximum: 1 },
          data: {
            allOf: [{ $ref: '#/components/schemas/ResolvedAddress' }],
            nullable: true,
          },
          debug_info: { $ref: '#/components/schemas/DebugInfo' },
        },
      },
      ResolutionLog: {
        type: 'object',
        required: [
          'id',
          'requestAddress',
          'requestPhone',
          'sanitizedAddress',
          'sanitizeEnabled',
          'provider',
          'model',
          'status',
          'confidenceScore',
          'result',
          'detectedRules',
          'cacheHit',
          'latencyMs',
          'promptTokens',
          'cachedPromptTokens',
          'outputTokens',
          'thinkingTokens',
          'toolTokens',
          'totalTokens',
          'searchQueries',
          'estimatedListCostUsd',
          'createdAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          resourceId: { type: 'string', nullable: true },
          requestAddress: { type: 'string' },
          requestPhone: { type: 'string' },
          sanitizedAddress: { type: 'string' },
          sanitizeEnabled: { type: 'boolean' },
          provider: { type: 'string' },
          model: { type: 'string' },
          status: { type: 'string', enum: ['SUCCESS', 'AMBIGUOUS', 'FAILED'] },
          confidenceScore: {
            description: 'PostgreSQL numeric values may be serialized as JSON numbers or strings.',
            oneOf: [
              { type: 'number', minimum: 0, maximum: 1 },
              { type: 'string', pattern: '^(0(?:\\.\\d+)?|1(?:\\.0+)?)$' },
            ],
          },
          result: { $ref: '#/components/schemas/ResolutionResponse' },
          detectedRules: { type: 'array', items: { type: 'string' } },
          cacheHit: { type: 'boolean' },
          latencyMs: { type: 'integer', minimum: 0 },
          promptTokens: { type: 'integer', minimum: 0 },
          cachedPromptTokens: { type: 'integer', minimum: 0 },
          outputTokens: { type: 'integer', minimum: 0 },
          thinkingTokens: { type: 'integer', minimum: 0 },
          toolTokens: { type: 'integer', minimum: 0 },
          totalTokens: { type: 'integer', minimum: 0 },
          searchQueries: { type: 'integer', minimum: 0 },
          estimatedListCostUsd: {
            description: 'PostgreSQL numeric values may be serialized as JSON numbers or strings.',
            oneOf: [
              { type: 'number', minimum: 0 },
              { type: 'string', pattern: '^\\d+(?:\\.\\d+)?$' },
            ],
          },
          errorCode: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      QueryMeta: {
        type: 'object',
        required: ['limit', 'from', 'to'],
        properties: {
          limit: { type: 'integer' },
          from: { type: 'string', format: 'date-time', nullable: true },
          to: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      ResolutionLogsResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/ResolutionLog' },
          },
          meta: {
            allOf: [
              { $ref: '#/components/schemas/QueryMeta' },
              {
                type: 'object',
                required: ['count'],
                properties: { count: { type: 'integer', minimum: 0 } },
              },
            ],
          },
        },
      },
      OutcomeStats: {
        type: 'object',
        required: ['count', 'rate'],
        properties: {
          count: { type: 'integer', minimum: 0 },
          rate: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
      ResolutionStatsResponse: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: {
            type: 'object',
            required: ['total', 'success', 'failure', 'breakdown'],
            properties: {
              total: { type: 'integer', minimum: 0 },
              success: { $ref: '#/components/schemas/OutcomeStats' },
              failure: { $ref: '#/components/schemas/OutcomeStats' },
              breakdown: {
                type: 'object',
                required: ['ambiguous', 'failed'],
                properties: {
                  ambiguous: { type: 'integer', minimum: 0 },
                  failed: { type: 'integer', minimum: 0 },
                },
              },
            },
          },
          meta: {
            allOf: [
              { $ref: '#/components/schemas/QueryMeta' },
              {
                type: 'object',
                required: ['first_log_at', 'last_log_at'],
                properties: {
                  first_log_at: { type: 'string', format: 'date-time', nullable: true },
                  last_log_at: { type: 'string', format: 'date-time', nullable: true },
                },
              },
            ],
          },
        },
      },
    },
  },
} as const;
