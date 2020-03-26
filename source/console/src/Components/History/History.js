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
import { Table } from 'reactstrap';
import { formatMetric } from '../../utils';

class Results extends React.Component {
    render() {
        const history = this.props.data.history || [];
        const styles = {
            width: '15%'
        };
        return (
            <div>
                <div className="box">
                    <h2>Results History</h2>
                    <Table borderless responsive>
                        <thead>
                            <tr>
                                <th style={styles}>Run Time</th>
                                <th style={styles}>Metric</th>
                                <th>Values</th>
                            </tr>
                        </thead>
                        <tbody>
                            {
                                history.map(entry => Object.keys(entry.results).map((metricName, i) => {
                                    const metric = entry.results[metricName];
                                    return (
                                        <tr key={entry.id}>
                                            <td>{i === 0 ? entry.endTime : ''}</td>
                                            <td>{metricName}</td>
                                            <td>{formatMetric(metric)}</td>
                                        </tr>
                                    );
                                }))
                            }
                        </tbody>
                    </Table>
                </div>
            </div>
        )
    }
}

export default Results;
