#!/bin/bash
set -e  # exit if a command fails
set -u  # error/exit if variables are unset
set -f  # disable globbing
set -o pipefail  # if a command in a pipeline fails, the whole pipeline fails

SCENARIO_TABLE_LOGICAL_ID="DLTTestRunnerStorageDLTScenariosTableAB6F5C2A"
SCENARIO_BUCKET_LOGICAL_ID="DLTTestRunnerStorageDLTScenariosBucketA9290D21"
HISTORY_TABLE_LOGICAL_ID="DLTTestRunnerStorageDLTHistoryTable46D850CC"
SERVICES_FUNCTION_LOGICAL_ID="DLTApiDLTAPIServicesLambda9D76BA5C"

stack_name=$1
# todo: output instead of resource?
scenario_table=$(aws cloudformation describe-stack-resource \
  --stack-name "$stack_name" --logical-resource-id "$SCENARIO_TABLE_LOGICAL_ID" \
  --query "StackResourceDetail.PhysicalResourceId" --output text)
scenario_bucket=$(aws cloudformation describe-stack-resource \
  --stack-name "$stack_name" --logical-resource-id "$SCENARIO_BUCKET_LOGICAL_ID" \
  --query "StackResourceDetail.PhysicalResourceId" --output text)
history_table=$(aws cloudformation describe-stack-resource \
  --stack-name "$stack_name" --logical-resource-id "$HISTORY_TABLE_LOGICAL_ID" \
  --query "StackResourceDetail.PhysicalResourceId" --output text)
services_function_name=$(aws cloudformation describe-stack-resource \
  --stack-name "$stack_name" --logical-resource-id "${SERVICES_FUNCTION_LOGICAL_ID}" \
  --query "StackResourceDetail.PhysicalResourceId" --output text)
services_function_arn=$(aws lambda get-function --function-name "$services_function_name" \
  --query "Configuration.FunctionArn" --output text)

# the cli should paginate this call, but this isn't tested.
test_ids=$(aws dynamodb scan \
  --table-name $scenario_table --projection-expression testId \
  --query "Items[].testId.S" --output text)

# we assume the format is always public/test-scenarios/${testType}/${id}.${ext}
script_assets=$(aws s3api list-objects-v2 \
  --bucket "$scenario_bucket" --prefix "public/test-scenarios/" \
  --query "Contents[].Key" --output text)
for asset in $script_assets; do
  test_id=$(echo "$asset" | cut -d'/' -f4 | cut -d'.' -f1)
  if [[ ! "$test_ids" =~ $test_id ]]; then
   echo "s3://$scenario_bucket/$asset"
  fi
done

# we assume the format is always test-scenarios/${id}-${region}.json
json_assets=$(aws s3api list-objects-v2 \
  --bucket "$scenario_bucket" --prefix "test-scenarios/" \
  --query "Contents[].Key" --output text)
for asset in $json_assets; do
  test_id=$(echo "$asset" | cut -d'/' -f2 | cut -d'-' -f1)
  if [[ ! "$test_ids" =~ $test_id ]]; then
   echo "s3://$scenario_bucket/$asset"
  fi
done

# we assume the format is always results/${id}/*
result_assets=$(aws s3api list-objects-v2 \
  --bucket "$scenario_bucket" --prefix "results/" \
  --query "Contents[].Key" --output text)
for asset in $result_assets; do
  test_id=$(echo "$asset" | cut -d'/' -f2)
  if [[ ! "$test_ids" =~ $test_id ]]; then
   echo "s3://$scenario_bucket/$asset"
  fi
done

# History Table should not have orphaned resources, but we check anyway
# for the next history query we return two values (tab seperated), so we only split on new lines
SAVEIFS=$IFS;IFS=$'\n'
history_assets=$(aws dynamodb scan \
  --table-name "$history_table" --projection-expression testId,testRunId \
  --query "Items[].[testId.S,testRunId.S]" --output text)
for asset in $history_assets; do
  test_id=$(echo "$asset" | cut -f1)
  test_run_id=$(echo "$asset" | cut -f2)
  if [[ ! "$test_ids" =~ $test_id ]]; then
    echo "dynamodb://$history_table/$test_id/$test_run_id"
  fi
done
IFS=$SAVEIFS

# There should be no eventbridge rules left over, but we check anyway
rules=$(aws events list-rule-names-by-target --target-arn "$services_function_arn" \
  --query "RuleNames" --output text)
for rule in $rules; do
  # `${rule//Scheduled/}` removes the word Scheduled from the rule variable
  if [[ ! "$test_ids" =~ ${rule//Scheduled/} ]]; then
    echo "events://rules/${rule}"
  fi
done
