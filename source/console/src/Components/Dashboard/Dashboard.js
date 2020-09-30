// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Table, Spinner, Button } from 'reactstrap';
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowAltCircleRight } from '@fortawesome/free-solid-svg-icons';
import { API } from 'aws-amplify';

class Dashboard extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            Items: [],
            isLoading: true,
            noData: false
        }
    }

    getItems = async () => {
        this.setState({
            Items: [],
            isLoading: true
        });

        try {
            const data = await API.get('dlts', '/scenarios');
            this.setState({
                Items: data.Items,
                isLoading:false
            });

            if (data.Items.length === 0 ) {
                this.setState({ noData:true });
            }
        } catch (err) {
            alert(err);
        }
    };

    componentDidMount() {
        this.getItems();
    }

    render() {
        const { Items } = this.state;

        const welcome = (
            <div className="welcome">
                <h2>To get started select Create test from the top menu.</h2>
            </div>
        )

        const tableBody = (
            <tbody>
            {
                Items.map(item => (
                    <tr key={item.testId}>
                        <td>{item.testName}</td>
                        <td>{item.testId}</td>
                        <td className="desc">{item.testDescription}</td>
                        <td>{item.startTime}</td>
                        <td className={item.status}>{item.status}</td>
                        <td className="td-center">
                            <Link id={`detailLink-${item.testId}`} to= {{ pathname: "/details", state: { testId: item.testId } }}>
                                <FontAwesomeIcon icon={faArrowAltCircleRight} size="lg" />
                            </Link>
                        </td>
                    </tr>
                ))
            }
            </tbody>
        )

        return (
            <div>
                <div className="box">
                    <h1>Test Scenarios</h1>
                    <Button id="refreshButton" onClick={ this.getItems } size="sm">Refresh</Button>
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
                    {
                        this.state.isLoading &&
                        <div className="loading">
                            <Spinner color="secondary" />
                        </div>
                    }
                </div>
                { !this.state.isLoading && Items.length === 0 && welcome }
            </div>
        )
    }
}

export default Dashboard;
