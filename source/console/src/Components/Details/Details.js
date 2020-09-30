// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Link } from "react-router-dom";
import { Button, Modal, ModalHeader, ModalBody, ModalFooter, Row, Col, Spinner } from 'reactstrap';
import { API, Storage } from 'aws-amplify';

import Results from '../Results/Results.js';
import Running from '../Running/Running.js';
import History from '../History/History.js';

class Details extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            isLoading: true,
            runningTasks: false,
            deleteModal: false,
            cancelModal: false,
            testId: props.location.state,
            data: {
                testName: null,
                testDescription: null,
                testType: null,
                results: {},
                history: [],
                taskCount: null,
                concurrency: null,
                rampUp: null,
                holdFor: null,
                endpoint: null,
                method: null,
                taskArns: [],
                testScenario: {
                    execution: [],
                    reporting: [],
                    scenarios: {}
                }
            }
        }
        this.deleteToggle = this.deleteToggle.bind(this);
        this.deleteTest = this.deleteTest.bind(this);
        this.cancelToggle = this.cancelToggle.bind(this);
        this.cancelTest = this.cancelTest.bind(this);
        this.handleStart = this.handleStart.bind(this);
        this.handleDownload = this.handleDownload.bind(this);
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
        const { testId } = this.state.testId;
        try {
            await API.del('dlts', `/scenarios/${testId}`);
        } catch (err) {
            alert(err);
        }
        this.props.history.push("dashboard");
    }

    cancelTest = async () => {
        const { testId } = this.state.testId;
        try {
            await API.post('dlts', `/scenarios/${testId}`);
        } catch (err) {
            alert(err);
        }
        this.props.history.push("dashboard");
    }

    reloadData = async () => {
        this.setState({
            isLoading: true,
            data:{
                results:{},
                history:[],
                concurrency:null,
                rampUp:null,
                holdFor: null,
                endpoint:null,
                method:null,
                body:{},
                header:{},
                taskArns:[]
            }
        })
        await this.getTest();
        this.setState({ isLoading: false });
    }

    getTest = async () => {
        const { testId } = this.state.testId;
        try {
            const data = await API.get('dlts', `/scenarios/${testId}`);
            const { testName } = data;
            data.concurrency = data.testScenario.execution[0].concurrency;
            data.rampUp = data.testScenario.execution[0]['ramp-up'];
            data.holdFor = data.testScenario.execution[0]['hold-for'];

            // For migration purpose, old version would have undefined value, then it's a simple test.
            if (!data.testType || ['', 'simple'].includes(data.testType)) {
                data.testType = 'simple';
                data.endpoint = data.testScenario.scenarios[`${testName}`].requests[0].url;
                data.method = data.testScenario.scenarios[`${testName}`].requests[0].method;
                data.body = data.testScenario.scenarios[`${testName}`].requests[0].body;
                data.headers = data.testScenario.scenarios[`${testName}`].requests[0].headers;
            }

            this.setState({ data: data });
        } catch (err) {
            console.log(err);
            alert(err);
        }
    }

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

    componentDidMount = async () => {
        if (!this.state.testId) {
            this.props.history.push('/');
        }
        await this.getTest();
        await this.listTasks();
    }

    async handleStart() {
        const { testId } = this.state.testId;
        const { data } = this.state;
        let payload = {
            testId,
            testName: data.testName,
            testDescription: data.testDescription,
            taskCount: data.taskCount,
            testScenario: {
                execution: [{
                    concurrency: data.concurrency,
                    "ramp-up": data.rampUp,
                    "hold-for": data.holdFor,
                    scenario: data.testName,
                }],
                scenarios: {
                    [data.testName]: {}
                }
            },
            testType: data.testType
        };

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
        }

        this.setState({ isLoading: true });

        try {
            const response = await API.post('dlts', '/scenarios', { body: payload });
            console.log('Scenario started successfully', response);
            await this.reloadData();
        } catch (err) {
            console.error('Failed to start scenario', err);
            this.setState({ isLoading: false });
        }
    }

    async handleDownload() {
        try {
            const { testId } = this.state.testId;
            const url = await Storage.get(`test-scenarios/jmx/${testId}.jmx`, { expires: 10 });
            window.open(url, '_blank');
        } catch (error) {
            console.error('Error', error);
        }
    }

    render() {
        const { data } = this.state;

        const cancelled = (
            <div className="box">
                <h2>Test Results</h2>
                <p>No results available as the test was cancelled.</p>
            </div>
        )

        const failed = (
            <div className="box">
                <h2>Test Failed</h2>
                <pre>{JSON.stringify(data.taskError, null, 2)}</pre>
            </div>
        )

        const details = (
            <div>
                <div className="box">
                    <h1>Load Test Details</h1>
                    {
                        data.status === 'running' ?
                        [
                            <Button id="cancelButton" key="cancelButton" color="danger" onClick={this.cancelToggle} size="sm">Cancel</Button>,
                            <Button id="refreshButton" key="refreshButton" onClick={ this.reloadData } size="sm">Refresh</Button>
                        ] :
                        [
                            <Button id="deleteButton" key="deleteButton" color="danger" onClick={this.deleteToggle} size="sm">Delete</Button>,
                            <Link key="update_link" to= {{ pathname: '/create', state: { data } }}>
                                <Button id="updateButton" key="updateButton" size="sm">Update</Button>
                            </Link>,
                            <Button id="startButton" key="startButton" onClick={this.handleStart} size="sm" disabled={this.state.runningTasks}>Start</Button>
                        ]
                    }
                </div>
                <div className="box">
                    <Row>
                        <Col sm="7">
                            <Row className="detail">
                                <Col sm="3"><b>ID</b></Col>
                                <Col sm="9">{data.testId}</Col>
                            </Row>
                            <Row className="detail">
                                <Col sm="3"><b>NAME</b></Col>
                                <Col sm="9">{data.testName}</Col>
                            </Row>
                            <Row className="detail">
                                <Col sm="3"><b>DESCRIPTION</b></Col>
                                <Col sm="9">{data.testDescription}</Col>
                            </Row>
                            {
                                (!data.testType || ['', 'simple'].includes(data.testType)) &&
                                <div>
                                    <Row className="detail">
                                        <Col sm="3"><b>ENDPOINT</b></Col>
                                        <Col sm="9">{ data.endpoint }</Col>
                                    </Row>
                                    <Row className="detail">
                                        <Col sm="3"><b>METHOD</b></Col>
                                        <Col sm="9">{ data.method }</Col>
                                    </Row>
                                    <Row className="detail">
                                        <Col sm="3"><b>BODY</b></Col>
                                        <Col sm="9">{ JSON.stringify(data.body) }</Col>
                                    </Row>
                                    <Row className="detail">
                                        <Col sm="3"><b>HEADERS</b></Col>
                                        <Col sm="9">{ JSON.stringify(data.headers) }</Col>
                                    </Row>
                                </div>
                            }
                            {
                                data.testType && data.testType !== '' && data.testType !== 'simple' &&
                                <Row className="detail">
                                    <Col sm="3"><b>SCRIPT</b></Col>
                                    <Col sm="9"><Button color="link" size="sm" onClick={this.handleDownload}>Download</Button></Col>
                                </Row>
                            }
                        </Col>
                        <Col sm="5">
                            <Row className="detail">
                                <Col sm="4"><b>STATUS</b></Col>
                                <Col className={data.status} sm="8">{data.status}</Col>
                            </Row>
                            <Row className="detail">
                                <Col sm="4"><b>STARTED AT</b></Col>
                                <Col sm="8">{data.startTime}</Col>
                            </Row>
                            {
                                data.status === 'complete' &&
                                <Row className="detail">
                                    <Col sm="4"><b>ENDED AT</b></Col>
                                    <Col sm="8">{data.endTime}</Col>
                                </Row>
                            }
                            <Row className="detail">
                                <Col sm="4"><b>TASK COUNT</b></Col>
                                <Col sm="8">{data.taskCount}</Col>
                            </Row>

                            <Row className="detail">
                                <Col sm="4"><b>CONCURRENCY</b></Col>
                                <Col sm="8">{ data.concurrency }</Col>
                            </Row>
                            <Row className="detail">
                                <Col sm="4"><b>RAMP UP</b></Col>
                                <Col sm="8">{ data.rampUp }</Col>
                            </Row>
                            <Row className="detail">
                                <Col sm="4"><b>HOLD FOR</b></Col>
                                <Col sm="8">{ data.holdFor }</Col>
                            </Row>
                        </Col>
                    </Row>
                </div>

                {(() => {
                    switch (data.status) {
                    case 'complete':
                        return <Results data={data} />;
                    case 'cancelled':
                        return <div>{cancelled}</div>;
                    case 'failed':
                        return <div>{failed}</div>;
                    case 'running':
                        return <Running data={data} />;
                    default:
                        return <div></div>;
                    }
                })()}

                { data.status ==='running' ? <div></div> : <History data={data} /> }

            </div>
        )

        return (
            <div>
                { this.state.isLoading ? <div className="loading"><Spinner color="secondary" /></div> : details }
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
        )
    }
}

export default Details;
