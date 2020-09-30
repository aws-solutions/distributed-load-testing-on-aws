// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Row, Col, Button, Popover, PopoverHeader, PopoverBody } from 'reactstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInfoCircle } from '@fortawesome/free-solid-svg-icons';

class Results extends React.Component {
    constructor(props) {
        super(props);

        this.toggle = this.toggle.bind(this);
        this.state = {
          info: false
        };
      }

      toggle() {
        this.setState({
            info: !this.state.info
        });
      }

      render() {
        const results = this.props.data.results || {};

        let errors;
        if (results.rc && results.rc.length > 0) {
            errors = results.rc.map((err) =>
                <Col sm="3" key={err.code}>
                    <div className="result error">
                        <b>Error {err.code}:</b><span>{err.count}</span>
                    </div>
                </Col>
            );
        }

        return (
            <div>
                <div className="box">
                    <h2>Test Results</h2>
                    <Button id="info" color="link"><FontAwesomeIcon id="icon" icon={faInfoCircle} /> Info</Button>
                    <Row>
                        <Col sm="3">
                            <div className="result">
                                Avg Response Time
                                <p>{results.avg_rt}s</p>
                            </div>
                        </Col>
                        <Col sm="3">
                            <div className="result">
                                Avg Latency
                                <p>{results.avg_lt}s</p>
                            </div>
                        </Col>
                        <Col sm="3">
                            <div className="result">
                                Avg Conection Time
                                <p>{results.avg_ct}s</p>
                            </div>
                        </Col>
                        <Col sm="3">
                            <div className="result">
                                Avg Bandwidth
                                <p>{ Math.round(results.bytes * 0.01) /10 } kbps</p>
                            </div>
                        </Col>
                    </Row>
                    <Row>
                        <Col sm="3">
                            <div className="result">
                                <b>Total Requests:</b><span>{results.throughput}</span>
                            </div>
                        </Col>
                        <Col sm="3">
                            <div className="result">
                                <b>Success Count:</b><span>{results.succ}</span>
                            </div>
                        </Col>
                        <Col sm="3">
                            <div className="result">
                                <b>Error Count:</b><span>{results.fail}</span>
                            </div>
                        </Col>
                        <Col sm="3">
                            <div className="result">
                                <b>Avg Task Duration:</b><span>{Math.round(results.testDuration /60)}m</span>
                            </div>
                        </Col>
                    </Row>
                    <Row>
                    { errors }
                    </Row>
                    <Row>
                        <Col sm="3">
                            <h3>Percentile Response Time</h3>
                            <div className="result">
                                <b>100%:</b><span>{results.p100_0}s</span>
                            </div>
                            <div className="result">
                                <b>99.9%:</b><span>{results.p99_9}s</span>
                            </div>
                            <div className="result">
                                <b>99%:</b><span>{results.p99_0}s</span>
                            </div>
                            <div className="result">
                                <b>95%:</b><span>{results.p95_0}s</span>
                            </div>
                            <div className="result">
                                <b>90%:</b><span>{results.p90_0}s</span>
                            </div>
                            <div className="result">
                                <b>50%:</b><span>{results.p50_0}s</span>
                            </div>
                            <div className="result">
                                <b>0%:</b><span>{results.p0_0}s</span>
                            </div>
                        </Col>
                        <Col sm="9">
                            <img src={`data:image/jpeg;base64,${this.props.data.metricWidgetImage}`} alt='avRt' />
                        </Col>
                    </Row>
                </div>

                <Popover className="info" placement="top" isOpen={this.state.info} target="info" toggle={this.toggle}>
                    <PopoverHeader>Results Details</PopoverHeader>
                    <PopoverBody>
                        <li><b>Avg Response Time (AvgRt):</b> the average response time in seconds for all requests.</li>
                        <li><b>Avg Latency (AvgLt):</b> the average latency in seconds for all requests </li>
                        <li><b>Avg Connection Time (AvgCt):</b> the average connection time in seconds for all requests </li>
                        <li><b>Avg Bandwidth:</b> the average bandwidth in kilobytes per second for all requests  </li>
                        <li><b>Percentiles:</b> percentile levels for the response time, 0 is also minimum response time, 100 is maximum response time </li>
                    </PopoverBody>
                </Popover>
            </div>
        )
    }
}

export default Results;
