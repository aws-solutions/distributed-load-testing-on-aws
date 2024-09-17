"use strict";
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolutionsMetrics = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const aws_events_1 = require("aws-cdk-lib/aws-events");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_eventbridge_lambda_1 = require("@aws-solutions-constructs/aws-eventbridge-lambda");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
const aws_lambda_sqs_lambda_1 = require("@aws-solutions-constructs/aws-lambda-sqs-lambda");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const types_1 = require("../lambda/helpers/types");
const query_builders_1 = require("./query-builders");
class SolutionsMetrics extends constructs_1.Construct {
    constructor(scope, id, props) {
        var _a, _b, _c;
        super(scope, id);
        const { SOLUTION_ID, SOLUTION_NAME, CODE_VERSION } = process.env;
        this.metricsLambdaFunction = new aws_lambda_1.Function(this, "MetricsLambda", {
            description: "Metrics util",
            code: aws_lambda_1.Code.fromBucket(props.sourceCodeBucket, `${props.sourceCodePrefix}/metrics-utils.zip`),
            handler: "index.handler",
            runtime: aws_lambda_1.Runtime.NODEJS_18_X,
            timeout: aws_cdk_lib_1.Duration.seconds(60),
            memorySize: 128,
            environment: {
                QUERY_PREFIX: `${aws_cdk_lib_1.Aws.STACK_NAME}-`,
                SOLUTION_ID: SOLUTION_ID !== null && SOLUTION_ID !== void 0 ? SOLUTION_ID : scope.node.tryGetContext("solutionId"),
                SOLUTION_NAME: SOLUTION_NAME !== null && SOLUTION_NAME !== void 0 ? SOLUTION_NAME : scope.node.tryGetContext("solutionName"),
                SOLUTION_VERSION: CODE_VERSION !== null && CODE_VERSION !== void 0 ? CODE_VERSION : scope.node.tryGetContext("codeVersion"),
                UUID: (_a = props.uuid) !== null && _a !== void 0 ? _a : "",
                EXECUTION_DAY: props.executionDay ? props.executionDay : types_1.ExecutionDay.MONDAY,
            },
        });
        const ruleToLambda = new aws_eventbridge_lambda_1.EventbridgeToLambda(this, "EventbridgeRuleToLambda", {
            eventRuleProps: {
                schedule: aws_events_1.Schedule.cron({
                    minute: "0",
                    hour: "23",
                    weekDay: props.executionDay ? props.executionDay : types_1.ExecutionDay.MONDAY,
                }),
            },
            existingLambdaObj: this.metricsLambdaFunction,
        });
        (_b = props.queryProps) === null || _b === void 0 ? void 0 : _b.map(this.addQueryDefinition.bind(this));
        this.metricDataQueries = [];
        this.eventBridgeRule = ruleToLambda.eventsRule.node.defaultChild;
        (_c = props.metricDataProps) === null || _c === void 0 ? void 0 : _c.map(this.addMetricDataQuery.bind(this));
        new aws_lambda_sqs_lambda_1.LambdaToSqsToLambda(this, "LambdaToSqsToLambda", {
            existingConsumerLambdaObj: ruleToLambda.lambdaFunction,
            existingProducerLambdaObj: ruleToLambda.lambdaFunction,
            queueProps: {
                deliveryDelay: aws_cdk_lib_1.Duration.minutes(15),
                visibilityTimeout: aws_cdk_lib_1.Duration.minutes(17),
                receiveMessageWaitTime: aws_cdk_lib_1.Duration.seconds(20),
                retentionPeriod: aws_cdk_lib_1.Duration.days(1),
                maxMessageSizeBytes: 1024,
            },
            deployDeadLetterQueue: false,
        });
    }
    addQueryDefinition(queryDefinitionProps) {
        var _a;
        new aws_logs_1.QueryDefinition(this, queryDefinitionProps.queryDefinitionName, {
            ...queryDefinitionProps,
            queryDefinitionName: `${aws_cdk_lib_1.Aws.STACK_NAME}-${queryDefinitionProps.queryDefinitionName}`,
        });
        (_a = queryDefinitionProps.logGroups) === null || _a === void 0 ? void 0 : _a.map((logGroup) => logGroup.grant(this.metricsLambdaFunction, "logs:StartQuery", "logs:GetQueryResults"));
        this.metricsLambdaFunction.addToRolePolicy(new aws_iam_1.PolicyStatement({
            actions: ["logs:DescribeQueryDefinitions"],
            resources: ["*"],
        }));
    }
    addMetricDataQuery(metricDataProp) {
        if (this.metricDataQueries.length === 0) {
            this.metricsLambdaFunction.addToRolePolicy(new aws_iam_1.PolicyStatement({
                actions: ["cloudwatch:GetMetricData"],
                resources: ["*"],
            }));
        }
        this.metricDataQueries.push({
            ...metricDataProp,
            Id: `id_${aws_cdk_lib_1.Fn.join("_", aws_cdk_lib_1.Fn.split("-", aws_cdk_lib_1.Aws.STACK_NAME))}_${this.metricDataQueries.length}`,
        });
        this.eventBridgeRule.addOverride("Properties.Targets.0.InputTransformer", {
            InputPathsMap: {
                time: "$.time",
                "detail-type": "$.detail-type",
            },
            InputTemplate: `{"detail-type": <detail-type>, "time": <time>, "metrics-data-query": ${JSON.stringify(this.metricDataQueries)}}`,
        });
    }
}
exports.SolutionsMetrics = SolutionsMetrics;
Object.assign(SolutionsMetrics.prototype, {
    addLambdaInvocationCount: query_builders_1.addLambdaInvocationCount,
    addLambdaBilledDurationMemorySize: query_builders_1.addLambdaBilledDurationMemorySize,
    addCloudFrontMetric: query_builders_1.addCloudFrontMetric,
    addECSAverageCPUUtilization: query_builders_1.addECSAverageCPUUtilization,
    addECSAverageMemoryUtilization: query_builders_1.addECSAverageMemoryUtilization,
    addDynamoDBConsumedWriteCapacityUnits: query_builders_1.addDynamoDBConsumedWriteCapacityUnits,
    addDynamoDBConsumedReadCapacityUnits: query_builders_1.addDynamoDBConsumedReadCapacityUnits,
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic29sdXRpb25zLW1ldHJpY3MuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzb2x1dGlvbnMtbWV0cmljcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUEscUVBQXFFO0FBQ3JFLHNDQUFzQzs7O0FBRXRDLDZDQUE2RDtBQUM3RCwyQ0FBdUM7QUFDdkMsdURBQWtEO0FBQ2xELGlEQUFzRDtBQUN0RCw2RkFBdUY7QUFDdkYsdURBQW1GO0FBQ25GLDJGQUFzRjtBQUV0RixtREFBd0Y7QUFDeEYsbURBQThGO0FBQzlGLHFEQVEwQjtBQUUxQixNQUFhLGdCQUFpQixTQUFRLHNCQUFTO0lBSzdDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBMkI7O1FBQ25FLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsTUFBTSxFQUFFLFdBQVcsRUFBRSxhQUFhLEVBQUUsWUFBWSxFQUFFLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQztRQUNqRSxJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxxQkFBYyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDckUsV0FBVyxFQUFFLGNBQWM7WUFDM0IsSUFBSSxFQUFFLGlCQUFJLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxnQkFBZ0IsRUFBRSxHQUFHLEtBQUssQ0FBQyxnQkFBZ0Isb0JBQW9CLENBQUM7WUFDNUYsT0FBTyxFQUFFLGVBQWU7WUFDeEIsT0FBTyxFQUFFLG9CQUFPLENBQUMsV0FBVztZQUM1QixPQUFPLEVBQUUsc0JBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQzdCLFVBQVUsRUFBRSxHQUFHO1lBQ2YsV0FBVyxFQUFFO2dCQUNYLFlBQVksRUFBRSxHQUFHLGlCQUFHLENBQUMsVUFBVSxHQUFHO2dCQUNsQyxXQUFXLEVBQUUsV0FBVyxhQUFYLFdBQVcsY0FBWCxXQUFXLEdBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsWUFBWSxDQUFDO2dC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ckMsb0NBQW9DLEVBQXBDLHFEQUFvQztDQUNyQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgQW1hem9uLmNvbSwgSW5jLiBvciBpdHMgYWZmaWxpYXRlcy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbi8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG5cbmltcG9ydCB7IER1cmF0aW9uLCBDZm5SZXNvdXJjZSwgQXdzLCBGbiB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7IFNjaGVkdWxlIH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1ldmVudHNcIjtcbmltcG9ydCB7IFBvbGljeVN0YXRlbWVudCB9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtaWFtXCI7XG5pbXBvcnQgeyBFdmVudGJyaWRnZVRvTGFtYmRhIH0gZnJvbSBcIkBhd3Mtc29sdXRpb25zLWNvbnN0cnVjdHMvYXdzLWV2ZW50YnJpZGdlLWxhbWJkYVwiO1xuaW1wb3J0IHsgQ29kZSwgRnVuY3Rpb24gYXMgTGFtYmRhRnVuY3Rpb24sIFJ1bnRpbWUgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYVwiO1xuaW1wb3J0IHsgTGFtYmRhVG9TcXNUb0xhbWJkYSB9IGZyb20gXCJAYXdzLXNvbHV0aW9ucy1jb25zdHJ1Y3RzL2F3cy1sYW1iZGEtc3FzLWxhbWJkYVwiO1xuaW1wb3J0IHsgTWV0cmljRGF0YVF1ZXJ5IH0gZnJvbSBcIkBhd3Mtc2RrL2NsaWVudC1jbG91ZHdhdGNoXCI7XG5pbXBvcnQgeyBJTG9nR3JvdXAsIFF1ZXJ5RGVmaW5pdGlvbiwgUXVlcnlEZWZpbml0aW9uUHJvcHMgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxvZ3NcIjtcbmltcG9ydCB7IEV4ZWN1dGlvbkRheSwgTWV0cmljRGF0YVByb3BzLCBTb2x1dGlvbnNNZXRyaWNQcm9wcyB9IGZyb20gXCIuLi9sYW1iZGEvaGVscGVycy90eXBlc1wiO1xuaW1wb3J0IHtcbiAgYWRkTGFtYmRhQmlsbGVkRHVyYXRpb25NZW1vcnlTaXplLFxuICBhZGRDbG91ZEZyb250TWV0cmljLFxuICBhZGRMYW1iZGFJbnZvY2F0aW9uQ291bnQsXG4gIGFkZEVDU0F2ZXJhZ2VDUFVVdGlsaXphdGlvbixcbiAgYWRkRUNTQXZlcmFnZU1lbW9yeVV0aWxpemF0aW9uLFxuICBhZGREeW5hbW9EQkNvbnN1bWVkV3JpdGVDYXBhY2l0eVVuaXRzLFxuICBhZGREeW5hbW9EQkNvbnN1bWVkUmVhZENhcGFjaXR5VW5pdHMsXG59IGZyb20gXCIuL3F1ZXJ5LWJ1aWxkZXJzXCI7XG5cbmV4cG9ydCBjbGFzcyBTb2x1dGlvbnNNZXRyaWNzIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHJpdmF0ZSBtZXRyaWNEYXRhUXVlcmllczogTWV0cmljRGF0YVF1ZXJ5W107XG4gIHByaXZhdGUgZXZlbnRCcmlkZ2VSdWxlOiBDZm5SZXNvdXJjZTtcbiAgcHJpdmF0ZSBtZXRyaWNzTGFtYmRhRnVuY3Rpb246IExhbWJkYUZ1bmN0aW9uO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBTb2x1dGlvbnNNZXRyaWNQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBjb25zdCB7IFNPTFVUSU9OX0lELCBTT0xVVElPTl9OQU1FLCBDT0RFX1ZFUlNJT04gfSA9IHByb2Nlc3MuZW52O1xuICAgIHRoaXMubWV0cmljc0xhbWJkYUZ1bmN0aW9uID0gbmV3IExhbWJkYUZ1bmN0aW9uKHRoaXMsIFwiTWV0cmljc0xhbWJkYVwiLCB7XG4gICAgICBkZXNjcmlwdGlvbjogXCJNZXRyaWNzIHV0aWxcIixcbiAgICAgIGNvZGU6IENvZGUuZnJvbUJ1Y2tldChwcm9wcy5zb3VyY2VDb2RlQnVja2V0LCBgJHtwcm9wcy5zb3VyY2VDb2RlUHJlZml4fS9tZXRyaWNzLXV0aWxzLnppcGApLFxuICAgICAgaGFuZGxlcjogXCJpbmRleC5oYW5kbGVyXCIsXG4gICAgICBydW50aW1lOiBSdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICBtZW1vcnlTaXplOiAxMjgsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBRVUVSWV9QUkVGSVg6IGAke0F3cy5TVEFDS19OQU1FfS1gLFxuICAgICAgICBTT0xVVElPTl9JRDogU09MVVRJT05fSUQgPz8gc2NvcGUubm9kZS50cnlHZXRDb250ZXh0KFwic29sdXRpb25JZFwiKSxcbiAgICAgICAgU09MVVRJT05fTkFNRTogU09MVVRJT05fTkFNRSA/PyBzY29wZS5ub2RlLnRyeUdldENvbnRleHQoXCJzb2x1dGlvbk5hbWVcIiksXG4gICAgICAgIFNPTFVUSU9OX1ZFUlNJT046IENPREVfVkVSU0lPTiA/PyBzY29wZS5ub2RlLnRyeUdldENvbnRleHQoXCJjb2RlVmVyc2lvblwiKSxcbiAgICAgICAgVVVJRDogcHJvcHMudXVpZCA/PyBcIlwiLFxuICAgICAgICBFWEVDVVRJT05fREFZOiBwcm9wcy5leGVjdXRpb25EYXkgPyBwcm9wcy5leGVjdXRpb25EYXkgOiBFeGVjdXRpb25EYXkuTU9OREFZLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHJ1bGVUb0xhbWJkYSA9IG5ldyBFdmVudGJyaWRnZVRvTGFtYmRhKHRoaXMsIFwiRXZlbnRicmlkZ2VSdWxlVG9MYW1iZGFcIiwge1xuICAgICAgZXZlbnRSdWxlUHJvcHM6IHtcbiAgICAgICAgc2NoZWR1bGU6IFNjaGVkdWxlLmNyb24oe1xuICAgICAgICAgIG1pbnV0ZTogXCIwXCIsXG4gICAgICAgICAgaG91cjogXCIyM1wiLFxuICAgICAgICAgIHdlZWtEYXk6IHByb3BzLmV4ZWN1dGlvbkRheSA/IHByb3BzLmV4ZWN1dGlvbkRheSA6IEV4ZWN1dGlvbkRheS5NT05EQVksXG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICAgIGV4aXN0aW5nTGFtYmRhT2JqOiB0aGlzLm1ldHJpY3NMYW1iZGFGdW5jdGlvbixcbiAgICB9KTtcblxuICAgIHByb3BzLnF1ZXJ5UHJvcHM/Lm1hcCh0aGlzLmFkZFF1ZXJ5RGVmaW5pdGlvbi5iaW5kKHRoaXMpKTtcblxuICAgIHRoaXMubWV0cmljRGF0YVF1ZXJpZXMgPSBbXTtcbiAgICB0aGlzLmV2ZW50QnJpZGdlUnVsZSA9IHJ1bGVUb0xhbWJkYS5ldmVudHNSdWxlLm5vZGUuZGVmYXVsdENoaWxkIGFzIENmblJlc291cmNlO1xuICAgIHByb3BzLm1ldHJpY0RhdGFQcm9wcz8ubWFwKHRoaXMuYWRkTWV0cmljRGF0YVF1ZXJ5LmJpbmQodGhpcykpO1xuXG4gICAgbmV3IExhbWJkYVRvU3FzVG9MYW1iZGEodGhpcywgXCJMYW1iZGFUb1Nxc1RvTGFtYmRhXCIsIHtcbiAgICAgIGV4aXN0aW5nQ29uc3VtZXJMYW1iZGFPYmo6IHJ1bGVUb0xhbWJkYS5sYW1iZGFGdW5jdGlvbixcbiAgICAgIGV4aXN0aW5nUHJvZHVjZXJMYW1iZGFPYmo6IHJ1bGVUb0xhbWJkYS5sYW1iZGFGdW5jdGlvbixcbiAgICAgIHF1ZXVlUHJvcHM6IHtcbiAgICAgICAgZGVsaXZlcnlEZWxheTogRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBEdXJhdGlvbi5taW51dGVzKDE3KSxcbiAgICAgICAgcmVjZWl2ZU1lc3NhZ2VXYWl0VGltZTogRHVyYXRpb24uc2Vjb25kcygyMCksXG4gICAgICAgIHJldGVudGlvblBlcmlvZDogRHVyYXRpb24uZGF5cygxKSxcbiAgICAgICAgbWF4TWVzc2FnZVNpemVCeXRlczogMTAyNCxcbiAgICAgIH0sXG4gICAgICBkZXBsb3lEZWFkTGV0dGVyUXVldWU6IGZhbHNlLFxuICAgIH0pO1xuICB9XG5cbiAgYWRkUXVlcnlEZWZpbml0aW9uKHF1ZXJ5RGVmaW5pdGlvblByb3BzOiBRdWVyeURlZmluaXRpb25Qcm9wcyk6IHZvaWQge1xuICAgIG5ldyBRdWVyeURlZmluaXRpb24odGhpcywgcXVlcnlEZWZpbml0aW9uUHJvcHMucXVlcnlEZWZpbml0aW9uTmFtZSwge1xuICAgICAgLi4ucXVlcnlEZWZpbml0aW9uUHJvcHMsXG4gICAgICBxdWVyeURlZmluaXRpb25OYW1lOiBgJHtBd3MuU1RBQ0tfTkFNRX0tJHtxdWVyeURlZmluaXRpb25Qcm9wcy5xdWVyeURlZmluaXRpb25OYW1lfWAsXG4gICAgfSk7XG4gICAgcXVlcnlEZWZpbml0aW9uUHJvcHMubG9nR3JvdXBzPy5tYXAoKGxvZ0dyb3VwOiBJTG9nR3JvdXApID0+XG4gICAgICBsb2dHcm91cC5ncmFudCh0aGlzLm1ldHJpY3NMYW1iZGFGdW5jdGlvbiwgXCJsb2dzOlN0YXJ0UXVlcnlcIiwgXCJsb2dzOkdldFF1ZXJ5UmVzdWx0c1wiKVxuICAgICk7XG4gICAgdGhpcy5tZXRyaWNzTGFtYmRhRnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IFBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcImxvZ3M6RGVzY3JpYmVRdWVyeURlZmluaXRpb25zXCJdLFxuICAgICAgICByZXNvdXJjZXM6IFtcIipcIl0sXG4gICAgICB9KVxuICAgICk7XG4gIH1cblxuICBhZGRNZXRyaWNEYXRhUXVlcnkobWV0cmljRGF0YVByb3A6IE1ldHJpY0RhdGFQcm9wcyk6IHZvaWQge1xuICAgIGlmICh0aGlzLm1ldHJpY0RhdGFRdWVyaWVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5tZXRyaWNzTGFtYmRhRnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgICBuZXcgUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBhY3Rpb25zOiBbXCJjbG91ZHdhdGNoOkdldE1ldHJpY0RhdGFcIl0sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbXCIqXCJdLFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG4gICAgdGhpcy5tZXRyaWNEYXRhUXVlcmllcy5wdXNoKHtcbiAgICAgIC4uLm1ldHJpY0RhdGFQcm9wLFxuICAgICAgSWQ6IGBpZF8ke0ZuLmpvaW4oXCJfXCIsIEZuLnNwbGl0KFwiLVwiLCBBd3MuU1RBQ0tfTkFNRSkpfV8ke3RoaXMubWV0cmljRGF0YVF1ZXJpZXMubGVuZ3RofWAsXG4gICAgfSk7XG4gICAgdGhpcy5ldmVudEJyaWRnZVJ1bGUuYWRkT3ZlcnJpZGUoXCJQcm9wZXJ0aWVzLlRhcmdldHMuMC5JbnB1dFRyYW5zZm9ybWVyXCIsIHtcbiAgICAgIElucHV0UGF0aHNNYXA6IHtcbiAgICAgICAgdGltZTogXCIkLnRpbWVcIixcbiAgICAgICAgXCJkZXRhaWwtdHlwZVwiOiBcIiQuZGV0YWlsLXR5cGVcIixcbiAgICAgIH0sXG4gICAgICBJbnB1dFRlbXBsYXRlOiBge1wiZGV0YWlsLXR5cGVcIjogPGRldGFpbC10eXBlPiwgXCJ0aW1lXCI6IDx0aW1lPiwgXCJtZXRyaWNzLWRhdGEtcXVlcnlcIjogJHtKU09OLnN0cmluZ2lmeShcbiAgICAgICAgdGhpcy5tZXRyaWNEYXRhUXVlcmllc1xuICAgICAgKX19YCxcbiAgICB9KTtcbiAgfVxuXG4gIGFkZExhbWJkYUludm9jYXRpb25Db3VudDogdHlwZW9mIGFkZExhbWJkYUludm9jYXRpb25Db3VudDtcbiAgYWRkTGFtYmRhQmlsbGVkRHVyYXRpb25NZW1vcnlTaXplOiB0eXBlb2YgYWRkTGFtYmRhQmlsbGVkRHVyYXRpb25NZW1vcnlTaXplO1xuICBhZGRDbG91ZEZyb250TWV0cmljOiB0eXBlb2YgYWRkQ2xvdWRGcm9udE1ldHJpYztcbiAgYWRkRUNTQXZlcmFnZUNQVVV0aWxpemF0aW9uOiB0eXBlb2YgYWRkRUNTQXZlcmFnZUNQVVV0aWxpemF0aW9uO1xuICBhZGRFQ1NBdmVyYWdlTWVtb3J5VXRpbGl6YXRpb246IHR5cGVvZiBhZGRFQ1NBdmVyYWdlTWVtb3J5VXRpbGl6YXRpb247XG4gIGFkZER5bmFtb0RCQ29uc3VtZWRXcml0ZUNhcGFjaXR5VW5pdHM6IHR5cGVvZiBhZGREeW5hbW9EQkNvbnN1bWVkV3JpdGVDYXBhY2l0eVVuaXRzO1xuICBhZGREeW5hbW9EQkNvbnN1bWVkUmVhZENhcGFjaXR5VW5pdHM6IHR5cGVvZiBhZGREeW5hbW9EQkNvbnN1bWVkUmVhZENhcGFjaXR5VW5pdHM7XG59XG5cbk9iamVjdC5hc3NpZ24oU29sdXRpb25zTWV0cmljcy5wcm90b3R5cGUsIHtcbiAgYWRkTGFtYmRhSW52b2NhdGlvbkNvdW50LFxuICBhZGRMYW1iZGFCaWxsZWREdXJhdGlvbk1lbW9yeVNpemUsXG4gIGFkZENsb3VkRnJvbnRNZXRyaWMsXG4gIGFkZEVDU0F2ZXJhZ2VDUFVVdGlsaXphdGlvbixcbiAgYWRkRUNTQXZlcmFnZU1lbW9yeVV0aWxpemF0aW9uLFxuICBhZGREeW5hbW9EQkNvbnN1bWVkV3JpdGVDYXBhY2l0eVVuaXRzLFxuICBhZGREeW5hbW9EQkNvbnN1bWVkUmVhZENhcGFjaXR5VW5pdHMsXG59KTtcbiJdfQ==