#!/bin/bash

source_dir="$PWD/../source"

cd $source_dir/api-services
npm install --silent
npm test

cd $source_dir/custom-resource
npm install --silent
npm test

cd $source_dir/results-parser
npm install --silent
npm test

cd $source_dir/task-runner
npm install --silent
npm test 

cd $source_dir/task-status-checker
npm install --silent
npm test

cd $source_dir/task-canceler
npm install --silent
npm test 

cd $source_dir/infrastructure
npm install --silent
npm test