// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Link } from "react-router-dom";
import { Button, Modal, ModalHeader, ModalBody, ModalFooter, Spinner } from 'reactstrap';
import { API, Storage } from 'aws-amplify';

import Results from '../Results/Results.js';
import Running from '../Running/Running.js';
import History from '../History/History.js';
import DetailsTable from './DetailsTable';

import 'brace';
import 'brace/theme/github';

class Details extends React.Component {

  constructor(props) {
    super(props);
    this.state = {
      isLoading: true,
      runningTasks: false,
      deleteModal: false,
      cancelModal: false,
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
          scenarios: {}
        },
        scheduleDate: null,
        scheduleTime: null,
        recurrence: null
      }
    };
    this.deleteToggle = this.deleteToggle.bind(this);
    this.deleteTest = this.deleteTest.bind(this);
    this.cancelToggle = this.cancelToggle.bind(this);
    this.cancelTest = this.cancelTest.bind(this);
    this.handleStart = this.handleStart.bind(this);
    this.handleDownload = this.handleDownload.bind(this);
    this.calculateTestDurationSeconds = this.calculateTestDurationSeconds.bind(this);
    this.handleFullTestDataLocation = this.handleFullTestDataLocation.bind(this);
  }

  deleteToggle() {
    this.setState(prevState => ({
      deleteModal: !prevState.deleteModal
    }));
  }

  cancelToggle() {
    this.setState(prevState => ({
      cancelModal: !prevState.cancelModal
    }));
  }

  deleteTest = async () => {
    const testId = this.state.testId;
    try {
      await API.del('dlts', `/scenarios/${testId}`);
    } catch (err) {
      alert(err);
    }
    this.props.history.push("../dashboard");
  };

  cancelTest = async () => {
    const testId = this.state.testId;
    try {
      await API.post('dlts', `/scenarios/${testId}`);
    } catch (err) {
      alert(err);
    }
    this.props.history.push("../dashboard");
  };

  reloadData = async () => {
    this.setState({
      isLoading: true,
      data: {
        results: {},
        history: [],
        testTaskConfigs: [],
        rampUp: null,
        holdFor: null,
        endpoint: null,
        method: null,
        body: {},
        header: {},
        taskArns: []
      }
    });
    await this.getTest();
    this.setState({ isLoading: false });
  };

  // sets common state values to be presented, either current or past tests
  setTestData(data) {
    data.rampUp = data.testScenario.execution[0]['ramp-up'];
    data.holdFor = data.testScenario.execution[0]['hold-for'];
    const testDuration = this.calculateTestDurationSeconds([data.rampUp, data.holdFor]);
    if (!data.testType || ['', 'simple'].includes(data.testType)) {
      data.testType = 'simple';
      data.endpoint = data.testScenario.scenarios[`${data.testName}`].requests[0].url;
      data.method = data.testScenario.scenarios[`${data.testName}`].requests[0].method;
      data.body = data.testScenario.scenarios[`${data.testName}`].requests[0].body;
      data.headers = data.testScenario.scenarios[`${data.testName}`].requests[0].headers;
    }

    this.setState({ data, testDuration });
    this.setState({ isCurrentTestRunning: data.status === 'running' });
  }

  getTest = async () => {
    const testId = this.state.testId;
    try {
      const data = await API.get('dlts', `/scenarios/${testId}`);
      if (data.nextRun) {
        const [scheduleDate, scheduleTime] = data.nextRun.split(' ');
        data.scheduleDate = scheduleDate;
        data.scheduleTime = scheduleTime.split(':', 2).join(':');
        data.recurrence = data.scheduleRecurrence;
        delete data.nextRun;
      }
      this.setTestData(data);
      this.setState({ isCurrentTestRunning: data.status === 'running' });
    } catch (err) {
      console.error(err);
      alert(err);
    }
  };

  listTasks = async () => {
    try {
      const data = await API.get('dlts', '/tasks');
      this.setState({
        isLoading: false,
        runningTasks: data.length > 0
      });
    } catch (err) {
      alert(err);
    }
  };

  calculateTestDurationSeconds = (items) => {
    let seconds = 0;

    for (let item of items) {
      // On the UI, the item format would be always Xm or Xs (X is a number).
      if (item.endsWith('m')) {
        seconds += parseInt(item.slice(0, item.length - 1)) * 60;
      } else {
        seconds += parseInt(item.slice(0, item.length - 1));
      }
    }

    return seconds;
  };

  componentDidMount = async () => {
    if (!this.state.testId) {
      this.props.history.push('../');
    } else {
      await this.getTest();
      await this.listTasks();
    }
  };

  async handleStart() {
    const testId = this.state.testId;
    const { data } = this.state;
    let payload = {
      testId,
      testName: data.testName,
      testDescription: data.testDescription,
      testTaskConfigs: data.testTaskConfigs,
      testScenario: {
        execution: [{
          "ramp-up": data.rampUp,
          "hold-for": data.holdFor,
          scenario: data.testName,
        }],
        scenarios: {
          [data.testName]: {}
        }
      },
      showLive: data.showLive,
      testType: data.testType,
      scheduleData: data.scheduleDate,
      scheduleTime: data.scheduleTime,
      recurrence: data.recurrence
    };
    const hasEmptyRegion = data.testTaskConfigs.some(taskConfigs => taskConfigs.taskCluster === "");
    if (hasEmptyRegion) {
      alert("The test contains a region that may have been deleted, if you wish to run this test, please edit the test to remove the deleted region.");
      return;
    }
    if (data.testType === 'simple') {
      payload.testScenario.scenarios[data.testName] = {
        requests: [
          {
            url: data.endpoint,
            method: data.method,
            body: data.body,
            headers: data.headers
          }
        ]
      };
    } else {
      payload.testScenario.scenarios[data.testName] = {
        script: `${testId}.jmx`
      };
      payload.fileType = data.fileType;
    }

    this.setState({ isLoading: true });

    try {
      const response = await API.post('dlts', '/scenarios', { body: payload });
      console.log('Scenario started successfully', response.testId);
      await this.reloadData();
    } catch (err) {
      console.error('Failed to start scenario', err);
      this.setState({ isLoading: false });
    }
  }

  async handleDownload() {
    try {
      const testId = this.state.testId;
      const { testType } = this.state.data;
      let filename = this.state.data.fileType === 'zip' ? `${testId}.zip` : `${testId}.jmx`;
      const url = await Storage.get(`test-scenarios/${testType}/${filename}`, { expires: 10 });
      window.open(url, '_blank');
    } catch (error) {
      console.error('Error', error);
    }
  }

  async handleFullTestDataLocation() {
    try {
      const testId = this.state.testId;
      const url = `https://console.aws.amazon.com/s3/buckets/${Storage._config.AWSS3.bucket}?prefix=results/${testId}/`;
      window.open(url, '_blank');
    } catch (error) {
      console.error('Failed to open S3 location for test run results', error);
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
    const isCurrentTestFinished = data.results && Object.keys(data.results).length === 0;
    const refreshButtonText = isCurrentTestFinished ? 'Refresh' : 'Back to Current Test';
    const details = (
      <div>
        <div className="box">
          <h1>Load Test Details</h1>
          {
            this.state.isCurrentTestRunning ?
              [
                isCurrentTestFinished && <Button id="cancelButton" key="cancelButton" color="danger" onClick={this.cancelToggle} size="sm">Cancel</Button>,
                <Button id="refreshButton" key="refreshButton" className="refresh-button" onClick={this.reloadData} size="sm">{refreshButtonText}</Button>
              ] :
              [
                <Button id="deleteButton" key="deleteButton" color="danger" onClick={this.deleteToggle} size="sm">Delete</Button>,
                <Link key="update_link" to={{ pathname: '/create', state: { data } }}>
                  <Button id="updateButton" key="updateButton" size="sm">Edit</Button>
                </Link>,
                <Button id="startButton" key="startButton" onClick={this.handleStart} size="sm">Start</Button>
              ]
          }
        </div>
        <DetailsTable data={data} handleDownload={this.handleDownload} handleFullTestDataLocation={this.handleFullTestDataLocation}></DetailsTable>

        {
          data.status === 'complete' &&
          <Results
            data={data}
            testDuration={testDuration}
            regions={Object.keys(this.state.data.results).filter(region => region !== 'total')}
          />}
        {data.status === 'cancelled' && cancelled}
        {data.status === 'failed' && failed}
        {data.status === 'running' && <Running data={data} testId={this.state.testId} />}
        {data.history && <History data={data} handleFullTestDataLocation={this.handleFullTestDataLocation} />}

      </div>
    );

    return (
      <div>
        {this.state.isLoading ? <div className="loading"><Spinner color="secondary" /></div> : details}
        <Modal isOpen={this.state.deleteModal} toggle={this.deleteToggle}>
          <ModalHeader>Warning</ModalHeader>
          <ModalBody>
            This will delete the test scenario and all of of the results
          </ModalBody>
          <ModalFooter>
            <Button id="cancelDeleteButton" color="link" size="sm" onClick={this.deleteToggle}>Cancel</Button>
            <Button id="deleteConfirmButton" color="danger" size="sm" onClick={this.deleteTest}>Delete</Button>
          </ModalFooter>
        </Modal>

        <Modal isOpen={this.state.cancelModal} toggle={this.cancelToggle}>
          <ModalHeader>Warning</ModalHeader>
          <ModalBody>
            This will stop all running tasks and end the test.
          </ModalBody>
          <ModalFooter>
            <Button id="cancelStopButton" color="link" size="sm" onClick={this.cancelToggle}>Cancel</Button>
            <Button id="cancelTestButton" color="danger" size="sm" onClick={this.cancelTest}>Cancel Test</Button>
          </ModalFooter>
        </Modal>

      </div>
    );
  }
}

export default Details;
