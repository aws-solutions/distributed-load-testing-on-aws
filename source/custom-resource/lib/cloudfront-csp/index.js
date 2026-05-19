// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const {
  CloudFrontClient,
  GetResponseHeadersPolicyCommand,
  UpdateResponseHeadersPolicyCommand,
} = require("@aws-sdk/client-cloudfront");

const utils = require("solution-utils");

const options = utils.getOptions({});
const client = new CloudFrontClient(options);

// Directives that need the exact Cognito domain added
const COGNITO_DIRECTIVES = ["default-src", "script-src", "connect-src", "form-action"];

/**
 * Parse a CSP string into an array of directive objects.
 * Each directive has a `name` and the full `raw` text.
 */
const parseDirectives = (csp) => {
  return csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((raw) => {
      const parts = raw.split(/\s+/);
      return { name: parts[0], raw };
    });
};

/**
 * Add the Cognito origin to target directives, preserving all existing values.
 * Idempotent: skips if the origin already exists in the directive.
 */
const addCognitoOrigin = (directives, cognitoOrigin) => {
  return directives.map((directive) => {
    if (COGNITO_DIRECTIVES.includes(directive.name)) {
      if (!directive.raw.includes(cognitoOrigin)) {
        return { ...directive, raw: `${directive.raw} ${cognitoOrigin}` };
      }
    }
    return directive;
  });
};

/**
 * Rebuild the CSP string from parsed directives.
 */
const buildCsp = (directives) => {
  return directives.map((d) => d.raw).join("; ") + ";";
};

/**
 * Fetch the current policy, parse the CSP, add the Cognito domain, and update the policy.
 * Returns the result of the update call.
 */
const getCspAndUpdate = async (policyId, cognitoOrigin) => {
  // Get current policy and ETag
  const getResponse = await client.send(
    new GetResponseHeadersPolicyCommand({ Id: policyId })
  );
  const etag = getResponse.ETag;
  const policyConfig = getResponse.ResponseHeadersPolicy.ResponseHeadersPolicyConfig;

  // Parse and update CSP
  const currentCsp = policyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
  const directives = parseDirectives(currentCsp);
  const updatedDirectives = addCognitoOrigin(directives, cognitoOrigin);
  const updatedCsp = buildCsp(updatedDirectives);

  policyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy = updatedCsp;

  // Remove security header sub-configs that have null required fields.
  // The Get API returns objects like XSSProtection: { Protection: null, Override: null }
  // for headers that were never configured, but the Update API rejects null values.
  const secHeaders = policyConfig.SecurityHeadersConfig;
  if (secHeaders.XSSProtection && secHeaders.XSSProtection.Protection == null) {
    delete secHeaders.XSSProtection;
  }

  // Update the policy with the new CSP
  return client.send(
    new UpdateResponseHeadersPolicyCommand({
      Id: policyId,
      IfMatch: etag,
      ResponseHeadersPolicyConfig: policyConfig,
    })
  );
};

/**
 * Update the CloudFront ResponseHeadersPolicy CSP with the exact Cognito domain.
 * Handles Create and Update events. No-op on Delete.
 *
 * @param {Object} config - The custom resource properties
 * @param {string} config.ResponseHeadersPolicyId - The CloudFront ResponseHeadersPolicy ID
 * @param {string} config.CognitoDomain - The Cognito domain (e.g. dlt-abc123.auth.us-east-1.amazoncognito.com)
 */
const updateCsp = async (config) => {
  const { ResponseHeadersPolicyId: policyId, CognitoDomain: cognitoDomain } = config;
  const cognitoOrigin = `https://${cognitoDomain}`;

  try {
    await getCspAndUpdate(policyId, cognitoOrigin);
  } catch (err) {
    if (err.name === "PreconditionFailed") {
      console.log("ETag mismatch, retrying Get → Parse → Add → Update cycle");
      await getCspAndUpdate(policyId, cognitoOrigin);
    } else if (err.name === "NoSuchResponseHeadersPolicy") {
      console.error(`ResponseHeadersPolicy ${policyId} not found`);
      throw err;
    } else {
      throw err;
    }
  }
};

module.exports = {
  updateCsp,
};
