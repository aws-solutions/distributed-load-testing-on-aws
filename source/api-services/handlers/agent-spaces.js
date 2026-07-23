// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const agentSpaces = require("../lib/agent-spaces/");
const utils = require("solution-utils");

const handleAgentSpaces = async (method, resource, errorMsg, config, userAgent) => {
  switch (method) {
    case "GET":
      try {
        await utils.sendMetric({ Type: "ListAgentSpaces", UserAgent: userAgent });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return agentSpaces.listAgentSpaces();
    case "POST":
      try {
        await utils.sendMetric({ Type: "RegisterAgentSpace", UserAgent: userAgent });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return agentSpaces.registerAgentSpace(config);
    default:
      throw errorMsg;
  }
};

const handleAgentSpaceWithId = async (method, resource, errorMsg, id, config, userAgent) => {
  switch (method) {
    case "PUT":
      try {
        await utils.sendMetric({ Type: "UpdateAgentSpace", AgentSpaceId: id, UserAgent: userAgent });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return agentSpaces.updateAgentSpace(id, config);
    case "DELETE":
      try {
        await utils.sendMetric({ Type: "DeregisterAgentSpace", AgentSpaceId: id, UserAgent: userAgent });
      } catch (err) {
        console.error("Failed to send metric:", err);
      }
      return agentSpaces.deregisterAgentSpace(id);
    default:
      throw errorMsg;
  }
};

const handleAgentSpaceTestConnection = async (method, resource, errorMsg, config, userAgent, correlationId) => {
  if (method === "POST") {
    try {
      await utils.sendMetric({ Type: "TestAgentSpaceConnection", UserAgent: userAgent });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return agentSpaces.testConnection(config, correlationId);
  }
  throw errorMsg;
};

module.exports = { handleAgentSpaces, handleAgentSpaceWithId, handleAgentSpaceTestConnection };
