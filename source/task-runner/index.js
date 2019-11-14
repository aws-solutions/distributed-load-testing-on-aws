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

const AWS = require('aws-sdk'); 


exports.handler = async (event) => {

    console.log(JSON.stringify(event, null, 2));

    const ecs = new AWS.ECS({ 
        region: process.env.AWS_REGION 
    });
    const dynamo = new AWS.DynamoDB.DocumentClient({ 
        region: process.env.AWS_REGION 
    }); 
 
    const body = JSON.parse(event.Records[0].body);
    const testId = body.testId;
    const taskCount = body.taskCount;

    try {

        //Check if any tasks are running

        //Run tasks in batches of 10
        const params = { 
            taskDefinition: process.env.TASK_DEFINITION, 
            cluster: process.env.TASK_CLUSTER, 
            count: '', 
            group: testId, 
            launchType: 'FARGATE', 
            networkConfiguration: { 
                'awsvpcConfiguration': { 
                    'assignPublicIp': 'ENABLED', 
                    'securityGroups': [process.env.TASK_SECURITY_GROUP], 
                    'subnets': [ 
                        process.env.SUBNET_A, 
                        process.env.SUBNET_B
                    ] 
                } 
            }, 
            overrides: { 
                'containerOverrides': [{ 
                    'name': process.env.TASK_IMAGE, 
                    'environment': [{ 
                            'name': 'S3_BUCKET', 
                            'value': process.env.SCENARIOS_BUCKET 
                        }, 
                        { 
                            'name': 'TEST_ID', 
                            'value': testId 
                        } 
                    ] 
                }] 
            } 
        }; 
 
        /** 
        * The max number of containers (taskCount) per task execution is 10 so if the taskCount is 
        * more than 10 the task definition will need to be run multiple times. 
        * @runTaskCount is the number of sets of 10 in the taskCount 
        * @remainingCount is the remaining count which is a number between 1 and 10 
        */ 
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)); 
        const runTaskCount = Math.ceil(taskCount/10 -1); 

        for (let i = 0; i < runTaskCount; i++) {
            params.count = 10; 
            console.log('RUNNING TEST WITH 10'); 
            await ecs.runTask(params).promise(); 
            console.log('sleep 10 seconds to avoid ThrottlingException'); 
            await sleep(10000); 
        } 

        // run the final task definition with the remaining count. 
        let remainingCount = taskCount.toString().split('').pop(); 
        let finalCount; 
        
        if (remainingCount === '0') { 
            finalCount = 10; 
        } else { 
            finalCount = remainingCount; 
        } 

        params.count = finalCount; 
        console.log(`RUNNING TEST WITH FINAL COUNT: ${finalCount}`); 
        await ecs.runTask(params).promise(); 
    
    } catch (err) {

        console.log(err);
        //Update DynamoDB with Status FAILED and Error Message
        let params = { 
            TableName: process.env.SCENARIOS_TABLE, 
            Key: { 
                testId: testId 
            }, 
            UpdateExpression: '#s = :s, #e = :e', 
            ExpressionAttributeNames: { 
                '#s': 'status',
                '#e': 'taskError'
            }, 
            ExpressionAttributeValues: { 
                ':s': 'running', 
                ":r": err
            }
        }; 
        await dynamo.update(params).promise(); 
    }
    console.log('success');
    return 'success';
};
