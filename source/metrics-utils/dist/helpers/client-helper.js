"use strict";
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientHelper = void 0;
const client_cloudwatch_1 = require("@aws-sdk/client-cloudwatch");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const client_cloudwatch_logs_1 = require("@aws-sdk/client-cloudwatch-logs");
class ClientHelper {
    getSqsClient() {
        if (!this.sqsClient) {
            this.sqsClient = new client_sqs_1.SQSClient();
        }
        return this.sqsClient;
    }
    getCwClient() {
        if (!this.cwClient) {
            this.cwClient = new client_cloudwatch_1.CloudWatchClient();
        }
        return this.cwClient;
    }
    getCwLogsClient() {
        if (!this.cwLogsClient) {
            this.cwLogsClient = new client_cloudwatch_logs_1.CloudWatchLogsClient();
        }
        return this.cwLogsClient;
    }
}
exports.ClientHelper = ClientHelper;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpZW50LWhlbHBlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNsaWVudC1oZWxwZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLHFFQUFxRTtBQUNyRSxzQ0FBc0M7OztBQUV0QyxrRUFBOEQ7QUFDOUQsb0RBQWdEO0FBQ2hELDRFQUF1RTtBQUV2RSxNQUFhLFlBQVk7SUFLdkIsWUFBWTtRQUNWLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDcEIsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLHNCQUFTLEVBQUUsQ0FBQztRQUNuQyxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDO0lBQ3hCLENBQUM7SUFFRCxXQUFXO1FBQ1QsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNuQixJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksb0NBQWdCLEVBQUUsQ0FBQztRQUN6QyxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDO0lBQ3ZCLENBQUM7SUFFRCxlQUFlO1FBQ2IsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUN2QixJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksNkNBQW9CLEVBQUUsQ0FBQztRQUNqRCxDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDO0lBQzNCLENBQUM7Q0FDRjtBQXpCRCxvQ0F5QkMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBDb3B5cmlnaHQgQW1hem9uLmNvbSwgSW5jLiBvciBpdHMgYWZmaWxpYXRlcy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbi8vIFNQRFgtTGljZW5zZS1JZGVudGlmaWVyOiBBcGFjaGUtMi4wXG5cbmltcG9ydCB7IENsb3VkV2F0Y2hDbGllbnQgfSBmcm9tIFwiQGF3cy1zZGsvY2xpZW50LWNsb3Vkd2F0Y2hcIjtcbmltcG9ydCB7IFNRU0NsaWVudCB9IGZyb20gXCJAYXdzLXNkay9jbGllbnQtc3FzXCI7XG5pbXBvcnQgeyBDbG91ZFdhdGNoTG9nc0NsaWVudCB9IGZyb20gXCJAYXdzLXNkay9jbGllbnQtY2xvdWR3YXRjaC1sb2dzXCI7XG5cbmV4cG9ydCBjbGFzcyBDbGllbnRIZWxwZXIge1xuICBwcml2YXRlIHNxc0NsaWVudDogU1FTQ2xpZW50O1xuICBwcml2YXRlIGN3Q2xpZW50OiBDbG91ZFdhdGNoQ2xpZW50O1xuICBwcml2YXRlIGN3TG9nc0NsaWVudDogQ2xvdWRXYXRjaExvZ3NDbGllbnQ7XG5cbiAgZ2V0U3FzQ2xpZW50KCk6IFNRU0NsaWVudCB7XG4gICAgaWYgKCF0aGlzLnNxc0NsaWVudCkge1xuICAgICAgdGhpcy5zcXNDbGllbnQgPSBuZXcgU1FTQ2xpZW50KCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLnNxc0NsaWVudDtcbiAgfVxuXG4gIGdldEN3Q2xpZW50KCk6IENsb3VkV2F0Y2hDbGllbnQge1xuICAgIGlmICghdGhpcy5jd0NsaWVudCkge1xuICAgICAgdGhpcy5jd0NsaWVudCA9IG5ldyBDbG91ZFdhdGNoQ2xpZW50KCk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmN3Q2xpZW50O1xuICB9XG5cbiAgZ2V0Q3dMb2dzQ2xpZW50KCk6IENsb3VkV2F0Y2hMb2dzQ2xpZW50IHtcbiAgICBpZiAoIXRoaXMuY3dMb2dzQ2xpZW50KSB7XG4gICAgICB0aGlzLmN3TG9nc0NsaWVudCA9IG5ldyBDbG91ZFdhdGNoTG9nc0NsaWVudCgpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5jd0xvZ3NDbGllbnQ7XG4gIH1cbn1cbiJdfQ==