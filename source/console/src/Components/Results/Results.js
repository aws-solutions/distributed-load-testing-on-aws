// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Row, Col, Button, Popover, PopoverHeader, PopoverBody, Nav, NavItem, NavLink, TabContent, TabPane } from 'reactstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import { Storage } from 'aws-amplify';

class Results extends React.Component {
    constructor(props) {
        super(props);

        this.toggle = this.toggle.bind(this);
        this.toggleTab = this.toggleTab.bind(this);
        this.showResult = this.showResult.bind(this);
        this.caculateBandwidth = this.caculateBandwidth.bind(this);
        this.state = {
            info: false,
            activeTab: 'summary',
            metricImage: undefined,
            metricImageLocation: undefined
        };
    }

    toggle() {
        this.setState({
            info: !this.state.info
        });
    }

    toggleTab(tab) {
        if (this.state.activeTab !== tab) {
            this.setState({ activeTab: tab });
        }
    }

    /**
     * Caculate the bandwidth.
     * @param {number} bandwidth Test total download bytes
     * @param {number} duration Test duration seconds
     * @return {string} Caculcated bandwidth
     */
    caculateBandwidth(bandwidth, duration) {
        if (isNaN(bandwidth) || isNaN(duration) || duration === 0) {
            return '-';
        }

        bandwidth = Math.round(bandwidth * 100 / duration / 8) / 100; // Initially, Bps
        let units = 'Bps';

        while (bandwidth > 1024) {
            switch (units) {
                case 'Bps':
                    units = 'Kbps';
                    break;
                case 'Kbps':
                    units = 'Mbps';
                    break;
                case 'Mbps':
                    units = 'Gbps';
                    break;
                default:
                    return `${bandwidth} ${units}`;
            }

            bandwidth = Math.round(bandwidth * 100 / 1024) / 100;
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
            const image = await Storage.get(metricS3ImageLocation, { contentType: 'data:image/jpeg;base64', download: true });
            const imageBodyText = await image.Body.text();
            this.setState({ metricImage: imageBodyText });
        } catch (error) {
            console.error('There was an error trying to retrieve the CloudWatch widget image from S3: ', error);
            this.setState({ metricImage: undefined });
        }
    }

    /**
     * Checks if the variable is undefined
     * @param {any} value The input variable 
     * @returns {boolean} Returns true if the variable is undefined
     */
    isUndefined(value) {
        return typeof value === 'undefined';
    }

    /*
     * Initital load of the CloudWatch widget image depending upon set value returned in `this.props.data`
     * Either `this.props.data.metricS3Location` will be populated (if base64 image string is stored in S3)
     * or `this.props.data.metricWidgetImage` will be populated (if base64 image string is stored in DynamoDB)
     */
    componentDidMount = async () => {
        if (!this.isUndefined(this.props.data.metricS3Location)) {
            await this.retrieveImage(this.props.data.metricS3Location);
            this.setState({ metricImageLocation: this.props.data.metricS3Location });
        } else if (!this.isUndefined(this.props.data.metricWidgetImage)) {
            this.setState({ metricImage: this.props.data.metricWidgetImage });
        } else {
            console.log("The CloudWatch metric widget could not be retrieved.");
            this.setState({
                metricImage: undefined,
                metricImageLocation: undefined
            });
        }
    }

    /*
     * Update the CloudWatch widget image in showResult onClick event for View Details
     * This includes backwards compatability for images stored as a string in DynamoDB
     * Either `this.props.data.metricWidgetImage` or `this.props.data.metricS3Location` are populated by the solution
     * `this.props.data.metricWidgetImage` is from the previous method of storing the base64 encoded image in DynamoBD
     * `this.props.data.metricS3Location` is the new method where the image is stored in S3 and the location is stored in DynamoDB
     */
    componentDidUpdate = async () => {
        if (!this.isUndefined(this.props.data.metricS3Location) && this.props.data.metricS3Location !== this.state.metricImageLocation) {
            await this.retrieveImage(this.props.data.metricS3Location);
            this.setState({ metricImageLocation: this.props.data.metricS3Location });
        } else if (this.isUndefined(this.props.data.metricS3Location) && !this.isUndefined(this.props.data.metricWidgetImage) && this.props.data.metricWidgetImage !== this.state.metricImage) {
            this.setState({
                metricImage: this.props.data.metricWidgetImage,
                metricImageLocation: undefined
            });
        } else if (this.isUndefined(this.props.data.metricS3Location) && this.isUndefined(this.props.data.metricWidgetImage)) {
            console.log("The CloudWatch metric widget could not be retrieved.");
            this.setState({
                metricImage: undefined,
                metricImageLocation: undefined
            });
        }
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
            errors = data.rc.map((err) =>
                <Col sm="4" key={err.code}>
                    <div className="result error">
                        <b>{err.code}:</b><span>{err.count}</span>
                    </div>
                </Col>
            );
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
                            <p>{data.avg_rt}s</p>
                        </div>
                    </Col>
                    <Col sm="3">
                        <div className="result">
                            Avg Latency
                            <p>{data.avg_lt}s</p>
                        </div>
                    </Col>
                    <Col sm="3">
                        <div className="result">
                            Avg Connection Time
                            <p>{data.avg_ct}s</p>
                        </div>
                    </Col>
                    <Col sm="3">
                        <div className="result">
                            Avg Bandwidth
                            <p>{this.caculateBandwidth(data.bytes, testDuration)}</p>
                        </div>
                    </Col>
                </Row>
                <Row>
                    <Col sm="3">
                        <div className="result">
                            <b>Total Count:</b><span>{data.throughput}</span>
                        </div>
                    </Col>
                    <Col sm="3">
                        <div className="result">
                            <b>Success Count:</b><span>{data.succ}</span>
                        </div>
                    </Col>
                    <Col sm="3">
                        <div className="result">
                            <b>Error Count:</b><span>{data.fail}</span>
                        </div>
                    </Col>
                    <Col sm="3">
                        <div className="result">
                            <b>Requests Per Second:</b><span>{testDuration > 0 ? Math.round(data.throughput * 100 / testDuration) / 100 : '-'}</span>
                        </div>
                    </Col>
                </Row>
                {
                    errors &&
                    <Row>
                        <Col sm="12">
                            <h3>Errors</h3>
                        </Col>
                    </Row>
                }
                <Row>
                    {errors}
                </Row>
                <Row>
                    <Col sm="3">
                        <h3>Percentile Response Time</h3>
                        <div className="result">
                            <b>100%:</b><span>{data.p100_0}s</span>
                        </div>
                        <div className="result">
                            <b>99.9%:</b><span>{data.p99_9}s</span>
                        </div>
                        <div className="result">
                            <b>99%:</b><span>{data.p99_0}s</span>
                        </div>
                        <div className="result">
                            <b>95%:</b><span>{data.p95_0}s</span>
                        </div>
                        <div className="result">
                            <b>90%:</b><span>{data.p90_0}s</span>
                        </div>
                        <div className="result">
                            <b>50%:</b><span>{data.p50_0}s</span>
                        </div>
                        <div className="result">
                            <b>0%:</b><span>{data.p0_0}s</span>
                        </div>
                    </Col>
                    {
                        image &&
                        <Col sm="9">
                            <img src={`data:image/jpeg;base64, ${image}`} alt='avRt' />
                        </Col>
                    }
                </Row>
            </div>
        );
    }

    render() {
        const results = this.props.data.results || { labels: [], testDuration: 0 };
        const testType = this.props.data.testType || '';
        const { labels, testDuration } = results;

        let labelTabs = [];
        let labelContents = [];

        if (labels && labels.length > 0 && !['simple', ''].includes(testType)) {
            for (let i = 0, length = labels.length; i < length; i++) {
                let label = labels[i].label;
                labelTabs.push(
                    <NavItem key={`${label}+${i}`}>
                        <NavLink className="custom-tab" active={this.state.activeTab === label} onClick={() => { this.toggleTab(label) }}>{label}</NavLink>
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
                    <h2>Test Results</h2>
                    <Button id="info" color="link"><FontAwesomeIcon id="icon" icon={faInfoCircle} /> Info</Button>
                    <Row>
                        <Col xs="6" sm="3" md="3">
                            <Nav tabs vertical pills>
                                <NavItem>
                                    <NavLink className="custom-tab" active={this.state.activeTab === 'summary'} onClick={() => { this.toggleTab('summary') }}>Summary</NavLink>
                                </NavItem>
                                {labelTabs}
                            </Nav>
                        </Col>
                        <Col xs="6" sm="9" md="9">
                            <TabContent activeTab={this.state.activeTab}>
                                <TabPane tabId="summary" >
                                    {this.showResult(results, testDuration)}
                                </TabPane>
                                {labelContents}
                            </TabContent>
                        </Col>
                    </Row>
                </div>

                <Popover className="info" placement="top" isOpen={this.state.info} target="info" toggle={this.toggle}>
                    <PopoverHeader>Results Details</PopoverHeader>
                    <PopoverBody>
                        <li><b>Avg Response Time (AvgRt):</b> the average response time in seconds for all requests.</li>
                        <li><b>Avg Latency (AvgLt):</b> the average latency in seconds for all requests.</li>
                        <li><b>Avg Connection Time (AvgCt):</b> the average connection time in seconds for all requests.</li>
                        <li><b>Avg Bandwidth:</b> the average bandwidth for all requests.</li>
                        <li><b>Total Count:</b> the total number of requests.</li>
                        <li><b>Success Count:</b> the total number of success requests.</li>
                        <li><b>Error Count:</b> the total number of errors.</li>
                        <li><b>Requests Per Second:</b> the average requests per seconds for all requests.</li>
                        <li><b>Percentiles:</b> percentile levels for the response time, 0 is also minimum response time, 100 is maximum response time.</li>
                    </PopoverBody>
                </Popover>
            </div>
        )
    }
}

export default Results;
