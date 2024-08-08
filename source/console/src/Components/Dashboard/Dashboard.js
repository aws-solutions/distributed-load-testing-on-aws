// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { Table, Spinner, Input, Pagination, PaginationItem, PaginationLink } from "reactstrap";
import { Link } from "react-router-dom";
import { get } from "aws-amplify/api";

import PageHeader from "../Shared/PageHeader/PageHeader";
import RefreshButtons from "../Shared/Buttons/RefreshButtons";

class Dashboard extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      Items: [],
      filteredItems: [],
      isLoading: true,
      searchQuery: '',
      currentPage: 1,
      itemsPerPage: 10,
      totalTests: 0,
    };
  }

  getItems = async () => {
    this.setState({
      Items: [],
      filteredItems: [],
      isLoading: true,
    });

    try {
      const _data = await get({
        apiName: "dlts",
        path: "/scenarios",
      }).response;
      const data = await _data.body.json();
      data.Items.sort((a, b) => {
        if (!a.startTime) a.startTime = "";
        if (!b.startTime) b.startTime = "";
        return b.startTime.localeCompare(a.startTime);
      });

      this.setState({
        Items: data.Items,
        filteredItems: data.Items,
        isLoading: false,
        totalTests: data.Items.length,
      });
    } catch (err) {
        alert(err);
    }
  };

  filterItems = (items, query) => {
    if (!query) return items;
  
    const normalizedQuery = query.toLowerCase();
  
    return items.filter(item =>
      Object.values(item).some(value =>
        value && value.toString().toLowerCase().includes(normalizedQuery)
      )
    );
  };

  handleSearchChange = (event) => {
    const searchQuery = event.target.value;
    this.setState({ searchQuery, currentPage: 1 }, this.updateFilteredItems);
  };

  updateFilteredItems = () => {
    const { Items, searchQuery } = this.state;
    const filteredItems = this.filterItems(Items, searchQuery);
    this.setState({ filteredItems });
  };
  
  
  handlePageChange = (pageNumber) => {
    this.setState({ currentPage: pageNumber });
  };

  calculatePaginationIndices = (currentPage, itemsPerPage, totalItems) => {
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = totalItems.slice(indexOfFirstItem, indexOfLastItem);
    const currentLoadRangeStart = indexOfFirstItem + 1;
    const currentLoadRangeEnd = Math.min(indexOfLastItem, totalItems.length);
    
    return { currentItems, currentLoadRangeStart, currentLoadRangeEnd };
  };
  

  componentDidMount() {
    this.getItems();
  }

  renderTableBody = (items) => {
    const { currentPage, itemsPerPage } = this.state;
    const { currentItems } = this.calculatePaginationIndices(currentPage, itemsPerPage, items);

    return (
      <tbody>
        {currentItems.map((item) => {
          return (
            <tr key={item.testId}>
              <td>{item.testName}</td>
              <td>{item.testId}</td>
              <td className="desc">{item.testDescription}</td>
              <td>{item.startTime ? item.startTime : ""}</td>
              <td className={item.status}>{item.status}</td>
              <td>{item.nextRun}</td>
              <td className="recurrence">{item.scheduleRecurrence}</td>
              <td className="td-center">
                <Link
                  id={`detailLink-${item.testId}`}
                  to={{ pathname: `/details/${item.testId}`, state: { testId: item.testId } }}
                >
                  <i className="icon-large bi bi-arrow-right-circle-fill" />
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    );
  };

  renderPagination = (items) => {
    const { currentPage, itemsPerPage } = this.state;
    const totalPages = Math.ceil(items.length / itemsPerPage);
  
    if (totalPages <= 1) return null;
  
    const pageNumbers = [];
    for (let i = 1; i <= totalPages; i++) {
      pageNumbers.push(i);
    }
  
    const previousPageItem = (
      <PaginationItem disabled={currentPage <= 1}>
        <PaginationLink previous onClick={() => this.handlePageChange(currentPage - 1)}>
          Previous page
        </PaginationLink>
      </PaginationItem>
    );
  
    const nextPageItem = (
      <PaginationItem disabled={currentPage >= totalPages}>
        <PaginationLink next onClick={() => this.handlePageChange(currentPage + 1)}>
          Next page
        </PaginationLink>
      </PaginationItem>
    );
  
    return (
      <Pagination size="sm" aria-label="Page navigation">
        {previousPageItem}
        {pageNumbers.map((number) => (
          <PaginationItem key={number} active={number === currentPage}>
            <PaginationLink onClick={() => this.handlePageChange(number)}>
              {number}
            </PaginationLink>
          </PaginationItem>
        ))}
        {nextPageItem}
      </Pagination>
    );
  };

  render() {
    const { filteredItems, isLoading, searchQuery, currentPage, itemsPerPage } = this.state;
    const { currentLoadRangeStart, currentLoadRangeEnd } = this.calculatePaginationIndices(currentPage, itemsPerPage, filteredItems);
    const loadTests = filteredItems;

    const welcome = (
      <div className="welcome">
        <h2>To get started select Create test from the top menu.</h2>
      </div>
    );

    return (
      <div>
        <PageHeader
          title="Test Scenarios"
          refreshButton={<RefreshButtons key="refresh-buttons" refreshFunction={this.getItems} />}
        />
        <div className="box">
          <Input
            type="text"
            placeholder="Filter by any value"
            value={searchQuery}
            onChange={this.handleSearchChange}
            style={{ marginTop: 10, marginBottom: 10, width: 300 }}
          />
              <Table className="dashboard" borderless responsive>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Id</th>
                    <th>Description</th>
                    <th>Last Run (UTC)</th>
                    <th>Status</th>
                    <th>Next Run (UTC)</th>
                    <th>Recurrence</th>
                    <th className="td-center">Details</th>
                  </tr>
                </thead>
                {this.renderTableBody(loadTests)}
              </Table>
              <div className={`page-container ${filteredItems.length === 0 ? 'no-results' : ''}`}>
                {filteredItems.length === 0 ? (
                  <div className="search-info" style={{padding:50}}>
                    The search didn't find anything
                  </div>
                ) : (
                  <div className="rows-info">
                    Showing rows {currentLoadRangeStart} to {currentLoadRangeEnd} of {loadTests.length}
                  </div>
                )}
                {this.renderPagination(loadTests)}
              </div>
          {isLoading && (
            <div className="loading">
              <Spinner color="secondary" />
            </div>
          )}
        </div>
        {!isLoading && (
          (this.state.totalTests === 0 && welcome)
        )}
      </div>
    );
}
}

export default Dashboard;
