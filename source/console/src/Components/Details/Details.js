// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { Spinner } from "reactstrap";
import { API, Storage } from "aws-amplify";

import PageHeader from "../Shared/PageHeader/PageHeader.js";
import RefreshButtons from "../Shared/Buttons/RefreshButtons.js";
import CancelButtons from "../Shared/Buttons/CancelButtons.js";
import TestControlButtons from "../Shared/Buttons/TestControlButtons.js";
import Results from "../Results/Results.js";
import Running from "../Running/Running.js";
import History from "../History/History.js";
import DetailsTable from "./DetailsTable";

import "brace";
import "brace/theme/github";

class Details extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      autoRefresh: false,
      refreshIntervalToggle: false,
      refreshInterval: "30 seconds",
      isLoading: true,
      runningTasks: false,
      isCurrentTestRunning: true,
      testId: props.match.params.testId,
      testDuration: 0,
      data: {
        completeTasks: {},
        testName: null,
        testDescription: null,
        testType: null,
        fileType: null,
        results: {},
        history: [],
        testTaskConfigs: [],
        rampUp: null,
        holdFor: null,
        endpoint: null,
        method: null,
        taskArns: [],
        testScenario: {
          execution: [],
          reporting: [],
          scenarios: {},
        },
        scheduleDate: null,
        scheduleTime: null,
        recurrence: null,
        regionalTaskDetails: {},
      },
    };
    this.handleDownload = this.handleDownload.bind(this);
    this.calculateTestDurationSeconds = this.calculateTestDurationSeconds.bind(this);
    this.handleFullTestDataLocation = this.handleFullTestDataLocation.bind(this);
  }

  componentDidMount = async () => {
    if (!this.state.testId) {
      this.props.history.push("../");
    } else {
      await this.getTest();
    }
  };

  reloadData = async () => {
    this.setState({ isLoading: true });
    await this.getTest();
  };

  // sets common state values to be presented, either current or past tests
  setTestData(data) {
    data.rampUp = data.testScenario.execution[0]["ramp-up"];
    data.holdFor = data.testScenario.execution[0]["hold-for"];
    const testDuration = this.calculateTestDurationSeconds([data.rampUp, data.holdFor]);
    if (!data.testType || ["", "simple"].includes(data.testType)) {
      data.testType = "simple";
      data.endpoint = data.testScenario.scenarios[`${data.testName}`].requests[0].url;
      data.method = data.testScenario.scenarios[`${data.testName}`].requests[0].method;
      data.body = data.testScenario.scenarios[`${data.testName}`].requests[0].body;
      data.headers = data.testScenario.scenarios[`${data.testName}`].requests[0].headers;
    } else {
      data.testScenario.execution[0].executor = data.testType;
    }

    this.setState({
      data,
      testDuration,
      isCurrentTestRunning: data.status === "running",
      isLoading: false,
    });
  }

  getTest = async () => {
    const testId = this.state.testId;
    try {
      const data = await API.get("dlts", `/scenarios/${testId}`);
      if (data.nextRun) {
        const [scheduleDate, scheduleTime] = data.nextRun.split(" ");
        data.scheduleDate = scheduleDate;
        data.scheduleTime = scheduleTime.split(":", 2).join(":");
        data.recurrence = data.scheduleRecurrence;
        delete data.nextRun;
      }
      data.regionalTaskDetails = await API.get("dlts", "/vCPUDetails");
      this.setTestData(data);
    } catch (err) {
      console.error(err);
      alert(err);
    }
  };

  calculateTestDurationSeconds = (items) => {
    let seconds = 0;

    for (let item of items) {
      // On the UI, the item format would be always Xm or Xs (X is a number).
      if (item.endsWith("m")) {
        seconds += parseInt(item.slice(0, item.length - 1)) * 60;
      } else {
        seconds += parseInt(item.slice(0, item.length - 1));
      }
    }

    return seconds;
  };

  async handleDownload() {
    try {
      const testId = this.state.testId;
      const { testType } = this.state.data;
      var extension;
      if (testType === "jmeter") {
        extension = "jmx";
      }
      if (testType === "k6") {
        extension = "js";
      }
      let filename = this.state.data.fileType === "zip" ? `${testId}.zip` : `${testId}.${extension}`;
      const url = await Storage.get(`test-scenarios/${testType}/${filename}`, { expires: 10 });
      window.open(url, "_blank");
    } catch (error) {
      console.error("Error", error);
    }
  }

  async handleFullTestDataLocation() {
    try {
      const testId = this.state.testId;
      const url = `https://console.aws.amazon.com/s3/buckets/${Storage._config.AWSS3.bucket}?prefix=results/${testId}/`;
      window.open(url, "_blank");
    } catch (error) {
      console.error("Failed to open S3 location for test run results", error);
    }
  }

  render() {
    const { data, testDuration } = this.state;
    const cancelled = (
      <div className="box">
        <h2>Test Results</h2>
        <p>No results available as the test was cancelled.</p>
      </div>
    );

    const failed = (
      <div className="box">
        <h2>Test Failed</h2>
        <h6>
          <pre>{JSON.stringify(data.taskError, null, 2) || data.errorReason}</pre>
        </h6>
      </div>
    );
    const details = (
      <div>
        {this.state.isCurrentTestRunning ? (
          <PageHeader
            title="Load Test Details"
            refreshButton={<RefreshButtons key="refresh-buttons" refreshFunction={this.reloadData} />}
            cancelButton={<CancelButtons key="cancel-buttons" testId={this.state.testId} />}
          />
        ) : (
          <PageHeader
            title="Load Test Details"
            testControlButtons={
              <TestControlButtons
                key="test-control-buttons"
                testId={this.state.testId}
                data={this.state.data}
                refreshFunction={this.reloadData}
              />
            }
          />
        )}
        {this.state.isLoading ? (
          <div className="loading">
            <Spinner color="secondary" />
          </div>
        ) : (
          <React.Fragment>
            <DetailsTable
              data={data}
              handleDownload={this.handleDownload}
              handleFullTestDataLocation={this.handleFullTestDataLocation}
            ></DetailsTable>

            {data.status === "complete" && (
              <Results
                data={data}
                testDuration={testDuration}
                regions={Object.keys(this.state.data.results).filter((region) => region !== "total")}
              />
            )}
            {data.status === "cancelled" && cancelled}
            {data.status === "failed" && failed}
            {data.status === "running" && <Running data={data} testId={this.state.testId} />}
            {data.history && <History data={data} handleFullTestDataLocation={this.handleFullTestDataLocation} />}
          </React.Fragment>
        )}
      </div>
    );

    return <div>{details}</div>;
  }
}

export default Details;
