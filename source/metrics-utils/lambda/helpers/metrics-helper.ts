// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import {
  GetMetricDataCommand,
  GetMetricDataCommandInput,
  GetMetricDataCommandOutput,
  MetricDataQuery,
} from "@aws-sdk/client-cloudwatch";
import { SendMessageCommand, SendMessageCommandOutput } from "@aws-sdk/client-sqs";
import {
  DescribeQueryDefinitionsCommand,
  DescribeQueryDefinitionsCommandInput,
  GetQueryResultsCommand,
  GetQueryResultsCommandOutput,
  ResultField,
  StartQueryCommand,
  StartQueryCommandInput,
  QueryDefinition,
} from "@aws-sdk/client-cloudwatch-logs";
import { EventBridgeQueryEvent, MetricPayload, MetricData, QueryProps, SQSEventBody, ExecutionDay } from "./types";
// eslint-disable-next-line import/no-unresolved
import { SQSEvent } from "aws-lambda";
import { ClientHelper } from "./client-helper";
import axios, { RawAxiosRequestConfig } from "axios";

const METRICS_ENDPOINT = "https://metrics.awssolutionsbuilder.com/generic";
const RETRY_LIMIT = 3;
const { EXECUTION_DAY } = process.env;

export class MetricsHelper {
  private clientHelper: ClientHelper;

  constructor() {
    this.clientHelper = new ClientHelper();
  }

  async getMetricsData(event: EventBridgeQueryEvent): Promise<MetricData> {
    const metricsDataProps: MetricDataQuery[] = event["metrics-data-query"];
    const endTime = new Date(event.time);
    const input: GetMetricDataCommandInput = {
      MetricDataQueries: metricsDataProps,
      StartTime: new Date(endTime.getTime() - (EXECUTION_DAY === ExecutionDay.DAILY ? 1 : 7) * 86400 * 1000), // 7 or 1 day(s) previous
      EndTime: endTime,
    };
    return await this.fetchMetricsData(input);
  }

  private async fetchMetricsData(input: GetMetricDataCommandInput): Promise<MetricData> {
    let command = new GetMetricDataCommand(input);
    let response: GetMetricDataCommandOutput;
    const results: MetricData = {};
    do {
      response = await this.clientHelper.getCwClient().send(command);
      console.info(response);

      input.MetricDataQueries?.forEach((item, index) => {
        const key = `${item.MetricStat?.Metric?.Namespace}/${item.MetricStat?.Metric?.MetricName}`;
        const value: number[] = response.MetricDataResults?.[index].Values || [];
        results[key] = ((results[key] as number[]) || []).concat(...value);
      });

      command = new GetMetricDataCommand({ ...input, NextToken: response.NextToken });
    } while (response.NextToken);

    return results;
  }

  processQueryResults(resolvedQueries: (ResultField | undefined)[], body: SQSEventBody): MetricData {
    const failedQueries: string[] = [];
    const metricsData: MetricData = {};
    resolvedQueries.forEach((data, index) => {
      if (data === undefined) {
        failedQueries.push(body.queryIds[index]);
        return;
      }
      metricsData[data.field!] = parseInt(data.value!, 10);
    });
    console.debug("Query data: ", JSON.stringify(metricsData, null, 2));

    if (failedQueries.length > 0) {
      const { retry = 0 } = body;
      if (retry < RETRY_LIMIT) {
        body.retry = retry + 1;
        body.queryIds = failedQueries;
        console.debug(`Retrying query resolver. Retry #${retry + 1}`);
        this.sendSQS(body);
      } else {
        console.debug("Retries exceeded. Aborting");
      }
    }
    return metricsData;
  }

  async getQueryDefinitions(queryPrefix: string): Promise<QueryDefinition[]> {
    const input: DescribeQueryDefinitionsCommandInput = {
      queryDefinitionNamePrefix: queryPrefix,
    };
    const command = new DescribeQueryDefinitionsCommand(input);
    const response = await this.clientHelper.getCwLogsClient().send(command);

    if (!response.queryDefinitions) {
      return [];
    }
    return response.queryDefinitions;
  }

  async startQueries(event: EventBridgeQueryEvent): Promise<SendMessageCommandOutput> {
    const queryDefinitions = await this.getQueryDefinitions(process.env.QUERY_PREFIX as string);
    const endTime = new Date(event.time);
    const queryIds = await Promise.all(
      queryDefinitions?.map((queryDefinition) => this.startQuery(queryDefinition as QueryProps, endTime))
    );
    return await this.sendSQS({ queryIds, endTime: endTime.getTime() });
  }

  async sendSQS(sqsBody: SQSEventBody): Promise<SendMessageCommandOutput> {
    const command = new SendMessageCommand({
      MessageBody: JSON.stringify(sqsBody),
      QueueUrl: process.env.SQS_QUEUE_URL,
    });
    return await this.clientHelper.getSqsClient().send(command);
  }

  async startQuery(queryProp: QueryProps, endTime: Date): Promise<string> {
    const input: StartQueryCommandInput = {
      startTime: endTime.getTime() - (EXECUTION_DAY === ExecutionDay.DAILY ? 1 : 7) * 86400 * 1000,
      endTime: endTime.getTime(),
      ...queryProp,
    };

    const command = new StartQueryCommand(input);
    const response = await this.clientHelper.getCwLogsClient().send(command);
    if (response.queryId) {
      return response.queryId;
    }
    return "";
  }

  async resolveQuery(queryId: string): Promise<ResultField[] | undefined> {
    const command = new GetQueryResultsCommand({ queryId });
    const response: GetQueryResultsCommandOutput = await this.clientHelper.getCwLogsClient().send(command);
    console.debug(`Query response: ${JSON.stringify(response)}`);
    if (response.status === "Running") {
      console.debug(`Query is still running. QueryID: ${queryId}`);
      return undefined;
    }
    return (
      response.results?.[0] ||
      (() => {
        console.debug(`Query contains no results. QueryID: ${queryId}`);
        return [];
      })()
    );
  }

  async resolveQueries(event: SQSEvent): Promise<(ResultField | undefined)[]> {
    const requestBody = JSON.parse(event.Records[0].body);
    const queryIds = requestBody.queryIds;
    if (Object.keys(queryIds).length <= 0) return [];
    return (await Promise.all(queryIds.map((queryId: string) => this.resolveQuery(queryId)))).flat();
  }

  async sendAnonymousMetric(
    results: MetricData,
    startTime: Date,
    endTime: Date
  ): Promise<{ Message: string; Data?: MetricPayload }> {
    const result: { Message: string; Data?: MetricPayload } = {
      Message: "",
    };

    try {
      const { SOLUTION_ID, SOLUTION_VERSION, UUID } = process.env;
      const payload: MetricPayload = {
        Solution: SOLUTION_ID as string,
        Version: SOLUTION_VERSION as string,
        UUID: UUID as string,
        TimeStamp: new Date().toISOString().replace("T", " ").replace("Z", ""),
        Data: {
          DataStartTime: startTime.toISOString().replace("T", " ").replace("Z", ""),
          DataEndTime: endTime.toISOString().replace("T", " ").replace("Z", ""),
          ...results,
        },
      };

      result.Data = payload;

      const payloadStr = JSON.stringify(payload);

      const config: RawAxiosRequestConfig = {
        headers: {
          "content-type": "application/json",
          "content-length": payloadStr.length,
        },
      };

      console.info("Sending anonymous metric", payloadStr);
      await axios.post(METRICS_ENDPOINT, payloadStr, config);

      result.Message = "Anonymous data was sent successfully.";
    } catch (err) {
      console.error("Error sending anonymous metric");
      console.error(err);

      result.Message = "Anonymous data sending failed.";
    }

    return result;
  }
}
