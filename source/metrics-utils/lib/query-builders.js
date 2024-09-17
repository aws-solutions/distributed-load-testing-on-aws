"use strict";
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.addLambdaInvocationCount = addLambdaInvocationCount;
exports.addCloudFrontMetric = addCloudFrontMetric;
exports.addECSAverageCPUUtilization = addECSAverageCPUUtilization;
exports.addECSAverageMemoryUtilization = addECSAverageMemoryUtilization;
exports.addDynamoDBConsumedWriteCapacityUnits = addDynamoDBConsumedWriteCapacityUnits;
exports.addDynamoDBConsumedReadCapacityUnits = addDynamoDBConsumedReadCapacityUnits;
exports.addLambdaBilledDurationMemorySize = addLambdaBilledDurationMemorySize;
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
function addLambdaInvocationCount(functionName, period = 604800) {
    this.addMetricDataQuery({
        MetricStat: {
            Metric: {
                Namespace: "AWS/Lambda",
                Dimensions: [
                    {
                        Name: "FunctionName",
                        Value: functionName,
                    },
                ],
                MetricName: "Invocations",
            },
            Stat: "Sum",
            Period: period,
        },
    });
}
function addCloudFrontMetric(distributionId, metricName, period = 604800) {
    this.addMetricDataQuery({
        MetricStat: {
            Metric: {
                Namespace: "AWS/CloudFront",
                Dimensions: [
                    {
                        Name: "DistributionId",
                        Value: distributionId,
                    },
                    {
                        Name: "Region",
                        Value: "Global",
                    },
                ],
                MetricName: metricName,
            },
            Stat: "Sum",
            Period: period,
        },
    });
}
function addECSAverageCPUUtilization(clusterName, taskDefinitionFamily, period = 300) {
    this.addMetricDataQuery({
        MetricStat: {
            Metric: {
                Namespace: "ECS/ContainerInsights",
                Dimensions: [
                    {
                        Name: "ClusterName",
                        Value: clusterName,
                    },
                    {
                        Name: "TaskDefinitionFamily",
                        Value: taskDefinitionFamily,
                    },
                ],
                MetricName: "CpuUtilized",
            },
            Stat: "Average",
            Period: period,
        },
    });
}
function addECSAverageMemoryUtilization(clusterName, taskDefinitionFamily, period = 300) {
    this.addMetricDataQuery({
        MetricStat: {
            Metric: {
                Namespace: "ECS/ContainerInsights",
                Dimensions: [
                    {
                        Name: "ClusterName",
                        Value: clusterName,
                    },
                    {
                        Name: "TaskDefinitionFamily",
                        Value: taskDefinitionFamily,
                    },
                ],
                MetricName: "MemoryUtilized",
            },
            Stat: "Average",
            Period: period,
        },
    });
}
function addDynamoDBConsumedWriteCapacityUnits(tableName, period = 604800) {
    this.addMetricDataQuery({
        MetricStat: {
            Metric: {
                Namespace: "AWS/DynamoDB",
                Dimensions: [
                    {
                        Name: "TableName",
                        Value: tableName,
                    },
                ],
                MetricName: "ConsumedWriteCapacityUnits",
            },
            Stat: "Sum",
            Period: period,
        },
    });
}
function addDynamoDBConsumedReadCapacityUnits(tableName, period = 604800) {
    this.addMetricDataQuery({
        MetricStat: {
            Metric: {
                Namespace: "AWS/DynamoDB",
                Dimensions: [
                    {
                        Name: "TableName",
                        Value: tableName,
                    },
                ],
                MetricName: "ConsumedReadCapacityUnits",
            },
            Stat: "Sum",
            Period: period,
        },
    });
}
function addLambdaBilledDurationMemorySize(logGroups, queryDefinitionName, limit = undefined) {
    this.addQueryDefinition({
        logGroups,
        queryString: new aws_logs_1.QueryString({
            stats: "sum(@billedDuration) as AWSLambdaBilledDuration, max(@memorySize) as AWSLambdaMemorySize",
            limit,
        }),
        queryDefinitionName,
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnktYnVpbGRlcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJxdWVyeS1idWlsZGVycy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUEscUVBQXFFO0FBQ3JFLHNDQUFzQzs7QUFLdEMsNERBaUJDO0FBRUQsa0RBMEJDO0FBRUQsa0VBMEJDO0FBRUQsd0VBMEJDO0FBRUQsc0ZBcUJDO0FBRUQsb0ZBcUJDO0FBRUQsOEVBY0M7QUF0S0QsbURBQThEO0FBRzlELFNBQWdCLHdCQUF3QixDQUF5QixZQUFvQixFQUFFLFNBQWlCLE1BQU07SUFDNUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDO1FBQ3RCLFVBQVUsRUFBRTtZQUNWLE1BQU0sRUFBRTtnQkFDTixTQUFTLEVBQUUsWUFBWTtnQkFDdkIsVUFBVSxFQUFFO29CQUNWO3dCQUNFLElBQUksRUFBRSxjQUFjO3dCQUNwQixLQUFLLEVBQUUsWUFBWTtxQkFDcEI7aUJBQ0Y7Z0JBQ0QsVUFBVSxFQUFFLGFBQWE7YUFDMUI7WUFDRCxJQUFJLEVBQUUsS0FBSztZQUNYLE1BQU0sRUFBRSxNQUFNO1NBQ2Y7S0FDRixDQUFDLENBQUM7QUFDTCxDQUFDO0FBRUQsU0FBZ0IsbUJBQW1CLENBRWpDLGNBQXNCLEVBQ3RCLFVBQWtCLEVBQ2xCLFNBQWlCLE1BQU07SUFFdkIsSUFBSSxDQUFDLGtCQUFrQixDQUFDO1FBQ3RCLFVBQVUsRUFBRTtZQUNWLE1BQU0sRUFBRTtnQkFDTixTQUFTLEVBQUUsZ0JBQWdCO2dCQUMzQixVQUFVLEVBQUU7b0JBQ1Y7d0JBQ0UsSUFBSSxFQUFFLGdCQUFnQjt3QkFDdEIsS0FBSyxFQUFFLGNBQWM7cUJBQ3RCO29CQUNEO3dCQUNFLElBQUksRUFBRSxRQUFRO3dCQUNkLEtBQUssRUFBRSxRQUFRO3FCQUNoQjtpQkFDRjtnQkFDRCxVQUFVLEVBQUUsVUFBVTthQUN2QjtZQUNELElBQUksRUFBRSxLQUFLO1lBQ1gsTUFBTSxFQUFFLE1BQU07U0FDZjtLQUNGLENBQUMsQ0FBQztBQUNMLENBQUM7QUFFRCxTQUFnQiwyQkFBMkIsQ0FFekMsV0FBbUIsRUFDbkIsb0JBQTZCLEVBQzdCLFNBQWlCLEdBQUc7SUFFcEIsSUFBSSxDQUFDLGtCQUFrQixDQUFDO1FBQ3RCLFVBQVUsRUFBRTtZQUNWLE1BQU0sRUFBRTtnQkFDTixTQUFTLEVBQUUsdUJBQXVCO2dCQUNsQyxVQUFVLEVBQUU7b0JBQ1Y7d0JBQ0UsSUFBSSxFQUFFLGFBQWE7d0JBQ25CLEtBQUssRUFBRSxXQUFXO3FCQUNuQjtvQkFDRDt3QkFDRSxJQUFJLEVBQUUsc0JBQXNCO3dCQUM1QixLQUFLLEVBQUUsb0JBQW9CO3FCQUM1QjtpQkFDRjtnQkFDRCxVQUFVLEVBQUUsYUFBYTthQUMxQjtZQUNELElBQUksRUFBRSxTQUFTO1lBQ2YsTUFBTSxFQUFFLE1BQU07U0FDZjtLQUNGLENBQUMsQ0FBQztBQUNMLENBQUM7QUFFRCxTQUFnQiw4QkFBOEIsQ0FFNUMsV0FBbUIsRUFDbkIsb0JBQTZCLEVBQzdCLFNBQWlCLEdBQUc7SUFFcEIsSUFBSSxDQUFDLGtCQUFrQixDQUFDO1FBQ3RCLFVBQVUsRUFBRTtZQUNWLE1BQU0sRUFBRTtnQkFDTixTQUFTLEVBQUUsdUJBQXVCO2dCQUNsQyxVQUFVLEVBQUU7b0JBQ1Y7d0JBQ0UsSUFBSSxFQUFFLGFBQWE7d0JBQ25CLEtBQUssRUFBRSxXQUFXO3FCQUNuQjtvQkFDRDt3QkFDRSxJQUFJLEVBQUUsc0JBQXNCO3dCQUM1QixLQUFLLEVBQUUsb0JBQW9CO3FCQUM1QjtpQkFDRjtnQkFDRCxVQUFVLEVBQUUsZ0JBQWdCO2FBQzdCO1lBQ0QsSUFBSSxFQUFFLFNBQVM7WUFDZixNQUFNLEVBQUUsTUFBTTtTQUNmO0tBQ0YsQ0FBQyxDQUFDO0FBQ0wsQ0FBQztBQUVELFNBQWdCLHFDQUFxQyxDQUVuRCxTQUFpQixFQUNqQixTQUFpQixNQUFNO0lBRXZCLElBQUksQ0FBQyxrQkFBa0IsQ0FBQztRQUN0QixVQUFVLEVBQUU7WUFDVixNQUFNLEVBQUU7Z0JBQ04sU0FBUyxFQUFFLGNBQWM7Z0JBQ3pCLFVBQVUsRUFBRTtvQkFDVjt3QkFDRSxJQUFJLEVBQUUsV0FBVzt3QkFDakIsS0FBSyxFQUFFLFNBQVM7cUJBQ2pCO2lCQUNGO2dCQUNELFVBQVUsRUFBRSw0QkFBNEI7YUFDekM7WUFDRCxJQUFJLEVBQUUsS0FBSztZQUNYLE1BQU0sRUFBRSxNQUFNO1NBQ2Y7S0FDRixDQUFDLENBQUM7QUFDTCxDQUFDO0FBRUQsU0FBZ0Isb0NBQW9DLENBRWxELFNBQWlCLEVBQ2pCLFNBQWlCLE1BQU07SUFFdkIsSUFBSSxDQUFDLGtCQUFrQixDQUFDO1FBQ3RCLFVBQVUsRUFBRTtZQUNWLE1BQU0sRUFBRTtnQkFDTixTQUFTLEVBQUUsY0FBYztnQkFDekIsVUFBVSxFQUFFO29CQUNWO3dCQUNFLElBQUksRUFBRSxXQUFXO3dCQUNqQixLQUFLLEVBQUUsU0FBUztxQkFDakI7aUJBQ0Y7Z0JBQ0QsVUFBVSxFQUFFLDJCQUEyQjthQUN4QztZQUNELElBQUksRUFBRSxLQUFLO1lBQ1gsTUFBTSxFQUFFLE1BQU07U0FDZjtLQUNGLENBQUMsQ0FBQztBQUNMLENBQUM7QUFFRCxTQUFnQixpQ0FBaUMsQ0FFL0MsU0FBc0IsRUFDdEIsbUJBQTJCLEVBQzNCLFFBQTRCLFNBQVM7SUFFckMsSUFBSSxDQUFDLGtCQUFrQixDQUFDO1FBQ3RCLFNBQVM7UUFDVCxXQUFXLEVBQUUsSUFBSSxzQkFBVyxDQUFDO1lBQzNCLEtBQUssRUFBRSwwRkFBMEY7WUFDakcsS0FBSztTQUNOLENBQUM7UUFDRixtQkFBbUI7S0FDcEIsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCBBbWF6b24uY29tLCBJbmMuIG9yIGl0cyBhZmZpbGlhdGVzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuLy8gU1BEWC1MaWNlbnNlLUlkZW50aWZpZXI6IEFwYWNoZS0yLjBcblxuaW1wb3J0IHsgSUxvZ0dyb3VwLCBRdWVyeVN0cmluZyB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbG9nc1wiO1xuaW1wb3J0IHsgU29sdXRpb25zTWV0cmljcyB9IGZyb20gXCIuL3NvbHV0aW9ucy1tZXRyaWNzXCI7XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRMYW1iZGFJbnZvY2F0aW9uQ291bnQodGhpczogU29sdXRpb25zTWV0cmljcywgZnVuY3Rpb25OYW1lOiBzdHJpbmcsIHBlcmlvZDogbnVtYmVyID0gNjA0ODAwKSB7XG4gIHRoaXMuYWRkTWV0cmljRGF0YVF1ZXJ5KHtcbiAgICBNZXRyaWNTdGF0OiB7XG4gICAgICBNZXRyaWM6IHtcbiAgICAgICAgTmFtZXNwYWNlOiBcIkFXUy9MYW1iZGFcIixcbiAgICAgICAgRGltZW5zaW9uczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIE5hbWU6IFwiRnVuY3Rpb25OYW1lXCIsXG4gICAgICAgICAgICBWYWx1ZTogZnVuY3Rpb25OYW1lLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIE1ldHJpY05hbWU6IFwiSW52b2NhdGlvbnNcIixcbiAgICAgIH0sXG4gICAgICBTdGF0OiBcIlN1bVwiLFxuICAgICAgUGVyaW9kOiBwZXJpb2QsXG4gICAgfSxcbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRDbG91ZEZyb250TWV0cmljKFxuICB0aGlzOiBTb2x1dGlvbnNNZXRyaWNzLFxuICBkaXN0cmlidXRpb25JZDogc3RyaW5nLFxuICBtZXRyaWNOYW1lOiBzdHJpbmcsXG4gIHBlcmlvZDogbnVtYmVyID0gNjA0ODAwXG4pIHtcbiAgdGhpcy5hZGRNZXRyaWNEYXRhUXVlcnkoe1xuICAgIE1ldHJpY1N0YXQ6IHtcbiAgICAgIE1ldHJpYzoge1xuICAgICAgICBOYW1lc3BhY2U6IFwiQVdTL0Nsb3VkRnJvbnRcIixcbiAgICAgICAgRGltZW5zaW9uczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIE5hbWU6IFwiRGlzdHJpYnV0aW9uSWRcIixcbiAgICAgICAgICAgIFZhbHVlOiBkaXN0cmlidXRpb25JZCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIE5hbWU6IFwiUmVnaW9uXCIsXG4gICAgICAgICAgICBWYWx1ZTogXCJHbG9iYWxcIixcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICBNZXRyaWNOYW1lOiBtZXRyaWNOYW1lLFxuICAgICAgfSxcbiAgICAgIFN0YXQ6IFwiU3VtXCIsXG4gICAgICBQZXJpb2Q6IHBlcmlvZCxcbiAgICB9LFxuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZEVDU0F2ZXJhZ2VDUFVVdGlsaXphdGlvbihcbiAgdGhpczogU29sdXRpb25zTWV0cmljcyxcbiAgY2x1c3Rlck5hbWU6IHN0cmluZyxcbiAgdGFza0RlZmluaXRpb25GYW1pbHk/OiBzdHJpbmcsXG4gIHBlcmlvZDogbnVtYmVyID0gMzAwXG4pIHtcbiAgdGhpcy5hZGRNZXRyaWNEYXRhUXVlcnkoe1xuICAgIE1ldHJpY1N0YXQ6IHtcbiAgICAgIE1ldHJpYzoge1xuICAgICAgICBOYW1lc3BhY2U6IFwiRUNTL0NvbnRhaW5lckluc2lnaHRzXCIsXG4gICAgICAgIERpbWVuc2lvbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBOYW1lOiBcIkNsdXN0ZXJOYW1lXCIsXG4gICAgICAgICAgICBWYWx1ZTogY2x1c3Rlck5hbWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBOYW1lOiBcIlRhc2tEZWZpbml0aW9uRmFtaWx5XCIsXG4gICAgICAgICAgICBWYWx1ZTogdGFza0RlZmluaXRpb25GYW1pbHksXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgICAgTWV0cmljTmFtZTogXCJDcHVVdGlsaXplZFwiLFxuICAgICAgfSxcbiAgICAgIFN0YXQ6IFwiQXZlcmFnZVwiLFxuICAgICAgUGVyaW9kOiBwZXJpb2QsXG4gICAgfSxcbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRFQ1NBdmVyYWdlTWVtb3J5VXRpbGl6YXRpb24oXG4gIHRoaXM6IFNvbHV0aW9uc01ldHJpY3MsXG4gIGNsdXN0ZXJOYW1lOiBzdHJpbmcsXG4gIHRhc2tEZWZpbml0aW9uRmFtaWx5Pzogc3RyaW5nLFxuICBwZXJpb2Q6IG51bWJlciA9IDMwMFxuKSB7XG4gIHRoaXMuYWRkTWV0cmljRGF0YVF1ZXJ5KHtcbiAgICBNZXRyaWNTdGF0OiB7XG4gICAgICBNZXRyaWM6IHtcbiAgICAgICAgTmFtZXNwYWNlOiBcIkVDUy9Db250YWluZXJJbnNpZ2h0c1wiLFxuICAgICAgICBEaW1lbnNpb25zOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgTmFtZTogXCJDbHVzdGVyTmFtZVwiLFxuICAgICAgICAgICAgVmFsdWU6IGNsdXN0ZXJOYW1lLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgTmFtZTogXCJUYXNrRGVmaW5pdGlvbkZhbWlseVwiLFxuICAgICAgICAgICAgVmFsdWU6IHRhc2tEZWZpbml0aW9uRmFtaWx5LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIE1ldHJpY05hbWU6IFwiTWVtb3J5VXRpbGl6ZWRcIixcbiAgICAgIH0sXG4gICAgICBTdGF0OiBcIkF2ZXJhZ2VcIixcbiAgICAgIFBlcmlvZDogcGVyaW9kLFxuICAgIH0sXG4gIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkRHluYW1vREJDb25zdW1lZFdyaXRlQ2FwYWNpdHlVbml0cyhcbiAgdGhpczogU29sdXRpb25zTWV0cmljcyxcbiAgdGFibGVOYW1lOiBzdHJpbmcsXG4gIHBlcmlvZDogbnVtYmVyID0gNjA0ODAwXG4pIHtcbiAgdGhpcy5hZGRNZXRyaWNEYXRhUXVlcnkoe1xuICAgIE1ldHJpY1N0YXQ6IHtcbiAgICAgIE1ldHJpYzoge1xuICAgICAgICBOYW1lc3BhY2U6IFwiQVdTL0R5bmFtb0RCXCIsXG4gICAgICAgIERpbWVuc2lvbnM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBOYW1lOiBcIlRhYmxlTmFtZVwiLFxuICAgICAgICAgICAgVmFsdWU6IHRhYmxlTmFtZSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICBNZXRyaWNOYW1lOiBcIkNvbnN1bWVkV3JpdGVDYXBhY2l0eVVuaXRzXCIsXG4gICAgICB9LFxuICAgICAgU3RhdDogXCJTdW1cIixcbiAgICAgIFBlcmlvZDogcGVyaW9kLFxuICAgIH0sXG4gIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkRHluYW1vREJDb25zdW1lZFJlYWRDYXBhY2l0eVVuaXRzKFxuICB0aGlzOiBTb2x1dGlvbnNNZXRyaWNzLFxuICB0YWJsZU5hbWU6IHN0cmluZyxcbiAgcGVyaW9kOiBudW1iZXIgPSA2MDQ4MDBcbikge1xuICB0aGlzLmFkZE1ldHJpY0RhdGFRdWVyeSh7XG4gICAgTWV0cmljU3RhdDoge1xuICAgICAgTWV0cmljOiB7XG4gICAgICAgIE5hbWVzcGFjZTogXCJBV1MvRHluYW1vREJcIixcbiAgICAgICAgRGltZW5zaW9uczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIE5hbWU6IFwiVGFibGVOYW1lXCIsXG4gICAgICAgICAgICBWYWx1ZTogdGFibGVOYW1lLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIE1ldHJpY05hbWU6IFwiQ29uc3VtZWRSZWFkQ2FwYWNpdHlVbml0c1wiLFxuICAgICAgfSxcbiAgICAgIFN0YXQ6IFwiU3VtXCIsXG4gICAgICBQZXJpb2Q6IHBlcmlvZCxcbiAgICB9LFxuICB9KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZExhbWJkYUJpbGxlZER1cmF0aW9uTWVtb3J5U2l6ZShcbiAgdGhpczogU29sdXRpb25zTWV0cmljcyxcbiAgbG9nR3JvdXBzOiBJTG9nR3JvdXBbXSxcbiAgcXVlcnlEZWZpbml0aW9uTmFtZTogc3RyaW5nLFxuICBsaW1pdDogbnVtYmVyIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkXG4pIHtcbiAgdGhpcy5hZGRRdWVyeURlZmluaXRpb24oe1xuICAgIGxvZ0dyb3VwcyxcbiAgICBxdWVyeVN0cmluZzogbmV3IFF1ZXJ5U3RyaW5nKHtcbiAgICAgIHN0YXRzOiBcInN1bShAYmlsbGVkRHVyYXRpb24pIGFzIEFXU0xhbWJkYUJpbGxlZER1cmF0aW9uLCBtYXgoQG1lbW9yeVNpemUpIGFzIEFXU0xhbWJkYU1lbW9yeVNpemVcIixcbiAgICAgIGxpbWl0LFxuICAgIH0pLFxuICAgIHF1ZXJ5RGVmaW5pdGlvbk5hbWUsXG4gIH0pO1xufVxuIl19