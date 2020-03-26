/*******************************************************************************
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved. 
 *
 * Licensed under the Amazon Software License (the "License").
 * You may not use this file except in compliance with the License.
 * A copy of the License is located at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0    
 *
 * or in the "license" file accompanying this file. This file is distributed
 * on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 *
 ********************************************************************************/
import React from 'react';
import { Row, Col, Button, Popover, PopoverHeader, PopoverBody } from 'reactstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import { formatMetric } from '../../utils';

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
                    {
                        Object.keys(results).sort().map(metricName => {
                            const metric = results[metricName];
                            return (
                                <Row>
                                    <Col sm="3">
                                        <div className="result">
                                            {metricName}
                                        </div>
                                    </Col>
                                    <Col sm="9">
                                        <div className="result">
                                            {formatMetric(metric)}
                                        </div>
                                    </Col>
                                </Row>
                            );
                        })
                    }
                    <Row>
                        {errors}
                    </Row>
                    <Row>
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
