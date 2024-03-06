// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { Modal, ModalHeader, ModalBody, Row, Col, Button, ListGroup, ListGroupItem, Tooltip } from "reactstrap";
import { get } from "aws-amplify/api";

class RegionalModal extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      availableRegions: [],
      cfUrl: "",
      tooltipOpen: false,
      tooltipLanguage: "Copy URL",
    };
    this.listRegions = this.listRegions.bind(this);
    this.toggle = this.toggle.bind(this);
  }

  toggle() {
    let tooltipLanguage;
    if (this.state.tooltipOpen === false) {
      tooltipLanguage = "Copy URL";
    }
    this.setState({
      tooltipOpen: !this.state.tooltipOpen,
      tooltipLanguage: tooltipLanguage,
    });
  }

  handleCopyClick() {
    navigator.clipboard.writeText(this.state.cfUrl);
    this.setState({ tooltipLanguage: "Copied!" });
  }

  listRegions = async () => {
    try {
      const regions = [];
      const _data = await get({
        apiName: "dlts",
        path: "/regions",
      }).response;
      const data = await _data.body.json();
      for (const item of data.regions) {
        regions.push(item.region);
      }
      this.setState({ availableRegions: regions, cfUrl: data.url });
    } catch (err) {
      alert(err);
    }
  };

  componentDidMount() {
    this.listRegions();
  }

  render() {
    return (
      <Modal size="lg" isOpen={this.props.regionalModal} toggle={this.props.toggleRegionalModal}>
        <ModalHeader toggle={this.props.toggleRegionalModal}>Manage Regions</ModalHeader>
        <ModalBody>
          <Row className="available-regions-title">Available Regions</Row>

          <ListGroup horizontal className="available-regions-list">
            {this.state.availableRegions.map((region) => (
              <ListGroupItem id={`${region}-icon`} key={region} className="available-region-item">
                <i className="bi bi-globe" /> {region}
              </ListGroupItem>
            ))}
          </ListGroup>

          <Row className="regional-stack-row" fluid="true">
            <Col>
              <Row className="available-regions-title">Add A Region</Row>
              Add a new region to enable multi-region load testing:&nbsp;
              <ul>
                <li>
                  Copy the link for the regional CloudFormation template&nbsp;&nbsp;
                  <Button
                    id="copyCFTemplateButton"
                    className="regional-stack-button"
                    color="link"
                    onClick={() => this.handleCopyClick()}
                  >
                    <i className="icon-small bi bi-clipboard-check-fill"></i>
                  </Button>
                  <Tooltip
                    target="copyCFTemplateButton"
                    placement="top"
                    trigger="hover"
                    isOpen={this.state.tooltipOpen}
                    toggle={this.toggle}
                  >
                    {this.state.tooltipLanguage}
                  </Tooltip>
                </li>
                <li>
                  Navigate to the{" "}
                  <a
                    id="cfConsoleLink"
                    className="text-link"
                    href="https://console.aws.amazon.com/cloudformation"
                    target="_blank"
                    rel="noreferrer"
                  >
                    CloudFormation console
                  </a>
                </li>
                <li>Select the appropriate region from the dropdown menu in the upper right hand corner</li>
                <li>Paste the link the Amazon S3 URL area</li>
                <li>Launch the CloudFormation Stack</li>
              </ul>
            </Col>
            <span>
              Regional Deployment CloudFormation Template URL:&nbsp;
              <a
                id="cfTemplateURL"
                className="regional-cf-link"
                href={this.state.cfUrl}
                target="_blank"
                rel="noreferrer"
              >
                {this.state.cfUrl}
              </a>
            </span>
          </Row>

          <Row className="regional-stack-row" fluid="true">
            <Col>
              <Row className="available-regions-title">Delete A Region</Row>
              Remove a region:&nbsp;
              <ul>
                <li>
                  Navigate to the{" "}
                  <a
                    className="text-link"
                    href="https://console.aws.amazon.com/cloudformation"
                    target="_blank"
                    rel="noreferrer"
                  >
                    CloudFormation console
                  </a>
                </li>
                <li>Select the appropriate region from the dropdown menu in the upper right hand corner</li>
                <li>
                  Select the appropriate CloudFormation stack and click the Delete button to delete the regional
                  deployment
                </li>
              </ul>
            </Col>
          </Row>
        </ModalBody>
      </Modal>
    );
  }
}

export default RegionalModal;
