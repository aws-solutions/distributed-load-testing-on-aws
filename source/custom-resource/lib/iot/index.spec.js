// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockIot = jest.fn();
const mockAWS = require("aws-sdk");
mockAWS.Iot = jest.fn(() => ({
  describeEndpoint: mockIot,
  listTargetsForPolicy: mockIot,
  detachPrincipalPolicy: mockIot,
}));
mockAWS.config = jest.fn(() => ({
  logger: Function,
}));
process.env.SOLUTION_ID = "SO0062";
process.env.VERSION = "3.0.0";
const lambda = require("./index.js");

describe("#IOT::", () => {
  beforeEach(() => {
    mockIot.mockReset();
  });

  it("should return endpoint on getIotEndpoint success", async () => {
    mockIot.mockImplementationOnce(() => ({
      promise() {
        //describeEndpoint
        return Promise.resolve({ endpointAddress: "test-endpoint" });
      },
    }));

    const response = await lambda.getIotEndpoint();
    expect(response).toEqual("test-endpoint");
    expect(mockIot).toHaveBeenCalledTimes(1);
    expect(mockIot).toHaveBeenCalledWith({
      endpointType: "iot:Data-ATS",
    });
  });

  it('should return "error" on getIotEndpoint error', async () => {
    mockIot.mockImplementationOnce(() => ({
      promise() {
        //describeEndpoint
        return Promise.reject("error");
      },
    }));

    try {
      await lambda.getIotEndpoint();
    } catch (err) {
      expect(err).toEqual("error");
    }
  });

  it('should return "success" on detachIotPolicy success', async () => {
    mockIot.mockImplementationOnce(() => ({
      promise() {
        //listTargetsForPolicy
        return Promise.resolve({ targets: ["target1"] });
      },
    }));

    mockIot.mockImplementationOnce(() => ({
      promise() {
        //detachPrincipalPolicy
        return Promise.resolve();
      },
    }));

    const response = await lambda.detachIotPolicy("iot-policy");
    expect(response).toEqual("success");
    expect(mockIot).toHaveBeenNthCalledWith(1, {
      policyName: "iot-policy",
    });
    expect(mockIot).toHaveBeenNthCalledWith(2, {
      policyName: "iot-policy",
      principal: "target1",
    });
  });

  it('should return "error" on listTargetsForPolicy error', async () => {
    mockIot.mockImplementationOnce(() => ({
      promise() {
        //listTargetsForPolicy
        return Promise.reject("error");
      },
    }));

    try {
      await lambda.detachIotPolicy("iot-policy");
    } catch (err) {
      expect(err).toEqual("error");
    }
  });

  it('should return "error" on detachPrincipalPolicy error', async () => {
    mockIot.mockImplementationOnce(() => ({
      promise() {
        //listTargetsForPolicy
        return Promise.resolve({ targets: ["target1"] });
      },
    }));

    mockIot.mockImplementationOnce(() => ({
      promise() {
        //detachPrincipalPolicy
        return Promise.reject("error");
      },
    }));

    try {
      await lambda.detachIotPolicy("iot-policy");
    } catch (err) {
      expect(err).toEqual("error");
    }
  });
});
