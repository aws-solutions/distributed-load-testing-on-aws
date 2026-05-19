// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Comprehensive mapping of AWS region codes to their display names.
 * This is a display-only utility — it does not restrict which regions
 * are available for deployment. If a region code is not found in the
 * map, getRegionName() falls back to returning the raw code.
 *
 * Source of truth: https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html
 */
const AWS_REGION_NAMES: Record<string, string> = {
  // US
  "us-east-1": "N. Virginia",
  "us-east-2": "Ohio",
  "us-west-1": "N. California",
  "us-west-2": "Oregon",

  // Canada
  "ca-central-1": "Central",
  "ca-west-1": "Calgary",

  // Europe
  "eu-west-1": "Ireland",
  "eu-west-2": "London",
  "eu-west-3": "Paris",
  "eu-central-1": "Frankfurt",
  "eu-central-2": "Zurich",
  "eu-north-1": "Stockholm",
  "eu-south-1": "Milan",
  "eu-south-2": "Spain",

  // Asia Pacific
  "ap-east-1": "Hong Kong",
  "ap-east-2": "Taipei",
  "ap-south-1": "Mumbai",
  "ap-south-2": "Hyderabad",
  "ap-southeast-1": "Singapore",
  "ap-southeast-2": "Sydney",
  "ap-southeast-3": "Jakarta",
  "ap-southeast-4": "Melbourne",
  "ap-southeast-5": "Malaysia",
  "ap-southeast-6": "New Zealand",
  "ap-southeast-7": "Thailand",
  "ap-northeast-1": "Tokyo",
  "ap-northeast-2": "Seoul",
  "ap-northeast-3": "Osaka",

  // Mexico
  "mx-central-1": "Central",

  // South America
  "sa-east-1": "São Paulo",

  // Middle East
  "me-south-1": "Bahrain",
  "me-central-1": "UAE",

  // Africa
  "af-south-1": "Cape Town",

  // Israel
  "il-central-1": "Tel Aviv",

  // AWS GovCloud
  "us-gov-east-1": "US-Gov-East",
  "us-gov-west-1": "US-Gov-West",
};

/**
 * Returns the human-readable display name for an AWS region code.
 * Falls back to the raw region code if not found in the map.
 */
export function getRegionName(region: string): string {
  return AWS_REGION_NAMES[region] || region;
}
