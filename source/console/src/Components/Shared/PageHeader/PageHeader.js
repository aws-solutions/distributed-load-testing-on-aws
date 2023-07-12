// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";

class PageHeader extends React.Component {
  render() {
    return (
      <div className="box header-banner">
        <h1>{this.props.title}</h1>
        {[this.props.cancelButton, this.props.refreshButton, this.props.testControlButtons]}
      </div>
    );
  }
}

export default PageHeader;
