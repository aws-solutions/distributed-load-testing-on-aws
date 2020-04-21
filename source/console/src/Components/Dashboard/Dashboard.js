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
import {Table, Spinner, Button } from 'reactstrap';
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {faArrowAltCircleRight } from '@fortawesome/free-solid-svg-icons';
import { API } from 'aws-amplify';
import moment from 'moment';

class Dashboard extends React.Component {

    constructor(props) { 
        super(props); 
        this.state = {
            Items:[],
            isLoading: true,
            noData: false
        }
    };

    getItems = async () => {
        this.setState({Items:[], isLoading:true});
        try {
            const data = await API.get('dlts', '/scenarios');
            this.setState({Items:data.Items.sort((a, b) => moment(b.startTime) - moment(a.startTime)), isLoading:false});
            if (data.Items.length === 0 ) {
                this.setState({noData:true});
            }
        } catch (err) {
            alert(err);
        }
    };

    componentDidMount() { 
        this.getItems();
    };  

    render() {

        const { Items } = this.state;

        const welcome = (
            <div className="welcome">
                    <h2>To get started select Create test from the top menu.</h2>
            </div>
        ) 

        const tableBody = (
            <tbody  ref={this.tableBody} >
            {Items.map(item => (
                <tr key={item.testId}>
                    <td>{item.testName}</td>
                    <td>{item.testId}</td>
                    <td className="desc">{item.testDescription}</td>
                    <td>{item.startTime}</td>
                    <td className={item.status}>{item.status}</td>
                    <td className="td-center">
                        <Link to= {{
                            pathname:"/details",
                            state:{ testId:item.testId}
                            }}
                        >
                            <FontAwesomeIcon icon={faArrowAltCircleRight} size="lg" />
                        </Link>
                    </td>
                </tr>
            ))}
            </tbody>
        )

        return (
            <div>
                <div className="box">
                    <h1>Test Scenarios</h1>
                    <Button onClick={ this.getItems } size="sm">Refresh</Button>
                </div>
                <div className="box">
                    <Table className="dashboard" borderless responsive >
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Id</th>
                                <th>Description</th>
                                <th>Last Run (UTC)</th>
                                <th>Status</th>
                                <th className="td-center">Details</th>
                            </tr>
                        </thead>
                        { tableBody }
                    </Table>
                    { this.state.isLoading? <div className="loading"><Spinner color="secondary" /></div> : <div></div> }
                   
                </div>
                { this.state.noData? welcome : <div></div> }
            </div>
        )
    }

}

export default Dashboard;
