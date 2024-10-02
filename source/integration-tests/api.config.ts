// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export interface ApiConfig {
  readonly apiUrl: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken: string;
  readonly region: string;
  readonly s3ScenarioBucket: string;
}

/**
 * Load the config from the environment
 *
 * @returns {ApiConfig} - environment config
 */
export function load(): ApiConfig {
  return {
    apiUrl: process.env.API_URL,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN,
    region: process.env.AWS_REGION,
    s3ScenarioBucket: process.env.S3_SCENARIO_BUCKET,
  };
}
