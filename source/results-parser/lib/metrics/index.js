// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require('axios');
const moment = require('moment');

/**
 * Sends anonymouse metrics.
 * @param {{ totalDuration: number, testType: string, fileType: string, testResult: string }} - the total time the test ran for in seconds, the test type, the file type, and the test result
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
                Type: 'TaskCompletion',
                TestType: obj.testType,
                FileType: obj.fileType || (obj.testType === 'simple' ? 'none' : 'script'),
                TestResult: obj.testResult,
                Duration: obj.totalDuration
            }
        };
        const params = {
            method: 'post',
            port: 443,
            url: process.env.METRIC_URL,
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
