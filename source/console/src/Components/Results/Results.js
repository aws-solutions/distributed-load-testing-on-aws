// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import {
  Row,
  Col,
  Button,
  Popover,
  PopoverHeader,
  PopoverBody,
  Nav,
  NavItem,
  NavLink,
  TabContent,
  TabPane,
  Tooltip,
  Input,
  Modal,
  ModalHeader,
  ModalBody,
} from "reactstrap";
import { downloadData } from "aws-amplify/storage";
import AceEditor from "react-ace";

class Results extends React.Component {
  constructor(props) {
    super(props);

    this.toggle = this.toggle.bind(this);
    this.toggleTab = this.toggleTab.bind(this);
    this.showResult = this.showResult.bind(this);
    this.calculateBandwidth = this.calculateBandwidth.bind(this);
    this.handleRegionChange = this.handleRegionChange.bind(this);
    this.getTotalGraphSource = this.getTotalGraphSource.bind(this);
    this.tooltipToggle = this.tooltipToggle.bind(this);
    this.handleCopyClick = this.handleCopyClick.bind(this);
    this.state = {
      info: false,
      activeTab: "summary",
      metricImage: undefined,
      metricImageLocation: undefined,
      selectedRegion: this.props.regions[0],
      showTotalGraphDirections: false,
      tooltipOpen: false,
      tooltipLanguage: "Copy Code",
    };
  }

  toggle() {
    this.setState({
      info: !this.state.info,
    });
  }

  toggleTab(tab) {
    if (this.state.activeTab !== tab) {
      this.setState({ activeTab: tab });
    }
  }

  /**
   * calculate the bandwidth.
   * @param {number} bandwidth Test total download bytes
   * @param {number} duration Test duration seconds
   * @return {string} Calculated bandwidth
   */
  calculateBandwidth(bandwidth, duration) {
    if (isNaN(bandwidth) || isNaN(duration) || duration === 0) {
      return "-";
    }

    bandwidth = Math.round((bandwidth * 100) / duration / 8) / 100; // Initially, Bps
    let units = "Bps";

    while (bandwidth > 1024) {
      switch (units) {
        case "Bps":
          units = "Kbps";
          break;
        case "Kbps":
          units = "Mbps";
          break;
        case "Mbps":
          units = "Gbps";
          break;
        default:
          return `${bandwidth} ${units}`;
      }

      bandwidth = Math.round((bandwidth * 100) / 1024) / 100;
    }

    return `${bandwidth} ${units}`;
  }

  /**
   * Retrieve the CloudWatch widget image from S3
   * Store the base64 encoded image string in state
   * @param {string} metricS3ImageLocation
   */
  retrieveImage = async (metricS3ImageLocation) => {
    try {
      const { body } = await downloadData({ path: `public/${metricS3ImageLocation}` }).result;
      const imageBodyText = await body.text();
      this.setState({ metricImage: imageBodyText });
    } catch (error) {
      console.error("There was an error trying to retrieve the CloudWatch widget image from S3: ", error);
      this.setState({ metricImage: undefined });
    }
  };

  /**
   * Checks if the variable is undefined
   * @param {any} value The input variable
   * @returns {boolean} Returns true if the variable is undefined
   */
  isUndefined(value) {
    return typeof value === "undefined";
  }

  /*
   * Initial load of the CloudWatch widget image depending upon set value returned in `this.props.data`
   * Either `this.props.data.metricS3Location` will be populated (if base64 image string is stored in S3)
   * or `this.props.data.metricWidgetImage` will be populated (if base64 image string is stored in DynamoDB)
   */
  componentDidMount = async () => {
    if (!this.isUndefined(this.props.data.results.total.metricS3Location)) {
      await this.retrieveImage(this.props.data.results.total.metricS3Location);
      this.setState({ metricImageLocation: this.props.data.results.total.metricS3Location });
    } else if (!this.isUndefined(this.props.data.metricWidgetImage)) {
      this.setState({ metricImage: this.props.data.metricWidgetImage });
    } else {
      console.log("The CloudWatch metric widget could not be retrieved.");
      this.setState({
        metricImage: undefined,
        metricImageLocation: undefined,
      });
    }
  };

  /*
   * Update the CloudWatch widget image in showResult onClick event for View Details
   * This includes backwards compatibility for images stored as a string in DynamoDB
   * Either `this.props.data.metricWidgetImage` or `this.props.data.metricS3Location` are populated by the solution
   * `this.props.data.metricWidgetImage` is from the previous method of storing the base64 encoded image in DynamoBD
   * `this.props.data.metricS3Location` is the new method where the image is stored in S3 and the location is stored in DynamoDB
   */
  componentDidUpdate = async () => {
    const imageLocation = this.props.data.results[this.state.selectedRegion].metricS3Location || undefined;
    if (!this.isUndefined(imageLocation) && imageLocation !== this.state.metricImageLocation) {
      await this.retrieveImage(imageLocation);
      this.setState({ metricImageLocation: imageLocation });
    } else if (
      this.isUndefined(imageLocation) &&
      !this.isUndefined(this.props.data.metricWidgetImage) &&
      this.props.data.metricWidgetImage !== this.state.metricImage
    ) {
      this.setState({
        metricImage: this.props.data.metricWidgetImage,
        metricImageLocation: undefined,
      });
    } else if (this.isUndefined(imageLocation) && this.isUndefined(this.props.data.metricWidgetImage)) {
      console.log("The CloudWatch metric widget could not be retrieved.");
      this.setState({
        metricImage: undefined,
        metricImageLocation: undefined,
      });
    }
  };

  getTotalGraphSource() {
    const regions = this.props.regions;
    const metricOptions = {
      avgRt: {
        label: "Avg Response Time",
        color: "#FF9900",
      },
      numVu: {
        label: "Virtual Users Activities",
        color: "#1f77b4",
        stat: "Sum",
      },
      numSucc: {
        label: "Successes",
        color: "#2CA02C",
        stat: "Sum",
      },
      numFail: {
        label: "Failures",
        color: "#D62728",
        stat: "Sum",
      },
    };
    const metricList = { avgRt: [], numVu: [], numSucc: [], numFail: [] };
    const metrics = regions
      .map((region, index) => {
        const regionalMetrics = [];
        for (const metric in metricOptions) {
          const id = `${metric}${index}`;
          metricList[metric].push(id);
          regionalMetrics.push([
            "distributed-load-testing",
            `${this.props.data.testId}-${metric}`,
            {
              ...metricOptions[metric],
              visible: false,
              region: region,
              id: id,
            },
          ]);
        }
        return regionalMetrics;
      })
      .flat();

    for (const metric in metricOptions) {
      const yAxis = metric === "avgRt" ? "left" : "right";
      const op = metric === "avgRt" ? "AVG" : "SUM";
      metrics.push({
        ...metricOptions[metric],
        yAxis: yAxis,
        expression: `${op}([${metricList[metric]}])`,
      });
    }

    return JSON.stringify(
      {
        width: 600,
        height: 395,
        metrics: metrics,
        period: 10,
        yAxis: {
          left: {
            showUnits: false,
            label: "Seconds",
          },
          right: {
            showUnits: false,
            label: "Total",
          },
        },
        stat: "Average",
        view: "timeSeries",
        start: new Date(this.props.data.startTime).toISOString(),
        end: new Date(this.props.data.endTime).toISOString(),
      },
      null,
      2
    );
  }

  /**
   * Show the result into DIV.
   * @param {object} data Result data to show
   * @param {number} testDuration Test duration
   * @return {JSX.IntrinsicElements} Result DIV from the data
   */
  showResult(data, testDuration) {
    testDuration = parseInt(testDuration);
    const image = this.state.metricImage;

    let errors;
    if (data.rc && data.rc.length > 0) {
      errors = data.rc.map((err) => (
        <Col sm="4" key={err.code}>
          <div className="result error">
            <b>{err.code}:</b>
            <span>{err.count}</span>
          </div>
        </Col>
      ));
    }

    if (isNaN(testDuration) || testDuration === 0) {
      testDuration = this.props.testDuration;
    }

    return (
      <div>
        <Row>
          <Col sm="3">
            <div className="result">
              Avg Response Time
              <p id="avgResponseTime">{data.avg_rt}s</p>
            </div>
          </Col>
          <Col sm="3">
            <div className="result">
              Avg Latency
              <p id="avgLatency">{data.avg_lt}s</p>
            </div>
          </Col>
          <Col sm="3">
            <div className="result">
              Avg Connection Time
              <p id="avgConnectionTime">{data.avg_ct}s</p>
            </div>
          </Col>
          <Col sm="3">
            <div className="result">
              Avg Bandwidth
              <p id="avgBandwidth">{this.calculateBandwidth(data.bytes, testDuration)}</p>
            </div>
          </Col>
        </Row>
        <Row>
          <Col sm="3">
            <div className="result">
              <b>Total Count:</b>
              <span id="totalCount">{data.throughput}</span>
            </div>
          </Col>
          <Col sm="3">
            <div className="result">
              <b>Success Count:</b>
              <span id="successCount">{data.succ}</span>
            </div>
          </Col>
          <Col sm="3">
            <div className="result">
              <b>Error Count:</b>
              <span id="errorCount">{data.fail}</span>
            </div>
          </Col>
          <Col sm="3">
            <div className="result">
              <b>Requests Per Second:</b>
              <span id="requestsPerSecond">
                {testDuration > 0 ? Math.round((data.throughput * 100) / testDuration) / 100 : "-"}
              </span>
            </div>
          </Col>
        </Row>
        {errors && (
          <Row>
            <Col sm="12">
              <h3>Errors</h3>
            </Col>
          </Row>
        )}
        <Row>{errors}</Row>
        <Row>
          <Col sm="3">
            <h3>Percentile Response Time</h3>
            <div className="result">
              <b>100%:</b>
              <span id="prt100">{data.p100_0}s</span>
            </div>
            <div className="result">
              <b>99.9%:</b>
              <span id="prt99.9">{data.p99_9}s</span>
            </div>
            <div className="result">
              <b>99%:</b>
              <span id="prt99">{data.p99_0}s</span>
            </div>
            <div className="result">
              <b>95%:</b>
              <span id="prt95">{data.p95_0}s</span>
            </div>
            <div className="result">
              <b>90%:</b>
              <span id="prt90">{data.p90_0}s</span>
            </div>
            <div className="result">
              <b>50%:</b>
              <span id="prt50">{data.p50_0}s</span>
            </div>
            <div className="result">
              <b>0%:</b>
              <span id="prt0">{data.p0_0}s</span>
            </div>
          </Col>
          {(this.state.selectedRegion === "total" && (
            <Col className="total-graph-directions">
              <h3>
                Graphs are not available for aggregated results across multiple regions.
                <br />
                <br />
                To view graphs you may do one of the following:
              </h3>
              <ol className="total-graph-directions-list">
                <li>
                  <b>View graphs by region</b>
                </li>
                <ul>
                  <li>View the graphs by region using the dropdown above</li>
                </ul>
                <li>
                  <b>View a total graph with all regions aggregated</b>
                </li>
                <ul>
                  <li>
                    View the total aggregate graph by using Amazon CloudWatch in the AWS console using the
                    following&nbsp;
                    <Button
                      className="total-graph-directions-link"
                      color="link"
                      onClick={() => this.setState({ showTotalGraphDirections: !this.state.showTotalGraphDirections })}
                    >
                      directions
                      <Modal
                        size="lg"
                        isOpen={this.state.showTotalGraphDirections}
                        toggle={() => this.setState({ showTotalGraphDirections: !this.state.showTotalGraphDirections })}
                      >
                        <ModalHeader
                          toggle={() =>
                            this.setState({ showTotalGraphDirections: !this.state.showTotalGraphDirections })
                          }
                        >
                          How to view the aggregate graph using the AWS CloudWatch console
                        </ModalHeader>
                        <ModalBody>
                          <ol>
                            <li>
                              Copy the following Code&nbsp;&nbsp;
                              <Button
                                id="total-graph-source"
                                className="total-graph-button"
                                color="link"
                                onClick={() => this.handleCopyClick()}
                              >
                                <i className="icon-small bi bi-clipboard-check-fill"></i>
                              </Button>
                              <Tooltip
                                target="total-graph-source"
                                placement="top"
                                trigger="hover"
                                isOpen={this.state.tooltipOpen}
                                toggle={this.tooltipToggle}
                              >
                                {this.state.tooltipLanguage}
                              </Tooltip>
                              <AceEditor
                                id="headers"
                                name="headers"
                                value={this.getTotalGraphSource()}
                                mode="json"
                                theme="github"
                                width="100%"
                                maxLines={20}
                                showPrintMargin={false}
                                showGutter={false}
                                readOnly={true}
                                editorProps={{ $blockScrolling: true }}
                              />
                            </li>
                            <li>
                              Navigate to Amazon CloudWatch in the&nbsp;
                              <a
                                className="text-link"
                                href="https://console.aws.amazon.com/cloudwatch/home"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                AWS Console
                              </a>
                            </li>
                            <li>
                              In the left hand menu, click on <b>All Metrics</b> under the <b>Metrics</b> header.
                            </li>
                            <li>
                              Click on the <b>Source</b> tab
                            </li>
                            <li>Paste the copied code into the source text box in the Amazon CloudWatch console.</li>
                          </ol>
                        </ModalBody>
                      </Modal>
                    </Button>
                  </li>
                </ul>
              </ol>
            </Col>
          )) ||
            (image && (
              <Col sm="9">
                <img id="resultsGraph" src={`data:image/jpeg;base64, ${image}`} alt="avRt" />
              </Col>
            ))}
        </Row>
      </div>
    );
  }

  handleRegionChange = async (event) => {
    this.setState({ selectedRegion: event.target.value });
  };

  tooltipToggle() {
    let tooltipLanguage;
    if (this.state.tooltipOpen === false) {
      tooltipLanguage = "Copy Code";
    }
    this.setState({
      tooltipOpen: !this.state.tooltipOpen,
      tooltipLanguage: tooltipLanguage,
    });
  }

  handleCopyClick() {
    navigator.clipboard.writeText(this.getTotalGraphSource());
    this.setState({ tooltipLanguage: "Copied!" });
  }

  render() {
    const results = this.props.data.results[this.state.selectedRegion] || { labels: [], testDuration: 0 };
    const testType = this.props.data.testType || "";
    const { labels, testDuration } = results;

    const labelTabs = [];
    const labelContents = [];

    if (labels && labels.length > 0 && !["simple", ""].includes(testType)) {
      for (let i = 0, length = labels.length; i < length; i++) {
        let label = labels[i].label;
        labelTabs.push(
          <NavItem key={`${label}+${i}`}>
            <NavLink
              className="custom-tab"
              active={this.state.activeTab === label}
              onClick={() => {
                this.toggleTab(label);
              }}
            >
              {label}
            </NavLink>
          </NavItem>
        );

        labelContents.push(
          <TabPane tabId={label} key={`${label}+${i}`}>
            {this.showResult(labels[i], testDuration)}
          </TabPane>
        );
      }
    }

    return (
      <div>
        <div className="box" id="TestResults">
          <Row>
            <Col xs="9">
              <h2>Test Results</h2>
              <Button id="info" color="link">
                <i className="bi bi-info-circle-fill" /> Info
              </Button>
            </Col>
            <Col>
              <Input
                type="select"
                id="regionSelect"
                name="regionSelect"
                required
                value={this.state.selectedRegion}
                onChange={this.handleRegionChange}
              >
                {this.props.regions.map((key) => (
                  <option value={key} key={key} defaultValue={key === this.props.regions[0]}>
                    {key}
                  </option>
                ))}
                {this.props.regions.length > 1 && <option value="total">total</option>}
              </Input>
            </Col>
          </Row>
          <Row>
            <Col xs="6" sm="3" md="3">
              <Nav tabs vertical pills>
                <NavItem>
                  <NavLink
                    className="custom-tab"
                    active={this.state.activeTab === "summary"}
                    onClick={() => {
                      this.toggleTab("summary");
                    }}
                  >
                    Summary
                  </NavLink>
                </NavItem>
                {labelTabs}
              </Nav>
            </Col>
            <Col xs="6" sm="9" md="9">
              <TabContent activeTab={this.state.activeTab}>
                <TabPane tabId="summary">{this.showResult(results, testDuration)}</TabPane>
                {labelContents}
              </TabContent>
            </Col>
          </Row>
        </div>

        <Popover className="info" placement="top" isOpen={this.state.info} target="info" toggle={this.toggle}>
          <PopoverHeader>Results Details</PopoverHeader>
          <PopoverBody>
            <li>
              <b>Avg Response Time (AvgRt):</b> the average response time in seconds for all requests.
            </li>
            <li>
              <b>Avg Latency (AvgLt):</b> the average latency in seconds for all requests.
            </li>
            <li>
              <b>Avg Connection Time (AvgCt):</b> the average connection time in seconds for all requests.
            </li>
            <li>
              <b>Avg Bandwidth:</b> the average bandwidth for all requests.
            </li>
            <li>
              <b>Total Count:</b> the total number of requests.
            </li>
            <li>
              <b>Success Count:</b> the total number of success requests.
            </li>
            <li>
              <b>Error Count:</b> the total number of errors.
            </li>
            <li>
              <b>Requests Per Second:</b> the average requests per seconds for all requests.
            </li>
            <li>
              <b>Percentiles:</b> percentile levels for the response time, 0 is also minimum response time, 100 is
              maximum response time.
            </li>
          </PopoverBody>
        </Popover>
      </div>
    );
  }
}

export default Results;
