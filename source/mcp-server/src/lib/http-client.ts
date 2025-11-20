// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as aws4 from "aws4";
import https from "https";
import { URL } from "url";

export interface HttpClientOptions {
  method: string;
  url: string;
  body?: string | undefined;
  headers?: Record<string, string> | undefined;
}

export interface HttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

/**
 * HTTP client that signs requests with AWS IAM credentials using aws4
 * Automatically uses Lambda execution role credentials from environment
 */
export class IAMHttpClient {
  private region: string;
  private correlationId: string;

  constructor(region: string, correlationId: string) {
    this.region = region;
    this.correlationId = correlationId;
  }

  /**
   * Make an IAM-signed HTTP request
   */
  async request(options: HttpClientOptions): Promise<HttpResponse> {
    try {
      const url = new URL(options.url);
      
      // Prepare request options for aws4 signing
      const requestOptions: aws4.Request = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: options.method,
        service: "execute-api",
        region: this.region,
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-Id": this.correlationId,
          "User-Agent": "dlt-mcp-server",
          ...options.headers,
        },
      };

      // Add body if present
      if (options.body) {
        requestOptions.body = options.body;
      }

      // Sign the request with aws4 (automatically uses Lambda credentials)
      aws4.sign(requestOptions);

      // Execute the signed request
      return new Promise((resolve, reject) => {
        const req = https.request(requestOptions, (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            resolve({
              statusCode: res.statusCode || 500,
              body,
              headers: res.headers as Record<string, string>,
            });
          });
        });

        req.on("error", (error) => {
          reject(new Error(`HTTP request failed: ${error.message}`));
        });

        // Write body if present
        if (options.body) {
          req.write(options.body);
        }

        req.end();
      });
    } catch (error) {
      throw new Error(`Failed to make signed request: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Make a GET request
   */
  async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request({ method: "GET", url, headers });
  }
}
