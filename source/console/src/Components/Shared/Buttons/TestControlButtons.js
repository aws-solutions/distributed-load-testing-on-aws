// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { withRouter, Link } from "react-router-dom";
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from "reactstrap";
import { del, post } from "aws-amplify/api";

import "brace";
import "brace/theme/github";

class TestControlButtons extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      showModal: false,
    };
    this.deleteToggle = this.deleteToggle.bind(this);
    this.deleteTest = this.deleteTest.bind(this);
    this.handleStart = this.handleStart.bind(this);
    this.setPayload = this.setPayload.bind(this);
  }

  deleteToggle() {
    this.setState((prevState) => ({
      showModal: !prevState.showModal,
    }));
  }

  deleteTest = async () => {
    const testId = this.props.testId;
    try {
      await del({ apiName: "dlts", path: `/scenarios/${testId}` }).response;
    } catch (err) {
      alert(err);
    }
    this.props.history.push("/dashboard");
  };

  setPayload() {
    const testId = this.props.testId;
    const data = this.props.data;
    let payload = {
      testId,
      testName: data.testName,
      testDescription: data.testDescription,
      testTaskConfigs: data.testTaskConfigs,
      testScenario: {
        execution: [
          {
            "ramp-up": data.rampUp,
            "hold-for": data.holdFor,
            scenario: data.testName,
            executor: data.testType !== "simple" ? data.testType : "jmeter", // default value
          },
        ],
        scenarios: {
          [data.testName]: {},
        },
      },
      showLive: data.showLive,
      testType: data.testType,
      scheduleData: data.scheduleDate,
      scheduleTime: data.scheduleTime,
      recurrence: data.recurrence,
      regionalTaskDetails: data.regionalTaskDetails,
    };

    const obj = {
      simple: {
        requests: [
          {
            url: data.endpoint,
            method: data.method,
            body: data.body,
            headers: data.headers,
          },
        ],
      },
      jmeter: {
        script: `${testId}.jmx`,
      },
      k6: {
        script: `${testId}.js`,
      },
      locust: {
        script: `${testId}.py`,
      },
    };
    payload.testScenario.scenarios[data.testName] = obj[data.testType];
    if (data.testType !== "simple") payload.fileType = data.fileType;
    return payload;
  }

  emptyRegionError() {
    const errorMessage =
      "The test contains a region that may have been deleted, if you wish to run this test, please edit the test to remove the deleted region.";
    alert(errorMessage);
    throw new Error(errorMessage);
  }

  async handleStart() {
    const payload = this.setPayload();
    const hasEmptyRegion = payload.testTaskConfigs.some((taskConfigs) => taskConfigs.taskCluster === "");

    try {
      hasEmptyRegion && this.emptyRegionError();
      const _response = await post({ apiName: "dlts", path: "/scenarios", options: { body: payload } }).response;
      const response = await _response.body.json();
      console.log("Scenario started successfully", response.testId);
      await this.props.refreshFunction();
    } catch (err) {
      console.error("Failed to start scenario", err);
    }
  }

  render() {
    return [
      <Button key="delete-button" id="deleteButton" color="danger" onClick={this.deleteToggle} size="sm">
        Delete
      </Button>,
      <Link key="update_link" to={{ pathname: "/create", state: { data: this.props.data } }}>
        <Button id="updateButton" key="updateButton" size="sm">
          Edit
        </Button>
      </Link>,
      <Button key="start-button" id="startButton" onClick={this.handleStart} size="sm">
        Start
      </Button>,
      <Modal key="delete-modal" isOpen={this.state.showModal} toggle={this.deleteToggle}>
        <ModalHeader>Warning</ModalHeader>
        <ModalBody>This will delete the test scenario and all of of the results</ModalBody>
        <ModalFooter>
          <Button id="cancelDeleteButton" color="link" size="sm" onClick={this.deleteToggle}>
            Cancel
          </Button>
          <Button id="deleteConfirmButton" color="danger" size="sm" onClick={this.deleteTest}>
            Delete
          </Button>
        </ModalFooter>
      </Modal>,
    ];
  }
}

export default withRouter(TestControlButtons);
