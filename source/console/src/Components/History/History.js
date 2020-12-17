// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { Table } from 'reactstrap';

class Results extends React.Component {

      render() {
        const history = this.props.data.history || [];

        return (
            <div>
                <div className="box">
                    <h2>Results History</h2>
                    <Table borderless responsive>
                        <thead>
                            <tr>
                                <th>RunTime</th>
                                <th>AvgRt</th>
                                <th>AvgLt</th>
                                <th>AvgCt</th>
                                <th>100%</th>
                                <th>99.9%</th>
                                <th>99.0%</th>
                                <th>95%</th>
                                <th>90%</th>
                                <th>50%</th>
                                <th>0%</th>
                            </tr>
                        </thead>
                        <tbody>
                        {
                            history.map (i => (
                                <tr key= { i.id }>
                                    <td>{ i.endTime }</td>
                                    <td>{ i.results.avg_rt }</td>
                                    <td>{ i.results.avg_lt }</td>
                                    <td>{ i.results.avg_ct }</td>
                                    <td>{ i.results.p100_0 }</td>
                                    <td>{ i.results.p99_9 }</td>
                                    <td>{ i.results.p99_0 }</td>
                                    <td>{ i.results.p95_0 }</td>
                                    <td>{ i.results.p90_0 }</td>
                                    <td>{ i.results.p50_0 }</td>
                                    <td>{ i.results.p0_0 }</td>
                                </tr>
                            ))
                        }
                        </tbody>
                    </Table>
                </div>
            </div>
        )
    }

}

export default Results;
