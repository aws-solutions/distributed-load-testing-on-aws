import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { SQSClient } from "@aws-sdk/client-sqs";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
export declare class ClientHelper {
    private sqsClient;
    private cwClient;
    private cwLogsClient;
    getSqsClient(): SQSClient;
    getCwClient(): CloudWatchClient;
    getCwLogsClient(): CloudWatchLogsClient;
}
