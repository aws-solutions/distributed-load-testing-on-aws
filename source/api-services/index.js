/*******************************************************************************
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. 
 *
 * Licensed under the Amazon Software License (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0    
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 *
 ********************************************************************************/

const scenarios = require('./lib/scenarios/');
const metrics = require('./lib/metrics/');

exports.handler = async (event) => {

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
        statusCode: 200,
    };

    try {

        switch (resource) {

            case '/scenarios':
                switch (method) {
                    case 'GET':
                        data = await scenarios.listTests();
                        break;
                    case 'POST':
                        data = await scenarios.createTest(config);
                        //sending anonymous metrics (task Count) to aws
                        await metrics.send(config.taskCount); 
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
                        data = await scenarios.deleteTest(testId);
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
        console.log(err);
        response.body = err.toString();
        response.statusCode = 400;
    }

    console.log(response);
    return response;
};
