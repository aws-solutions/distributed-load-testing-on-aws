// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

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
      endpoint: "endpoint",
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
                url: "endpoint",
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

  test("setPayloadTestScenario for non simple test type", async () => {
    const createInstance = new Create(commonProps);
    // Mock the internal method and state as needed
    createInstance.uploadFileToScenarioBucket = jest.fn(() => Promise.resolve());
    createInstance.state = { file: undefined };

    const payload = { testScenario: { scenarios: {} } }; // Initial empty payload structure
    const props = {
      testType: "jmeter",
      testName: "testName",
      endpoint: "endpoint",
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

    props.testType = "k6";

    await createInstance.setPayloadTestScenario(props);

    expect(payload).toEqual({
      testScenario: {
        scenarios: {
          testName: {
            script: "123.js",
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
      expect(uploadData).toHaveBeenCalledTimes(1); // NOSONAR
    });
  });

  describe("checkIntervalDiff", () => {
    test("sets intervalDiff to true when onSchedule is '1' and checkEnoughIntervalDiff returns true", () => {
      const createInstance = new Create(commonProps);
      createInstance.state = {
        formValues: { onSchedule: "1" },
        intervalDiff: false,
      };
      createInstance.setState = jest.fn();
      createInstance.checkEnoughIntervalDiff = jest.fn().mockReturnValue(true);

      createInstance.checkIntervalDiff();

      expect(createInstance.setState).toHaveBeenCalledWith({ intervalDiff: true });
    });

    test("does not set intervalDiff when onSchedule is '0'", () => {
      const createInstance = new Create(commonProps);
      createInstance.state = {
        formValues: { onSchedule: "0" },
        intervalDiff: false,
      };
      createInstance.setState = jest.fn();
      createInstance.checkEnoughIntervalDiff = jest.fn().mockReturnValue(true);

      createInstance.checkIntervalDiff();

      expect(createInstance.setState).not.toHaveBeenCalled();
    });

    test("does not set intervalDiff when checkEnoughIntervalDiff returns false", () => {
      const createInstance = new Create(commonProps);
      createInstance.state = {
        formValues: { onSchedule: "1" },
        intervalDiff: false,
      };
      createInstance.setState = jest.fn();
      createInstance.checkEnoughIntervalDiff = jest.fn().mockReturnValue(false);

      createInstance.checkIntervalDiff();

      expect(createInstance.setState).not.toHaveBeenCalled();
    });
  });

  describe("handleInputChange", () => {
    test("updates form value for regular input", () => {
      const createInstance = new Create(commonProps);
      createInstance.setFormValue = jest.fn();
      const event = { target: { name: "testName", value: "New Test", id: "testName" } };

      createInstance.handleInputChange(event);

      expect(createInstance.setFormValue).toHaveBeenCalledWith("testName", "New Test", "testName");
    });

    test("handles checkbox input for showLive", () => {
      const createInstance = new Create(commonProps);
      createInstance.setFormValue = jest.fn();
      const event = { target: { name: "showLive", checked: true, id: "showLive" } };

      createInstance.handleInputChange(event);

      expect(createInstance.setFormValue).toHaveBeenCalledWith("showLive", true, "showLive");
    });

    test("updates submit label when onSchedule changes", () => {
      const createInstance = new Create(commonProps);
      createInstance.setFormValue = jest.fn();
      createInstance.setState = jest.fn();
      const event = { target: { name: "onSchedule", value: "1", id: "onSchedule" } };

      createInstance.handleInputChange(event);

      expect(createInstance.setState).toHaveBeenCalledWith({ submitLabel: "Schedule" });
    });

    test("updates submit label when onSchedule changes", () => {
      const createInstance = new Create(commonProps);
      createInstance.setFormValue = jest.fn();
      createInstance.setState = jest.fn();
      const event = { target: { name: "onSchedule", value: "0", id: "onSchedule" } };

      createInstance.handleInputChange(event);

      expect(createInstance.setState).toHaveBeenCalledWith({ submitLabel: "Run Now" });
    });

    test("calls checkForTaskCountWarning for testTaskConfigs", () => {
      const createInstance = new Create(commonProps);
      createInstance.setFormValue = jest.fn();
      createInstance.checkForTaskCountWarning = jest.fn();
      const event = { target: { name: "testTaskConfigs", value: "5", id: "taskCount-0" } };

      createInstance.handleInputChange(event);

      expect(createInstance.checkForTaskCountWarning).toHaveBeenCalledWith("5", "taskCount-0");
    });

    test("handles cronExpiryDate validation", () => {
      const createInstance = new Create(commonProps);
      createInstance.setFormValue = jest.fn();
      createInstance.setState = jest.fn();
      const event = { target: { name: "cronExpiryDate", value: "2023-01-01", id: "cronExpiryDate" } };

      createInstance.handleInputChange(event);

      expect(createInstance.setState).toHaveBeenCalledWith({ cronDateError: true });
    });
  });
});
