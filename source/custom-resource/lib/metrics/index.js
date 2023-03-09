// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require("axios");
const moment = require("moment");

const send = async (config, type) => {
  try {
    const metrics = {
      Solution: config.SolutionId,
      Version: config.Version,
      UUID: config.UUID,
      TimeStamp: moment().utc().format("YYYY-MM-DD HH:mm:ss.S"),
      Data: {
        Type: type,
        Region: config.Region,
        ExistingVpc: config.existingVPC,
      },
    };
    const params = {
      method: "post",
      port: 443,
      url: process.env.METRIC_URL,
      headers: {
        "Content-Type": "application/json",
      },
      data: metrics,
    };
    //Send Metrics & return status code.
    await axios(params);
  } catch (err) {
    //Not returning an error to avoid Metrics affecting the Application
    console.error(err);
  }
};

module.exports = {
  send: send,
};
