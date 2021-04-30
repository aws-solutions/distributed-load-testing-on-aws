// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const scenarios = require('./lib/scenarios/');
const metrics = require('./lib/metrics/');

exports.handler = async (event, context) => {
    console.log(JSON.stringify(event, null, 2));

    const resource = event.resource;
    const method = event.httpMethod;
    const config = JSON.parse(event.body);
    const errMsg = `Method: ${method} not supported for this resource: ${resource} `;

    let testId;
    let data;
    let response = {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept"
        },
        statusCode: 200
    };

    try {
        switch (resource) {
            case '/scenarios':
                switch (method) {
                    case 'GET':
                        data = await scenarios.listTests();
                        break;
                    case 'POST':
                        if(config.scheduleStep)
                        {
                            const contextValues = {
                                functionName: context.functionName,
                                functionArn: context.invokedFunctionArn
                            }
                            data = await scenarios.scheduleTest(event, contextValues);
                        }
                        else {
                            data = await scenarios.createTest(config);
                        }
                        //sending anonymous metrics (task Count) to aws
                        if (process.env.SEND_METRIC === 'Yes') {
                            await metrics.send({ taskCount: config.taskCount, testType: config.testType, fileType: config.fileType });
                        }
                        break;
                    default:
                         throw new Error(errMsg);
                }
                break;

            case '/scenarios/{testId}':
                testId = event.pathParameters.testId;
                switch (method) {
                    case 'GET':
                        data = await scenarios.getTest(testId);
                        break;
                    case 'POST':
                        data = await scenarios.cancelTest(testId);
                        break;
                    case 'DELETE':
                        data = await scenarios.deleteTest(testId, context.functionName);
                        break;
                    default:
                        throw new Error(errMsg);
                }
                break;
            case '/tasks':
                switch (method) {
                    case 'GET':
                        data = await scenarios.listTasks();
                        break;
                    default:
                        throw new Error(errMsg);
                }
                break;
            default:
                throw new Error(errMsg);
        }

        response.body = JSON.stringify(data);
    } catch (err) {
        console.error(err);
        response.body = err.toString();
        response.statusCode = 400;
    }

    console.log(response);
    return response;
};
