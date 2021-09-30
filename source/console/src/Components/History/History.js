// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Table } from 'reactstrap';
import { HashLink } from "react-router-hash-link";

class Results extends React.Component {
    constructor(props) {
        super(props);
        this.clickedLink = props.clickedLink;
        this.state = {
            rowIsActive: 0
        }
    }

    activeRow(index) {
        this.setState({
            rowIsActive: index
        });
    }

    onClick(id, index) {
        this.clickedLink(id);
        this.activeRow(index);
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
                                <th>Task Count</th>
                                <th>Concurrency</th>
                                <th>Average Response Time</th>
                                <th>Success %</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {
                                history.map((i, index) => (
                                    <tr key={i.id} className={this.state.rowIsActive === index ? 'rowActive' : ''}>
                                        <td>{i.endTime}</td>
                                        <td>{i.taskCount}</td>
                                        <td>{i.results.concurrency}</td>
                                        <td>{i.results.avg_rt}s</td>
                                        <td>{i.succPercent}%</td>
                                        <td><HashLink className="text-link" onClick={() => this.onClick(i.id, index)} to="#TestResults">View details</HashLink></td>
                                    </tr>
                                ))
                            }
                        </tbody>
                    </Table>
                </div>
            </div >
        )
    }

}

export default Results;
