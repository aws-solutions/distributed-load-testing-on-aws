// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require('axios');
const moment = require('moment');

/**
 * Sends anonymouse metrics.
 * @param {{ taskCount: number, testType: string }} - the number of containers used for the test and the test type
 */
const send = async (obj) => {

    let data;

    try {
        const metrics = {
            Solution: process.env.SOLUTION_ID,
            UUID: process.env.UUID,
            TimeStamp: moment().utc().format('YYYY-MM-DD HH:mm:ss.S'),
            Version: process.env.VERSION,
            Data: {
                Type: 'TaskCreate',
                TestType: obj.testType,
                TaskCount: obj.taskCount
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
