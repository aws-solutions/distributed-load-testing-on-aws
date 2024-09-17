import { ILogGroup } from "aws-cdk-lib/aws-logs";
import { SolutionsMetrics } from "./solutions-metrics";
export declare function addLambdaInvocationCount(this: SolutionsMetrics, functionName: string, period?: number): void;
export declare function addCloudFrontMetric(this: SolutionsMetrics, distributionId: string, metricName: string, period?: number): void;
export declare function addECSAverageCPUUtilization(this: SolutionsMetrics, clusterName: string, taskDefinitionFamily?: string, period?: number): void;
export declare function addECSAverageMemoryUtilization(this: SolutionsMetrics, clusterName: string, taskDefinitionFamily?: string, period?: number): void;
export declare function addDynamoDBConsumedWriteCapacityUnits(this: SolutionsMetrics, tableName: string, period?: number): void;
export declare function addDynamoDBConsumedReadCapacityUnits(this: SolutionsMetrics, tableName: string, period?: number): void;
export declare function addLambdaBilledDurationMemorySize(this: SolutionsMetrics, logGroups: ILogGroup[], queryDefinitionName: string, limit?: number | undefined): void;
