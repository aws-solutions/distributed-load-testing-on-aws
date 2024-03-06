import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import Create from "./Create";
import { uploadData } from "aws-amplify/storage";

jest.mock("aws-amplify/api", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));
jest.mock("aws-amplify/storage", () => ({
  uploadData: jest.fn(),
}));

const commonProps = {
  // Example prop structure based on your component's needs
  location: {
    state: {
      data: {
        testId: "123",
        testType: "jmeter",
        fileType: "script",
        holdFor: "11",
        rampUp: "12",
        testTaskConfigs: [
          {
            region: "us-east-1",
            concurrency: "5",
            taskCount: "5",
          },
        ],
      },
    },
  },
};

describe("Component Testing", () => {
  test("setInitialFileType see if Run Now is not disabled", () => {
    // Example of Componenet Testings
    render(<Create {...commonProps} />);
    expect(screen.getByRole("button", { name: "Run Now" })).not.toBeDisabled();
  });
});

describe("Functions Testing", () => {
  test("setInitialFileType returns script type", () => {
    const createInstance = new Create(commonProps);
    const result = createInstance.setInitialFileType(/* arguments */);
    expect(result).toBe("script");
  });
  test("setInitialFileType returns type", () => {
    const props = {
      // Example prop structure based on your component's needs
      location: {
        state: {
          data: {
            testId: "123",
            testType: "jmeter",
            fileType: "fileType",
            holdFor: "11",
            rampUp: "12",
            testTaskConfigs: [
              {
                region: "us-east-1",
                concurrency: "5",
                taskCount: "5",
              },
            ],
          },
        },
      },
    };
    const createInstance = new Create(props);
    const result = createInstance.setInitialFileType();
    expect(result).toBe("fileType");
  });

  test("setPayloadTestScenario for simple test type", async () => {
    const createInstance = new Create(commonProps);
    // Mock the internal method and state as needed
    createInstance.state = { file: undefined };

    const payload = { testScenario: { scenarios: {} } }; // Initial empty payload structure
    const props = {
      testType: "simple",
      testName: "testName",
      endpoint: "http://example.com",
      method: "GET",
      headers: "{}",
      body: "{}",
      payload,
      testId: "123",
    };

    await createInstance.setPayloadTestScenario(props);

    expect(payload).toEqual({
      testScenario: {
        scenarios: {
          testName: {
            requests: [
              {
                url: "http://example.com",
                method: "GET",
                body: {},
                headers: {},
              },
            ],
          },
        },
      },
    });
  });

  test("setPayloadTestScenario for NOT simple test type", async () => {
    const createInstance = new Create(commonProps);
    // Mock the internal method and state as needed
    createInstance.uploadFileToScenarioBucket = jest.fn(() => Promise.resolve());
    createInstance.state = { file: undefined };

    const payload = { testScenario: { scenarios: {} } }; // Initial empty payload structure
    const props = {
      testType: "NOT SIMPLE",
      testName: "testName",
      endpoint: "http://example.com",
      method: "GET",
      headers: "{}",
      body: "{}",
      payload,
      testId: "123",
    };

    await createInstance.setPayloadTestScenario(props);

    expect(payload).toEqual({
      testScenario: {
        scenarios: {
          testName: {
            script: "123.jmx",
          },
        },
      },
    });
  });

  describe("uploadFileToScenarioBucket", () => {
    test.each([
      ["zip", "test.zip"],
      ["script", "test.jmx"],
    ])("uploads file successfully for fileType %s", async (initialFileType) => {
      let createInstance = new Create(commonProps);
      createInstance.state = { file: { type: initialFileType === "zip" ? "application/zip" : "text/plain" } };
      await createInstance.uploadFileToScenarioBucket("test");
      expect(uploadData).toHaveBeenCalledTimes(1);
    });
  });
});
