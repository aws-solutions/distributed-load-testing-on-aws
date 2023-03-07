// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require("axios");

const send = async (event, context, responseStatus, responseData, physicalResourceId) => {
  try {
    const responseBody = JSON.stringify({
      Status: responseStatus,
      Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
      PhysicalResourceId: physicalResourceId || context.logStreamName,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: responseData,
    });
    const params = {
      url: event.ResponseURL,
      port: 443,
      method: "put",
      headers: {
        "content-type": "",
        "content-length": responseBody.length,
      },
      data: responseBody,
    };
    await axios(params);
  } catch (err) {
    console.error(`There was an error sending the response to CloudFormation: ${err}`);
    throw err;
  }
};

module.exports = {
  send: send,
};
