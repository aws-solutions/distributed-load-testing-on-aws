// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { API, Storage } from "aws-amplify";
import "brace";
import AceEditor from "react-ace";
import {
  Card,
  CardHeader,
  Table,
  Col,
  Row,
  Button,
  FormGroup,
  Label,
  Input,
  FormText,
  Spinner,
  InputGroup,
  Collapse,
  Nav,
  NavItem,
  NavLink,
  TabContent,
  TabPane,
} from "reactstrap";
import "brace/theme/github";
import { generateUniqueId } from "solution-utils";
import PageHeader from "../Shared/PageHeader/PageHeader";
import RefreshButtons from "../Shared/Buttons/RefreshButtons";

// Upload file size limit
const FILE_SIZE_LIMIT = 50 * 1024 * 1024;

// Allowed file extensions
const FILE_EXTENSIONS = ["jmx", "zip"];

class Create extends React.Component {
  constructor(props) {
    super(props);
    if (this.props.location.state && this.props.location.state.data.testId) {
      let fileType = "";
      if (this.props.location.state.data.testType && this.props.location.state.data.testType !== "simple") {
        if (this.props.location.state.data.fileType) {
          fileType = this.props.location.state.data.fileType;
        } else {
          fileType = "script";
        }
      }
      this.state = {
        isLoading: false,
        isUploading: false,
        runningTasks: false,
        testId: this.props.location.state.data.testId,
        file: null,
        validFile: false,
        chooseNewFile: false,
        activeTab: this.props.location.state.data.recurrence ? "2" : "1",
        submitLabel: this.props.location.state.data.scheduleDate ? "Schedule" : "Run Now",
        availableRegions: {},
        regionalTaskDetails: {},
        showTaskWarning: false,
        showResourceTable: false,
        vCPUDetailsLoading: true,
        regionsExceedingResources: new Set(),
        formValues: {
          testName: this.props.location.state.data.testName,
          testDescription: this.props.location.state.data.testDescription,
          testTaskConfigs: this.props.location.state.data.testTaskConfigs,
          holdFor: this.props.location.state.data.holdFor.slice(0, -1),
          holdForUnits: this.props.location.state.data.holdFor.slice(-1),
          rampUp: this.props.location.state.data.rampUp.slice(0, -1),
          rampUpUnits: this.props.location.state.data.rampUp.slice(-1),
          endpoint: this.props.location.state.data.endpoint,
          method: this.props.location.state.data.method,
          body: JSON.stringify(this.props.location.state.data.body, null, 2),
          headers: JSON.stringify(this.props.location.state.data.headers, null, 2),
          testType: this.props.location.state.data.testType ? this.props.location.state.data.testType : "simple",
          fileType: fileType,
          onSchedule: this.props.location.state.data.scheduleDate ? "1" : "0",
          scheduleDate: this.props.location.state.data.scheduleDate || "",
          scheduleTime: this.props.location.state.data.scheduleTime || "",
          recurrence: this.props.location.state.data.recurrence || "",
          showLive: this.props.location.state.data.showLive || false,
        },
      };
    } else {
      this.state = {
        isLoading: false,
        isUploading: false,
        runningTasks: false,
        testId: null,
        file: null,
        validFile: false,
        chooseNewFile: false,
        activeTab: "1",
        submitLabel: "Run Now",
        availableRegions: {},
        regionalTaskDetails: {},
        showTaskWarning: false,
        showResourceTable: false,
        vCPUDetailsLoading: true,
        regionsExceedingResources: new Set(),
        formValues: {
          testName: "",
          testDescription: "",
          testTaskConfigs: [{ concurrency: 0, taskCount: 0, region: "" }],
          holdFor: 0,
          holdForUnits: "m",
          rampUp: 0,
          rampUpUnits: "m",
          endpoint: "",
          method: "GET",
          body: "",
          headers: "",
          testType: "simple",
          fileType: "",
          onSchedule: "0",
          scheduleDate: "",
          scheduleTime: "",
          recurrence: "",
          showLive: false,
        },
      };
    }

    this.form = React.createRef();
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleInputChange = this.handleInputChange.bind(this);
    this.setFormValue = this.setFormValue.bind(this);
    this.handleBodyPayloadChange = this.handleBodyPayloadChange.bind(this);
    this.handleHeadersChange = this.handleHeadersChange.bind(this);
    this.handleFileChange = this.handleFileChange.bind(this);
    this.handleCheckBox = this.handleCheckBox.bind(this);
    this.parseJson = this.parseJson.bind(this);
    this.toggleTab = this.toggleTab.bind(this);
    this.listRegions = this.listRegions.bind(this);
    this.getvCPUDetails = this.getvCPUDetails.bind(this);
    this.getConfigRowMaxTasks = this.getConfigRowMaxTasks.bind(this);
    this.checkForTaskCountWarning = this.checkForTaskCountWarning.bind(this);
  }

  parseJson(str) {
    try {
      return JSON.parse(str);
    } catch (err) {
      return false;
    }
  }

  handleSubmit = async () => {
    const values = this.state.formValues;

    if (!this.form.current.reportValidity()) {
      this.setState({ isLoading: false });
      return false;
    }

    const testId = this.state.testId || generateUniqueId(10);
    let payload = {
      testId,
      testName: values.testName,
      testDescription: values.testDescription,
      testTaskConfigs: values.testTaskConfigs,
      testScenario: {
        execution: [
          {
            "ramp-up": String(parseInt(values.rampUp)).concat(values.rampUpUnits),
            "hold-for": String(parseInt(values.holdFor)).concat(values.holdForUnits),
            scenario: values.testName,
          },
        ],
        scenarios: {
          [values.testName]: {},
        },
      },
      showLive: values.showLive,
      testType: values.testType,
      fileType: values.fileType,
      regionalTaskDetails: this.state.regionalTaskDetails,
    };

    if (!!parseInt(values.onSchedule)) {
      payload.scheduleDate = values.scheduleDate;
      payload.scheduleTime = values.scheduleTime;
      payload.scheduleStep = "start";
      if (this.state.activeTab === "2") {
        payload.scheduleStep = "create";
        payload.recurrence = values.recurrence;
      }
    }

    if (values.testType === "simple") {
      if (!values.headers) {
        values.headers = "{}";
      }
      if (!values.body) {
        values.body = "{}";
      }
      if (!this.parseJson(values.headers.trim())) {
        return alert("WARNING: headers text is not valid JSON");
      }
      if (!this.parseJson(values.body.trim())) {
        return alert("WARNING: body text is not valid JSON");
      }

      payload.testScenario.scenarios[values.testName] = {
        requests: [
          {
            url: values.endpoint,
            method: values.method,
            body: this.parseJson(values.body.trim()),
            headers: this.parseJson(values.headers.trim()),
          },
        ],
      };
    } else {
      var extension;
      if (values.testType === "jmeter") {
        extension = "jmx";
      }
      if (values.testType === "k6") {
        extension = "js";
      }
      payload.testScenario.execution[0].executor = values.testType;
      payload.testScenario.scenarios[values.testName] = {
        script: `${testId}.${extension}`,
      };

      if (this.state.file) {
        try {
          const file = this.state.file;
          let filename = `${testId}.${extension}`;

          if (file.type && file.type.includes("zip")) {
            payload.fileType = "zip";
            filename = `${testId}.zip`;
          } else {
            payload.fileType = "script";
          }
          this.setState({ isUploading: true });
          await Storage.put(`test-scenarios/${values.testType}/${filename}`, file);
          console.log("Script uploaded successfully");
        } catch (error) {
          console.error("Error", error);
        }
      }
    }

    this.setState({ isLoading: true });
    this.setState({ isUploading: false });
    try {
      const response = await API.post("dlts", "/scenarios", { body: payload });
      console.log("Scenario created successfully", response.testId);
      this.props.history.push({ pathname: `/details/${response.testId}`, state: { testId: response.testId } });
    } catch (err) {
      console.error("Failed to create scenario", err);
      this.setState({ isLoading: false });
    }
  };

  setFormValue(key, value, id) {
    const formValues = this.state.formValues;
    if (key === "testTaskConfigs") {
      const [subKey, index] = id.split("-");
      formValues[key][parseInt(index)][subKey] = value;
    } else {
      formValues[key] = value;
    }
    this.setState({ formValues });
  }

  handleInputChange(event) {
    const value = event.target.name === "showLive" ? event.target.checked : event.target.value;
    const name = event.target.name;
    const id = event.target.id;

    if (name === "testType") {
      this.setState({ file: null });
    } else if (name === "onSchedule") {
      this.setState({ submitLabel: value === "1" ? "Schedule" : "Run Now" });
    } else if (name === "testTaskConfigs") {
      this.checkForTaskCountWarning(value, id);
    }

    this.setFormValue(name, value, id);
  }

  handleBodyPayloadChange(value) {
    this.setFormValue("body", value);
  }

  handleHeadersChange(value) {
    this.setFormValue("headers", value);
  }

  handleFileChange(event) {
    const file = event.target.files[0];
    this.setState({
      file: null,
      validFile: false,
    });

    if (file) {
      const { name, size } = file;
      const extension = name.split(".").pop();

      // Limit upload file size
      if (size > FILE_SIZE_LIMIT) {
        return alert(`WARNING: exceeded file size limit ${FILE_SIZE_LIMIT}`);
      }

      // Limit file extension
      if (!FILE_EXTENSIONS.includes(extension)) {
        return alert(`WARNING: only allows (${FILE_EXTENSIONS.join(",")}) files.`);
      }

      this.setState({
        file,
        validFile: true,
      });
    }
  }

  handleCheckBox(event) {
    const { checked } = event.target;
    if (checked) {
      this.setState({
        validFile: false,
        file: null,
      });
    } else {
      this.setState({ validFile: true });
    }
    this.setState({ chooseNewFile: checked });
  }

  // Gets the maximum number of tasks for the selected region in the form
  getConfigRowMaxTasks(row) {
    const region = this.state.formValues.testTaskConfigs[row].region;
    if (region === "" || this.state.vCPUDetailsLoading) return Number.MAX_SAFE_INTEGER;

    const regionLimit = this.state.regionalTaskDetails[region].dltTaskLimit;
    return regionLimit;
  }

  // Will check if the task count warning needs to be displayed
  checkForTaskCountWarning(value, id) {
    const row = parseInt(id.replace(/^[^\s-]+-/, "")); // removes everything before the first dash
    const taskConfig = this.state.formValues.testTaskConfigs[row];

    // taskConfig does not update to reflect the new changes right away. value is what the user just entered into the form
    const taskCount = id.includes("taskCount") ? value : taskConfig.taskCount;
    const region = id.includes("region") ? value : taskConfig.region;

    // See if check is needed or if it can be checked at all
    if (id.includes("concurrency") || this.state.vCPUDetailsLoading || region === "") return;

    const availableTasks = this.state.regionalTaskDetails[region].dltAvailableTasks;
    const newRegionsExceedingResources = new Set(this.state.regionsExceedingResources);

    if (taskCount > availableTasks) {
      newRegionsExceedingResources.add(region);
    } else if (taskCount <= availableTasks && newRegionsExceedingResources.has(region)) {
      newRegionsExceedingResources.delete(region);
    }
    this.setState({ regionsExceedingResources: newRegionsExceedingResources });
  }

  listRegions = async () => {
    try {
      const regions = {};
      const data = await API.get("dlts", "/regions");
      for (const item of data.regions) {
        regions[item.region] = item.region;
      }
      this.setState({ availableRegions: regions });
    } catch (err) {
      alert(err);
    }
  };

  getvCPUDetails = async () => {
    try {
      this.setState({ vCPUDetailsLoading: true });

      const vCPUDetails = await API.get("dlts", "/vCPUDetails");

      const regions = {};
      for (const region in vCPUDetails) {
        const regionDetails = vCPUDetails[region];
        const taskLimit = Math.floor(regionDetails.vCPULimit / regionDetails.vCPUsPerTask);
        const availableTasks = Math.floor(
          (regionDetails.vCPULimit - regionDetails.vCPUsInUse) / regionDetails.vCPUsPerTask
        );

        // Make data user friendly for displaying within the table
        regionDetails.dltTaskLimit = isNaN(taskLimit) ? "ERROR" : taskLimit;
        regionDetails.dltAvailableTasks = isNaN(availableTasks) ? "ERROR" : availableTasks;
        regionDetails.vCPUsPerTask = regionDetails.vCPUsPerTask === undefined ? "ERROR" : regionDetails.vCPUsPerTask;

        // Update dropown for regions with available tasks
        if (vCPUDetails[region].dltAvailableTasks === "ERROR") {
          regions[region] = region;
        } else {
          regions[region] = `${region} (${vCPUDetails[region].dltAvailableTasks} tasks available)`;
        }
      }

      this.setState({
        regionalTaskDetails: vCPUDetails,
        availableRegions: regions,
        vCPUDetailsLoading: false,
      });
    } catch (err) {
      alert(err);
    }
  };

  toggleTab(tab) {
    if (this.state.activeTab !== tab) {
      this.setState({ activeTab: tab });
    }
  }

  async componentDidMount() {
    await this.listRegions();
    await this.getvCPUDetails();
  }

  render() {
    const getTableIcon = () => {
      if (this.state.vCPUDetailsLoading) {
        return <Spinner color="secondary" size="sm" />;
      } else if (this.state.showResourceTable) {
        return <i className="large bi bi-caret-down" />;
      } else {
        return <i className="large bi bi-caret-right" />;
      }
    };

    const cancel = () => {
      return this.state.testId === null
        ? this.props.history.push("/")
        : this.props.history.push({ pathname: `/details/${this.state.testId}`, state: { testId: this.state.testId } });
    };

    const heading = (
      <PageHeader
        title={`${this.state.testId === null ? "Create" : "Update"} Load Test`}
        refreshButton={
          <RefreshButtons
            refreshFunction={this.getvCPUDetails}
            key={`${this.state.testId === null ? "Create" : "Update"} Load Test`}
          />
        }
      />
    );
    const currentDate = new Date().toISOString().split("T")[0];
    const maxRegions = Math.min(Object.keys(this.state.availableRegions).length, 5);
    const createTestForm = (
      <div>
        <Row>
          <Col sm="6">
            <div className="box create-box">
              <h3>General Settings</h3>
              <FormGroup>
                <Label for="testName">Name</Label>
                <Input
                  value={this.state.formValues.testName}
                  type="text"
                  name="testName"
                  id="testName"
                  required
                  onChange={this.handleInputChange}
                />
                <FormText color="muted">The name of your load test, doesn't have to be unique.</FormText>
              </FormGroup>
              <FormGroup>
                <Label for="testDescription">Description</Label>
                <Input
                  value={this.state.formValues.testDescription}
                  type="textarea"
                  name="testDescription"
                  id="testDescription"
                  required
                  onChange={this.handleInputChange}
                />
                <FormText color="muted">Short description of the test scenario.</FormText>
              </FormGroup>
              <FormGroup>
                <Row className="regional-config-title-row">
                  <Col xs="3">
                    <Label for="taskCount">Task Count</Label>
                  </Col>
                  <Col xs="3">
                    <Label for="concurrency">Concurrency</Label>
                  </Col>
                  <Col xs="3">
                    <Label for="method">Region</Label>
                  </Col>
                </Row>
                {this.state.formValues.testTaskConfigs.map((value, index) => (
                  <Row key={index} className="regional-config-input-row">
                    <Col xs="3">
                      <Input
                        value={value.taskCount}
                        type="number"
                        name="testTaskConfigs"
                        id={`taskCount-${index}`}
                        min={1}
                        max={this.getConfigRowMaxTasks(index)}
                        step={1}
                        required
                        onChange={this.handleInputChange}
                      />
                    </Col>
                    <Col xs="3">
                      <Input
                        value={value.concurrency}
                        type="number"
                        min={1}
                        step={1}
                        name="testTaskConfigs"
                        id={`concurrency-${index}`}
                        required
                        onChange={this.handleInputChange}
                      />
                    </Col>
                    <Col xs="3">
                      <Input
                        value={value.region}
                        type="select"
                        name="testTaskConfigs"
                        id={`region-${index}`}
                        required
                        onChange={this.handleInputChange}
                      >
                        <option defaultValue="true"></option>
                        {Object.entries(this.state.availableRegions).map(([region, regionsWithResources]) => {
                          return (
                            <option id={`${region}-dropdown`} key={region} value={region}>
                              {regionsWithResources}
                            </option>
                          );
                        })}
                      </Input>
                    </Col>
                    <Col xs="1">
                      {index === this.state.formValues.testTaskConfigs.length - 1 && (
                        <Row className="regional-config-button-row">
                          <Button
                            className="regional-config-button"
                            name="remove-region"
                            id="remove-region"
                            disabled={index < 1}
                            onClick={() => {
                              const formValues = this.state.formValues;
                              index > 0 && formValues.testTaskConfigs.pop();
                              this.setState({ formValues });
                            }}
                          >
                            <i className="bi bi-dash" />
                          </Button>
                          <Button
                            className="regional-config-button"
                            name="add-region"
                            id="add-region"
                            disabled={index >= maxRegions - 1}
                            onClick={() => {
                              const formValues = this.state.formValues;
                              index < maxRegions - 1 &&
                                formValues.testTaskConfigs.push({ concurrency: 0, taskCount: 0, region: "" });
                              this.setState({ formValues });
                            }}
                          >
                            <i className=" bi bi-plus" />
                          </Button>
                        </Row>
                      )}
                    </Col>
                  </Row>
                ))}
                <Row className="regional-config-text-row">
                  <Col xs="12">
                    <Collapse isOpen={this.state.regionsExceedingResources.size !== 0}>
                      <FormText color="muted" className="exceeding-resources-warning">
                        <b>WARNING:</b> Currently requesting more than the available DLT Fargate tasks for region
                        {this.state.regionsExceedingResources.size > 1 ? "s" : ""}:
                        {" " + Array.from(this.state.regionsExceedingResources).join(", ")}. Additional tasks will not
                        be created once the account limit on Fargate resources has been reached, however tasks already
                        running will continue.
                      </FormText>
                    </Collapse>
                    <FormText color="muted">
                      <b>Task Count:</b> Number of containers that will be launched in the Fargate cluster to run the
                      test scenario. Additional tasks will not be created once the account limit on Fargate resources
                      has been reached, however tasks already running will continue.
                      <br />
                    </FormText>
                    <FormText>
                      <b>Concurrency:</b> The number of concurrent virtual users generated per task. The recommended
                      limit based on default settings is 200 virtual users. Concurrency is limited by CPU and Memory.
                      Please see the &nbsp;
                      <a
                        className="text-link"
                        href={
                          "https://docs.aws.amazon.com/solutions/latest/distributed-load-testing-on-aws/considerations.html#load-testing-limits"
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        implementation guide
                      </a>
                      &nbsp;for instructions on how to determine the amount concurrency your test can support. <br />
                      <b>Region:</b> The region to launch the given task count and concurrency <br />
                    </FormText>
                  </Col>
                </Row>
                <Card id="availableTasksCard" className="available-tasks-card">
                  <CardHeader
                    id="availableTasksCardHeader"
                    className="available-tasks-card-header"
                    onClick={() => {
                      this.setState({ showResourceTable: !this.state.showResourceTable });
                    }}
                  >
                    <div id="availableTasksTableIcon" className="available-tasks-table-icon">
                      {getTableIcon()}
                    </div>
                    {"Currently Available Tasks"}
                  </CardHeader>
                  <Collapse isOpen={this.state.showResourceTable}>
                    <Table striped bordered className="available-tasks-table" size="sm" id="availableTasksTable">
                      <thead>
                        <tr>
                          <th id="tableHeaderRegion"> Region </th>
                          <th id="tableHeadervCPUs"> vCPUs per Task </th>
                          <th id="tableHeaderTaskLimit"> DLT Task Limit </th>
                          <th id="tableHeaderAvailableTasks"> Available DLT Tasks </th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(this.state.regionalTaskDetails).map(([region, details]) => {
                          return (
                            <tr key={`${region}-row`}>
                              <th id={`${region}-entry`}>{region}</th>
                              <th id={`${region}-vCPUs`}>{details.vCPUsPerTask}</th>
                              <th id={`${region}-taskLimit`}>{details.dltTaskLimit}</th>
                              <th id={`${region}-availableTasks`}>{details.dltAvailableTasks}</th>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  </Collapse>
                </Card>
              </FormGroup>
              <FormGroup>
                <Label for="rampUp">Ramp Up</Label>
                <InputGroup className="input-group-short">
                  <Input
                    value={this.state.formValues.rampUp}
                    className="form-short"
                    type="number"
                    name="rampUp"
                    id="rampUp"
                    required
                    onChange={this.handleInputChange}
                  />
                  &nbsp;
                  <Input
                    type="select"
                    className="form-short"
                    name="rampUpUnits"
                    value={this.state.formValues.rampUpUnits}
                    id="rampUpUnits"
                    onChange={this.handleInputChange}
                  >
                    <option value="m">minutes</option>
                    <option value="s">seconds</option>
                  </Input>
                </InputGroup>
                <FormText color="muted">The time to reach target concurrency.</FormText>
              </FormGroup>
              <FormGroup>
                <Label for="holdFor">Hold For</Label>
                <InputGroup className="input-group-short">
                  <Input
                    value={this.state.formValues.holdFor}
                    className="form-short"
                    type="number"
                    min={1}
                    name="holdFor"
                    id="holdFor"
                    required
                    onChange={this.handleInputChange}
                  />
                  &nbsp;
                  <Input
                    type="select"
                    value={this.state.formValues.holdForUnits}
                    className="form-short"
                    name="holdForUnits"
                    id="holdForUnits"
                    onChange={this.handleInputChange}
                  >
                    <option value="m">minutes</option>
                    <option value="s">seconds</option>
                  </Input>
                </InputGroup>
                <FormText color="muted">Time to hold target concurrency.</FormText>
              </FormGroup>
              <FormGroup>
                <Row>
                  <Col xs="auto">
                    <Input
                      type="radio"
                      name="onSchedule"
                      id="now"
                      value={0}
                      checked={this.state.formValues.onSchedule === "0"}
                      required
                      onChange={this.handleInputChange}
                    />
                    <Label className="inline-label-right" for="now">
                      Run Now
                    </Label>
                  </Col>
                  <Col xs="auto">
                    <Input
                      type="radio"
                      name="onSchedule"
                      id="schedule"
                      value={1}
                      checked={this.state.formValues.onSchedule === "1"}
                      required
                      onChange={this.handleInputChange}
                    />
                    <Label className="inline-label-right" for="schedule">
                      Run on Schedule
                    </Label>
                  </Col>
                </Row>
                <FormText>Schedule a test or or run now</FormText>
              </FormGroup>
              <Collapse isOpen={!!parseInt(this.state.formValues.onSchedule)}>
                <Nav tabs>
                  <NavItem>
                    <NavLink
                      className="custom-tab"
                      active={this.state.activeTab === "1"}
                      onClick={() => this.toggleTab("1")}
                    >
                      One Time
                    </NavLink>
                  </NavItem>
                  <NavItem>
                    <NavLink
                      className="custom-tab"
                      active={this.state.activeTab === "2"}
                      onClick={() => this.toggleTab("2")}
                    >
                      Recurring
                    </NavLink>
                  </NavItem>
                </Nav>
                <TabContent activeTab={this.state.activeTab} className="schedule-tab-content">
                  <TabPane tabId="1">
                    <FormGroup>
                      <InputGroup className="schedule-date-time">
                        <Label className="inline-label-left" for="scheduleDate">
                          Date:
                        </Label>
                        <Input
                          type="date"
                          name="scheduleDate"
                          id="scheduleDate"
                          placeholder="date placeholder"
                          min={currentDate}
                          value={this.state.formValues.scheduleDate}
                          onChange={this.handleInputChange}
                          required={parseInt(this.state.formValues.onSchedule) === 1}
                        ></Input>
                        <Label className="inline-label-left" for="scheduleTime">
                          Time:
                        </Label>
                        <Input
                          type="time"
                          name="scheduleTime"
                          id="scheduleTime"
                          placeholder="time placeholder"
                          value={this.state.formValues.scheduleTime}
                          onChange={this.handleInputChange}
                          required={parseInt(this.state.formValues.onSchedule) === 1}
                        ></Input>
                      </InputGroup>
                      <FormText color="muted">The date and time(UTC) to run the test.</FormText>
                    </FormGroup>
                  </TabPane>
                  <TabPane tabId="2">
                    <FormGroup>
                      <InputGroup className="schedule-date-time">
                        <Label className="inline-label-left" for="scheduleDate">
                          Date:
                        </Label>
                        <Input
                          type="date"
                          name="scheduleDate"
                          id="scheduleDate"
                          placeholder="date placeholder"
                          min={currentDate}
                          value={this.state.formValues.scheduleDate}
                          onChange={this.handleInputChange}
                          required={this.state.activeTab === "2"}
                        />
                        <Label className="inline-label-left" for="scheduleTime">
                          Time:
                        </Label>
                        <Input
                          type="time"
                          name="scheduleTime"
                          id="time"
                          placeholder="time placeholder"
                          value={this.state.formValues.scheduleTime}
                          onChange={this.handleInputChange}
                          required={this.state.activeTab === "2"}
                        />
                      </InputGroup>
                      <FormText color="muted">The date and time(UTC) to first run the test.</FormText>
                    </FormGroup>
                    <FormGroup>
                      <Row>
                        <Col xs="auto">
                          <Label className="mb-0">Recurrence:&nbsp;</Label>
                          &nbsp;
                          <Input
                            type="radio"
                            name="recurrence"
                            id="daily"
                            value="daily"
                            checked={this.state.formValues.recurrence === "daily"}
                            required={this.state.activeTab === "2"}
                            onChange={this.handleInputChange}
                          />
                          <Label className="inline-label-right" for="daily">
                            Daily
                          </Label>
                        </Col>
                        <Col xs="auto">
                          <Input
                            type="radio"
                            name="recurrence"
                            id="weekly"
                            value="weekly"
                            checked={this.state.formValues.recurrence === "weekly"}
                            required={this.state.activeTab === "2"}
                            onChange={this.handleInputChange}
                          />
                          <Label className="inline-label-right" for="weekly">
                            Weekly
                          </Label>
                        </Col>
                        <Col xs="auto">
                          <Input
                            type="radio"
                            name="recurrence"
                            id="biweekly"
                            value="biweekly"
                            checked={this.state.formValues.recurrence === "biweekly"}
                            required={this.state.activeTab === "2"}
                            onChange={this.handleInputChange}
                          />
                          <Label className="inline-label-right" for="biweekly">
                            Biweekly
                          </Label>
                        </Col>
                        <Col xs="auto">
                          <Input
                            type="radio"
                            name="recurrence"
                            id="monthly"
                            value="monthly"
                            checked={this.state.formValues.recurrence === "monthly"}
                            required={this.state.activeTab === "2"}
                            onChange={this.handleInputChange}
                          />
                          <Label className="inline-label-right" for="monthly">
                            Monthly
                          </Label>
                        </Col>
                      </Row>
                      <FormText color="muted">How often to run the test.</FormText>
                    </FormGroup>
                  </TabPane>
                </TabContent>
              </Collapse>
              <FormGroup check>
                <Input
                  name="showLive"
                  id="showLive"
                  type="checkbox"
                  checked={this.state.formValues.showLive}
                  onChange={this.handleInputChange}
                />
                <Label check>
                  <Input
                    name="showLive"
                    id="showLive"
                    type="checkbox"
                    checked={this.state.formValues.showLive}
                    onChange={this.handleInputChange}
                  />
                  Include Live Data
                </Label>
              </FormGroup>
              <FormText>Includes live data while the test is running.</FormText>
            </div>
          </Col>
          <Col sm="6">
            <div className="box create-box">
              <h3>Scenario</h3>
              <FormGroup>
                <Label for="testType">Test Type</Label>
                <Input
                  type="select"
                  id="testType"
                  name="testType"
                  required
                  value={this.state.formValues.testType}
                  onChange={this.handleInputChange}
                >
                  <option value="simple">Single HTTP Endpoint</option>
                  <option value="jmeter">JMeter</option>
                  <option value="k6">K6</option>
                </Input>
              </FormGroup>
              {this.state.formValues.testType === "simple" && (
                <div>
                  <FormGroup>
                    <Label for="endpoint">HTTP endpoint under test</Label>
                    <Input
                      value={this.state.formValues.endpoint}
                      type="url"
                      name="endpoint"
                      id="endpoint"
                      required
                      onChange={this.handleInputChange}
                    />
                    <FormText color="muted">
                      Target URL to run tests against, supports http and https. i.e. https://example.com:8080.
                    </FormText>
                  </FormGroup>
                  <FormGroup>
                    <Label for="method">HTTP Method</Label>
                    <Input
                      value={this.state.formValues.method}
                      className="form-short"
                      type="select"
                      name="method"
                      id="method"
                      required
                      onChange={this.handleInputChange}
                    >
                      <option>GET</option>
                      <option>PUT</option>
                      <option>POST</option>
                      <option>DELETE</option>
                    </Input>
                    <FormText color="muted">The request method, default is GET.</FormText>
                  </FormGroup>
                  <FormGroup>
                    <Label for="testDescription">HTTP Headers (Optional)</Label>
                    <AceEditor
                      id="headers"
                      mode="text"
                      theme="github"
                      value={this.state.formValues.headers}
                      onChange={this.handleHeadersChange}
                      name="headers"
                      width="100%"
                      height="190px"
                      editorProps={{ $blockScrolling: true }}
                      setOptions={{
                        showLineNumbers: true,
                        tabSize: 2,
                      }}
                    />
                    <FormText color="muted">
                      A valid JSON object key-value pair containing headers to include in the requests.
                    </FormText>
                  </FormGroup>
                  <FormGroup>
                    <Label>Body Payload (Optional)</Label>
                    <AceEditor
                      id="bodyPayload"
                      mode="text"
                      theme="github"
                      onChange={this.handleBodyPayloadChange}
                      name="bodyPayload"
                      value={this.state.formValues.body}
                      width="100%"
                      height="190px"
                      editorProps={{ $blockScrolling: true }}
                      setOptions={{
                        showLineNumbers: true,
                        tabSize: 2,
                      }}
                    />
                    <FormText color="muted">
                      A valid JSON object containing any body text to include in the requests.
                    </FormText>
                  </FormGroup>
                </div>
              )}
              {this.state.formValues.testType !== "simple" && (
                <div>
                  {["zip", "script"].includes(this.state.formValues.fileType) && (
                    <FormGroup check>
                      <Label check>
                        <Input
                          id="newScriptCheckbox"
                          type="checkbox"
                          onClick={this.handleCheckBox}
                          defaultChecked={this.state.chooseNewFile}
                        />{" "}
                        Choose a new file.
                      </Label>
                    </FormGroup>
                  )}
                  {((this.state.formValues.testType !== "simple" &&
                    !["zip", "script"].includes(this.state.formValues.fileType)) ||
                    this.state.chooseNewFile) && (
                    <FormGroup>
                      <Label for="fileUpload">Upload File</Label>
                      <Input type="file" id="fileUpload" name="fileUpload" onChange={this.handleFileChange} />
                      <FormText color="muted">
                        You can choose either a <code>.jmx</code> file or a <code>.zip</code> file. Choose{" "}
                        <code>.zip</code> file if you have any files to upload other than a <code>.jmx</code> script
                        file, or if you didn't select a "JMeter" as the test type.
                      </FormText>
                      {this.state.isUploading && (
                        <div className="alert alert-info" role="alert">
                          This may take some time, please wait...
                        </div>
                      )}
                    </FormGroup>
                  )}
                </div>
              )}
              <Button
                id="submitButton"
                className="submit"
                size="sm"
                onClick={this.handleSubmit}
                disabled={
                  this.state.formValues.testType !== "simple" &&
                  !this.state.file &&
                  (this.state.chooseNewFile || !["zip", "script"].includes(this.state.formValues.fileType))
                }
              >
                {this.state.submitLabel}
              </Button>
              <Button
                id="cancelButton"
                className="submit"
                color="danger"
                size="sm"
                onClick={cancel}
                disabled={this.state.isLoading}
              >
                Cancel
              </Button>
            </div>
          </Col>
        </Row>
      </div>
    );

    return (
      <div>
        <form ref={this.form} onSubmit={(e) => e.preventDefault()}>
          {heading}

          <div>
            {this.state.isLoading ? (
              <div className="loading">
                <Spinner color="secondary" />
              </div>
            ) : (
              createTestForm
            )}
          </div>
        </form>
      </div>
    );
  }
}

export default Create;
