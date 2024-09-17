import { SQSEvent } from "aws-lambda";
import { EventBridgeQueryEvent } from "./helpers/types";
/**
 * Metrics collector Lambda handler.
 * @param event The EventBridge or SQS request event.
 * @param _context The request context
 * @returns Processed request response.
 */
export declare function handler(event: EventBridgeQueryEvent | SQSEvent, _context: any): Promise<{
    statusCode: number;
    body: string;
}>;
