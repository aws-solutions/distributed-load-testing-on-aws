// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { BrowserRouter as Router, Route, Switch, Link } from "react-router-dom";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAws } from '@fortawesome/free-brands-svg-icons';
import { faPlusSquare, faSignOutAlt, faBars, faExternalLinkAlt } from '@fortawesome/free-solid-svg-icons';
import {
  Collapse,
  Navbar,
  NavbarToggler,
  NavbarBrand,
  Nav,
  NavItem
} from 'reactstrap';

//Amplify
import Amplify, { Auth } from 'aws-amplify';
import { withAuthenticator, AmplifyTheme } from 'aws-amplify-react';

//Components
import Dashboard from './Components/Dashboard/Dashboard.js';
import Create from './Components/Create/Create.js';
import Details from './Components/Details/Details.js';

declare var awsConfig;
Amplify.configure(awsConfig);

const loginTheme = {
  sectionFooterSecondaryContent:{
    ...AmplifyTheme.sectionFooterSecondaryContent,
    display:"none"
  }
};

class App extends React.Component {

  constructor(props) {
    super(props);
    this.noMatch = this.noMatch.bind(this);
    this.signOut = this.signOut.bind(this);
    this.toggleNavbar = this.toggleNavbar.bind(this);
    this.state = {
      collapsed: true
    };
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
      collapsed: !this.state.collapsed
    });
  }

  signOut() {
    Auth.signOut();
    window.location.reload();
  }

  render() {
    return (
      <div>
        <Router>
          <Navbar color="dark" dark fixed="top" expand="md">
            <NavbarBrand href="/"> <FontAwesomeIcon icon={faAws} size="lg" color="#FF9900" id="logo" /> Distributed Load Testing</NavbarBrand>
            <NavbarToggler onClick={this.toggleNavbar} className="mr-2" />
            <Collapse isOpen={!this.state.collapsed} navbar>
            <Nav className="mr-auto" navbar>
            <NavItem>
              <Link to={'/dashboard'} className="nav-link" id="dashboard">
                <FontAwesomeIcon id="icon" icon={faBars} /> Dashboard
              </Link>
            </NavItem>
            <NavItem>
              <Link to= {{
                    pathname:"/create",
                    state:{ data:{}}
                    }}
                    className="nav-link"
                    id="createTest"
              >
                <FontAwesomeIcon id="icon" icon={faPlusSquare} /> Create Test
              </Link>
            </NavItem>
            </Nav>
              <Nav className="ml-auto" navbar>
                <NavItem>
                  <Link to="" onClick={this.signOut} className="nav-link" id="signOut">
                    <FontAwesomeIcon id="icon" icon={faSignOutAlt} /> Sign Out
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
              <Route path="/details/" component={Details} />
              <Route component={this.noMatch} />
            </Switch>
            <div className="footer">
              <p>For help please see the <a className="text-link" href="https://aws.amazon.com/solutions/distributed-load-testing-on-aws/"
                 target="_blank"
                 rel="noopener noreferrer">
                  solution home page <FontAwesomeIcon size="sm" icon={faExternalLinkAlt}/>
              </a></p>
          </div>
          </div>
        </Router>

      </div>
    )
  }
}

//export default App;
export default withAuthenticator(App, false, [], null, loginTheme);
