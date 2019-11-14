#!/bin/bash

cd ../source/api-services
npm install --silent
npm test

cd ../custom-resource
npm install --silent
npm test

cd ../results-parser
npm install --silent
npm test

cd ../task-runner
npm install --silent
npm test
