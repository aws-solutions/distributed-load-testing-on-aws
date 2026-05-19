// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-cloudfront", () => ({
  CloudFrontClient: jest.fn(() => ({ send: mockSend })),
  GetResponseHeadersPolicyCommand: jest.fn((input) => ({ ...input, _command: "Get" })),
  UpdateResponseHeadersPolicyCommand: jest.fn((input) => ({ ...input, _command: "Update" })),
}));

jest.mock("solution-utils", () => ({
  getOptions: jest.fn(() => ({})),
}));

const { updateCsp } = require("./index.js");

const POLICY_ID = "test-policy-id";
const COGNITO_DOMAIN = "dlt-abc123.auth.us-east-1.amazoncognito.com";
const COGNITO_ORIGIN = `https://${COGNITO_DOMAIN}`;

const BASE_CSP = [
  "default-src 'self' https://*.amazonaws.com; upgrade-insecure-requests;",
  "script-src 'self' https://*.amazonaws.com;",
  "style-src 'self' 'unsafe-inline' https://*.amazonaws.com;",
  "img-src 'self' data: https://*.amazonaws.com;",
  "font-src 'self' data:;",
  "connect-src 'self' https://*.amazonaws.com wss://*.amazonaws.com https://metrics.awssolutionsbuilder.com;",
  "frame-src 'self' https://*.amazonaws.com;",
  "frame-ancestors 'self' https://*.amazonaws.com;",
  "object-src 'none';",
  "base-uri 'self';",
  "form-action 'self' https://*.amazonaws.com;",
].join(" ");

const buildGetResponse = (csp, extraSecurityHeaders = {}) => ({
  ETag: "test-etag",
  ResponseHeadersPolicy: {
    ResponseHeadersPolicyConfig: {
      Name: "test-policy",
      SecurityHeadersConfig: {
        ContentSecurityPolicy: {
          ContentSecurityPolicy: csp,
          Override: true,
        },
        ...extraSecurityHeaders,
      },
    },
  },
});

const config = {
  ResponseHeadersPolicyId: POLICY_ID,
  CognitoDomain: COGNITO_DOMAIN,
};

describe("#CloudFrontCsp", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("should add Cognito domain to target directives only", async () => {
    mockSend
      .mockResolvedValueOnce(buildGetResponse(BASE_CSP))
      .mockResolvedValueOnce({});

    await updateCsp(config);

    expect(mockSend).toHaveBeenCalledTimes(2);
    const updateCall = mockSend.mock.calls[1][0];
    expect(updateCall.IfMatch).toEqual("test-etag");
    expect(updateCall.Id).toEqual(POLICY_ID);

    const updatedCsp = updateCall.ResponseHeadersPolicyConfig.SecurityHeadersConfig
      .ContentSecurityPolicy.ContentSecurityPolicy;

    // Target directives should have the Cognito origin
    expect(updatedCsp).toContain(`default-src 'self' https://*.amazonaws.com ${COGNITO_ORIGIN}`);
    expect(updatedCsp).toContain(`script-src 'self' https://*.amazonaws.com ${COGNITO_ORIGIN}`);
    expect(updatedCsp).toContain(`connect-src 'self' https://*.amazonaws.com wss://*.amazonaws.com https://metrics.awssolutionsbuilder.com ${COGNITO_ORIGIN}`);
    expect(updatedCsp).toContain(`form-action 'self' https://*.amazonaws.com ${COGNITO_ORIGIN}`);

    // Non-target directives should be unchanged
    expect(updatedCsp).toContain("style-src 'self' 'unsafe-inline' https://*.amazonaws.com");
    expect(updatedCsp).toContain("img-src 'self' data: https://*.amazonaws.com");
    expect(updatedCsp).toContain("font-src 'self' data:");
    expect(updatedCsp).toContain("frame-src 'self' https://*.amazonaws.com");
    expect(updatedCsp).toContain("frame-ancestors 'self' https://*.amazonaws.com");
    expect(updatedCsp).toContain("object-src 'none'");
    expect(updatedCsp).toContain("base-uri 'self'");
    expect(updatedCsp).toContain("upgrade-insecure-requests");
  });

  it("should be idempotent — not duplicate Cognito domain on second run", async () => {
    // First call adds the domain
    mockSend
      .mockResolvedValueOnce(buildGetResponse(BASE_CSP))
      .mockResolvedValueOnce({});
    await updateCsp(config);

    const firstCsp = mockSend.mock.calls[1][0].ResponseHeadersPolicyConfig
      .SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;

    // Second call with CSP that already has the domain
    mockSend.mockReset();
    mockSend
      .mockResolvedValueOnce(buildGetResponse(firstCsp))
      .mockResolvedValueOnce({});
    await updateCsp(config);

    const secondCsp = mockSend.mock.calls[1][0].ResponseHeadersPolicyConfig
      .SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;

    expect(secondCsp).toEqual(firstCsp);
  });

  it("should retry on PreconditionFailed error", async () => {
    const preconditionError = new Error("PreconditionFailed");
    preconditionError.name = "PreconditionFailed";

    mockSend
      .mockResolvedValueOnce(buildGetResponse(BASE_CSP))
      .mockRejectedValueOnce(preconditionError)
      .mockResolvedValueOnce(buildGetResponse(BASE_CSP))
      .mockResolvedValueOnce({});

    await updateCsp(config);

    // 4 calls: Get, failed Update, retry Get, retry Update
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it("should throw on NoSuchResponseHeadersPolicy error", async () => {
    const notFoundError = new Error("NoSuchResponseHeadersPolicy");
    notFoundError.name = "NoSuchResponseHeadersPolicy";

    mockSend
      .mockResolvedValueOnce(buildGetResponse(BASE_CSP))
      .mockRejectedValueOnce(notFoundError);

    await expect(updateCsp(config)).rejects.toThrow("NoSuchResponseHeadersPolicy");
  });

  it("should throw on unexpected errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("AccessDenied"));

    await expect(updateCsp(config)).rejects.toThrow("AccessDenied");
  });

  it("should strip null XSSProtection before updating", async () => {
    const response = buildGetResponse(BASE_CSP, {
      XSSProtection: { Protection: null, Override: null },
    });
    mockSend
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({});

    await updateCsp(config);

    const updateCall = mockSend.mock.calls[1][0];
    const secHeaders = updateCall.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
    expect(secHeaders.XSSProtection).toBeUndefined();
  });

  it("should preserve XSSProtection when it has valid values", async () => {
    const response = buildGetResponse(BASE_CSP, {
      XSSProtection: { Protection: true, Override: true },
    });
    mockSend
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({});

    await updateCsp(config);

    const updateCall = mockSend.mock.calls[1][0];
    const secHeaders = updateCall.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
    expect(secHeaders.XSSProtection).toEqual({ Protection: true, Override: true });
  });
});
