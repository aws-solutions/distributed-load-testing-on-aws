// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { uploadData } from "aws-amplify/storage";
import { get, post } from "aws-amplify/api";
import "brace";
import { v4 as uuidv4 } from "uuid";
import { Cron } from "react-js-cron";

import "react-js-cron/dist/styles.css";
import cronParser from "cron-parser";

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
  Modal,
  ModalBody,
  ModalFooter,
} from "reactstrap";
import "brace/theme/github";
import { generateUniqueId } from "solution-utils";
import PageHeader from "../Shared/PageHeader/PageHeader";
import RefreshButtons from "../Shared/Buttons/RefreshButtons";

// Upload file size limit
const FILE_SIZE_LIMIT = 50 * 1024 * 1024;

// Allowed file extensions
const SCRIPT_FILE_EXTENSIONS = { jmeter: "jmx", k6: "js", locust: "py" };

class Create extends React.Component {
  constructor(props) {
    super(props);
    if (this.props.location.state && this.props.location.state.data.testId) {
      this.initializeStateForExistingTest();
    } else {
      this.initializeStateForNewTest();
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

  initializeStateForExistingTest() {
    let fileType = this.setInitialFileType();
    this.props.location.state.data.testTaskConfigs.forEach((config) => {
      config.id = uuidv4();
    });
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
      showModal: false,
      cronError: false,
      cronDateError: false,
      submitFailure: "",
      intervalDiff: false,
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
        cronValue: this.props.location.state.data.cronValue || "0 * * * *",
        cronExpiryDate: this.props.location.state.data.cronExpiryDate || "",
        k6Acknowledged: this.props.location.state.data.k6Acknowledged || false,
      },
    };
    if (this.props.location.state.data.cronValue) {
      this.state.activeTab = "3";
    }
  }

  initializeStateForNewTest() {
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
      showModal: false,
      cronError: false,
      submitFailure: "",
      intervalDiff: false,

      formValues: {
        testName: "",
        testDescription: "",
        testTaskConfigs: [{ concurrency: 0, taskCount: 0, region: "", id: uuidv4() }],
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
        cronValue: "0 * * * *",
        cronExpiryDate: "",
        k6Acknowledged: false,
      },
    };
  }

  setInitialFileType() {
    if (this.props.location.state.data.testType && this.props.location.state.data.testType !== "simple") {
      if (this.props.location.state.data.fileType) {
        return this.props.location.state.data.fileType;
      }
      return "script";
    }
    return "";
  }

  parseJson(str) {
    try {
      return JSON.parse(str);
    } catch (err) {
      return false;
    }
  }
  alertsForBadCronInputs() {
    if ((this.state.formValues.cronValue && this.state.cronError) || !this.state.formValues.cronValue) {
      return alert("Please provide a valid cron expression");
    }

    if (this.state.cronDateError) {
      return alert("cron expiry date cannot be older than the today's date.");
    }
  }

  onSchedulePayloadUpdate = (payload) => {
    const { scheduleDate, scheduleTime, recurrence, cronValue, cronExpiryDate } = this.state.formValues;
    payload.scheduleStep = "start";
    payload.scheduleDate = scheduleDate;
    payload.scheduleTime = scheduleTime;
    payload.cronValue = "";
    if (this.state.activeTab !== "1") {
      payload.scheduleStep = "create";
      payload.recurrence = recurrence ? recurrence : "";
      payload.cronExpiryDate = cronExpiryDate ? cronExpiryDate : "";
      payload.cronValue = !recurrence ? cronValue : "";
    }
    return payload;
  };

  handleSubmit = async () => {
    const {
      testName,
      testDescription,
      testTaskConfigs,
      rampUp,
      rampUpUnits,
      holdFor,
      holdForUnits,
      onSchedule,
      testType,
      fileType,
      showLive,
      headers,
      body,
      endpoint,
      method,
      k6Acknowledged,
    } = this.state.formValues;

    if (testType === "k6" && !k6Acknowledged) {
      this.setState({ showModal: true });
      return false;
    }
    if (!this.form.current.reportValidity()) {
      this.setState({ isLoading: false });
      return false;
    }
    const testId = this.state.testId || generateUniqueId(10);
    let payload = {
      testId,
      testName: testName,
      testDescription: testDescription,
      testTaskConfigs: testTaskConfigs.map(({ id, ...rest }) => rest),
      testScenario: {
        execution: [
          {
            "ramp-up": String(parseInt(rampUp)).concat(rampUpUnits),
            "hold-for": String(parseInt(holdFor)).concat(holdForUnits),
            scenario: testName,
            executor: testType !== "simple" ? testType : "jmeter",
          },
        ],
        scenarios: {
          [testName]: {},
        },
      },
      showLive: showLive,
      testType: testType,
      fileType: fileType,
      regionalTaskDetails: this.state.regionalTaskDetails,
    };
    console.log("Payload", payload);
    if (!!parseInt(onSchedule)) payload = this.onSchedulePayloadUpdate(payload);

    await this.setPayloadTestScenario({ testType, testName, endpoint, method, headers, body, payload, testId });

    this.alertsForBadCronInputs();
    this.setState({ isLoading: true });
    this.setState({ isUploading: false });
    try {
      const _response = await post({
        apiName: "dlts",
        path: "/scenarios",
        options: {
          body: payload,
        },
      }).response;
      const response = await _response.body.json();
      console.log("Scenario created successfully", response.testId);
      this.props.history.push({ pathname: `/details/${response.testId}`, state: { testId: response.testId } });
    } catch (err) {
      this.state.submitFailure = err;
      this.setState({ isLoading: false });
    }
  };

  async setPayloadTestScenario(props) {
    let { testType, testName, endpoint, method, headers, body, payload, testId } = props;
    if (testType === "simple") {
      headers = headers || "{}";
      body = body || "{}";

      if (!this.parseJson(headers.trim())) {
        return alert("WARNING: headers text is not valid JSON");
      }
      if (!this.parseJson(body.trim())) {
        return alert("WARNING: body text is not valid JSON");
      }

      payload.testScenario.scenarios[testName] = {
        requests: [
          {
            url: endpoint,
            method: method,
            body: this.parseJson(body.trim()),
            headers: this.parseJson(headers.trim()),
          },
        ],
      };
    } else {
      const extension = SCRIPT_FILE_EXTENSIONS[testType];
      payload.testScenario.scenarios[testName] = {
        script: `${testId}.${extension}`,
      };

      if (this.state.file) {
        payload.fileType = await this.uploadFileToScenarioBucket(testId, testType);
      }
    }
  }

  async uploadFileToScenarioBucket(testId, testType) {
    const extension = SCRIPT_FILE_EXTENSIONS[testType];
    const file = this.state.file;
    let filename;
    let fileType;
    if (file.type && file.type.includes("zip")) {
      fileType = "zip";
      filename = `${testId}.zip`;
    } else {
      fileType = "script";
      filename = `${testId}.${extension}`;
    }
    try {
      this.setState({ isUploading: true });
      await uploadData({ path: `public/test-scenarios/${testType}/${filename}`, data: file }).result;
      console.log("Script uploaded successfully");
    } catch (error) {
      console.error("Error", error);
    }
    return fileType;
  }

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

  onCronError = (error) => {
    this.setState({ cronError: false, intervalDiff: false, submitFailure: false });
    if (this.checkOneHourDiff()) this.setState({ cronError: true });
    if (this.checkEnoughIntervalDiff()) this.setState({ intervalDiff: true });
    if (error && error.type === "invalid_cron") this.setState({ cronError: true });
  };

  handleInputChange(event) {
    this.setState({ submitFailure: false });

    const value = event.target.name === "showLive" ? event.target.checked : event.target.value;
    const name = event.target.name;
    const id = event.target.id;
    if (name === "testType") {
      this.setState({ file: null });
      if (value === "k6" && !this.state.isAcknowledged) {
        this.setState({ showModal: true });
        this.setFormValue("k6Acknowledged", false);
      }
    } else if (name === "onSchedule") {
      this.setState({ submitLabel: value === "1" ? "Schedule" : "Run Now" });
    } else if (name === "testTaskConfigs") {
      this.checkForTaskCountWarning(value, id);
    } else if (name === "cronExpiryDate" && value) {
      const [year, month, day] = value.split("-");
      let selectedDate = new Date(year, month - 1, day);
      selectedDate.setDate(selectedDate.getDate() + 1);
      const today = new Date();
      this.setState({ cronDateError: selectedDate <= today });
      this.setFormValue("cronExpiryDate", value, id);
    } else if (name === "cronValue") {
      this.setState({ cronError: true });
    } else if (name === "holdFor" || name === "rampUp") this.setFormValue(name, value, id);
    this.setState({ intervalDiff: false });
    this.checkIntervalDiff();
    this.setFormValue(name, value, id);
  }

  /**
   * Checks if there is enough time interval between successive scheduled test runs.
   *
   * This function verifies that the customer has allowed for enough time interval between
   * successive test runs, as each test run on its own can use up the entire ECS service quota in the account.
   * The interval check is only performed when the customer is using the scheduling feature in the UI
   * (when they select the radio button to schedule a test instead of the "Run Now" option).
   *
   * The state attribute formValues.onSchedule is "1" when the user has selected to schedule the test.
   * This check is skipped when the customer chooses to run the test immediately after submitting the form.
   */
  checkIntervalDiff() {
    if (this.state.formValues.onSchedule === "1" && this.checkEnoughIntervalDiff())
      this.setState({ intervalDiff: true });
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
      const testType = this.state.formValues.testType;
      // Limit upload file size
      if (size > FILE_SIZE_LIMIT) {
        return alert(`WARNING: exceeded file size limit ${FILE_SIZE_LIMIT}`);
      }

      if (extension === "zip") {
        console.debug(`zip file provided for ${testType} test`);
      } else if (extension !== SCRIPT_FILE_EXTENSIONS[testType]) {
        event.target.value = null;
        return alert(`WARNING: ${testType} cannot support ${extension} files.`);
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
      const _data = await get({
        apiName: "dlts",
        path: "/regions",
      }).response;
      const data = await _data.body.json();
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

      const _vCPUDetails = await get({
        apiName: "dlts",
        path: "/vCPUDetails",
      }).response;
      const vCPUDetails = await _vCPUDetails.body.json();
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

  getTableIcon = () => {
    if (this.state.vCPUDetailsLoading) {
      return <Spinner color="secondary" size="sm" />;
    } else if (this.state.showResourceTable) {
      return <i className="large bi bi-caret-down" />;
    } else {
      return <i className="large bi bi-caret-right" />;
    }
  };

  uploadFileDescription = () => {
    if (!["jmeter", "k6", "locust"].includes(this.state.formValues.testType)) {
      return null;
    }
    const ext = SCRIPT_FILE_EXTENSIONS[this.state.formValues.testType];
    return (
      <>
        You can choose either a <code>.${ext}</code> file or a <code>.zip</code> file. Choose <code>.zip</code> file if
        you have any files to upload other than a <code>.${ext}</code> script file.
      </>
    );
  };

  getNextRunDates = () => {
    const { scheduleDate, scheduleTime, recurrence } = this.state.formValues;
    const startDateTime = new Date(`${scheduleDate}T${scheduleTime}`);
    const nextRunDates = [];

    // Calculate the next five run dates and times based on the recurrence
    for (let i = 0; i < 5; i++) {
      let nextRunDate;

      switch (recurrence) {
        case "daily":
          nextRunDate = new Date(startDateTime.getTime() + i * 24 * 60 * 60 * 1000);
          break;
        case "weekly":
          nextRunDate = new Date(startDateTime.getTime() + i * 7 * 24 * 60 * 60 * 1000);
          break;
        case "biweekly":
          nextRunDate = new Date(startDateTime.getTime() + i * 2 * 7 * 24 * 60 * 60 * 1000);
          break;
        case "monthly":
          nextRunDate = new Date(
            startDateTime.getFullYear(),
            startDateTime.getMonth() + i + 1,
            startDateTime.getDate(),
            startDateTime.getHours(),
            startDateTime.getMinutes()
          );
          break;
        default:
          break;
      }
      if (nextRunDate) nextRunDates.push(nextRunDate);
      else break;
    }

    if (nextRunDates.length === 0) return [];

    const formattedDates = nextRunDates.map((date) => {
      const options = {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      };
      return date.toLocaleString("en-US", options);
    });

    return formattedDates;
  };

  renderNextRunDatesRecurring = () => {
    const { scheduleDate, scheduleTime, recurrence } = this.state.formValues;

    // Check if all required values are present
    if (!scheduleDate || !scheduleTime || !recurrence) {
      return null; // Return null to avoid rendering
    }

    const nextRunDates = this.getNextRunDates();

    if (!nextRunDates || nextRunDates.length === 0) {
      return null; // Return null if there are no run dates
    }

    return (
      <div>
        <br></br>
        <h4>Next Run Dates (UTC):</h4>
        <ul>
          {nextRunDates.map((date) => (
            <li key={date}>{date}</li>
          ))}
        </ul>
        <p>These are the next 5 scheduled runs. More runs are scheduled.</p>
      </div>
    );
  };

  renderNextRunDatesAdvancedRecurring = () => {
    const { formValues, cronError } = this.state;
    const { cronValue, cronExpiryDate } = formValues;

    // Check if cronValue is present and cronError is false
    if (!cronValue || cronError) {
      return null; // Return null to avoid rendering
    }
    const nextRunDates = this.nextSixRuns();

    if (nextRunDates.length === 0) {
      return null;
    }

    const options = {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      timeZone: "UTC",
    };
    const upcomingRunsMessage =
      nextRunDates.length <= 5
        ? `These are all the upcoming runs. The test expires on ${cronExpiryDate}`
        : "These are the next 5 scheduled runs. More runs are scheduled beyond these until the expiry date.";
    return (
      <div>
        <h4>Next Run Dates (UTC):</h4>
        <ul>
          {nextRunDates.slice(0, 5).map((date) => (
            <li key={date}>{date.toLocaleString("en-US", options)}</li>
          ))}
        </ul>
        <p>{upcomingRunsMessage}</p>
      </div>
    );
  };

  nextSixRuns = () => {
    let interval;
    const { cronValue, cronError, cronExpiryDate } = this.state.formValues;
    if (!cronValue || cronError) {
      return null; // Return null to avoid rendering
    }
    try {
      interval = cronParser.parseExpression(cronValue, { utc: true });
    } catch {
      return null;
    }
    let cronExpiry = new Date(cronExpiryDate);
    let nextRunDates = [];
    // Calculate the next six run dates and times based on the cron expression
    // Adding one extra run date to the list, enough to make sure are upcomingRunsMessages are accurate
    for (let i = 0; i < 6; i++) {
      let nextRun = new Date(interval.next());
      if (nextRun > cronExpiry) break;
      nextRunDates.push(nextRun);
    }

    return nextRunDates;
  };

  failedFromErrors = (oneHourErrorMsg, enoughIntervalDiffMsg) => {
    console.log(this.state.submitFailure.response.body);
    let errors = [];
    if (this.state.submitFailure.response.body.includes("Cron Expiry Date older than the next run."))
      errors.push("Cron Expiry Date cannot be older than the next run");
    else if (this.state.submitFailure.response.body.includes(oneHourErrorMsg)) errors.push(oneHourErrorMsg);
    else if (this.state.submitFailure.response.body.includes(enoughIntervalDiffMsg)) errors.push(enoughIntervalDiffMsg);
    return errors;
  };

  schedulingErrors = () => {
    let errors = [];

    if (this.state.cronDateError) errors.push("Cron Expiry Date cannot be older than current Date");

    const { formValues } = this.state;
    const { cronValue, cronError } = formValues;
    const oneHourErrorMsg = "The interval between scheduled tests cannot be less than an hour.";
    const noNewRunErrMsg = "No new run will be scheduled";
    const enoughIntervalDiffMsg =
      "The interval between scheduled tests is too short. Please ensure there is enough time between test runs to accommodate the duration of each test.";
    if (!cronValue || cronError) {
      return null; // Return null to avoid rendering
    }

    const nextSixRuns = this.nextSixRuns();
    if (nextSixRuns && nextSixRuns.length === 0) errors.push(noNewRunErrMsg);

    if (this.checkOneHourDiff()) errors.push(oneHourErrorMsg);
    else if (this.checkEnoughIntervalDiff()) errors.push(enoughIntervalDiffMsg);
    if (this.state.submitFailure && this.state.submitFailure.response.body)
      errors = this.failedFromErrors(oneHourErrorMsg, enoughIntervalDiffMsg);

    if (!errors) return null;
    return errors.map((error) => (
      <div
        key={error}
        className={`alert ${error !== noNewRunErrMsg ? "alert-danger" : "alert-warning"}`}
        role={error !== noNewRunErrMsg ? "error" : "alert"}
      >
        {error}
      </div>
    ));
  };

  checkOneHourDiff = () => {
    let interval;
    const { formValues } = this.state;
    const { cronValue, cronError } = formValues;
    if (!cronValue || cronError) return false; // Return null to avoid rendering

    try {
      interval = cronParser.parseExpression(cronValue, { utc: true });
    } catch {
      return false;
    }

    const nextSixRuns = this.nextSixRuns();
    let fields = JSON.parse(JSON.stringify(interval.fields));
    return fields.minute.length !== 1 && nextSixRuns && nextSixRuns.length > 1;
  };

  checkEnoughIntervalDiff = () => {
    let interval;
    const { formValues } = this.state;
    const { cronValue, cronExpiryDate, holdFor, holdForUnits, rampUp, rampUpUnits, testTaskConfigs } = formValues;
    try {
      interval = cronParser.parseExpression(cronValue, { utc: true });
    } catch {
      return null;
    }
    let prev = interval.next();
    let next = interval.next();
    let cronExpiry = new Date(cronExpiryDate);
    let totalTaskCount = 0;

    for (const testTaskConfig of testTaskConfigs) totalTaskCount += testTaskConfig.taskCount;

    // Initial buffer for 1 call every 1.5 sec to create a task,
    // 2 min to enter running, 1 min launch for leader, 2 min for leader to enter running + 5 min buffer
    // multiplied by two to account for provisisioning and deprovisioning
    let estimatedTestDuration = 2 * Math.floor(Math.ceil(totalTaskCount / 10) * 1.5 + 600);
    estimatedTestDuration += holdForUnits == "m" ? parseInt(holdFor) * 60 : parseInt(holdFor);
    estimatedTestDuration += rampUpUnits == "m" ? parseInt(rampUp) * 60 : parseInt(rampUp);

    // Times posted for the next runs are not UTC
    // Error for input issue
    for (let i = 0; i < 100; i++) {
      if (!(next && prev)) break;
      let prevDate = new Date(prev);
      let nextDate = new Date(next);
      if (prevDate > cronExpiry) break;
      if (nextDate - prevDate < estimatedTestDuration * 1000) return true;
      prev = next;
      next = interval.next();
    }
    return false;
  };

  disableSubmitButton = () => {
    return (
      (this.state.formValues.testType !== "simple" &&
        !this.state.file &&
        (this.state.chooseNewFile || !["zip", "script"].includes(this.state.formValues.fileType)) &&
        (this.state.cronError || this.state.cronDateError || this.state.intervalDiff)) ||
      (this.state.formValues.testType === "simple" &&
        (this.state.cronError || this.state.cronDateError || this.state.intervalDiff))
    );
  };

  render() {
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
                <FormText key="description" color="muted">
                  Short description of the test scenario.
                </FormText>
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
                  <Row key={value.id} className="regional-config-input-row">
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
                                formValues.testTaskConfigs.push({
                                  concurrency: 0,
                                  taskCount: 0,
                                  region: "",
                                  id: uuidv4(),
                                });
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
                      {this.getTableIcon()}
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
                  <NavItem>
                    <NavLink
                      className="custom-tab"
                      active={this.state.activeTab === "3"}
                      onClick={() => this.toggleTab("3")}
                    >
                      Cron
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
                          required={this.state.onSchedule && this.state.activeTab === "1"}
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
                          required={this.state.onSchedule && this.state.activeTab === "1"}
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
                          required={this.state.onSchedule && this.state.activeTab === "2"}
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
                          required={this.state.onSchedule && this.state.activeTab === "2"}
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
                      {this.renderNextRunDatesRecurring()}
                    </FormGroup>
                  </TabPane>
                  <TabPane tabId="3">
                    <FormGroup>
                      <InputGroup className="schedule-date-time">
                        <Label className="inline-label-left" for="cronValue">
                          Cron:
                        </Label>
                        <input
                          type="text"
                          className={`form-control ${this.state.cronError ? "is-invalid" : ""}`}
                          id="cronValue"
                          name="cronValue"
                          value={this.state.formValues.cronValue}
                          onChange={this.handleInputChange}
                          required={this.state.activeTab == 3}
                        />
                        <Label className="inline-label-left" for="cronExpiryDate">
                          &nbsp; Cron Expiry Date:
                        </Label>
                        <Input
                          type="date"
                          name="cronExpiryDate"
                          id="cronExpiryDate"
                          placeholder="date placeholder"
                          value={this.state.formValues.cronExpiryDate}
                          onChange={this.handleInputChange}
                          className={this.state.cronDateError ? "is-invalid" : ""}
                          required={this.state.activeTab == 3}
                        />
                      </InputGroup>
                    </FormGroup>
                    <FormGroup>
                      <Cron
                        value={this.state.formValues.cronValue}
                        setValue={(e) => this.setFormValue("cronValue", e)}
                        allowEmpty="never"
                        humanizeLabels={true}
                        onError={this.onCronError}
                      />
                    </FormGroup>
                    {this.renderNextRunDatesAdvancedRecurring()}
                  </TabPane>
                </TabContent>
              </Collapse>
              {this.state.activeTab === "3" && this.schedulingErrors()}
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
                  <option value="locust">Locust</option>
                </Input>
                <Modal
                  isOpen={this.state.showModal}
                  toggle={() => {
                    this.setState({ showModal: false });
                    this.setFormValue("k6Acknowledged", false);
                  }}
                >
                  <ModalBody>
                    <p>
                      This project is licensed under the{" "}
                      <code>
                        <a href="https://www.apache.org/licenses/LICENSE-2.0">Apache-2.0 License.</a>
                      </code>{" "}
                      However, as part of this test, the K6 testing framework that will be installed is licensed under
                      the{" "}
                      <code>
                        <a href="https://github.com/grafana/k6?tab=AGPL-3.0-1-ov-file">AGPL-3.0 License</a>
                      </code>
                    </p>
                  </ModalBody>
                  <ModalFooter>
                    <Button
                      id="modalAcknowledge"
                      color="primary"
                      onClick={() => {
                        this.setState({ showModal: false, isAcknowledged: true });
                        this.setFormValue("k6Acknowledged", true);
                      }}
                    >
                      Acknowledge
                    </Button>
                  </ModalFooter>
                </Modal>
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
                          defaultChecked={this.chooseNewFile}
                        />{" "}
                        Choose a new file.
                      </Label>
                    </FormGroup>
                  )}
                  {((Object.keys(SCRIPT_FILE_EXTENSIONS).includes(this.state.formValues.testType) &&
                    !["zip", "script"].includes(this.state.formValues.fileType)) ||
                    this.state.chooseNewFile) && (
                    <FormGroup>
                      <Label for="fileUpload">Upload File</Label>
                      <Input
                        type="file"
                        id="fileUpload"
                        name="fileUpload"
                        onChange={this.handleFileChange}
                        key={this.state.formValues.testType || ""}
                      />
                      <FormText color="muted">{this.uploadFileDescription()}</FormText>
                      {this.isUploading && (
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
                disabled={this.disableSubmitButton()}
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
