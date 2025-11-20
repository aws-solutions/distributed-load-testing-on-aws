# API Validation Module

This module provides TypeScript types and Zod-based validation for all API inputs in the Distributed Load Testing solution.

## Overview

The validation layer validates:
- **Path Parameters**: `testId`, `testRunId`
- **Query Parameters**: Endpoint-specific query strings
- **Request Bodies**: POST/PUT/DELETE request payloads

## Architecture

```
lib/validation/
├── index.ts          # Main entry point, exports all validation functions
├── schemas.ts        # Zod validation schemas
├── validators.ts     # Validation wrapper functions
├── errors.ts         # Error transformation utilities
└── README.md         # This file

types/
└── index.ts          # TypeScript type definitions
```

## Usage

### Basic Validation

```javascript
const { validateTestId, validateCreateTestBody } = require('./lib/validation');

// Validate path parameter
try {
  const validTestId = validateTestId('my-test-123');
  console.log('Valid testId:', validTestId);
} catch (error) {
  console.error('Validation error:', error.message);
}

// Validate request body
try {
  const validBody = validateCreateTestBody({
    testName: 'My Load Test',
    testDescription: 'Testing API performance',
    testType: 'simple',
    testTaskConfigs: [{
      region: 'us-west-2',
      taskCount: 5,
      concurrency: 10
    }],
    // ... other fields
  });
} catch (error) {
  console.error('Validation error:', error.message);
}
```

### Validation Rules

#### Path Parameters

**testId**
- Required when present
- Length: 1-128 characters
- Format: Alphanumeric and hyphens only
- Example: `test-abc123`, `my-test-001`

**testRunId**
- Required when present
- Length: 1-128 characters
- Format: Alphanumeric and hyphens only
- Example: `run-xyz789`, `execution-456`

#### Query Parameters

**GET /scenarios**
- `op`: Optional, must be 'listRegions'
- `tags`: Optional, comma-separated tags (max 500 chars)

**GET /scenarios/{testId}**
- `history`: Optional, must be 'true' or 'false'
- `latest`: Optional, must be 'true' or 'false'

**GET /scenarios/{testId}/testruns**
- `limit`: Optional, 1-100 (default: 20)
- `start_timestamp`: Optional, ISO 8601 date
- `end_timestamp`: Optional, ISO 8601 date
- `latest`: Optional, must be 'true' or 'false'
- `next_token`: Optional, pagination token

**GET /scenarios/{testId}/baseline**
- `data`: Optional, must be 'true' or 'false'

#### Request Bodies

**POST /scenarios** (Create Test)
Required fields:
- `testName`: 3-255 characters
- `testDescription`: 3-60000 characters
- `testType`: One of 'simple', 'jmeter', 'locust', 'k6'
- `testTaskConfigs`: Array of task configurations
  - `region`: Valid AWS region (e.g., 'us-west-2')
  - `taskCount`: Positive integer
  - `concurrency`: Positive integer
- `testScenario`: Test scenario object with execution array
- `regionalTaskDetails`: Regional task configuration

Optional fields:
- `testId`: 1-128 characters (generated if not provided)
- `fileType`: 'none', 'script', or 'zip'
- `showLive`: Boolean
- `tags`: Array of up to 5 tags
- `scheduleStep`: 'create' or 'start'
- `scheduleDate`: YYYY-MM-DD format
- `scheduleTime`: HH:MM format
- `recurrence`: 'daily', 'weekly', 'biweekly', or 'monthly'
- `cronValue`: Linux cron expression
- `cronExpiryDate`: YYYY-MM-DD format

**PUT /scenarios/{testId}/baseline** (Set Baseline)
- `testRunId`: Valid test run identifier (required)

**DELETE /scenarios/{testId}/testruns** (Delete Test Runs)
- Array of `testRunId` strings (at least one required)

## Error Handling

Validation errors are thrown with detailed messages:

```javascript
// Example error for invalid testId
{
  code: "INVALID_PATH_PARAMETER",
  message: "testId: testId must not exceed 128 characters",
  statusCode: 400
}

// Example error for invalid request body
{
  code: "INVALID_REQUEST_BODY",
  message: "testName: testName must be at least 3 characters; testType: testType must be one of: simple, jmeter, locust, k6",
  statusCode: 400
}
```

## Integration with Existing Code

The validation layer supplements existing validation:

1. **Zod validation runs first** - Catches format and type errors early
2. **Existing business logic validation runs second** - Domain-specific rules
3. **Both layers coexist** - Gradual migration path

### Example: Tag Validation

```javascript
// Zod validates format and count
const tagsSchema = z.array(z.string()).max(5);

// Existing code validates and normalizes content
const validateTags = (tags) => {
  if (!Array.isArray(tags)) throw new Error('Tags must be an array');
  return tags.map(normalizeTag).filter(t => t.length > 0);
};
```

## TypeScript Support

Full TypeScript types are available:

```typescript
import type {
  CreateTestValidation,
  PathParametersValidation,
  TestRunsQueryValidation
} from './lib/validation';

const testConfig: CreateTestValidation = {
  testName: 'My Test',
  testDescription: 'Load test',
  testType: 'simple',
  // ... typed fields with autocomplete
};
```

## Extending the Validation

### Adding a New Endpoint

1. **Add types** to `types/index.ts`:
```typescript
export interface NewEndpointQueryParams {
  param1?: string;
  param2?: number;
}
```

2. **Create schema** in `schemas.ts`:
```typescript
export const newEndpointQuerySchema = z.object({
  param1: z.string().optional(),
  param2: z.number().min(1).max(100).optional(),
}).strict();
```

3. **Add validator** in `validators.ts`:
```typescript
export function validateNewEndpointQuery(queryParams) {
  try {
    return newEndpointQuerySchema.parse(queryParams || {});
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(formatZodError(error));
    }
    throw error;
  }
}
```

4. **Update resource validator** in `validators.ts`:
```typescript
export function validateQueryForResource(resource, queryParams) {
  switch (resource) {
    case '/new-endpoint':
      return validateNewEndpointQuery(queryParams);
    // ... other cases
  }
}
```

### Custom Validation Rules

Use Zod's `.refine()` for custom business logic:

```typescript
const customSchema = z.object({
  field: z.string()
}).refine(
  (data) => customBusinessLogic(data.field),
  { message: 'Custom validation failed' }
);
```

## Testing

The validation layer is tested through:
1. Unit tests (Jest) for individual validators
2. Integration tests with API handler
3. End-to-end tests with real API requests

## Benefits

✅ **Early validation** - Catch errors before business logic  
✅ **Consistent errors** - Standardized error messages  
✅ **Type safety** - Full TypeScript support  
✅ **Self-documenting** - Schema is the documentation  
✅ **Maintainable** - Centralized validation logic  
✅ **Backward compatible** - Works alongside existing code

## Migration Path

1. ✅ **Phase 1** - Add Zod validation alongside existing (current)
2. **Phase 2** - Remove redundant simple validations
3. **Phase 3** - Integrate complex validators with Zod
4. **Phase 4** - Full migration complete

## Resources

- [Zod Documentation](https://zod.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [API Gateway Event Structure](https://docs.aws.amazon.com/lambda/latest/dg/services-apigateway.html)
