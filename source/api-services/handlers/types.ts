// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";

export interface HandlerContext {
  event: APIGatewayProxyEvent;
  context: Context;
  config: unknown;
  userAgent: string | undefined;
}

export type RouteHandler = (ctx: HandlerContext) => Promise<unknown>;

export const createResponse = (data: unknown, statusCode: number): APIGatewayProxyResult => ({
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
  },
  statusCode,
  body: JSON.stringify(data),
});
