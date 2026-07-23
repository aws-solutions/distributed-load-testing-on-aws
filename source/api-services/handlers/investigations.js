// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const investigations = require("../lib/investigations/");
const utils = require("solution-utils");

const handleInvestigations = async (method, resource, errorMsg, testId, testRunId, config, correlationId, requesterCognitoSub) => {
  if (method === "POST") {
    const data = await investigations.createInvestigation({
      testId,
      testRunId,
      body: config,
      correlationId,
      requesterCognitoSub,
    });
    try {
      await utils.sendMetric({ Type: "CreateInvestigation", TestId: testId, TestRunId: testRunId });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return { data, statusCode: 201 };
  }
  if (method === "GET") {
    const data = await investigations.listInvestigations({ testId, testRunId });
    try {
      await utils.sendMetric({ Type: "ListInvestigations", TestId: testId, TestRunId: testRunId });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return { data };
  }
  throw errorMsg;
};

const handleInvestigationWithId = async (method, resource, errorMsg, testId, testRunId, investigationId, config, correlationId, requesterCognitoSub) => {
  if (method === "PUT") {
    const data = await investigations.cancelInvestigation({
      testId,
      testRunId,
      investigationId,
      body: config,
      correlationId,
      requesterCognitoSub,
    });
    try {
      await utils.sendMetric({ Type: "CancelInvestigation", TestId: testId, TestRunId: testRunId, InvestigationId: investigationId });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return { data };
  }
  if (method === "DELETE") {
    const data = await investigations.archiveInvestigation({
      testId,
      testRunId,
      investigationId,
      correlationId,
      requesterCognitoSub,
    });
    try {
      await utils.sendMetric({ Type: "ArchiveInvestigation", TestId: testId, TestRunId: testRunId, InvestigationId: investigationId });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return { data };
  }
  throw errorMsg;
};

const handleInvestigationStatus = async (method, resource, errorMsg, testId, testRunId, investigationId, correlationId, requesterCognitoSub) => {
  if (method === "GET") {
    const data = await investigations.getInvestigationStatus({
      testId,
      testRunId,
      investigationId,
      correlationId,
      requesterCognitoSub,
    });
    try {
      await utils.sendMetric({ Type: "GetInvestigationStatus", TestId: testId, TestRunId: testRunId, InvestigationId: investigationId });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return { data };
  }
  throw errorMsg;
};

const handleInvestigationFindings = async (method, resource, errorMsg, testId, testRunId, investigationId, type, format, correlationId, requesterCognitoSub) => {
  if (method === "GET") {
    const data = await investigations.getInvestigationFindings({
      testId,
      testRunId,
      investigationId,
      type,
      format,
      correlationId,
      requesterCognitoSub,
    });
    try {
      await utils.sendMetric({ Type: "GetInvestigationFindings", TestId: testId, TestRunId: testRunId, InvestigationId: investigationId });
    } catch (err) {
      console.error("Failed to send metric:", err);
    }
    return { data };
  }
  throw errorMsg;
};

module.exports = { handleInvestigations, handleInvestigationWithId, handleInvestigationStatus, handleInvestigationFindings };
