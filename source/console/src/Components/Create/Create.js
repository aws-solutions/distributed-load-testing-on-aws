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
import { API } from 'aws-amplify';
import 'brace';
import {
    Col,
    Row,
    Button,
    FormGroup,
    Label,
    Input,
    FormText,
    Spinner,
    InputGroup,
} from 'reactstrap';

import 'brace/theme/github';

class Create extends React.Component {

    constructor(props) {
        super(props);
        if (this.props.location.state.data.testId) {
            this.state = {
                isLoading: false,
                runningTasks: false,
                testId: this.props.location.state.data.testId,
                formValues: {
                    testName: this.props.location.state.data.testName,
                    testDescription: this.props.location.state.data.testDescription,
                    taskCount: this.props.location.state.data.taskCount,
                    concurrency: this.props.location.state.data.concurrency,
                    rampUp: this.props.location.state.data.rampUp.slice(0, -1),
                    rampUpUnits: this.props.location.state.data.rampUp.slice(-1),
                    holdFor: this.props.location.state.data.holdFor.slice(0, -1),
                    holdForUnits: this.props.location.state.data.holdFor.slice(-1),
                    rampDown: this.props.location.state.data.rampDown.slice(0, -1),
                    rampDownUnits: this.props.location.state.data.rampDown.slice(-1),
                    stack: this.props.localtion.state.data.stack
                }
            }
        } else {
            this.state = {
                isLoading: false,
                runningTasks: false,
                testId: null,
                formValues: {
                    testName: '',
                    testDescription: '',
                    taskCount: 0,
                    concurrency: 0,
                    rampUp: 0,
                    rampUpUnits: 'm',
                    holdFor: 0,
                    holdForUnits: 'm',
                    rampDown: 0,
                    rampDownUnits: 'm',
                    stack: ''
                }
            };

        }

        this.form = React.createRef();
        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleInputChange = this.handleInputChange.bind(this);
        this.setFormValue = this.setFormValue.bind(this);
        this.parseJson = this.parseJson.bind(this);
        this.listTasks = this.listTasks.bind(this);
    }

    parseJson(str) {
        try {
            return JSON.parse(str)
        } catch (err) {
            return false;
        }
    }

    handleSubmit = async () => {

        const values = this.state.formValues;

        if (!this.form.current.reportValidity()) {
            return false;
        }
        this.setState({ isLoading: true })

        try {

            let payload = {
                testName: values.testName,
                testDescription: values.testDescription,
                taskCount: values.taskCount,
                testConfig: {
                    testName: values.testName,
                    vusMax: 200,
                    stages: [
                        { duration: String(values.rampUp).concat(values.rampUpUnits), target: values.concurrency },
                        { duration: String(values.holdFor).concat(values.holdForUnits), target: values.concurrency },
                        { duration: String(values.rampDown).concat(values.rampDownUnits), target: 0 }
                    ],
                    stack: values.stack,
                    logLevels: {
//                        Client: 'Trace',
                        '*': 'Info'
                    },
                    enableDelays: true,
                    clientStackData: {
                        staging: {
                            clientId: '4db22g7bslp30dblj8kkubente',
                            urlBase: 'https://staging-api.tallyup.com/api/v1/'
                        },
                        latest: {
                            clientId: '4db22g7bslp30dblj8kkubente',
                            urlBase: 'https://latest-api.tallyup.com/api/v1/'
                        },
                        sandbox: {
                            clientId: '4db22g7bslp30dblj8kkubente',
                            urlBase: 'https://sandbox-api.tallyup.com/api/v1/'
                        },
                        paul: {
                            clientId: 'l1scbnoef6ir8696fu4iginnb',
                            urlBase: 'https://paul-api.tallyup.com/api/v1/'
                        }
                    }
                }
            };

            if (this.state.testId) {
                payload.testId = this.state.testId;
            }

            const response = await API.post('dlts', '/scenarios', { body: payload });
            console.log('Scenario created successfully', response);
            this.props.history.push("/");
        } catch (err) {
            console.error('Failed to create scenario', err);
            this.setState({ isLoading: false });
        }
    }

    setFormValue(key, value) {
        const formValues = this.state.formValues;
        formValues[key] = value;
        this.setState({ formValues });
    }

    handleInputChange(event) {
        const value = event.target.value;
        const name = event.target.name;
        this.setFormValue(name, value);
    }

    listTasks = async () => {
        try {
            const data = await API.get('dlts', '/tasks');
            if (data.length !== 0) {
                this.setState({ runningTasks: true });
            }
        } catch (err) {
            alert(err);
        }
    };

    componentDidMount() {
        this.listTasks();
    };

    render() {
        const warning = (
            <div>
                <div className="box">
                    <h1>Create a Load Test</h1>
                </div>
                <p className="warning">Warning there is a test running, multiple concurrent tests is currently not supported to avoid hitting the AWS Fargate task limits. Please wait for the test to finish before submitting a new test!</p>
            </div>
        )

        const heading = (
            <div className="box">
                <h1>Create a Load Test</h1>
            </div>
        )

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
                                <FormText color="muted">
                                    The name of your load test, doesn't have to be unique.
                                </FormText>
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
                                <FormText color="muted">
                                    Short description of the test scenario.
                                </FormText>
                            </FormGroup>
                            <FormGroup>
                                <Label for="taskCount">Task Count</Label>
                                <Input
                                    value={this.state.formValues.taskCount}
                                    className="form-short"
                                    type="number"
                                    name="taskCount"
                                    id="taskCount"
                                    max={50}
                                    min={1}
                                    step={1}
                                    required
                                    onChange={this.handleInputChange}
                                />
                                <FormText color="muted">
                                    Number of docker containers that will be launched in the Fargate cluster to run the
                                    test scenario, max value 50.
                                </FormText>
                            </FormGroup>
                            <FormGroup>
                                <Label for="concurrency">Concurrency (TPS)</Label>
                                <Input
                                    value={this.state.formValues.concurrency}
                                    className="form-short"
                                    type="number"
                                    max={200}
                                    min={1}
                                    step={1}
                                    name="concurrency"
                                    id="concurrency"
                                    required
                                    onChange={this.handleInputChange}
                                />
                                <FormText color="muted">
                                    The number of concurrent requests generated per task, max value 200.
                                </FormText>
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
                                <FormText color="muted">
                                    The time to reach target concurrency.
                                </FormText>
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
                                <FormText color="muted">
                                    Time to hold target concurrency.
                                </FormText>
                            </FormGroup>
                            <FormGroup>
                                <Label for="rampDown">Ramp Down</Label>
                                <InputGroup className="input-group-short">
                                    <Input
                                        value={this.state.formValues.rampDown}
                                        className="form-short"
                                        type="number"
                                        name="rampDown"
                                        id="rampDown"
                                        required
                                        onChange={this.handleInputChange}
                                    />
                                    &nbsp;
                                    <Input
                                        type="select"
                                        className="form-short"
                                        name="rampDownUnits"
                                        value={this.state.formValues.rampDownUnits}
                                        id="rampDownUnits"
                                        onChange={this.handleInputChange}
                                    >
                                        <option value="m">minutes</option>
                                        <option value="s">seconds</option>
                                    </Input>
                                </InputGroup>
                                <FormText color="muted">
                                    The time to ramp down concurrency.
                                </FormText>
                            </FormGroup>
                        </div>
                    </Col>
                    <Col sm="6">
                        <div className="box create-box">
                            <h3>Scenario</h3>
                            <FormGroup>
                                <Label for="stack">Stack</Label>
                                <Input
                                    value={this.state.formValues.stack}
                                    type="text"
                                    name="stack"
                                    id="stack"
                                    required
                                    onChange={this.handleInputChange}
                                />
                                <FormText color="muted">
                                    Target stack to run tests against.
                                </FormText>
                            </FormGroup>
                            <Button
                                className="submit"
                                size="sm"
                                onClick={this.handleSubmit}
                                disabled={this.state.runningTasks}
                            >
                                Submit
                            </Button>
                        </div>
                    </Col>
                </Row>
            </div>
        );

        return (
            <div>
                <form ref={this.form} onSubmit={e => e.preventDefault()}>
                    {this.state.runningTasks ? warning : heading}
                    <div>
                        {this.state.isLoading ? <div className="loading"><Spinner color="secondary" /></div> : createTestForm}
                    </div>
                </form>
            </div>
        )
    }
}

export default Create;
