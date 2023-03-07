// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { Modal, ModalBody, ModalHeader, Table } from "reactstrap";
import DetailsTable from "../Details/DetailsTable.js";
import Results from "../Results/Results.js";

class History extends React.Component {
  constructor(props) {
    super(props);
    this.getHistoricalTest = this.getHistoricalTest.bind(this);
    this.state = {
      rowIsActive: -1,
    };
  }

  activeRow(index) {
    this.setState({
      rowIsActive: index,
    });
  }

  onClick(index) {
    this.activeRow(index);
  }

  //Sets the state with values from a previous run of the test
  getHistoricalTest(testRun) {
    try {
      let data = {
        ...testRun,
        testName: testRun.testScenario.execution[0].scenario,
        testId: this.props.data.testId,
      };
      data.rampUp = data.testScenario.execution[0]["ramp-up"];
      data.holdFor = data.testScenario.execution[0]["hold-for"];
      if (!data.testType || ["", "simple"].includes(data.testType)) {
        data.testType = "simple";
        data.endpoint = data.testScenario.scenarios[`${data.testName}`].requests[0].url;
        data.method = data.testScenario.scenarios[`${data.testName}`].requests[0].method;
        data.body = data.testScenario.scenarios[`${data.testName}`].requests[0].body;
        data.headers = data.testScenario.scenarios[`${data.testName}`].requests[0].headers;
      }
      return data;
    } catch (err) {
      alert(err);
    }
  }

  render() {
    const history = this.props.data.history || [];
    return (
      <div>
        <div className="box">
          <h2>Results History</h2>
          <Table borderless responsive>
            <thead>
              <tr>
                <th>Run Time</th>
                <th>Total Task Count</th>
                <th>Total Concurrency</th>
                <th>Average Response Time</th>
                <th>Success %</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {history.map((i, index) => {
                const loadInfo = i.testTaskConfigs.reduce((previous, current) => ({
                  taskCount: previous.taskCount + current.taskCount,
                  concurrency: previous.concurrency + current.concurrency,
                }));
                const data = this.getHistoricalTest(i);
                return (
                  <tr
                    id={`historyRow-${index}`}
                    key={i.testRunId}
                    className={this.state.rowIsActive === index ? "rowActive" : ""}
                  >
                    <td id={`endTime-${index}`}>{i.endTime}</td>
                    <td id={`taskCount-${index}`}>{loadInfo.taskCount}</td>
                    <td id={`concurrency-${index}`}>{loadInfo.concurrency}</td>
                    <td id={`avgResponseTime-${index}`}>{i.results.total?.avg_rt}s</td>
                    <td id={`successPercent-${index}`}>{i.succPercent}%</td>
                    <td id={`detailsLink-${index}`}>
                      <div className="text-link history-link" onClick={() => this.onClick(index)}>
                        View details
                      </div>
                    </td>
                    {this.state.rowIsActive === index && (
                      <Modal
                        size="xl"
                        isOpen={this.state.rowIsActive === index}
                        toggle={() => {
                          this.setState({ rowIsActive: -1 });
                        }}
                      >
                        <ModalHeader
                          toggle={() => {
                            this.setState({ rowIsActive: -1 });
                          }}
                        >
                          <h2>Test run from {i.endTime}</h2>
                        </ModalHeader>
                        <ModalBody>
                          <DetailsTable
                            data={data}
                            handleFullTestDataLocation={this.props.handleFullTestDataLocation}
                          ></DetailsTable>
                          <Results
                            data={data}
                            regions={Object.keys(data.results).filter((region) => region !== "total")}
                          ></Results>
                        </ModalBody>
                      </Modal>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </div>
    );
  }
}

export default History;
