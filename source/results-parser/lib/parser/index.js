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
const parser = require('xml-js');
const moment = require('moment');
const shortid = require('shortid');


/**
 * @function results
 * Description: dowloads xml results from s3 and writes results to DynamoDb.
 * @bucket {string} s3 bucket extracted from the S3 event passed to lambda.
 * @key {string} s3 key for the xml file extracted from the S3 event passed to lambda.
 * @uuid {string} the id of the individual task container.
 * @testId {string} the unique id of test scenario.
 */
const results = async (bucket,key,uuid, testId) => {

    console.log(`processing results, bucket:${bucket}, key:${key}, uuid:${uuid}, testId:${testId}`);

    const s3 = new AWS.S3();
    const dynamo = new AWS.DynamoDB.DocumentClient({
		region: process.env.AWS_REGION
    });

    let params,results, response;

    try {
        //Download xml results
        params = {
            Bucket: bucket,
            Key: key
        };
        const xmlFile = await s3.getObject(params).promise();
        const options = {nativeType:true,compact: true, ignoreAttributes:false};
        const json = parser.xml2js(xmlFile.Body, options);
        const jsonData = json.FinalStatus;
        const testDuration = jsonData.TestDuration._text;
        let endPoints = [];

        console.log(`xml to json: ${JSON.stringify(jsonData,null,2)}`);

        // loop through results
        for (let i = 0; i < jsonData.Group.length; i++) {
            const group = jsonData.Group[i];
            const endpoint = jsonData.Group[i]._attributes.label;
            let stats = {
                rc:[]
            };

            // loop through group results
            for (let r in group) {
                if (r != '_attributes' && r != 'perc' && r !='rc') {
                    stats[r] = group[r].value._text;
                } 
            }

            //loop through response codes, rc is a object for single responses array for multiple
            if (Array.isArray(group.rc)) {
                for (let i = 0; i < group.rc.length; i++) {
                    if (group.rc[i]._attributes.param != '200') {
                        stats.rc.push({'code':group.rc[i]._attributes.param, 'count':group.rc[i].value._text});
                    }
                }

            } else {
                if (group.rc._attributes.param != '200') {
                    stats.rc.push({code:group.rc._attributes.param,count:group.rc._attributes.value});
                }
            }
            
            //loop through percentiles and rename/convert keys to strings
            for (let i = 0; i < group.perc.length; i++) {
                const perc = 'p'+group.perc[i]._attributes.param.replace('.','_');
                stats[perc] = group.perc[i].value._text;
            }
            //check if the resuts are for the group (label '') or for a specific endpoint
            //label '' are the average results for all the endpoints.
            if (endpoint) {
                stats.endpoint = endpoint;
                endPoints.push(stats);
            } else {
                results = stats;
            }
        }
        results.testDuration = jsonData.TestDuration._text;

        console.log(`xml to json: ${JSON.stringify(jsonData,null,2)}`);

        //set ttl for dynamodb entry. records expire after 7 days
        const ttlDel = moment().utc().add(7, 'days').format('YYYY-MM-DD HH:mm:ss.S');

        params = {
            TableName: process.env.RESULTS_TABLE,
            Key: {
                uuid: uuid
            },
            UpdateExpression: 'set #i=:i, #d=:d, #e=:e, #r=:r, #t=:t',
            ExpressionAttributeNames: {
                '#i': 'testId',
                '#d': 'testDuration',
                '#e': 'endPoints',
                '#r': 'results',
                '#t': 'ttlDel'
            },
            ExpressionAttributeValues: {
                ':i': testId,
                ':d': testDuration,
                ':e': endPoints,
                ':r': results,
                ':t': ttlDel
            },
        };
        await dynamo.update(params).promise();

        //Update the list of completed tasks, this is used to by the final Results
        //function to check to see if all the tasks have completed.
        params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            UpdateExpression: 'set #t = list_append(if_not_exists(#t, :l), :t)',
            ExpressionAttributeNames: {
                '#t': 'taskIds'
            },
            ExpressionAttributeValues: {
                ':t':[uuid],
                ':l':[]
            },
            ReturnValues: 'ALL_NEW'
        };
        const data = await dynamo.update(params).promise();

        response = {
          duration: testDuration,
          taskCount: data.Attributes.taskCount,
          taskIds: data.Attributes.taskIds
        };
	} catch (err) {
        throw err;
    }
	return response;
};


/**
 * @function finalResults
 * Description: gets all of the results from the results table for a specific testId and
 * sets the average for each data point (final results)
 * @testId {string} the unique id of test scenario.
 */
const finalResults = async (testId) => {

    console.log(`Parsing Final Results for ${testId}`);

    const dynamo = new AWS.DynamoDB.DocumentClient({
		region: process.env.AWS_REGION
    });
    
    const cloudwatch = new AWS.CloudWatch({ 
        region: process.env.AWS_REGION 
    }); 

    //function to return the average value of an array
    const getAvg = (array) => array.reduce((a, b) => a + b) / array.length;

    const endTime = moment().utc().format('YYYY-MM-DD HH:mm:ss');
    let finalResults = {};
    let data;
    let all = {
        "avg_ct": [],
        "avg_lt": [],
        "avg_rt": [],
        "bytes": [],
        "concurrency": [],
        "fail": [],
        "p0_0": [],
        "p100_0": [],
        "p50_0": [],
        "p90_0": [],
        "p95_0": [],
        "p99_0": [],
        "p99_9": [],
        "stdev_rt": [],
        "succ": [],
        "testDuration": [],
        "throughput": [],
        "rc":[]
    };

    try {
        //get all Items from the results table for the testId 
        let params = {
            TableName: process.env.RESULTS_TABLE,
              FilterExpression : 'testId = :id',
              ExpressionAttributeValues : {
                  ':id' : testId
              }
        };
        data = await dynamo.scan(params).promise();

        for (let i in data.Items) {
            //combine all results into arrays and then get teh average for each data point
            const results = data.Items[i].results;
            for (let r in results) {
                if (r != 'rc') {
                    all[r].push(results[r]);
                } else {
                    //response codes is a list of objects, adding objects to all list.
                    for (let rc of results.rc) {
                        all.rc.push(rc);
                    }
                }
            }
        }
        //find duplicates in response codes and sum count
        if (all.rc.length > 0) {
            all.rc = all.rc.reduce((accumulator, currentValue) => {
                let existing = accumulator.find(acc => acc.code === currentValue.code);
                if (existing) {
                    existing.count += currentValue.count;
                } else {
                    accumulator.push(currentValue);
                }
                return accumulator;
            }, []);
        }
        //parse all of the results to generate the final results.
        for (let i in all) {
            switch (i) {
                case 'concurrency':
                case 'testDuration':
                case 'bytes':
                    finalResults[i] = getAvg(all[i]).toFixed(0);
                    break;
                case 'fail':
                case 'succ':
                case 'throughput':
                    finalResults[i] = all[i].reduce((a, b) => a + b);
                    break;
                case 'avg_ct':
                case 'avg_lt':
                case 'avg_rt':
                    finalResults[i] = getAvg(all[i]).toFixed(5);
                    break;
                case 'rc':
                    finalResults[i] = all[i];
                    break;
                default:
                    finalResults[i] = getAvg(all[i]).toFixed(3);
            }
        }
        console.log('Final Results: ',JSON.stringify(finalResults,null,2));

        // get cloudwathc metrics image for the test.
        params = { 
            TableName: process.env.SCENARIOS_TABLE, 
            Key: { 
                testId: testId 
            }, 
            AttributesToGet: [ 
                'startTime'
            ], 
        }; 
        data = await dynamo.get(params).promise(); 
        console.log(JSON.stringify(data,null,2))
        const widget = {
            title: 'CloudWatch Metrics',
            width: 600, 
            height: 395, 
            metrics : [ 
               [
                   "distribuited-load-testing", "Avg Response Time", 
                    {
                        color:'#FF9900',
                        label:'Avg Response Time'
                    }
            ] 
            ],

            period: 10, 
            stacked: true, 
            stat: 'Average', 
            view: 'timeSeries', 
            start: new Date(data.Item.startTime).toISOString(), 
            end: new Date(endTime).toISOString() 
        }; 
        params = { 
            MetricWidget: JSON.stringify(widget) 
        }; 
        console.log(widget);
        
        const image = await cloudwatch.getMetricWidgetImage(params).promise(); 
        const metricWidgetImage = Buffer.from(image.MetricWidgetImage).toString('base64');  
        
        //Update Scenarios Table with final results.
        params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            UpdateExpression: 'set #r=:r, #t=:t, #i=:i',
            ExpressionAttributeNames: {
                '#r':'results',
                '#t':'endTime',
                '#i':'metricWidgetImage'
            },
            ExpressionAttributeValues: {
                ':r': finalResults,
                ':t': endTime,
                ':i': metricWidgetImage
            },
            ReturnValues: 'ALL_NEW'
        };
        data = await dynamo.update(params).promise();

        //Update Scenarios Table with history
        const history = {
            id: shortid.generate(),
            startTime: data.Attributes.runTime,
            endTime: endTime,
            results: finalResults
        };
        params = {
            TableName: process.env.SCENARIOS_TABLE,
            Key: {
                testId: testId
            },
            UpdateExpression: 'set #s = :s, #h = list_append(if_not_exists(#h, :l), :h)',

            ExpressionAttributeNames: {
                '#s':'status',
                '#h':'history'
            },
            ExpressionAttributeValues: {
                ':s': 'complete',
                ':h': [history],
                ':l': []
            },
            ReturnValues: 'ALL_NEW'
        };
        await dynamo.update(params).promise();

	} catch (err) {
		throw err;
    }
	return 'success';
};


module.exports = {
    results:results,
    finalResults:finalResults
};
