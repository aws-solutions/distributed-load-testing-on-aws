// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Investigation handlers for the DevOps Agent integration.
 *
 * POST   .../investigations          — Create investigation
 * GET    .../investigations          — List all (including archived)
 * GET    .../investigations/{id}/status   — Poll status
 * GET    .../investigations/{id}/findings — Fetch markdown findings
 * PUT    .../investigations/{id}     — Cancel (auto-archives)
 * DELETE .../investigations/{id}     — Archive (terminal only)
 */

const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { randomUUID } = require("crypto");

const utils = require("solution-utils");
const { createBacklogTask, getBacklogTask, updateBacklogTask, listExecutions, listJournalRecords } = require("../integrations/aidevops");
const { buildDescription } = require("./payload");
const { uploadTestArtifacts, deleteArtifactAsset, cleanupInvestigationAsset, containsSensitiveData } = require("./artifacts");

const options = utils.getOptions({ region: process.env.AWS_REGION });
const dynamoDB = DynamoDBDocument.from(new DynamoDB(options));

const { HISTORY_TABLE, INVESTIGATIONS_TABLE, AGENT_SPACES_TABLE, SCENARIOS_TABLE, CONSOLE_URL } = process.env;

// ─── Constants ─────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "TIMED_OUT", "CANCELED"]);

const KNOWN_STATUSES = new Set([
  "PENDING_TRIAGE", "LINKED", "PENDING_START", "IN_PROGRESS",
  "PENDING_CUSTOMER_APPROVAL", "COMPLETED", "FAILED", "TIMED_OUT", "CANCELED",
]);

const VALID_PRIORITIES = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW", "MINIMAL"]);
const DEFAULT_PRIORITY = "HIGH";

/**
 * Age beyond which an active-investigation lock is considered orphaned and may be
 * reclaimed. Must exceed the maximum plausible create duration so an in-flight
 * create's lock is never reclaimed out from under it. A create cannot outlive the
 * API Lambda (120s timeout), so 4 minutes (2x the timeout) is a safe margin while
 * still letting an orphaned lock self-heal promptly.
 */
const STALE_LOCK_MS = 4 * 60 * 1000;

/** Composite sort-key attribute name on InvestigationsTable. */
const SK_NAME = "testRunId#investigationId";

/**
 * Builds the InvestigationsTable primary key for a single investigation.
 * Centralizes the composite sort-key format so the magic attribute name
 * lives in exactly one place.
 */
const investigationKey = (testId, testRunId, investigationId) => ({
  testId,
  [SK_NAME]: `${testRunId}#${investigationId}`,
});

const { StatusCodes, ErrorException } = require("../constants");

const SDK_ERROR_MAP = {
  ThrottlingException: { code: "THROTTLED", message: "DevOps Agent API rate limit exceeded. Try again shortly.", statusCode: StatusCodes.TOO_MANY_REQUESTS, retryAfter: 10 },
  ContentSizeExceededException: { code: "DESCRIPTION_TOO_LARGE", message: "The investigation description exceeds the 10,000 character limit.", statusCode: StatusCodes.BAD_REQUEST },
  AccessDeniedException: { code: "ACCESS_DENIED", message: "The DLT deployment does not have permission to access the specified Agent Space. Check the IAM policy.", statusCode: StatusCodes.NOT_FOUND },
  ResourceNotFoundException: { code: "AGENT_SPACE_NOT_FOUND_REMOTE", message: "The Agent Space was not found in AWS DevOps Agent. Verify the ARN is correct using Test Connection.", statusCode: StatusCodes.NOT_FOUND },
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds a concise investigation title from the test run data.
 * A failed run (DLT infrastructure could not execute the test) takes precedence
 * over request-level counts, since a failed run can still upload partial results
 * with a 0% request error rate.
 * Format: "<testName> [<runId> <timestamp>] — <failRate>% failed (<totalRequests> req)"
 * Falls back to "<testName> [<runId> <timestamp>] — investigation requested" if no results.
 */
const buildTitle = (testRun) => {
  const name = testRun.testName || testRun.testId;

  // Build a bracketed tag with run ID and start time for easy identification
  // in the DevOps Agent web app.
  let tag = "";
  const parts = [];
  if (testRun.testRunId) parts.push(testRun.testRunId);
  if (testRun.startTime) {
    try {
      const d = new Date(testRun.startTime);
      if (!isNaN(d.getTime())) {
        parts.push(d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC"));
      }
    } catch { /* ignore malformed dates */ }
  }
  if (parts.length > 0) tag = ` [${parts.join(" | ")}]`;

  // A "failed" status means the test run itself did not complete successfully.
  // This overrides the request-level success rate so we never label a failed
  // run "healthy".
  if (testRun.status === "failed") {
    return `${name}${tag} — test run failed`;
  }

  try {
    const results = testRun.results
      ? typeof testRun.results === "string" ? JSON.parse(testRun.results) : testRun.results
      : null;
    const total = results?.total || results;
    const fail = Number(total?.fail) || 0;
    const succ = Number(total?.succ) || 0;
    const totalReqs = fail + succ;

    if (totalReqs > 0) {
      const failRate = Math.round((fail / totalReqs) * 100);
      return failRate === 0
        ? `${name}${tag} — healthy (${totalReqs} req)`
        : `${name}${tag} — ${failRate}% failed (${totalReqs} req)`;
    }
  } catch {
    // Fall through to default
  }
  return `${name}${tag} — investigation requested`;
};

const extractAgentSpaceIdFromArn = (arn) => {
  const parts = arn.split("/");
  return parts[parts.length - 1];
};

const extractRegionFromArn = (arn) => {
  return arn.split(":")[3];
};

/**
 * Best-effort cancellation of a backlog task that was created but never recorded
 * in DLT (the agent has no DeleteBacklogTask, so an orphaned task can only be
 * canceled). Never throws — used to compensate for a failed record write.
 */
const cancelOrphanedTask = async ({ agentSpaceApiId, taskId, region, correlationId, requesterCognitoSub }) => {
  try {
    await updateBacklogTask({ agentSpaceId: agentSpaceApiId, taskId, taskStatus: "CANCELED", region, correlationId, requesterCognitoSub });
    console.log(JSON.stringify({ level: "info", action: "investigations.orphanTaskCanceled", taskId }));
  } catch (err) {
    console.log(JSON.stringify({ level: "error", action: "investigations.orphanTaskCancelFailed", taskId, error: err.message }));
  }
};

/**
 * Maps an SDK error to an ErrorException. Always throws; never returns.
 * @throws {ErrorException}
 */
const throwSdkError = (err) => {
  const mapped = SDK_ERROR_MAP[err.name];
  if (mapped) {
    const error = new ErrorException(mapped.code, mapped.message, mapped.statusCode);
    if (mapped.retryAfter) error.retryAfter = mapped.retryAfter;
    error.cause = err;
    throw error;
  }
  // Server-side agent failures carry no actionable detail for the user, so
  // replace the raw SDK message with a friendly one.
  if (err.$fault === "server" || err.$metadata?.httpStatusCode >= 500) {
    const error = new ErrorException("AIDEVOPS_ERROR", "There was an error sending your investigation to DevOps Agent.", StatusCodes.INTERNAL_SERVER_ERROR);
    error.cause = err;
    throw error;
  }
  const error = new ErrorException("AIDEVOPS_ERROR", `DevOps Agent API error: ${err.message}`, StatusCodes.INTERNAL_SERVER_ERROR);
  error.cause = err;
  throw error;
};

/**
 * Invokes a DevOps Agent SDK call and translates any SDK error into an
 * ErrorException. Returns the call's result on success.
 */
const callAgent = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    throwSdkError(err);
  }
};

/**
 * Retrieves an investigation record from InvestigationsTable.
 */
const getInvestigationRecord = async (testId, testRunId, investigationId) => {
  const { Item } = await dynamoDB.get({
    TableName: INVESTIGATIONS_TABLE,
    Key: investigationKey(testId, testRunId, investigationId),
  });
  if (!Item) {
    throw new ErrorException("INVESTIGATION_NOT_FOUND", `Investigation '${investigationId}' not found.`, StatusCodes.NOT_FOUND);
  }
  return Item;
};

/**
 * Sets archived: true on an investigation record.
 */
const setArchived = async (testId, testRunId, investigationId) => {
  await dynamoDB.update({
    TableName: INVESTIGATIONS_TABLE,
    Key: investigationKey(testId, testRunId, investigationId),
    UpdateExpression: "SET #archived = :true",
    ExpressionAttributeNames: { "#archived": "archived" },
    ExpressionAttributeValues: { ":true": true },
  });
};

/**
 * Per-test-run "active investigation" lock.
 *
 * An investigation record's sort key embeds its unique task id, so a conditional
 * put on the record cannot enforce "at most one active investigation per test
 * run" — every record has a brand-new key. This marker item has a deterministic
 * key (`ACTIVE#<testRunId>`) that does not match the `<testRunId>#` prefix used
 * by listInvestigations / the one-active query, so it stays invisible to them
 * while providing an atomic gate via a conditional put.
 */
const activeLockKey = (testId, testRunId) => ({
  testId,
  [SK_NAME]: `ACTIVE#${testRunId}`,
});

/**
 * Acquires the active lock for a test run. Throws INVESTIGATION_ALREADY_EXISTS
 * if a live lock is held (i.e. an active investigation exists or a create is in
 * flight). A lock older than STALE_LOCK_MS is treated as orphaned (left behind by
 * a failed release or a timed-out create) and reclaimed, so a single failure can
 * never permanently block investigations for a test run.
 */
const acquireActiveLock = async (testId, testRunId) => {
  if (await tryPutLock(testId, testRunId)) return;

  // A lock already exists. Reclaim it only if it is stale; a fresh lock means a
  // concurrent create is in flight (its record is not yet written), so reject.
  const { Item: existing } = await dynamoDB.get({ TableName: INVESTIGATIONS_TABLE, Key: activeLockKey(testId, testRunId) });
  const ageMs = existing?.createdAt ? Date.now() - new Date(existing.createdAt).getTime() : Infinity;

  if (!existing || ageMs < STALE_LOCK_MS) {
    throw alreadyActiveError();
  }

  // Stale lock: delete it (guarded on the same createdAt so a concurrently
  // refreshed lock is never removed), then re-acquire. Any failure here means
  // another request won the reclaim, so treat the run as already active.
  try {
    await dynamoDB.delete({
      TableName: INVESTIGATIONS_TABLE,
      Key: activeLockKey(testId, testRunId),
      ConditionExpression: "#c = :c",
      ExpressionAttributeNames: { "#c": "createdAt" },
      ExpressionAttributeValues: { ":c": existing.createdAt },
    });
    console.log(JSON.stringify({ level: "warn", action: "investigations.staleLockReclaimed", testId, testRunId, lockCreatedAt: existing.createdAt }));
  } catch {
    throw alreadyActiveError();
  }

  if (!(await tryPutLock(testId, testRunId))) {
    throw alreadyActiveError();
  }
};

/**
 * Attempts the conditional put that creates the lock item. Returns true on
 * success, false if the lock already exists. Rethrows any other error.
 */
const tryPutLock = async (testId, testRunId) => {
  try {
    await dynamoDB.put({
      TableName: INVESTIGATIONS_TABLE,
      Item: { ...activeLockKey(testId, testRunId), lock: true, createdAt: new Date().toISOString() },
      ConditionExpression: "attribute_not_exists(testId)",
    });
    return true;
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
};

const alreadyActiveError = () =>
  new ErrorException("INVESTIGATION_ALREADY_EXISTS", "An active investigation already exists for this test run. Archive or cancel it before starting a new one.", StatusCodes.CONFLICT);

/**
 * Releases the active lock. Best-effort — a failure is logged and swallowed so it
 * never masks an in-flight error or breaks an otherwise successful archive/cancel.
 */
const releaseActiveLock = async (testId, testRunId) => {
  try {
    await dynamoDB.delete({ TableName: INVESTIGATIONS_TABLE, Key: activeLockKey(testId, testRunId) });
  } catch (err) {
    console.log(JSON.stringify({ level: "error", action: "investigations.lockReleaseFailed", testId, testRunId, error: err.message }));
  }
};

/**
 * Loads an investigation record and fetches its current backlog task from the
 * DevOps Agent in one step. Shared by the status and cancel handlers, which
 * both need the stored record and the live task state. (Archive does its own
 * load so it can short-circuit on already-archived records without an agent call.)
 *
 * @returns {Promise<{investigation: object, agentSpaceApiId: string, task: object}>}
 */
const loadInvestigationAndTask = async ({ testId, testRunId, investigationId, correlationId, requesterCognitoSub }) => {
  const investigation = await getInvestigationRecord(testId, testRunId, investigationId);
  const agentSpaceApiId = investigation.agentSpaceApiId;
  const region = investigation.agentSpaceRegion;
  const task = await callAgent(() =>
    getBacklogTask({ agentSpaceId: agentSpaceApiId, taskId: investigationId, region, correlationId, requesterCognitoSub }),
  );
  return { investigation, agentSpaceApiId, region, task };
};

// ─── Create ────────────────────────────────────────────────────────────────────

const createInvestigation = async ({ testId, testRunId, body, correlationId, requesterCognitoSub }) => {
  // 1. Look up the test-run record
  const { Item: testRun } = await dynamoDB.get({
    TableName: HISTORY_TABLE,
    Key: { testId, testRunId },
  });

  if (!testRun) {
    throw new ErrorException("TESTRUN_NOT_FOUND", `Test run '${testRunId}' not found for test '${testId}'`, StatusCodes.NOT_FOUND);
  }

  // 2. One-active pre-check (fast reject; also covers any pre-existing active
  //    investigation that predates the active lock). The atomic gate is the lock
  //    acquired in step 6c, just before the first side effect.
  const { Items: activeInvestigations } = await dynamoDB.query({
    TableName: INVESTIGATIONS_TABLE,
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
    FilterExpression: "#archived = :false",
    ExpressionAttributeNames: { "#pk": "testId", "#sk": SK_NAME, "#archived": "archived" },
    ExpressionAttributeValues: { ":pk": testId, ":skPrefix": `${testRunId}#`, ":false": false },
  });

  if (activeInvestigations && activeInvestigations.length > 0) {
    throw new ErrorException("INVESTIGATION_ALREADY_EXISTS", "An active investigation already exists for this test run. Archive or cancel it before starting a new one.", StatusCodes.CONFLICT);
  }

  // 3. Resolve Agent Space server-side
  if (!body.agentSpaceId) {
    throw new ErrorException("MISSING_AGENT_SPACE", "agentSpaceId is required", StatusCodes.BAD_REQUEST);
  }

  const { Item: agentSpace } = await dynamoDB.get({
    TableName: AGENT_SPACES_TABLE,
    Key: { id: body.agentSpaceId },
  });

  if (!agentSpace) {
    throw new ErrorException("AGENT_SPACE_NOT_FOUND", `Agent Space '${body.agentSpaceId}' not found. Configure it on the Agent Integration page.`, StatusCodes.NOT_FOUND);
  }

  const agentSpaceApiId = extractAgentSpaceIdFromArn(agentSpace.agentSpaceArn);
  const agentSpaceRegion = extractRegionFromArn(agentSpace.agentSpaceArn);

  // 4. Check denylist on user-provided context
  if (containsSensitiveData(body.additionalContext)) {
    throw new ErrorException("CONTEXT_CONTAINS_SENSITIVE_DATA", "The additional context contains text that resembles credentials or secrets. Remove sensitive data and try again.", StatusCodes.BAD_REQUEST);
  }

  // 5. Build description (with baseline comparison if a baseline is set)
  const userContext = body.additionalContext ? { additionalContext: body.additionalContext } : undefined;

  let baselineRun = null;
  try {
    const { Item: scenario } = await dynamoDB.get({ TableName: SCENARIOS_TABLE, Key: { testId } });
    if (scenario?.baselineId && scenario.baselineId !== testRunId) {
      const { Item: baselineItem } = await dynamoDB.get({ TableName: HISTORY_TABLE, Key: { testId, testRunId: scenario.baselineId } });
      if (baselineItem) {
        baselineRun = baselineItem;
      }
    }
  } catch (err) {
    // Baseline lookup is non-blocking; degrade to no comparison rather than
    // failing the investigation creation.
    console.log(JSON.stringify({ level: "warn", action: "investigations.baselineLookupFailed", testId, error: err.message }));
  }

  let description = buildDescription(testRun, userContext, CONSOLE_URL, baselineRun);

  // 6. Check denylist on full description
  if (containsSensitiveData(description)) {
    throw new ErrorException("DESCRIPTION_CONTAINS_SENSITIVE_DATA", "The investigation description contains text that resembles credentials or secrets. Remove sensitive data and try again.", StatusCodes.BAD_REQUEST);
  }

  // 6c. Acquire the per-test-run active lock — the atomic gate that prevents two
  // concurrent creates from both producing an active investigation. Acquired here,
  // after all validation, so validation failures never hold the lock. Released on
  // any failure below (so a failed create does not leave the test run locked) and
  // on archive/cancel.
  await acquireActiveLock(testId, testRunId);

  // 6a. Upload test artifacts to the agent space BEFORE creating the task.
  // The task description references the asset ID, and UpdateBacklogTask cannot
  // modify the description after creation — so the upload must happen first.
  // Best-effort: a failure here is non-blocking.
  let artifactResult = null;
  try {
    artifactResult = await uploadTestArtifacts({
      testId,
      testRunId,
      agentSpaceId: agentSpaceApiId,
      region: agentSpaceRegion,
      correlationId,
      requesterCognitoSub,
    });
  } catch (err) {
    console.warn(`Artifact upload failed (non-blocking): ${err.message}`);
  }

  // 6b. If artifacts were uploaded, rebuild the description with the artifact
  // reference included so it counts toward the 10,000-char limit (appending it
  // after the build would push a full description over the agent's cap). The
  // added section is entirely DLT-generated, so the sensitive-data check from
  // step 6 still stands.
  if (artifactResult) {
    description = buildDescription(testRun, userContext, CONSOLE_URL, baselineRun, artifactResult);
  }

  // 7. Call createBacklogTask
  const title = buildTitle(testRun);
  const priority = VALID_PRIORITIES.has(body.priority) ? body.priority : DEFAULT_PRIORITY;
  let taskResult;
  try {
    taskResult = await callAgent(() =>
      createBacklogTask({
        agentSpaceId: agentSpaceApiId,
        title: title.substring(0, 400),
        description,
        taskType: "INVESTIGATION",
        priority,
        clientToken: randomUUID(),
        region: agentSpaceRegion,
        correlationId,
        requesterCognitoSub,
      }),
    );
  } catch (err) {
    // Task creation failed after the artifact was uploaded and the lock was
    // acquired — release the lock and delete the asset so neither is orphaned
    // (best-effort, never masks err).
    await Promise.all([
      releaseActiveLock(testId, testRunId),
      artifactResult
        ? deleteArtifactAsset({
            agentSpaceId: agentSpaceApiId,
            assetId: artifactResult.assetId,
            region: agentSpaceRegion,
            correlationId,
            requesterCognitoSub,
            reason: "task-create-failed",
          })
        : Promise.resolve(),
    ]);
    throw err;
  }

  // 8. Write investigation record (store agentSpaceApiId to avoid lookups on subsequent calls)
  const investigationRecord = {
    ...investigationKey(testId, testRunId, taskResult.taskId),
    executionId: taskResult.executionId,
    agentSpaceId: body.agentSpaceId,
    agentSpaceApiId,
    agentSpaceRegion,
    agentSpaceName: agentSpace.displayName,
    testRunId,
    investigationId: taskResult.taskId,
    createdAt: new Date().toISOString(),
    archived: false,
    ...(artifactResult && { artifactAssetId: artifactResult.assetId }),
  };

  try {
    await dynamoDB.put({
      TableName: INVESTIGATIONS_TABLE,
      Item: investigationRecord,
      ConditionExpression: "attribute_not_exists(testId)",
    });
  } catch (err) {
    // The record write failed after the lock, task, and possibly the asset were
    // created. Release the lock, cancel the orphaned backlog task (it cannot be
    // deleted, only canceled), and delete the asset. All best-effort, run
    // concurrently; none masks the original error.
    await Promise.all([
      releaseActiveLock(testId, testRunId),
      cancelOrphanedTask({ agentSpaceApiId, taskId: taskResult.taskId, region: agentSpaceRegion, correlationId, requesterCognitoSub }),
      artifactResult
        ? deleteArtifactAsset({
            agentSpaceId: agentSpaceApiId,
            assetId: artifactResult.assetId,
            region: agentSpaceRegion,
            correlationId,
            requesterCognitoSub,
            reason: "record-write-failed",
          })
        : Promise.resolve(),
    ]);
    if (err.name === "ConditionalCheckFailedException") {
      throw new ErrorException("INVESTIGATION_ALREADY_EXISTS", "An active investigation was created concurrently. Archive or cancel it before starting a new one.", StatusCodes.CONFLICT);
    }
    throw err;
  }

  // 9. Return
  return {
    investigationId: taskResult.taskId,
    executionId: taskResult.executionId,
    agentSpaceId: body.agentSpaceId,
    agentSpaceName: agentSpace.displayName,
    status: taskResult.status || "PENDING_TRIAGE",
    createdAt: investigationRecord.createdAt,
  };
};

// ─── List ──────────────────────────────────────────────────────────────────────

const listInvestigations = async ({ testId, testRunId }) => {
  const { Items } = await dynamoDB.query({
    TableName: INVESTIGATIONS_TABLE,
    KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skPrefix)",
    ExpressionAttributeNames: { "#pk": "testId", "#sk": SK_NAME },
    ExpressionAttributeValues: { ":pk": testId, ":skPrefix": `${testRunId}#` },
    ScanIndexForward: false,
  });
  return Items || [];
};

// ─── Status ────────────────────────────────────────────────────────────────────

const getInvestigationStatus = async ({ testId, testRunId, investigationId, correlationId, requesterCognitoSub }) => {
  const { investigation, agentSpaceApiId, task } = await loadInvestigationAndTask({
    testId, testRunId, investigationId, correlationId, requesterCognitoSub,
  });

  // Warn on mismatch
  if (task.agentSpaceId && task.agentSpaceId !== agentSpaceApiId) {
    console.warn(JSON.stringify({ level: "warn", action: "investigations.status.agentSpaceMismatch", expected: agentSpaceApiId, received: task.agentSpaceId, investigationId }));
  }

  // Warn on unknown status
  if (task.status && !KNOWN_STATUSES.has(task.status)) {
    console.warn(JSON.stringify({ level: "warn", action: "investigations.status.unknownStatus", status: task.status, investigationId }));
  }

  const result = {
    investigationId,
    status: task.status,
    statusReason: task.statusReason || null,
    createdAt: investigation.createdAt,
    agentSpaceName: investigation.agentSpaceName,
  };

  // Mitigation detection removed — DLT UI does not track agent follow-up
  // actions. Users view mitigation and other agent actions directly in the
  // DevOps Agent console.

  return result;
};

// ─── Findings ────────────────────────────────────────────────────────

const getInvestigationFindings = async ({ testId, testRunId, investigationId, type, format, correlationId, requesterCognitoSub }) => {
  const investigation = await getInvestigationRecord(testId, testRunId, investigationId);
  const agentSpaceApiId = investigation.agentSpaceApiId;
  const region = investigation.agentSpaceRegion;

  let executionId = investigation.executionId;

  if (type === "mitigation") {
    const { executions } = await callAgent(() =>
      listExecutions({ agentSpaceId: agentSpaceApiId, taskId: investigationId, region, correlationId, requesterCognitoSub }),
    );
    const mitigationExec = executions.find((e) => e.agentType === "mitigation");
    if (!mitigationExec) {
      throw new ErrorException("MITIGATION_NOT_FOUND", "No mitigation execution exists for this investigation.", StatusCodes.NOT_FOUND);
    }
    executionId = mitigationExec.executionId;
  }

  // Determine which record type to fetch based on type + format
  let recordType;
  if (type === "mitigation") {
    recordType = format === "structured" ? "mitigation_summary" : "mitigation_summary_md";
  } else {
    recordType = format === "structured" ? "investigation_summary" : "investigation_summary_md";
  }

  let records;
  const response = await callAgent(() =>
    listJournalRecords({ agentSpaceId: agentSpaceApiId, executionId, recordType, region, correlationId, requesterCognitoSub }),
  );
  records = response.records;

  // Fallback: fetch all types if typed query is empty
  if (!records || records.length === 0) {
    const fallback = await callAgent(() =>
      listJournalRecords({ agentSpaceId: agentSpaceApiId, executionId, recordType: "", region, correlationId, requesterCognitoSub }),
    );
    records = fallback.records;
  }

  if (!records || records.length === 0) {
    return { findings: null, recordType: null };
  }

  const sorted = [...records].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const record = sorted[0];

  return {
    findings: record.content,
    recordType: record.recordType || recordType,
    recordId: record.recordId,
    createdAt: record.createdAt,
  };
};

// ─── Cancel ────────────────────────────────────────────────────────────────────

const cancelInvestigation = async ({ testId, testRunId, investigationId, body, correlationId, requesterCognitoSub }) => {
  if (!body || body.action !== "cancel") {
    throw new ErrorException("INVALID_ACTION", 'Request body must be { "action": "cancel" }.', StatusCodes.BAD_REQUEST);
  }

  const { investigation, agentSpaceApiId, region, task } = await loadInvestigationAndTask({
    testId, testRunId, investigationId, correlationId, requesterCognitoSub,
  });

  if (TERMINAL_STATUSES.has(task.status)) {
    if (task.status === "CANCELED") {
      await setArchived(testId, testRunId, investigationId);
      await cleanupInvestigationAsset(investigation, correlationId, requesterCognitoSub, "cancel");
      await releaseActiveLock(testId, testRunId);
      return { investigationId, status: "CANCELED", archived: true };
    }
    throw new ErrorException("ALREADY_TERMINAL", `Investigation is already in terminal state '${task.status}'. Use DELETE to archive.`, StatusCodes.CONFLICT);
  }

  await callAgent(() =>
    updateBacklogTask({ agentSpaceId: agentSpaceApiId, taskId: investigationId, taskStatus: "CANCELED", region, correlationId, requesterCognitoSub }),
  );

  await setArchived(testId, testRunId, investigationId);
  await cleanupInvestigationAsset(investigation, correlationId, requesterCognitoSub, "cancel");
  await releaseActiveLock(testId, testRunId);
  return { investigationId, status: "CANCELED", archived: true };
};

// ─── Archive ───────────────────────────────────────────────────────────────────

const archiveInvestigation = async ({ testId, testRunId, investigationId, correlationId, requesterCognitoSub }) => {
  const investigation = await getInvestigationRecord(testId, testRunId, investigationId);

  if (investigation.archived) {
    return { investigationId, archived: true };
  }

  const agentSpaceApiId = investigation.agentSpaceApiId;
  const region = investigation.agentSpaceRegion;

  const task = await callAgent(() =>
    getBacklogTask({ agentSpaceId: agentSpaceApiId, taskId: investigationId, region, correlationId, requesterCognitoSub }),
  );

  if (!TERMINAL_STATUSES.has(task.status)) {
    throw new ErrorException("NOT_TERMINAL", `Investigation is in state '${task.status}'. Cancel it first before archiving.`, StatusCodes.CONFLICT);
  }

  await setArchived(testId, testRunId, investigationId);
  await cleanupInvestigationAsset(investigation, correlationId, requesterCognitoSub, "archive");
  await releaseActiveLock(testId, testRunId);
  return { investigationId, archived: true };
};

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  createInvestigation,
  listInvestigations,
  getInvestigationStatus,
  getInvestigationFindings,
  cancelInvestigation,
  archiveInvestigation,
  // Exported for unit tests
  extractAgentSpaceIdFromArn,
  TERMINAL_STATUSES,
};
