// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');

const lambda = require('./index.js');

const _config = {
  SolutionId: 'SO00XX',
  Version: 'testVersion',
  UUID: '999-999',
  Region: 'testRegion',
  ExistingVpc: 'testTest'
};

describe('#SEND METRICS', () => {

  it('Send metrics success', async () => {
    const mock = new MockAdapter(axios);

    lambda.send(_config, 'Create', () => {
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock).toHaveBeenCalledWith(_config);
      expect('metrics').toBeDefined();
      expect('metrics').toHaveProperty('Solution', 'SO00XX');
      expect('metrics').toHaveProperty('Version', 'testVersion');
      expect('metrics').toHaveProperty('UUID', '999-999');
      expect('metrics').toHaveProperty('Data.Region', 'testRegion');
      expect('metrics').toHaveProperty('Data.ExistingVpc', 'testTest');
    });
  });

  it('should return error', async () => {
    let mock = new MockAdapter(axios);
    mock.onPut().networkError();

    await lambda.send(_config, 'Create').catch(err => {
      expect(mock).toHaveBeenCalledTimes(1);
      expect(err.toString()).toEqual("Error: Network Error");
    });
  });
});