// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { aws4Interceptor } from "aws4-axios";
import Ajv from "ajv";
import axios, { AxiosError, AxiosResponse } from "axios";
import { load } from "../api.config";
import { ScenarioResponse } from "./scenario";

const config = load();

export interface ErrorResponse {
  status: number;
  code: string;
  data: string;
}

const setupAxiosInterceptors = () => {
  const interceptor = aws4Interceptor({
    options: {
      region: config.region,
      service: "execute-api",
    },
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken,
    },
  });

  axios.interceptors.request.use(interceptor);
  axios.interceptors.response.use(
    (response: AxiosResponse): AxiosResponse => response,
    (error: AxiosError): ErrorResponse => ({
      status: error.response.status,
      code: error.response.statusText.toUpperCase().replace(/ /g, "_"),
      data: <string>error.response.data,
    })
  );
};

const teardownAxiosInterceptors = () => {
  axios.interceptors.request.clear();
  axios.interceptors.response.clear();
};

const validateScenario = (item: ScenarioResponse): boolean => {
  const ajv = new Ajv();
  const schema = {
    type: "object",
    properties: {
      testId: { type: "string" },
      testName: { type: "string" },
      status: { type: "string" },
    },
    required: ["testId", "testName", "status"],
    additionalProperties: true,
  };

  const validate = ajv.compile(schema);
  return validate(item);
};

export { setupAxiosInterceptors, teardownAxiosInterceptors, validateScenario };
