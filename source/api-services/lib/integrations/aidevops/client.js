// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Thin wrapper around the aidevops SDK calls.
 *
 * Responsibilities:
 * 1. Call the AWS SDK with the provided input.
 * 2. Retry on ThrottlingException / InternalServerException (exponential backoff + full jitter).
 * 3. Unwrap the { task: { ... } } envelope where applicable.
 * 4. Emit structured JSON CloudWatch logs (correlation id, action, latency, outcome).
 *
 */

const {
  DevOpsAgentClient,
  GetAgentSpaceCommand,
  CreateBacklogTaskCommand,
  GetBacklogTaskCommand,
  UpdateBacklogTaskCommand,
  ListExecutionsCommand,
  ListJournalRecordsCommand,
  CreateAssetCommand,
  DeleteAssetCommand,
} = require("@aws-sdk/client-devops-agent");

const utils = require("solution-utils");
const { withRetry } = require("./retry");

const options = utils.getOptions({ region: process.env.AWS_REGION });
// Disable SDK built-in retry — our withRetry handles retries with longer backoff (1s/2s/4s)
// and explicit error classification (fail-fast on ValidationException, ConflictException, etc.)
const client = new DevOpsAgentClient({ ...options, maxAttempts: 1 });

// Cache of regional clients keyed by region string.
// The default client handles the stack's own region; cross-region calls get a dedicated client.
const regionalClients = new Map();

const getClientForRegion = (region) => {
  if (!region || region === process.env.AWS_REGION) return client;
  if (regionalClients.has(region)) return regionalClients.get(region);
  const regionalOptions = utils.getOptions({ region });
  const regionalClient = new DevOpsAgentClient({ ...regionalOptions, maxAttempts: 1 });
  regionalClients.set(region, regionalClient);
  return regionalClient;
};

/**
 * Emits a structured JSON log entry for observability.
 *
 * @param {object} fields
 * @param {string} fields.correlationId - Unique id for the request chain.
 * @param {string} fields.action - The aidevops action name.
 * @param {number} fields.latencyMs - Duration of the call in milliseconds.
 * @param {string} fields.outcome - "success" or "failure".
 * @param {string} [fields.errorName] - Exception name on failure.
 * @param {string} [fields.requesterCognitoSub] - Cognito sub of the operator.
 */
const emitLog = (fields) => {
  const entry = {
    level: fields.outcome === "success" ? "info" : "error",
    action: `aidevops.${fields.action}`,
    correlationId: fields.correlationId,
    latencyMs: fields.latencyMs,
    outcome: fields.outcome,
  };
  if (fields.agentSpaceId) entry.agentSpaceId = fields.agentSpaceId;
  if (fields.investigationId) entry.investigationId = fields.investigationId;
  if (fields.executionId) entry.executionId = fields.executionId;
  if (fields.errorName) entry.errorName = fields.errorName;
  if (fields.requesterCognitoSub) entry.requesterCognitoSub = fields.requesterCognitoSub;
  console.log(JSON.stringify(entry));
};

/**
 * Wraps a SDK command execution with logging and optional retry.
 *
 * @param {object} params
 * @param {string} params.action - Human-readable action name for logs.
 * @param {object} params.command - The SDK Command instance.
 * @param {string} params.correlationId - Correlation id for tracing.
 * @param {string} [params.requesterCognitoSub] - Cognito sub of the requesting operator.
 * @param {boolean} [params.retry=false] - Whether to apply retry logic.
 * @returns {Promise<object>} Raw SDK response.
 */
const executeCommand = async ({ action, command, correlationId, requesterCognitoSub, agentSpaceId, investigationId, executionId, region, retry = false }) => {
  const start = Date.now();
  const logContext = { correlationId, action, requesterCognitoSub, agentSpaceId, investigationId, executionId };
  const targetClient = getClientForRegion(region);
  try {
    const fn = () => targetClient.send(command);
    const response = retry ? await withRetry(fn) : await fn();
    emitLog({ ...logContext, latencyMs: Date.now() - start, outcome: "success" });
    return response;
  } catch (err) {
    emitLog({ ...logContext, latencyMs: Date.now() - start, outcome: "failure", errorName: err.name });
    throw err;
  }
};

/**
 * Verifies an Agent Space is reachable (used by test-connection).
 * Retries on ThrottlingException and InternalServerException.
 *
 * @param {object} input
 * @param {string} input.agentSpaceId - The Agent Space ID (pattern: [a-zA-Z0-9-]{1,64}).
 * @param {string} [input.region] - Override region for cross-region calls (extracted from ARN).
 * @param {string} input.correlationId - For structured logging.
 * @param {string} [input.requesterCognitoSub] - Cognito sub of the operator.
 * @returns {Promise<object>} Agent Space metadata from the API.
 */
const getAgentSpace = async (input) => {
  const { correlationId, requesterCognitoSub, region, ...commandInput } = input;
  const command = new GetAgentSpaceCommand(commandInput);
  return executeCommand({
    action: "GetAgentSpace",
    command,
    correlationId,
    requesterCognitoSub,
    agentSpaceId: commandInput.agentSpaceId,
    region,
    retry: true,
  });
};

/**
 * Creates a backlog task (investigation) in DevOps Agent.
 * Retries on ThrottlingException and InternalServerException.
 * Unwraps the { task: { ... } } envelope.
 *
 * @param {object} input
 * @param {string} input.agentSpaceId - The Agent Space ID (pattern: [a-zA-Z0-9-]{1,64}).
 * @param {string} input.title - Task title (1-400 chars).
 * @param {string} input.description - Task description (≤ 10,000 chars).
 * @param {string} input.taskType - "INVESTIGATION" or "EVALUATION".
 * @param {string} input.priority - "CRITICAL", "HIGH", "MEDIUM", "LOW", or "MINIMAL".
 * @param {string} [input.clientToken] - Idempotency token.
 * @param {string} input.correlationId - For structured logging.
 * @param {string} [input.requesterCognitoSub] - Cognito sub of the operator.
 * @returns {Promise<object>} Unwrapped task fields (taskId, executionId, status, etc.).
 */
const createBacklogTask = async (input) => {
  const { correlationId, requesterCognitoSub, region, ...commandInput } = input;
  const command = new CreateBacklogTaskCommand(commandInput);
  const response = await executeCommand({
    action: "CreateBacklogTask",
    command,
    correlationId,
    requesterCognitoSub,
    agentSpaceId: commandInput.agentSpaceId,
    region,
    retry: true,
  });
  return response.task;
};

/**
 * Gets the current state of a backlog task.
 * Retries on ThrottlingException and InternalServerException.
 * Unwraps the { task: { ... } } envelope.
 *
 * @param {object} input
 * @param {string} input.agentSpaceId - The Agent Space ID.
 * @param {string} input.taskId - The task to retrieve.
 * @param {string} input.correlationId - For structured logging.
 * @param {string} [input.requesterCognitoSub] - Cognito sub of the operator.
 * @returns {Promise<object>} Unwrapped task fields.
 */
const getBacklogTask = async (input) => {
  const { correlationId, requesterCognitoSub, region, ...commandInput } = input;
  const command = new GetBacklogTaskCommand(commandInput);
  const response = await executeCommand({
    action: "GetBacklogTask",
    command,
    correlationId,
    requesterCognitoSub,
    agentSpaceId: commandInput.agentSpaceId,
    investigationId: commandInput.taskId,
    region,
    retry: true,
  });
  return response.task;
};

/**
 * Updates a backlog task (e.g. cancel).
 * Retries on ThrottlingException and InternalServerException.
 * Unwraps the { task: { ... } } envelope.
 *
 * @param {object} input
 * @param {string} input.agentSpaceId - The Agent Space ID.
 * @param {string} input.taskId - The task to update.
 * @param {string} input.taskStatus - New status (e.g. "CANCELED").
 * @param {string} [input.clientToken] - Idempotency token.
 * @param {string} input.correlationId - For structured logging.
 * @param {string} [input.requesterCognitoSub] - Cognito sub of the operator.
 * @returns {Promise<object>} Unwrapped task fields.
 */
const updateBacklogTask = async (input) => {
  const { correlationId, requesterCognitoSub, region, ...commandInput } = input;
  const command = new UpdateBacklogTaskCommand(commandInput);
  const response = await executeCommand({
    action: "UpdateBacklogTask",
    command,
    correlationId,
    requesterCognitoSub,
    agentSpaceId: commandInput.agentSpaceId,
    investigationId: commandInput.taskId,
    region,
    retry: true,
  });
  return response.task;
};

/**
 * Lists executions for a backlog task.
 * Retries on ThrottlingException and InternalServerException.
 *
 * @param {object} input
 * @param {string} input.agentSpaceId - The Agent Space ID (not ARN; URI param).
 * @param {string} input.taskId - The task whose executions to list.
 * @param {string} [input.nextToken] - Pagination token.
 * @param {number} [input.limit] - Max results per page.
 * @param {string} input.correlationId - For structured logging.
 * @param {string} [input.requesterCognitoSub] - Cognito sub of the operator.
 * @returns {Promise<object>} { executions: [...], nextToken?: string }
 */
const listExecutions = async (input) => {
  const { correlationId, requesterCognitoSub, region, ...commandInput } = input;
  const command = new ListExecutionsCommand(commandInput);
  const response = await executeCommand({
    action: "ListExecutions",
    command,
    correlationId,
    requesterCognitoSub,
    agentSpaceId: commandInput.agentSpaceId,
    investigationId: commandInput.taskId,
    region,
    retry: true,
  });
  return { executions: response.executions || [], nextToken: response.nextToken };
};

/**
 * Lists journal records (findings) for an execution.
 * Retries on ThrottlingException and InternalServerException.
 *
 * @param {object} input
 * @param {string} input.agentSpaceId - The Agent Space ID (not ARN; URI param).
 * @param {string} input.executionId - The execution whose records to list.
 * @param {string} [input.recordType] - Filter by record type (e.g. "investigation_summary_md").
 * @param {string} [input.nextToken] - Pagination token.
 * @param {number} [input.limit] - Max results per page (1-100, default 100).
 * @param {string} [input.order] - Sort order ("ASC" or "DESC", default "DESC").
 * @param {string} input.correlationId - For structured logging.
 * @param {string} [input.requesterCognitoSub] - Cognito sub of the operator.
 * @returns {Promise<object>} { records: [...], nextToken?: string }
 */
const listJournalRecords = async (input) => {
  const { correlationId, requesterCognitoSub, region, ...commandInput } = input;
  const command = new ListJournalRecordsCommand(commandInput);
  const response = await executeCommand({
    action: "ListJournalRecords",
    command,
    correlationId,
    requesterCognitoSub,
    agentSpaceId: commandInput.agentSpaceId,
    executionId: commandInput.executionId,
    region,
    retry: true,
  });
  return { records: response.records || [], nextToken: response.nextToken };
};

/**
 * Creates an asset in the agent space.
 * Used to attach test artifacts (error logs, result files) to an investigation.
 *
 * @param {object} input
 * @param {string} input.agentSpaceId - The Agent Space ID.
 * @param {string} input.assetType - Asset type identifier (e.g., "dlt-test-artifacts").
 * @param {object} [input.metadata] - Optional metadata document.
 * @param {object} input.content - Asset content (file or zip).
 * @param {string} [input.clientToken] - Idempotency token.
 * @param {string} input.correlationId - For structured logging.
 * @param {string} [input.requesterCognitoSub] - Cognito sub of the operator.
 * @returns {Promise<object>} The created asset object (assetId, version, etc.).
 */
const createAsset = async (input) => {
  const { correlationId, requesterCognitoSub, region, ...commandInput } = input;
  const command = new CreateAssetCommand(commandInput);
  const response = await executeCommand({
    action: "CreateAsset",
    command,
    correlationId,
    requesterCognitoSub,
    region,
    retry: true,
  });
  return response.asset;
};

/**
 * Deletes an asset from the agent space.
 * Used to clean up test-artifact attachments when an investigation fails to be
 * created or is archived/canceled.
 *
 * @param {object} input
 * @param {string} input.agentSpaceId - The Agent Space ID.
 * @param {string} input.assetId - The asset to delete.
 * @param {string} input.correlationId - For structured logging.
 * @param {string} [input.requesterCognitoSub] - Cognito sub of the operator.
 * @returns {Promise<object>} The raw (empty) delete response.
 */
const deleteAsset = async (input) => {
  const { correlationId, requesterCognitoSub, region, ...commandInput } = input;
  const command = new DeleteAssetCommand(commandInput);
  return executeCommand({
    action: "DeleteAsset",
    command,
    correlationId,
    requesterCognitoSub,
    region,
    retry: true,
  });
};

module.exports = {
  getAgentSpace,
  createBacklogTask,
  getBacklogTask,
  updateBacklogTask,
  listExecutions,
  listJournalRecords,
  createAsset,
  deleteAsset,
  // Exported for testing only
  _emitLog: emitLog,
  _executeCommand: executeCommand,
  _client: client,
};
