// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { loadConfig, type DltConfig } from "./config.js";
import { loadCredentials, toAwsCredentialIdentity } from "./credentials.js";
import type { DltCredentials } from "./credentials.js";
import { ensureValidCredentials } from "./auth/index.js";
import { DltHttpClient } from "./http-client.js";
import type { AwsCredentialIdentity } from "./http-client.js";

/**
 * High-level API client for the DLT REST API.
 *
 * Handles credential loading, refresh, SigV4 signing, response parsing,
 * and consistent error formatting (including 403 session-expiry hints).
 *
 * After creation the resolved {@link config} and {@link credentials} are
 * available so callers that need direct AWS access (e.g. S3) do not have to
 * re-resolve authentication independently.
 */
export class ApiClient {
  private client: DltHttpClient;
  private apiEndpoint: string;
  private _config: DltConfig;
  private _credentials: DltCredentials;

  private constructor(client: DltHttpClient, apiEndpoint: string, config: DltConfig, credentials: DltCredentials) {
    this.client = client;
    this.apiEndpoint = apiEndpoint;
    this._config = config;
    this._credentials = credentials;
  }

  /** The resolved DLT configuration. */
  get config(): DltConfig {
    return this._config;
  }

  /** The resolved (and refreshed) DLT credentials. */
  get credentials(): DltCredentials {
    return this._credentials;
  }

  /** Convenience: AWS region from the resolved config. */
  get region(): string {
    return this._config.region;
  }

  /**
   * AWS credential identity suitable for S3 and other AWS SDK clients.
   * Derived from the already-resolved session credentials.
   */
  get awsCredentialIdentity(): AwsCredentialIdentity {
    return toAwsCredentialIdentity(this._credentials);
  }

  /**
   * Create an authenticated API client.
   * Loads config + credentials from disk and refreshes if needed.
   */
  static async create(): Promise<ApiClient> {
    const config: DltConfig = loadConfig();
    let creds = loadCredentials();
    creds = await ensureValidCredentials(config, creds);

    const client = new DltHttpClient(config.region, {
      accessKeyId: creds.awsAccessKeyId,
      secretAccessKey: creds.awsSecretAccessKey,
      sessionToken: creds.awsSessionToken,
    });

    return new ApiClient(client, config.apiEndpoint, config, creds);
  }

  /**
   * GET a path on the API and return the parsed JSON response.
   */
  async get<T = unknown>(path: string): Promise<T> {
    const resp = await this.client.get(`${this.apiEndpoint}${path}`);
    return this.handleResponse<T>(resp);
  }

  /**
   * POST a JSON body to a path on the API and return the parsed JSON response.
   */
  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const resp = await this.client.post(`${this.apiEndpoint}${path}`, JSON.stringify(body));
    return this.handleResponse<T>(resp);
  }

  private handleResponse<T>(resp: { statusCode: number; body: string }): T {
    if (resp.statusCode !== 200) {
      const hint = resp.statusCode === 403 ? ' Your session may have expired — try running "dlt login" again.' : "";
      throw new Error(`API returned HTTP ${resp.statusCode}: ${resp.body}${hint}`);
    }
    return JSON.parse(resp.body) as T;
  }
}
