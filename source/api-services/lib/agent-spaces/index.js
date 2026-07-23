// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const crypto = require("crypto");
const utils = require("solution-utils");
const { getAgentSpace } = require("../integrations/aidevops/client");
const { ErrorException, StatusCodes } = require("../constants");

const options = utils.getOptions({ region: process.env.AWS_REGION });
const dynamoDB = DynamoDBDocument.from(new DynamoDB(options));

const { AGENT_SPACES_TABLE, AWS_ACCOUNT_ID } = process.env;

const ARN_REGEX = /^arn:aws:aidevops:[a-z0-9-]+:\d{12}:agentspace\/[a-zA-Z0-9-]{1,64}$/;

const validateArn = (arn) => {
  if (!ARN_REGEX.test(arn)) {
    throw new ErrorException(
      "INVALID_ARN",
      "agentSpaceArn must match format: arn:aws:aidevops:<region>:<account-id>:agentspace/<name>",
      StatusCodes.BAD_REQUEST
    );
  }

  const arnParts = arn.split(":");
  const arnAccount = arnParts[4];
  if (arnAccount !== AWS_ACCOUNT_ID) {
    throw new ErrorException(
      "CROSS_ACCOUNT_ARN",
      "agentSpaceArn must belong to the same AWS account as this deployment",
      StatusCodes.BAD_REQUEST
    );
  }
};

const listAgentSpaces = async () => {
  const items = [];
  let lastKey;

  do {
    const result = await dynamoDB.scan({
      TableName: AGENT_SPACES_TABLE,
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    });
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
};

const registerAgentSpace = async (body) => {
  const { displayName, agentSpaceArn } = body;

  if (!displayName || typeof displayName !== "string" || displayName.trim().length === 0) {
    throw new ErrorException("INVALID_INPUT", "displayName is required and must be a non-empty string");
  }
  if (displayName.length > 64) {
    throw new ErrorException("INVALID_INPUT", "displayName must be 64 characters or fewer");
  }
  if (!agentSpaceArn || typeof agentSpaceArn !== "string") {
    throw new ErrorException("INVALID_INPUT", "agentSpaceArn is required");
  }

  validateArn(agentSpaceArn);

  const existingSpaces = await listAgentSpaces();
  if (existingSpaces.some((s) => s.agentSpaceArn === agentSpaceArn)) {
    throw new ErrorException(
      "DUPLICATE_ARN",
      "An Agent Space with this ARN is already registered",
      StatusCodes.CONFLICT
    );
  }

  const now = new Date().toISOString();
  const agentSpaceResourceId = agentSpaceArn.split("/").pop();
  const item = {
    id: crypto.randomUUID(),
    displayName: displayName.trim(),
    agentSpaceArn,
    agentSpaceResourceId,
    createdAt: now,
    updatedAt: now,
  };

  await dynamoDB.put({ TableName: AGENT_SPACES_TABLE, Item: item });

  console.log(JSON.stringify({
    level: "info",
    action: "agentSpaces.register",
    agentSpaceId: item.id,
    outcome: "success",
  }));

  return item;
};

const updateAgentSpace = async (id, body) => {
  const { displayName, agentSpaceArn } = body;

  if (!displayName) {
    throw new ErrorException("INVALID_INPUT", "displayName is required");
  }

  if (typeof displayName !== "string" || displayName.trim().length === 0) {
    throw new ErrorException("INVALID_INPUT", "displayName must be a non-empty string");
  }
  if (displayName.length > 64) {
    throw new ErrorException("INVALID_INPUT", "displayName must be 64 characters or fewer");
  }

  const existing = await dynamoDB.get({ TableName: AGENT_SPACES_TABLE, Key: { id } });
  if (!existing.Item) {
    throw new ErrorException("NOT_FOUND", `Agent Space '${id}' not found`, StatusCodes.NOT_FOUND);
  }

  const now = new Date().toISOString();
  const updateExprParts = ["#updatedAt = :updatedAt", "#displayName = :displayName"];
  const exprAttrNames = { "#updatedAt": "updatedAt", "#displayName": "displayName" };
  const exprAttrValues = { ":updatedAt": now, ":displayName": displayName.trim() };

  if (agentSpaceArn) {
    updateExprParts.push("#agentSpaceArn = :agentSpaceArn");
    exprAttrNames["#agentSpaceArn"] = "agentSpaceArn";
    exprAttrValues[":agentSpaceArn"] = agentSpaceArn;
    updateExprParts.push("#agentSpaceResourceId = :agentSpaceResourceId");
    exprAttrNames["#agentSpaceResourceId"] = "agentSpaceResourceId";
    exprAttrValues[":agentSpaceResourceId"] = agentSpaceArn.split("/").pop();
    updateExprParts.push("#connectionVerifiedArn = :emptyArn");
    exprAttrNames["#connectionVerifiedArn"] = "connectionVerifiedArn";
    exprAttrValues[":emptyArn"] = null;
  }

  const result = await dynamoDB.update({
    TableName: AGENT_SPACES_TABLE,
    Key: { id },
    UpdateExpression: `SET ${updateExprParts.join(", ")}`,
    ExpressionAttributeNames: exprAttrNames,
    ExpressionAttributeValues: exprAttrValues,
    ReturnValues: "ALL_NEW",
  });

  console.log(JSON.stringify({
    level: "info",
    action: "agentSpaces.update",
    agentSpaceId: id,
    outcome: "success",
  }));

  return result.Attributes;
};

const deregisterAgentSpace = async (id) => {
  const existing = await dynamoDB.get({ TableName: AGENT_SPACES_TABLE, Key: { id } });
  if (!existing.Item) {
    throw new ErrorException("NOT_FOUND", `Agent Space '${id}' not found`, StatusCodes.NOT_FOUND);
  }

  await dynamoDB.delete({ TableName: AGENT_SPACES_TABLE, Key: { id } });

  console.log(JSON.stringify({
    level: "info",
    action: "agentSpaces.deregister",
    agentSpaceId: id,
    outcome: "success",
  }));

  return { message: "Agent Space removed" };
};

const testConnectionForArn = async (arn, correlationId) => {
  const agentSpaceId = arn.split("/").pop();
  const region = arn.split(":")[3];

  try {
    await getAgentSpace({ agentSpaceId, region, correlationId });
    return { status: "connected" };
  } catch (error) {
    return {
      status: "error",
      message: error.name === "ResourceNotFoundException"
        ? "Agent Space not found — verify the ARN is correct"
        : error.name === "AccessDeniedException"
          ? "Access denied — verify IAM permissions and resource tags"
          : `Connection failed: ${error.message}`,
    };
  }
};

const CONCURRENCY_LIMIT = 8;

const withConcurrencyLimit = async (items, fn) => {
  const results = [];
  for (let i = 0; i < items.length; i += CONCURRENCY_LIMIT) {
    const batch = items.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
};

const persistVerification = async (id, agentSpaceArn, now) => {
  await dynamoDB.update({
    TableName: AGENT_SPACES_TABLE,
    Key: { id },
    UpdateExpression: "SET #cv = :cv, #cva = :cva",
    ExpressionAttributeNames: {
      "#cv": "connectionVerifiedAt",
      "#cva": "connectionVerifiedArn",
    },
    ExpressionAttributeValues: {
      ":cv": now,
      ":cva": agentSpaceArn,
    },
  });
};

const testConnection = async (body, correlationId) => {
  const { agentSpaceArns, agentSpaceIds } = body || {};

  if (!agentSpaceArns && !agentSpaceIds) {
    throw new ErrorException(
      "INVALID_INPUT",
      "At least one of agentSpaceArns or agentSpaceIds is required"
    );
  }

  const targets = [];

  // Resolve IDs via BatchGetItem (single round-trip, up to 100 keys)
  if (agentSpaceIds && Array.isArray(agentSpaceIds)) {
    const keys = agentSpaceIds.map((id) => ({ id }));
    const { Responses } = await dynamoDB.batchGet({
      RequestItems: { [AGENT_SPACES_TABLE]: { Keys: keys } },
    });
    const found = new Map((Responses[AGENT_SPACES_TABLE] || []).map((item) => [item.id, item]));

    for (const id of agentSpaceIds) {
      const item = found.get(id);
      if (!item) {
        targets.push({ id, agentSpaceArn: null, status: "error", message: "Agent Space not found" });
      } else {
        targets.push({ id, agentSpaceArn: item.agentSpaceArn });
      }
    }
  }

  if (agentSpaceArns && Array.isArray(agentSpaceArns)) {
    for (const arn of agentSpaceArns) {
      validateArn(arn);
      targets.push({ id: null, agentSpaceArn: arn });
    }
  }

  const now = new Date().toISOString();

  // Bounded concurrent test calls
  const results = await withConcurrencyLimit(targets, async (target) => {
    if (target.status === "error") return target;

    const result = await testConnectionForArn(target.agentSpaceArn, correlationId);

    if (result.status === "connected" && target.id) {
      await persistVerification(target.id, target.agentSpaceArn, now);
    }

    console.log(JSON.stringify({
      level: result.status === "connected" ? "info" : "error",
      action: "agentSpaces.testConnection",
      agentSpaceArn: target.agentSpaceArn,
      outcome: result.status === "connected" ? "success" : "failure",
    }));

    return {
      id: target.id,
      agentSpaceArn: target.agentSpaceArn,
      status: result.status,
      ...(result.message && { message: result.message }),
      ...(result.status === "connected" && { verifiedAt: now }),
    };
  });

  return results;
};

module.exports = {
  listAgentSpaces,
  registerAgentSpace,
  updateAgentSpace,
  deregisterAgentSpace,
  testConnection,
};
