// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import {
  Button,
  ButtonDropdown,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
  FormGroup,
  Input,
  Label,
} from "reactstrap";

class RefreshButtons extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      autoRefresh: false,
      refreshIntervalToggle: false,
      refreshInterval: "30 seconds",
    };

    this.renderRefreshButton = this.renderRefreshButton.bind(this);
    this.setIntervalMultiplier = this.setIntervalMultiplier.bind(this);
    this.startAutoRefresh = this.startAutoRefresh.bind(this);
    this.setRefreshTimer = this.setRefreshTimer.bind(this);
    this.intervalID = "";
  }

  componentWillUnmount() {
    if (this.intervalID) {
      clearInterval(this.intervalID);
    }
  }

  componentDidUpdate(prevProps, prevState) {
    if (prevState.autoRefresh !== this.state.autoRefresh) {
      this.setRefreshTimer();
    } else if (prevState.refreshInterval !== this.state.refreshInterval) {
      clearInterval(this.intervalID);
      this.startAutoRefresh();
    }
  }

  setIntervalMultiplier(units) {
    switch (units) {
      case "minutes":
      case "minute": {
        return 60000;
      }
      case "seconds": {
        return 1000;
      }
      default:
        return 1;
    }
  }

  startAutoRefresh() {
    const [intervalAsString, intervalUnits] = this.state.refreshInterval.split(" ");
    const interval = parseInt(intervalAsString);
    const multiplier = this.setIntervalMultiplier(intervalUnits);
    this.intervalID = setInterval(this.props.refreshFunction, interval * multiplier);
  }

  setRefreshTimer() {
    if (this.state.autoRefresh) {
      this.startAutoRefresh();
    } else {
      clearInterval(this.intervalID);
    }
  }

  renderRefreshButton() {
    const intervals = ["5 seconds", "30 seconds", "1 minute", "5 minutes"];
    if (this.state.autoRefresh) {
      return (
        <ButtonDropdown
          inline="true"
          key="buttonDropdown"
          id="interval-button"
          className="interval-button"
          size="sm"
          isOpen={this.state.refreshIntervalToggle}
          toggle={() => this.setState({ refreshIntervalToggle: !this.state.refreshIntervalToggle })}
        >
          <DropdownToggle caret>Interval</DropdownToggle>
          <DropdownMenu>
            {intervals.map((interval, index) => (
              <DropdownItem
                key={interval}
                id={`interval-${index}`}
                onClick={() => this.setState({ refreshInterval: interval })}
              >
                {interval}
              </DropdownItem>
            ))}
          </DropdownMenu>
        </ButtonDropdown>
      );
    } else {
      return (
        <Button
          id="refreshButton"
          key="refreshButton"
          className="refresh-button"
          onClick={this.props.refreshFunction}
          size="sm"
        >
          Refresh
        </Button>
      );
    }
  }

  render() {
    return [
      this.renderRefreshButton(),
      <FormGroup key="auto-refresh-group" id="auto-refresh" className="auto-refresh" switch inline={true}>
        <Input
          type="switch"
          role="switch"
          onClick={() => {
            this.setState({ autoRefresh: !this.state.autoRefresh });
          }}
        ></Input>
        <Label check className="auto-refresh-label">
          Auto-Refresh
          <br />
          {this.state.autoRefresh && `(${this.state.refreshInterval})`}
        </Label>
      </FormGroup>,
    ];
  }
}

export default RefreshButtons;
