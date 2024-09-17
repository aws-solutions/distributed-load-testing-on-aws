// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { MetricDataQuery } from "@aws-sdk/client-cloudwatch";
import { StartQueryCommandInput } from "@aws-sdk/client-cloudwatch-logs";
import { QueryDefinitionProps } from "aws-cdk-lib/aws-logs";
// eslint-disable-next-line import/no-unresolved
import { EventBridgeEvent, SQSEvent } from "aws-lambda";
import { IBucket } from "aws-cdk-lib/aws-s3";

export interface QueryProps extends Pick<StartQueryCommandInput, "queryString" | "logGroupNames"> {}
export interface EventBridgeQueryEvent
  extends Pick<EventBridgeEvent<"Scheduled Event", NonNullable<unknown>>, "detail-type" | "time"> {
  "metrics-data-query": MetricDataQuery[];
}

export interface MetricDataProps
  extends Pick<MetricDataQuery, "MetricStat" | "Expression" | "Label" | "ReturnData" | "Period"> {}

export enum ExecutionDay {
  DAILY = "*",
  MONDAY = "MON",
  TUESDAY = "TUE",
  WEDNESDAY = "WED",
  THURSDAY = "THU",
  FRIDAY = "FRI",
  SATURDAY = "SAT",
  SUNDAY = "SUN",
}

export interface SolutionsMetricProps {
  uuid?: string;
  metricDataProps?: MetricDataProps[];
  queryProps?: QueryDefinitionProps[];
  executionDay?: string;
  sourceCodeBucket: IBucket;
  sourceCodePrefix: string;
}

export interface SQSEventBody {
  queryIds: string[];
  endTime: number;
  retry?: number;
}

export interface MetricData {
  [key: string]: number[] | number | string;
}

export interface MetricPayloadData extends MetricData {
  DataStartTime: string;
  DataEndTime: string;
}

export interface MetricPayload {
  Solution: string;
  Version: string;
  UUID: string;
  TimeStamp: string;
  Data: MetricPayloadData;
}

export function isEventBridgeQueryEvent(event: any): event is EventBridgeQueryEvent {
  return "detail-type" in event && "time" in event && "metrics-data-query" in event;
}

export function isSQSEvent(event: any): event is SQSEvent {
  return "Records" in event && Array.isArray(event.Records);
}
