// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// Mock AWS SDK
const mockIoT = {
  describeEndpoint: jest.fn(),
  listTargetsForPolicy: jest.fn(),
  detachPrincipalPolicy: jest.fn(),
};

jest.mock("@aws-sdk/client-iot", () => ({
  IoT: jest.fn(() => ({
    describeEndpoint: mockIoT.describeEndpoint,
    listTargetsForPolicy: mockIoT.listTargetsForPolicy,
    detachPrincipalPolicy: mockIoT.detachPrincipalPolicy,
  })),
}));

process.env.SOLUTION_ID = "SO0062";
process.env.VERSION = "3.0.0";
const lambda = require("./index.js");

describe("#IOT::", () => {
  beforeEach(() => {
    mockIoT.describeEndpoint.mockReset();
    mockIoT.listTargetsForPolicy.mockReset();
    mockIoT.detachPrincipalPolicy.mockReset();
  });

  it("should return endpoint on getIotEndpoint success", async () => {
    mockIoT.describeEndpoint.mockResolvedValueOnce({ endpointAddress: "test-endpoint" });

    const response = await lambda.getIotEndpoint();
    expect(response).toEqual("test-endpoint");
    expect(mockIoT.describeEndpoint).toHaveBeenCalledTimes(1);
    expect(mockIoT.describeEndpoint).toHaveBeenCalledWith({
      endpointType: "iot:Data-ATS",
    });
  });

  it('should return "error" on getIotEndpoint error', async () => {
    mockIoT.describeEndpoint.mockRejectedValueOnce("error");

    try {
      await lambda.getIotEndpoint();
    } catch (err) {
      expect(err).toEqual("error");
    }
  });

  it('should return "success" on detachIotPolicy success', async () => {
    mockIoT.listTargetsForPolicy.mockResolvedValueOnce({ targets: ["target1"] });
    mockIoT.detachPrincipalPolicy.mockResolvedValueOnce({});

    const response = await lambda.detachIotPolicy("iot-policy");
    expect(response).toEqual("success");
    expect(mockIoT.listTargetsForPolicy).toHaveBeenNthCalledWith(1, {
      policyName: "iot-policy",
    });
    expect(mockIoT.detachPrincipalPolicy).toHaveBeenNthCalledWith(1, {
      policyName: "iot-policy",
      principal: "target1",
    });
  });

  it('should return "error" on listTargetsForPolicy error', async () => {
    mockIoT.listTargetsForPolicy.mockRejectedValueOnce("error");

    try {
      await lambda.detachIotPolicy("iot-policy");
    } catch (err) {
      expect(err).toEqual("error");
    }
  });

  it('should return "error" on detachPrincipalPolicy error', async () => {
    mockIoT.listTargetsForPolicy.mockResolvedValueOnce({ targets: ["target1"] });
    mockIoT.detachPrincipalPolicy.mockRejectedValueOnce("error");

    try {
      await lambda.detachIotPolicy("iot-policy");
    } catch (err) {
      expect(err).toEqual("error");
    }
  });
});
