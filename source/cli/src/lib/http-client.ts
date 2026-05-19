// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import https from "node:https";
import os from "node:os";
import { URL } from "node:url";
import aws4 from "aws4";
import { VERSION } from "../generated-version.js";

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface AwsCredentialIdentity {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

export class DltHttpClient {
  private region: string;
  private credentials: AwsCredentialIdentity;

  constructor(region: string, credentials: AwsCredentialIdentity) {
    this.region = region;
    this.credentials = credentials;
  }

  async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request({ url, method: "GET", headers });
  }

  async post(url: string, body: string, headers?: Record<string, string>): Promise<HttpResponse> {
    return this.request({ url, method: "POST", body, headers });
  }

  async request(options: {
    url: string;
    method?: string | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
  }): Promise<HttpResponse> {
    const parsed = new URL(options.url);
    const method = options.method ?? "GET";

    const sigOptions: aws4.Request = {
      host: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      service: "execute-api",
      region: this.region,
      headers: {
        host: parsed.hostname,
        "User-Agent": `dlt-cli/${VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
        ...options.headers,
      },
    };

    if (options.body) {
      sigOptions.body = options.body;
      sigOptions.headers = {
        ...sigOptions.headers,
        "Content-Type": "application/json",
      };
    }

    const signed = aws4.sign(sigOptions, {
      accessKeyId: this.credentials.accessKeyId,
      secretAccessKey: this.credentials.secretAccessKey,
      sessionToken: this.credentials.sessionToken,
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method,
          port: parsed.port || 443,
          headers: signed.headers,
        },
        (res) => {
          collectResponse(res).then(resolve, reject);
        }
      );
      req.on("error", reject);
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }
}

// ---------------------------------------------------------------------------
// Unsigned HTTPS helpers (for Cognito token endpoints, etc.)
// ---------------------------------------------------------------------------

/**
 * Perform an unsigned HTTPS POST with form-encoded body.
 * Used for OAuth token exchanges where SigV4 is not needed.
 */
export function httpsPostForm(url: string, formBody: string): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "POST",
        port: parsed.port || 443,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(formBody),
        },
      },
      (res) => {
        collectResponse(res).then(resolve, reject);
      }
    );
    req.on("error", reject);
    req.write(formBody);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Shared response collector
// ---------------------------------------------------------------------------

function collectResponse(res: import("node:http").IncomingMessage): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let body = "";
    res.on("error", reject);
    res.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    res.on("end", () => {
      resolve({
        statusCode: res.statusCode ?? 0,
        headers: res.headers as Record<string, string | string[] | undefined>,
        body,
      });
    });
  });
}
