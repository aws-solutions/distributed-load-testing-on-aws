#!/bin/bash

set -e  # exit if a command fails
set -u  # error/exit if variables are unset
set -f  # disable globbing
set -o pipefail  # if a command in a pipeline fails, the whole pipeline fails

# set a uuid for the results xml file name in S3
UUID=$(cat /proc/sys/kernel/random/uuid)
pypid=0
echo "S3_BUCKET:: ${S3_BUCKET}"
echo "TEST_ID:: ${TEST_ID}"
echo "TEST_TYPE:: ${TEST_TYPE}"
echo "FILE_TYPE:: ${FILE_TYPE}"
echo "PREFIX:: ${PREFIX}"
echo "UUID:: ${UUID}"
echo "LIVE_DATA_ENABLED:: ${LIVE_DATA_ENABLED}"

sigterm_handler() {
  if [ $pypid -ne 0 ]; then
    echo "container received SIGTERM."
    kill -15 $pypid
    wait $pypid
    exit 143 #128 + 15
  fi
}
trap 'sigterm_handler' SIGTERM

echo "Download test scenario"
aws s3 cp s3://$S3_BUCKET/test-scenarios/$TEST_ID-$AWS_REGION.json test.json

# set variables based on TEST_TYPE
if [ "$TEST_TYPE" == "jmeter" ]; then
  EXT="jmx"
  TYPE_NAME="JMeter"
elif [ "$TEST_TYPE" == "k6" ]; then
  EXT="js"
  TYPE_NAME="K6"
fi
LOG_FILE="${TEST_TYPE}.log"
OUT_FILE="${TEST_TYPE}.out"
ERR_FILE="${TEST_TYPE}.err"

if [ "$TEST_TYPE" != "simple" ]; then
  if [ "$FILE_TYPE" != "zip" ]; then
    aws s3 cp s3://$S3_BUCKET/public/test-scenarios/$TEST_TYPE/$TEST_ID.$EXT ./
  else
    aws s3 cp s3://$S3_BUCKET/public/test-scenarios/$TEST_TYPE/$TEST_ID.zip ./
    unzip $TEST_ID.zip
    # only looks for the first test script file.
    TEST_SCRIPT=`find . -name "*.${EXT}" | head -n 1`
    if [ -z "$TEST_SCRIPT" ]; then
      echo "There is no test script (.${EXT}) in the zip file."
      exit 1
    fi

    sed -i -e "s|$TEST_ID.$EXT|$TEST_SCRIPT|g" test.json
  fi
fi

# special case for jmeter zips
if [ "$TEST_TYPE" == "jmeter" ]; then
  # Copy *.jar to JMeter library path. See the Taurus JMeter path: https://gettaurus.org/docs/JMeter/
  JMETER_LIB_PATH=`find ~/.bzt/jmeter-taurus -type d -name "lib"`
  echo "cp $PWD/*.jar $JMETER_LIB_PATH"
  cp $PWD/*.jar $JMETER_LIB_PATH || true

  if [ "$FILE_TYPE" == "zip" ]; then
    # copy bundled plugin jars to jmeter extension folder to make them available to jmeter
    BUNDLED_PLUGIN_DIR=`find $PWD -type d -name "plugins" | head -n 1`
    # attempt to copy only if a /plugins folder is present in upload
    if [ -z "$BUNDLED_PLUGIN_DIR" ]; then
      echo "skipping plugin installation (no /plugins folder in upload)"
    else
      # ensure the jmeter extensions folder exists
      JMETER_EXT_PATH=`find ~/.bzt/jmeter-taurus -type d -name "ext"`
      if [ -z "$JMETER_EXT_PATH" ]; then
        # fail fast - if plugins bundled they will be needed for the tests
        echo "jmeter extension path (~/.bzt/jmeter-taurus/**/ext) not found - cannot install bundled plugins"
        exit 1
      fi
      cp -v $BUNDLED_PLUGIN_DIR/*.jar $JMETER_EXT_PATH || true
    fi
  fi
fi

: ${IPNETWORK=''}
: ${SCRIPT=''}

if [ -n "$SCRIPT" ]; then
  #Download python script
  if [ -z "$IPNETWORK" ]; then
      python3 -u $SCRIPT $TIMEOUT &
      pypid=$!
      wait $pypid
      pypid=0
  else 
      python3 -u $SCRIPT $IPNETWORK $IPHOSTS
  fi
fi

echo "Running test"
stdbuf -i0 -o0 -e0 bzt test.json -o modules.console.disable=true | stdbuf -i0 -o0 -e0 tee -a result.tmp | sed -u -e "s|^|$TEST_ID $LIVE_DATA_ENABLED |"
CALCULATED_DURATION=`cat result.tmp | grep -m1 "Test duration" | awk -F ' ' '{ print $5 }' | awk -F ':' '{ print ($1 * 3600) + ($2 * 60) + $3 }'`

# upload custom results to S3 if any
# every file goes under $TEST_ID/$PREFIX/$UUID to distinguish the result correctly
if [ "$TEST_TYPE" != "simple" ]; then
  if [ "$FILE_TYPE" != "zip" ]; then
    cat $TEST_ID.$EXT | grep filename > results.txt || true
  else
    cat $TEST_SCRIPT | grep filename > results.txt || true
  fi

  if [ -f results.txt ]; then
    sed -i -e 's/<stringProp name="filename">//g' results.txt
    sed -i -e 's/<\/stringProp>//g' results.txt
    sed -i -e 's/ //g' results.txt

    echo "Files to upload as results"
    cat results.txt
    
    files=(`cat results.txt`)
    for f in "${files[@]}"; do
      p="s3://$S3_BUCKET/results/$TEST_ID/${TYPE_NAME}_Result/$PREFIX/$UUID/$f"
      if [[ $f = /* ]]; then
        p="s3://$S3_BUCKET/results/$TEST_ID/${TYPE_NAME}_Result/$PREFIX/$UUID$f"
      fi

      echo "Uploading $p"
      aws s3 cp $f $p || true  # Don't fail the build if a file upload fails
    done
  fi
fi

if [ -f /tmp/artifacts/results.xml ]; then
  echo "Validating Test Duration"
  TEST_DURATION=`xmlstarlet sel -t -v "/FinalStatus/TestDuration" /tmp/artifacts/results.xml`

  if (( $(echo "$TEST_DURATION > $CALCULATED_DURATION" | bc -l) )); then
    echo "Updating test duration: $CALCULATED_DURATION s"
    xmlstarlet ed -L -u /FinalStatus/TestDuration -v $CALCULATED_DURATION /tmp/artifacts/results.xml
  fi

  echo "Uploading results, bzt log, and JMeter log, out, and err files"
  aws s3 cp /tmp/artifacts/results.xml s3://$S3_BUCKET/results/${TEST_ID}/${PREFIX}-${UUID}-${AWS_REGION}.xml
  aws s3 cp /tmp/artifacts/bzt.log s3://$S3_BUCKET/results/${TEST_ID}/bzt-${PREFIX}-${UUID}-${AWS_REGION}.log || true  # Don't fail the build if the log upload fails
  if [ -z "$LOG_FILE" ]; then
    aws s3 cp /tmp/artifacts/$LOG_FILE s3://$S3_BUCKET/results/${TEST_ID}/${TEST_TYPE}-${PREFIX}-${UUID}-${AWS_REGION}.log
  fi
  if [ -z "$OUT_FILE" ]; then
    aws s3 cp /tmp/artifacts/$OUT_FILE s3://$S3_BUCKET/results/${TEST_ID}/${TEST_TYPE}-${PREFIX}-${UUID}-${AWS_REGION}.out
  fi
  if [ -z "$ERR_FILE" ]; then
    aws s3 cp /tmp/artifacts/$ERR_FILE s3://$S3_BUCKET/results/${TEST_ID}/${TEST_TYPE}-${PREFIX}-${UUID}-${AWS_REGION}.err
  fi
else
  echo "An error occurred while the test was running."
fi