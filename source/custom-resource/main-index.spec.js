// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const crypto = require("crypto");

// Mock dependencies
const mockCfn = {
  send: jest.fn(),
};

const mockMetrics = {
  send: jest.fn(),
};

const mockS3 = {
  putRegionalTemplate: jest.fn(),
};

const mockIot = {
  getIotEndpoint: jest.fn(),
  detachIotPolicy: jest.fn(),
};

const mockStoreConfig = {
  testingResourcesConfigFile: jest.fn(),
  delTestingResourcesConfigFile: jest.fn(),
};

jest.mock("./lib/cfn", () => mockCfn);
jest.mock("./lib/metrics", () => mockMetrics);
jest.mock("./lib/s3", () => mockS3);
jest.mock("./lib/iot", () => mockIot);
jest.mock("./lib/config-storage", () => mockStoreConfig);

const lambda = require("./main-index.js");

describe("#MAIN-INDEX HANDLER::", () => {
  const context = { logStreamName: "test-log-stream" };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCfn.send.mockResolvedValue({});
  });

  describe("UUID Resource", () => {
    it("should generate UUID and SUFFIX on Create request", async () => {
      const event = {
        RequestType: "Create",
        ResourceProperties: {
          Resource: "UUID",
        },
      };

      await lambda.handler(event, context);

      expect(mockCfn.send).toHaveBeenCalledTimes(1);
      const [, , status, responseData, resource] = mockCfn.send.mock.calls[0];
      
      expect(status).toBe("SUCCESS");
      expect(resource).toBe("UUID");
      expect(responseData).toHaveProperty("UUID");
      expect(responseData).toHaveProperty("SUFFIX");
      
      // Verify UUID format (8-4-4-4-12 pattern)
      expect(responseData.UUID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      
      // Verify SUFFIX is last 10 characters of a UUID
      expect(responseData.SUFFIX).toHaveLength(10);
    });

    it("should not generate UUID on Update request", async () => {
      const event = {
        RequestType: "Update",
        ResourceProperties: {
          Resource: "UUID",
        },
      };

      await lambda.handler(event, context);

      expect(mockCfn.send).toHaveBeenCalledTimes(1);
      const [, , status, responseData] = mockCfn.send.mock.calls[0];
      
      expect(status).toBe("SUCCESS");
      expect(responseData).toEqual({});
    });

    it("should not generate UUID on Delete request", async () => {
      const event = {
        RequestType: "Delete",
        ResourceProperties: {
          Resource: "UUID",
        },
      };

      await lambda.handler(event, context);

      expect(mockCfn.send).toHaveBeenCalledTimes(1);
      const [, , status, responseData] = mockCfn.send.mock.calls[0];
      
      expect(status).toBe("SUCCESS");
      expect(responseData).toEqual({});
    });
  });

  describe("TestingResourcesConfigFile Resource", () => {
    it("should call testingResourcesConfigFile on Create request", async () => {
      const event = {
        RequestType: "Create",
        ResourceProperties: {
          Resource: "TestingResourcesConfigFile",
          TestingResourcesConfig: { bucket: "test-bucket" },
        },
      };

      await lambda.handler(event, context);

      expect(mockStoreConfig.testingResourcesConfigFile).toHaveBeenCalledWith({ bucket: "test-bucket" });
      expect(mockCfn.send).toHaveBeenCalledWith(event, context, "SUCCESS", {}, "TestingResourcesConfigFile");
    });

    it("should call delTestingResourcesConfigFile on Delete request", async () => {
      const event = {
        RequestType: "Delete",
        ResourceProperties: {
          Resource: "TestingResourcesConfigFile",
          TestingResourcesConfig: { bucket: "test-bucket" },
        },
      };

      await lambda.handler(event, context);

      expect(mockStoreConfig.delTestingResourcesConfigFile).toHaveBeenCalledWith({ bucket: "test-bucket" });
      expect(mockCfn.send).toHaveBeenCalledWith(event, context, "SUCCESS", {}, "TestingResourcesConfigFile");
    });
  });

  describe("PutRegionalTemplate Resource", () => {
    it("should call putRegionalTemplate on Create request", async () => {
      const event = {
        RequestType: "Create",
        ResourceProperties: {
          Resource: "PutRegionalTemplate",
          SourceBucket: "source",
          DestBucket: "dest",
        },
      };

      await lambda.handler(event, context);

      expect(mockS3.putRegionalTemplate).toHaveBeenCalledWith(event.ResourceProperties);
      expect(mockCfn.send).toHaveBeenCalledWith(event, context, "SUCCESS", {}, "PutRegionalTemplate");
    });

    it("should not call putRegionalTemplate on Delete request", async () => {
      const event = {
        RequestType: "Delete",
        ResourceProperties: {
          Resource: "PutRegionalTemplate",
        },
      };

      await lambda.handler(event, context);

      expect(mockS3.putRegionalTemplate).not.toHaveBeenCalled();
      expect(mockCfn.send).toHaveBeenCalledWith(event, context, "SUCCESS", {}, "PutRegionalTemplate");
    });
  });

  describe("GetIotEndpoint Resource", () => {
    it("should return IoT endpoint on Create request", async () => {
      mockIot.getIotEndpoint.mockResolvedValue("test-iot-endpoint.amazonaws.com");
      
      const event = {
        RequestType: "Create",
        ResourceProperties: {
          Resource: "GetIotEndpoint",
        },
      };

      await lambda.handler(event, context);

      expect(mockIot.getIotEndpoint).toHaveBeenCalledTimes(1);
      expect(mockCfn.send).toHaveBeenCalledWith(
        event,
        context,
        "SUCCESS",
        { IOT_ENDPOINT: "test-iot-endpoint.amazonaws.com" },
        "GetIotEndpoint"
      );
    });

    it("should not call getIotEndpoint on Update request", async () => {
      const event = {
        RequestType: "Update",
        ResourceProperties: {
          Resource: "GetIotEndpoint",
        },
      };

      await lambda.handler(event, context);

      expect(mockIot.getIotEndpoint).not.toHaveBeenCalled();
    });
  });

  describe("DetachIotPolicy Resource", () => {
    it("should call detachIotPolicy on Delete request", async () => {
      const event = {
        RequestType: "Delete",
        ResourceProperties: {
          Resource: "DetachIotPolicy",
          IotPolicyName: "test-policy",
        },
      };

      await lambda.handler(event, context);

      expect(mockIot.detachIotPolicy).toHaveBeenCalledWith("test-policy");
      expect(mockCfn.send).toHaveBeenCalledWith(event, context, "SUCCESS", {}, "DetachIotPolicy");
    });

    it("should not call detachIotPolicy on Create request", async () => {
      const event = {
        RequestType: "Create",
        ResourceProperties: {
          Resource: "DetachIotPolicy",
          IotPolicyName: "test-policy",
        },
      };

      await lambda.handler(event, context);

      expect(mockIot.detachIotPolicy).not.toHaveBeenCalled();
    });
  });

  describe("Metric Resource", () => {
    it("should call metrics.send on Create request", async () => {
      const event = {
        RequestType: "Create",
        ResourceProperties: {
          Resource: "Metric",
          SolutionId: "SO0062",
        },
      };

      await lambda.handler(event, context);

      expect(mockMetrics.send).toHaveBeenCalledWith(event.ResourceProperties, "Create");
      expect(mockCfn.send).toHaveBeenCalledWith(event, context, "SUCCESS", {}, "Metric");
    });
  });

  describe("Error Handling", () => {
    it("should throw error for unsupported resource", async () => {
      const event = {
        RequestType: "Create",
        ResourceProperties: {
          Resource: "UnsupportedResource",
        },
      };

      await expect(lambda.handler(event, context)).rejects.toThrow("Custom resource UnsupportedResource failed");
      expect(mockCfn.send).toHaveBeenCalledWith(event, context, "FAILED", {}, "UnsupportedResource");
    });

    it("should handle errors from dependencies and send FAILED response", async () => {
      mockIot.getIotEndpoint.mockRejectedValue(new Error("IoT Error"));
      
      const event = {
        RequestType: "Create",
        ResourceProperties: {
          Resource: "GetIotEndpoint",
        },
      };

      await expect(lambda.handler(event, context)).rejects.toThrow("Custom resource GetIotEndpoint failed");
      expect(mockCfn.send).toHaveBeenCalledWith(event, context, "FAILED", {}, "GetIotEndpoint");
    });
  });
});
