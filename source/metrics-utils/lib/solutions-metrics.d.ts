import { Construct } from "constructs";
import { QueryDefinitionProps } from "aws-cdk-lib/aws-logs";
import { MetricDataProps, SolutionsMetricProps } from "../lambda/helpers/types";
import { addLambdaBilledDurationMemorySize, addCloudFrontMetric, addLambdaInvocationCount, addECSAverageCPUUtilization, addECSAverageMemoryUtilization, addDynamoDBConsumedWriteCapacityUnits, addDynamoDBConsumedReadCapacityUnits } from "./query-builders";
export declare class SolutionsMetrics extends Construct {
    private metricDataQueries;
    private eventBridgeRule;
    private metricsLambdaFunction;
    constructor(scope: Construct, id: string, props: SolutionsMetricProps);
    addQueryDefinition(queryDefinitionProps: QueryDefinitionProps): void;
    addMetricDataQuery(metricDataProp: MetricDataProps): void;
    addLambdaInvocationCount: typeof addLambdaInvocationCount;
    addLambdaBilledDurationMemorySize: typeof addLambdaBilledDurationMemorySize;
    addCloudFrontMetric: typeof addCloudFrontMetric;
    addECSAverageCPUUtilization: typeof addECSAverageCPUUtilization;
    addECSAverageMemoryUtilization: typeof addECSAverageMemoryUtilization;
    addDynamoDBConsumedWriteCapacityUnits: typeof addDynamoDBConsumedWriteCapacityUnits;
    addDynamoDBConsumedReadCapacityUnits: typeof addDynamoDBConsumedReadCapacityUnits;
}
