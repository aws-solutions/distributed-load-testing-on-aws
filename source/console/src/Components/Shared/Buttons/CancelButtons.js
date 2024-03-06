// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { withRouter } from "react-router-dom";
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from "reactstrap";
import { post } from "aws-amplify/api";

class CancelButtons extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      showModal: false,
    };
    this.cancelToggle = this.cancelToggle.bind(this);
    this.cancelTest = this.cancelTest.bind(this);
  }

  cancelToggle() {
    this.setState((prevState) => ({
      showModal: !prevState.showModal,
    }));
  }

  cancelTest = async () => {
    const testId = this.props.testId;
    try {
      await post({ apiName: "dlts", path: `/scenarios/${testId}` }).response;
    } catch (err) {
      alert(err);
    }
    console.log(this.props);
    this.props.history.push("/dashboard");
  };

  render() {
    return [
      <Button id="cancelButton" key="cancel-button" color="danger" onClick={this.cancelToggle} size="sm">
        Cancel
      </Button>,
      <Modal key="cancel-modal" isOpen={this.state.showModal} toggle={this.cancelToggle}>
        <ModalHeader>Warning</ModalHeader>
        <ModalBody>This will stop all running tasks and end the test.</ModalBody>
        <ModalFooter>
          <Button id="cancelStopButton" color="link" size="sm" onClick={this.cancelToggle}>
            Cancel
          </Button>
          <Button id="cancelTestButton" color="danger" size="sm" onClick={this.cancelTest}>
            Cancel Test
          </Button>
        </ModalFooter>
      </Modal>,
    ];
  }
}

export default withRouter(CancelButtons);
