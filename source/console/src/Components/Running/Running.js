// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { Button, Table, Col, Row } from "reactstrap";
import { pubsub } from "../../pubsub";
import Chart from "chart.js/auto";
import "chartjs-adapter-date-fns";
declare var awsConfig;

class Running extends React.Component {
  constructor(props) {
    super(props);
    this._chartRef = React.createRef();
    this._chartRef.current = {
      avgRt: null,
      vu: null,
      succ: null,
      fail: null,
    };
    this.handleMessage = this.handleMessage.bind(this);
    this.buildChart = this.buildChart.bind(this);
    this.setGraphRegions = this.setGraphRegions.bind(this);
    this.callbackRef = this.callbackRef.bind(this);
    this.iotSubscription = "";
    this.timer = "";
    this.state = {
      testMetricData: {},
      charts: [],
      pauseChart: false,
    };
  }

  handleMessage(data) {
    const region = Object.keys(data)[0];
    //allocate max per region based on a total max of 5,000 items
    const maxPerRegion = Math.floor(5000 / Object.keys(this.state.testMetricData).length);
    const regionMetricData = this.state.testMetricData[region];

    data[region].forEach((dataPoint) => {
      const timeIndex = regionMetricData.findIndex((existingItems) => existingItems.timestamp === dataPoint.timestamp);
      if (timeIndex > -1) {
        regionMetricData[timeIndex].count += 1;
        regionMetricData[timeIndex].avgRt =
          (regionMetricData[timeIndex].avgRt + dataPoint.avgRt) / regionMetricData[timeIndex].count;
        regionMetricData[timeIndex].vu += dataPoint.vu;
        regionMetricData[timeIndex].succ += dataPoint.succ;
        regionMetricData[timeIndex].fail = dataPoint.fail;
      } else {
        dataPoint.count = 1;
        regionMetricData.length === maxPerRegion && regionMetricData.shift();
        regionMetricData.push(dataPoint);
      }
    });

    if (!this.state.pauseChart && !this.timer) {
      this.timer = setTimeout(() => {
        this.buildChart();
        clearTimeout(this.timer);
        this.timer = "";
      }, 1000);
    }

    //if more than the maximum, remove the first (oldest) item
    regionMetricData.length === maxPerRegion && regionMetricData.shift();
    this.setState((prevState) => ({
      testMetricData: {
        ...prevState.testMetricData,
        [region]: regionMetricData,
      },
    }));
  }

  setGraphRegions() {
    //initialize regions on chart data object
    const testMetricData = this.state.testMetricData;
    for (const regionEntry of this.props.data.testTaskConfigs) {
      testMetricData[regionEntry.region] = [];
    }
    this.setState({ testMetricData: { ...testMetricData } });
  }

  componentDidMount() {
    try {
      //set regions for graph data
      this.setGraphRegions();
      //subscribe to iot topic, handle incoming messages
      this.iotSubscription = pubsub.subscribe({ topics: `dlt/${this.props.testId}` }).subscribe({
        next: (data) => {
          this.handleMessage(data);
        },
        error: (error) => console.error(error),
        complete: () => console.log("closing connection"),
      });

      //build graphs
      this.buildChart();
    } catch (err) {
      console.error(err);
    }
  }

  componentWillUnmount() {
    this.timer && clearTimeout(this.timer);
    this.iotSubscription.unsubscribe();
  }

  buildChart() {
    const metricLabels = Object.keys(this._chartRef.current);

    const charts = metricLabels.map((label, i) => {
      const chartRef = this._chartRef.current[label].getContext("2d");
      let labelDescription = "";
      switch (label) {
        case "avgRt":
          labelDescription = "Response Time";
          break;
        case "vu":
          labelDescription = "Virtual Users Activities";
          break;
        case "succ":
          labelDescription = "Successes";
          break;
        case "fail":
          labelDescription = "Failures";
          break;
        default:
          labelDescription = "Unknown";
          break;
      }

      const scale = {
        x: {
          type: "time",
          time: {
            unit: "minute",
          },
          title: {
            display: true,
            text: "Time",
          },
        },
        y: {
          type: "linear",
          display: true,
          position: "left",
          title: {
            display: true,
            text: labelDescription,
          },
          min: 0,
        },
      };

      const colors = ["blue", "#FF9900", "red", "green", "purple"];
      const dataset = Object.keys(this.state.testMetricData).map((region, index) => {
        return {
          label: region,
          type: "scatter",
          data: this.state.testMetricData[region],
          parsing: {
            yAxisKey: label,
            xAxisKey: "timestamp",
          },
          pointRadius: 1,
          pointHoverRadius: 1,
          borderColor: colors[index],
          borderWidth: 2,
          fill: false,
          yAxisID: "y",
        };
      });

      const options = {
        animation: {
          duration: 0,
        },
        scales: scale,
        legend: { display: true },
      };

      const data = {
        datasets: dataset,
      };

      if (this.state.charts.length === 0) {
        return new Chart(chartRef, { type: "scatter", data, options });
      } else {
        const chart = this.state.charts[i];
        chart.data = data;
        chart.update();
        return chart;
      }
    });

    this.setState({ charts: charts });
  }

  callbackRef(metricLabel) {
    return (node) => (this._chartRef.current[metricLabel] = node);
  }

  render() {
    let ETA = 0;

    for (let regionSet of this.props.data.tasksPerRegion) {
      regionSet.provisioning = 0;
      regionSet.pending = 0;
      regionSet.running = 0;
      for (const task in regionSet.tasks) {
        switch (regionSet.tasks[task].lastStatus) {
          case "PROVISIONING":
            ++regionSet.provisioning;
            break;
          case "PENDING":
            ++regionSet.pending;
            break;
          case "RUNNING":
            ++regionSet.running;
            break;
          default:
            break;
        }
      }
    }
    const tasksPerRegion = this.props.data.tasksPerRegion;
    //10 seconds to launch every 10 (or 1 second per task) + 2 minutes to enter running state
    let totalTaskCount = 0;
    const testTasks = this.props.data.testTaskConfigs;
    testTasks.forEach((entry) => {
      totalTaskCount += entry.taskCount;
    });
    let workerLaunchTime = totalTaskCount / 60 + 2;
    //another minute to launch leader (may have to wait in step functions) + 2 minutes to enter running state, rounded up
    ETA = Math.ceil(workerLaunchTime + 3);
    return (
      <div>
        <div className="box">
          {/* <div className="result"> */}
          <div>
            <h2>Task Status</h2>
            <Table borderless>
              <thead>
                <tr>
                  <th>Region</th>
                  <th>Tasks</th>
                  <th>Running</th>
                  <th>Pending</th>
                  <th>Provisioning</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasksPerRegion.map((i) => (
                  <tr key={i.region}>
                    <td>{i.region}</td>
                    <td>{i.tasks.length}</td>
                    <td>{i.running}</td>
                    <td>{i.pending}</td>
                    <td>{i.provisioning}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <span className="console">
            Details for the running tasks can be viewed in the{" "}
            <a className="text-link" href={awsConfig.ecs_dashboard} target="_blank" rel="noopener noreferrer">
              Amazon ECS Console <i className="bi bi-box-arrow-up-right" />
            </a>
          </span>
        </div>
        <div className="box">
          <h3>Realtime Metrics</h3>
          <Button onClick={() => this.setState({ pauseChart: !this.state.pauseChart })}>
            {this.state.pauseChart ? "Resume" : "Pause"}
          </Button>
          <Col>
            <Row>
              <div className="chart-container-div">
                <canvas ref={this.callbackRef("avgRt")}></canvas>
              </div>
              <div className="chart-container-div">
                <canvas ref={this.callbackRef("vu")}></canvas>
              </div>
            </Row>
            <Row>
              <div className="chart-container-div">
                <canvas ref={this.callbackRef("succ")}></canvas>
              </div>
              <div className="chart-container-div">
                <canvas ref={this.callbackRef("fail")}></canvas>
              </div>
            </Row>
          </Col>
          <p className="console">
            The realtime average response time, number of users, success counts, and error counts for each region can be
            monitored using the{" "}
            <a
              className="text-link"
              href={awsConfig.cw_dashboard + `listOptions=~(filteringText~'EcsLoadTesting-${this.props.testId})`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Amazon CloudWatch Metrics Dashboard <i className="bi bi-box-arrow-up-right" />
            </a>
          </p>
          <p className="note">
            {" "}
            Response times will start to populate once the tasks are running, task are launched in batches of 10 and it
            can take up to {ETA} minutes for all tasks to be running.
          </p>
        </div>
      </div>
    );
  }
}

export default Running;
