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
import AceEditor from 'react-ace';
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

    constructor(props){
        super(props);
        if (this.props.location.state.data.testId) {
            this.state = {
                isLoading: false,
                runningTasks:false,
                testId: this.props.location.state.data.testId,
                formValues: {
                    testName: this.props.location.state.data.testName,
                    testDescription: this.props.location.state.data.testDescription,
                    taskCount: this.props.location.state.data.taskCount,
                    concurrency: this.props.location.state.data.concurrency,
                    holdFor: this.props.location.state.data.holdFor.slice(0, -1),
                    holdForUnits: this.props.location.state.data.holdFor.slice(-1),
                    rampUp: this.props.location.state.data.rampUp.slice(0, -1),
                    rampUpUnits: this.props.location.state.data.rampUp.slice(-1),
                    endpoint: this.props.location.state.data.endpoint,
                    method: this.props.location.state.data.method,
                    body: JSON.stringify(this.props.location.state.data.body),
                    headers: JSON.stringify(this.props.location.state.data.headers)
                }
            }
        } else {
            this.state = {
                isLoading: false,
                runningTasks:false,
                testId: null,
                formValues: {
                    testName:'',
                    testDescription: '',
                    taskCount: 0,
                    concurrency:0,
                    holdFor: 0,
                    holdForUnits:'m',
                    rampUp: 0,
                    rampUpUnits: 'm',
                    endpoint: '',
                    method:'GET',
                    body: '',
                    headers: ''
                }
            };
            
        }

        this.form = React.createRef();
        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleInputChange = this.handleInputChange.bind(this);
        this.setFormValue = this.setFormValue.bind(this);
        this.handleBodyPayloadChange = this.handleBodyPayloadChange.bind(this);
        this.handleHeadersChange = this.handleHeadersChange.bind(this);
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

        if (!this.form.current.reportValidity() ) {
            return false;
        }
        if (!values.headers) {
            values.headers = '{}';
        }
        if (!values.body) {
            values.body = '{}';
        }
        if (!this.parseJson(values.headers.trim())) {
            return alert('WARINING: headers text is not valid JSON');
        }
        if (!this.parseJson(values.body.trim())) {
            return alert('WARINING: body text is not valid JSON');
        }
        this.setState({ isLoading: true })

        try {

            let payload = {
                testName: values.testName,
                testDescription: values.testDescription,
                taskCount: values.taskCount,
                testScenario: {
                    execution: [{
                        concurrency: values.concurrency,
                        "ramp-up": String(values.rampUp).concat(values.rampUpUnits),
                        "hold-for": String(values.holdFor).concat(values.holdForUnits),
                        scenario: values.testName,
                    }],
                    scenarios: {
                        [values.testName]: {
                            requests: [
                                {
                                    url: values.endpoint,
                                    method: values.method,
                                    body: this.parseJson(values.body.trim()),
                                    headers: this.parseJson(values.headers.trim())
                                }
                            ]
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

    handleBodyPayloadChange(value) {
        this.setFormValue('body', value);
    }

    handleHeadersChange(value) {
        this.setFormValue('headers', value);
    }

    listTasks = async () => {
        try {
            const data = await API.get('dlts', '/tasks');
            if (data.length !== 0 ) {
                this.setState({runningTasks:true});
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
                        </div>
                    </Col>
                    <Col sm="6">
                        <div className="box create-box">
                            <h3>Scenario</h3>
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
                                    Target URL to run tests against, supports http and https. i.e.
                                    https://example.com:8080.
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

                                <FormText color="muted">
                                    The request method, default is GET.
                                </FormText>
                            </FormGroup>
                            <FormGroup>
                                <Label for="testDescription">HTTP Headers (Optional)</Label>
                                <AceEditor
                                    mode="text"
                                    theme="github"
                                    showPrintMargin={true}
                                    showGutter={true}
                                    value={this.state.formValues.headers}
                                    highlightActiveLine={true}
                                    onChange={this.handleHeadersChange}
                                    name="headers"
                                    width="100%"
                                    height="190px"
                                    editorProps={{$blockScrolling: true}}
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
                                    mode="json"
                                    theme="github"
                                    showPrintMargin={true}
                                    showGutter={true}
                                    highlightActiveLine={true}
                                    onChange={this.handleBodyPayloadChange}
                                    name="bodyPayload"
                                    value={this.state.formValues.body}
                                    width="100%"
                                    height="190px"
                                    editorProps={{$blockScrolling: true}}
                                    setOptions={{
                                        showLineNumbers: true,
                                        tabSize: 2,
                                    }}
                                />
                                <FormText color="muted">
                                    A valid JSON object containing any body text to include in the requests.
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
                    
                    { this.state.runningTasks? warning : heading }

                    <div>
                        {this.state.isLoading? <div className="loading"><Spinner color="secondary" /></div> : createTestForm}
                    </div>
                </form>
            </div>
        )
    }
}

export default Create;
