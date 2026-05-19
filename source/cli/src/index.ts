#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { registerConfigureCommand } from "./commands/configure.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerTokenCommand } from "./commands/token.js";
import { registerScenariosCommand } from "./commands/scenarios.js";
import { registerRunsCommand } from "./commands/runs.js";
import { registerLogoutCommand } from "./commands/logout.js";
import { VERSION } from "./generated-version.js";

const program = new Command();

program.name("dlt").description("CLI for Distributed Load Testing on AWS").version(VERSION);

registerConfigureCommand(program);
registerLoginCommand(program);
registerTokenCommand(program);
registerScenariosCommand(program);
registerRunsCommand(program);
registerLogoutCommand(program);

program.parse();
