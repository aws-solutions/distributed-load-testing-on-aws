// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require('axios');

const send = async (event, context, responseStatus, responseData, physicalResourceId) => {


  let data;

  try {
    const responseBody = JSON.stringify({
      Status: responseStatus,
      Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
      PhysicalResourceId: physicalResourceId || context.logStreamName,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
      Data: responseData
    });
    const params = {
      url: event.ResponseURL,
      port: 443,
      method: "put",
      headers: {
        "content-type": "",
        "content-length": responseBody.length
      },
      data: responseBody
    };
    data = await axios(params);
  }
  catch (err) {
    throw err;
  }
  return data.status;
};


module.exports = {
	send: send
};
