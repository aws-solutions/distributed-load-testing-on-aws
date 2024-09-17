import { SendMessageCommandOutput } from "@aws-sdk/client-sqs";
import { ResultField, QueryDefinition } from "@aws-sdk/client-cloudwatch-logs";
import { EventBridgeQueryEvent, MetricPayload, MetricData, QueryProps, SQSEventBody } from "./types";
import { SQSEvent } from "aws-lambda";
export declare class MetricsHelper {
    private clientHelper;
    constructor();
    getMetricsData(event: EventBridgeQueryEvent): Promise<MetricData>;
    private fetchMetricsData;
    processQueryResults(resolvedQueries: (ResultField | undefined)[], body: SQSEventBody): MetricData;
    getQueryDefinitions(queryPrefix: string): Promise<QueryDefinition[]>;
    startQueries(event: EventBridgeQueryEvent): Promise<SendMessageCommandOutput>;
    sendSQS(sqsBody: SQSEventBody): Promise<SendMessageCommandOutput>;
    startQuery(queryProp: QueryProps, endTime: Date): Promise<string>;
    resolveQuery(queryId: string): Promise<ResultField[] | undefined>;
    resolveQueries(event: SQSEvent): Promise<(ResultField | undefined)[]>;
    sendAnonymousMetric(results: MetricData, startTime: Date, endTime: Date): Promise<{
        Message: string;
        Data?: MetricPayload;
    }>;
}
