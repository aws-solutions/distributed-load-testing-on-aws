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
import { Link } from "react-router-dom";
import { Button, Modal, ModalHeader, ModalBody, ModalFooter, Row, Col, Spinner } from 'reactstrap';
import { API } from 'aws-amplify';

import Results from '../Results/Results.js';
import Running from '../Running/Running.js';
import History from '../History/History.js';

class Details extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            isLoading: true,
            deleteModal: false,
            cancelModal: false,
            testId: props.location.state,
            data:{
                results:{},
                history:[],
                concurrency:null,
                rampUp:null,
                holdFor: null,
                endpoint:null,
                taskArns:[],
                testScenario:{
                    execution:[],
                    reporting:[],
                    scenarios:{}
                }
            }
        }
        this.deleteToggle = this.deleteToggle.bind(this);
        this.deleteTest = this.deleteTest.bind(this);
        this.cancelToggle = this.cancelToggle.bind(this);
        this.cancelTest = this.cancelTest.bind(this);
    };

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

    deleteTest= async () => {
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
    }

    getTest = async () => {
        const { testId } = this.state.testId;
        try {
            const data = await API.get('dlts', `/scenarios/${testId}`);
            data.concurrency = data.testScenario.execution[0].concurrency;
            data.rampUp = data.testScenario.execution[0]['ramp-up'];
            data.holdFor = data.testScenario.execution[0]['hold-for'];
            data.endpoint = data.testScenario.scenarios[Object.keys(data.testScenario.scenarios)[0]].requests[0].url;
            data.method = data.testScenario.scenarios[Object.keys(data.testScenario.scenarios)[0]].requests[0].method;
            data.body = data.testScenario.scenarios[Object.keys(data.testScenario.scenarios)[0]].requests[0].body;
            data.headers = data.testScenario.scenarios[Object.keys(data.testScenario.scenarios)[0]].requests[0].headers;

            this.setState({
                isLoading:false,
                data:data
            });
        } catch (err) {
            console.log(err);
            alert(err);
        }
    }
  
    componentDidMount= async () => {
        await this.getTest();
      }
   
    render() {

        const { data } = this.state;
        
        const cancelled = (
            <div className="box">
                <h2>Test Results</h2>
                <p>No results available as the test was cancelled.</p>
                </div>
        )

        const details = (
            <div>
                {(() => {
                    switch (data.status) {
                    case 'running':
                        return (
                            <div className="box">
                            <h1>Load Test Details</h1>
                            <Button color="danger" onClick={this.cancelToggle} size="sm">Cancel</Button>
                            <Button onClick={ this.reloadData } size="sm">Refresh</Button>
                        </div>
                        );
                    default:
                        return (
                            <div className="box">
                            <h1>Load Test Details</h1> 
                            <Button color="danger" onClick={this.deleteToggle} size="sm">Delete</Button>
                            <Link to= {{
                                    pathname:"/create",
                                    state:{ data }
                                }}>
                            <Button size="sm">Update</Button>
                            </Link>
                        </div>
                        );
                    }
                })()}

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
                                <Col  sm="9">{data.testDescription}</Col>
                            </Row>
                            <Row className="detail">
                                <Col sm="3"><b>ENDPOINT</b></Col>
                                <Col  sm="9">{ data.endpoint }</Col>
                            </Row>
                           
                            <Row className="detail">
                                <Col sm="3"><b>Body</b></Col>
                                <Col  sm="9">{ JSON.stringify(data.body) }</Col>
                            </Row>
                            <Row className="detail">
                                <Col sm="3"><b>Headers</b></Col>
                                <Col  sm="9">{ JSON.stringify(data.headers) }</Col>
                            </Row>
                        </Col>
                        <Col sm="5">
                        <Row className="detail">
                                <Col sm="4"><b>STATUS</b></Col>
                                <Col className={data.status} sm="8">{data.status}</Col>
                            </Row>
                            <Row className="detail">
                                <Col sm="4"><b>LAST RAN</b></Col> 
                                <Col  sm="8">{data.startTime}</Col>
                            </Row>
                            <Row className="detail">
                                <Col sm="4"><b>TASK COUNT</b></Col>
                                <Col  sm="8">{data.taskCount}</Col>
                            </Row>
                            <Row className="detail">
                                <Col sm="4"><b>METHOD</b></Col>
                                <Col  sm="8">{ data.method }</Col>
                            </Row>
                            <Row className="detail">
                                <Col sm="4"><b>CONCURRENCY</b></Col>
                                <Col  sm="8">{ data.concurrency }</Col>
                            </Row>
                            <Row className="detail"> 
                                <Col sm="4"><b>RAMP UP</b></Col>
                                <Col  sm="8">{ data.rampUp }</Col>
                            </Row>
                            <Row className="detail">
                                <Col sm="4"><b>HOLD FOR</b></Col>
                                <Col  sm="8">{ data.holdFor }</Col>
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
                    default:
                        return <Running data={data} />;
                    }
                })()}
                
                {data.status ==='running'? <div></div> :  <History data={data} /> }

            </div>
        )

        return (
            <div>

                { this.state.isLoading?  <div className="loading"><Spinner color="secondary" /></div> : details }

                <Modal isOpen={this.state.deleteModal} toggle={this.deleteToggle}>
                    <ModalHeader>Warning</ModalHeader>
                    <ModalBody>
                        This will delete the test scenario and all of of the results
                </ModalBody>
                    <ModalFooter>
                        <Button color="link" size="sm" onClick={this.deleteToggle}>Cancel</Button>
                        <Button color="danger" size="sm" onClick={this.deleteTest}>Delete</Button>
                    </ModalFooter>
                </Modal>

                <Modal isOpen={this.state.cancelModal} toggle={this.cancelToggle}>
                    <ModalHeader>Warning</ModalHeader>
                    <ModalBody>
                        This will stop all running tasks amd end the test.
                </ModalBody>
                    <ModalFooter>
                        <Button color="link" size="sm" onClick={this.cancelToggle}>Cancel</Button>
                        <Button color="danger" size="sm" onClick={this.cancelTest}>Cancel Test</Button>
                    </ModalFooter>
                </Modal>
            
            </div>
        )
    }

}

export default Details;
