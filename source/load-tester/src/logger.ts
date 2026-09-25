// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Output matches Lambda Powertools field schema for CloudWatch Logs Insights parity:
// {"level":"INFO","message":"start signal received","timestamp":"2026-06-03T20:02:06.759Z","service":"dlt-load-tester-jmeter"}

import { pino, type Logger as PinoLogger, type LoggerOptions } from "pino";

export type Logger = PinoLogger;

export type Level = "debug" | "info" | "warn" | "error";

export interface LoggerInput {
  readonly serviceName: string;
  readonly level?: Level;
}

export function createLogger(input: LoggerInput): Logger {
  const options: LoggerOptions = {
    level: input.level ?? "info",
    messageKey: "message",
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      level: (label: string): Record<string, string> => ({ level: label.toUpperCase() }),
      // Strip pino's default pid/hostname (useless in containers); keep only service.
      bindings: (bindings: Record<string, unknown>): Record<string, unknown> => ({
        service: bindings["service"],
      }),
    },
    base: { service: input.serviceName },
  };
  return pino(options);
}
