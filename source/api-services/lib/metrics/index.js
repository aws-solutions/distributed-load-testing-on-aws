// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require('axios');
const moment = require('moment');

/**
 * Sends anonymouse metrics.
 * @param {{ taskCount: number, testType: string, fileType: string|undefined }} - the number of containers used for the test, the test type, and the file type
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
                FileType: obj.fileType || (obj.testType === 'simple' ? 'none' : 'script'),
                TaskCount: obj.taskCount
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
