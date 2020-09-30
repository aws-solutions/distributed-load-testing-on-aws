// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require('axios');
const moment = require('moment');

const send = async (config, type) => {
    let data;

    try {
        const metrics = {
            Solution: config.SolutionId,
            Version: config.Version,
            UUID: config.UUID,
            TimeStamp: moment().utc().format('YYYY-MM-DD HH:mm:ss.S'),
            Data: {
                Type: type,
                Region: config.Region
            }
        };
        const params = {
            method: 'post',
            port: 443,
            url: 'https://metrics.awssolutionsbuilder.com/generic',
            headers: {
                'Content-Type': 'application/json'
            },
            data: metrics
        };
        //Send Metrics & retun status code.
        data = await axios(params);
    } catch (err) {
        //Not returning an error to avoid Metrics affecting the Application
        console.log(err);
    }
    return data.status;
};


module.exports = {
    send: send
};
