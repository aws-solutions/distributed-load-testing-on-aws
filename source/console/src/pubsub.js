// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { PubSub } from "@aws-amplify/pubsub";
declare var awsConfig;

export const pubsub = new PubSub({
  region: awsConfig.aws_project_region,
  endpoint: `wss://${awsConfig.aws_iot_endpoint}/mqtt`,
});
