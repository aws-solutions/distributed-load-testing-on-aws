#!/bin/bash

# set a uuid for the results xml file name in S3
UUID=$(cat /proc/sys/kernel/random/uuid)
#UUID=$WORKERNUM

echo "S3_BUCKET:: ${S3_BUCKET}"
echo "TEST_ID:: ${TEST_ID}"
echo "TEST_TYPE:: ${TEST_TYPE}"
echo "FILE_TYPE:: ${FILE_TYPE}"
echo "PREFIX:: ${PREFIX}"
echo "UUID ${UUID}"

echo "Download test scenario"
aws s3 cp s3://$S3_BUCKET/test-scenarios/$TEST_ID.json test.json

TEST_TYPE=custom

if [ "$TEST_TYPE" = "custom" ]; then
  echo "S3_BUCKET:: ${S3_BUCKET}" >> /tmp/setup.log
  echo "TEST_ID:: ${TEST_ID}" >> /tmp/setup.log
  echo "TEST_TYPE:: ${TEST_TYPE}" >> /tmp/setup.log
  echo "FILE_TYPE:: ${FILE_TYPE}" >> /tmp/setup.log
  echo "PREFIX:: ${PREFIX}" >> /tmp/setup.log
  echo "UUID ${UUID}" >> /tmp/setup.log
  echo "WORKER: $WORKERNUM" >> /tmp/setup.log
  ./setup-env.sh >>/tmp/setup.log 2>&1
  RES=$?
  echo "RETURN VALUE $RES" >> /tmp/setup.log
  aws s3 cp /tmp/setup.log s3://$S3_BUCKET/results/${TEST_ID}/SetupLogs/${PREFIX}-${UUID}.log
  if [ -z "$IPNETWORK" ]; then
      python3 $SCRIPT
  else 
      python3 $SCRIPT $IPNETWORK $IPHOSTS
  fi
  exit 0
elif [ "$TEST_TYPE" = "jmeter" ]; then
  # download JMeter jmx file
  # Copy *.jar to JMeter library path. See the Taurus JMeter path: https://gettaurus.org/docs/JMeter/
  JMETER_LIB_PATH=`find ~/.bzt/jmeter-taurus -type d -name "lib"`
  echo "cp $PWD/*.jar $JMETER_LIB_PATH"
  cp $PWD/*.jar $JMETER_LIB_PATH

  if [ "$FILE_TYPE" != "zip" ]; then
    aws s3 cp s3://$S3_BUCKET/public/test-scenarios/$TEST_TYPE/$TEST_ID.jmx ./
  else
    aws s3 cp s3://$S3_BUCKET/public/test-scenarios/$TEST_TYPE/$TEST_ID.zip ./
    unzip $TEST_ID.zip
    # only looks for the first jmx file.
    JMETER_SCRIPT=`find . -name "*.jmx" | head -n 1`
    if [ -z "$JMETER_SCRIPT" ]; then
      echo "There is no JMeter script in the zip file."
      exit 1
    fi

    sed -i -e "s|$TEST_ID.jmx|$JMETER_SCRIPT|g" test.json

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
      cp -v $BUNDLED_PLUGIN_DIR/*.jar $JMETER_EXT_PATH
    fi
  fi
fi

#Download python script

if [ -z "$IPNETWORK" ]; then
    python3 $SCRIPT
else 
    python3 $SCRIPT $IPNETWORK $IPHOSTS
fi

echo "Running test"
stdbuf -i0 -o0 -e0 bzt test.json -o modules.console.disable=true | stdbuf -i0 -o0 -e0 tee -a result.tmp | sed -u -e "s|^|$TEST_ID |"
CALCULATED_DURATION=`cat result.tmp | grep -m1 "Test duration" | awk -F ' ' '{ print $5 }' | awk -F ':' '{ print ($1 * 3600) + ($2 * 60) + $3 }'`

# upload custom results to S3 if any
# every file goes under $TEST_ID/$PREFIX/$UUID to distinguish the result correctly
if [ "$TEST_TYPE" != "simple" ]; then
  if [ "$FILE_TYPE" != "zip" ]; then
    cat $TEST_ID.jmx | grep filename > results.txt
  else
    cat $JMETER_SCRIPT | grep filename > results.txt
  fi
  sed -i -e 's/<stringProp name="filename">//g' results.txt
  sed -i -e 's/<\/stringProp>//g' results.txt
  sed -i -e 's/ //g' results.txt

  echo "Files to upload as results"
  cat results.txt

  files=(`cat results.txt`)
  for f in "${files[@]}"; do
    p="s3://$S3_BUCKET/results/$TEST_ID/JMeter_Result/$PREFIX/$UUID/$f"
    if [[ $f = /* ]]; then
      p="s3://$S3_BUCKET/results/$TEST_ID/JMeter_Result/$PREFIX/$UUID$f"
    fi

    echo "Uploading $p"
    aws s3 cp $f $p
  done
fi

if [ -f /tmp/artifacts/results.xml ]; then
  echo "Validating Test Duration"
  TEST_DURATION=`xmlstarlet sel -t -v "/FinalStatus/TestDuration" /tmp/artifacts/results.xml`

  if (( $(echo "$TEST_DURATION > $CALCULATED_DURATION" | bc -l) )); then
    echo "Updating test duration: $CALCULATED_DURATION s"
    xmlstarlet ed -L -u /FinalStatus/TestDuration -v $CALCULATED_DURATION /tmp/artifacts/results.xml
  fi

  echo "Uploading results"
  aws s3 cp /tmp/artifacts/results.xml s3://$S3_BUCKET/results/${TEST_ID}/${PREFIX}-${UUID}.xml
else
  echo "There might be an error happened while the test."
fi