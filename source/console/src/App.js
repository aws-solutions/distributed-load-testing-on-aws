// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { BrowserRouter as Router, Route, Switch, Link } from "react-router-dom";
import { Collapse, Navbar, NavbarToggler, NavbarBrand, Nav, NavItem } from "reactstrap";

//Amplify
import { Amplify } from "aws-amplify";
import { getCurrentUser, signOut, fetchAuthSession } from "aws-amplify/auth";
import { withAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import AWS from "aws-sdk";

//Components
import Dashboard from "./Components/Dashboard/Dashboard.js";
import Create from "./Components/Create/Create.js";
import Details from "./Components/Details/Details.js";
import RegionalModal from "./Components/RegionalModal/RegionalModal.js";
declare var awsConfig;

const ResourcesConfig = {
  Auth: {
    Cognito: {
      userPoolId: awsConfig.aws_user_pools_id,
      userPoolClientId: awsConfig.aws_user_pools_web_client_id,
      identityPoolId: awsConfig.aws_cognito_identity_pool_id,
    },
  },
  API: {
    REST: {
      dlts: {
        endpoint: awsConfig.aws_cloud_logic_custom[0].endpoint,
        region: awsConfig.aws_cloud_logic_custom[0].region,
      },
    },
  },
  Storage: {
    S3: {
      bucket: awsConfig.aws_user_files_s3_bucket, // Optional
      region: awsConfig.aws_user_files_s3_bucket_region, // Optional
    },
  },
};

Amplify.configure({ ...ResourcesConfig });

class App extends React.Component {
  constructor(props) {
    super(props);
    this.noMatch = this.noMatch.bind(this);
    this.signOut = this.signOut.bind(this);
    this.toggleNavbar = this.toggleNavbar.bind(this);
    this.toggleRegionalModal = this.toggleRegionalModal.bind(this);
    this.state = {
      collapsed: true,
      regionalModal: false,
    };
  }

  /**
   * Need to attach IoT Policy to Identity in order to subscribe.
   */
  async componentDidMount() {
    try {
      await getCurrentUser();
    } catch (error) {
      console.log("User is not signed in");
    }
    const credentials = await fetchAuthSession();
    const identityId = credentials.identityId;
    AWS.config.update({
      region: awsConfig.aws_project_region,
      credentials: credentials.credentials,
    });
    const params = {
      policyName: awsConfig.aws_iot_policy_name,
      principal: identityId,
    };
    try {
      await new AWS.Iot().attachPrincipalPolicy(params).promise();
    } catch (error) {
      console.error("Error occurred while attaching principal policy", error);
    }
  }

  noMatch({ location }) {
    return (
      <div>
        <h3>
          Error 404 Page not found: <code>{location.pathname}</code>
        </h3>
      </div>
    );
  }

  toggleNavbar() {
    this.setState({
      collapsed: !this.state.collapsed,
    });
  }

  toggleRegionalModal() {
    this.setState({
      regionalModal: !this.state.regionalModal,
    });
  }

  async signOut() {
    await signOut();
    window.location.reload();
  }

  render() {
    return (
      <div>
        <Router>
          <Navbar color="dark" dark fixed="top" expand="md">
            <NavbarBrand href="/">Distributed Load Testing</NavbarBrand>
            <NavbarToggler onClick={this.toggleNavbar} className="mr-2" />
            <Collapse isOpen={!this.state.collapsed} navbar>
              <Nav className="me-auto" navbar>
                <NavItem>
                  <Link to={"/dashboard"} className="nav-link" id="dashboard">
                    <i className="bi bi-list" /> Dashboard
                  </Link>
                </NavItem>
                <NavItem>
                  <Link
                    to={{
                      pathname: "/create",
                      state: { data: {} },
                    }}
                    className="nav-link"
                    id="createTest"
                    params={{ mainRegion: awsConfig.aws_project_region }}
                  >
                    <i className="bi bi-plus-square-fill" /> Create Test
                  </Link>
                </NavItem>
                <NavItem id="manageRegions" className="nav-link" onClick={this.toggleRegionalModal}>
                  <i className="bi bi-globe" /> Manage Regions
                  {this.state.regionalModal && (
                    <RegionalModal
                      regionalModal={this.state.regionalModal}
                      toggleRegionalModal={this.toggleRegionalModal}
                    />
                  )}
                </NavItem>
              </Nav>
              <Nav className="ms-auto" navbar>
                <NavItem>
                  <Link to="" onClick={this.signOut} className="nav-link" id="signOut">
                    <i className="bi bi-box-arrow-right" /> Sign Out
                  </Link>
                </NavItem>
              </Nav>
            </Collapse>
          </Navbar>

          <div className="main">
            <Switch>
              <Route path="/" exact component={Dashboard} />
              <Route path="/dashboard" exact component={Dashboard} />
              <Route path="/create/" component={Create} />
              <Route path="/details/:testId?" component={Details} />
              <Route component={this.noMatch} />
            </Switch>
            <div className="footer">
              <p>
                For help please see the{" "}
                <a
                  className="text-link"
                  href="https://aws.amazon.com/solutions/distributed-load-testing-on-aws/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  solution home page <i className="bi bi-box-arrow-up-right" />
                </a>
              </p>
            </div>
          </div>
        </Router>
      </div>
    );
  }
}

export default withAuthenticator(App);
