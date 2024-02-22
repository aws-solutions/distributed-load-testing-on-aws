// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { withRouter, Link } from "react-router-dom";
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from "reactstrap";
import { API } from "aws-amplify";

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
      await API.del("dlts", `/scenarios/${testId}`);
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

    if (data.testType === "simple") {
      payload.testScenario.scenarios[data.testName] = {
        requests: [
          {
            url: data.endpoint,
            method: data.method,
            body: data.body,
            headers: data.headers,
          },
        ],
      };
    } else {
      var extension;
      if (data.testType === "jmeter") {
        extension = "jmx";
      }
      if (data.testType === "k6") {
        extension = "js";
      }
      payload.testScenario.execution[0].executor = data.testType;
      payload.testScenario.scenarios[data.testName] = {
        script: `${testId}.${extension}`,
      };
      payload.fileType = data.fileType;
    }

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
      const response = await API.post("dlts", "/scenarios", { body: payload });
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
