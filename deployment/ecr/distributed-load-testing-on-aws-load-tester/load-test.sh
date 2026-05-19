#!/bin/bash

# Configure AWS CLI for better retry behavior at scale
export AWS_RETRY_MODE=adaptive  # Uses jitter and token bucket for distributed retries
export AWS_MAX_ATTEMPTS=10      # Increase attempts for high-scale scenarios (2000+ containers)

# set a uuid for the results xml file name in S3
UUID=$(cat /proc/sys/kernel/random/uuid)
FATAL_ERROR_DETECTED=0
BZT_PID=""
echo "CURRENT_USER:: $(whoami)"
echo "S3_BUCKET:: ${S3_BUCKET}"
echo "TEST_ID:: ${TEST_ID}"
echo "TEST_RUN_ID:: ${TEST_RUN_ID}"
echo "TEST_TYPE:: ${TEST_TYPE}"
echo "FILE_TYPE:: ${FILE_TYPE}"
echo "PREFIX:: ${PREFIX}"
echo "UUID:: ${UUID}"
echo "LIVE_DATA_ENABLED:: ${LIVE_DATA_ENABLED}"
echo "MAIN_STACK_REGION:: ${MAIN_STACK_REGION}"

# Gather ECS task metadata early from ECS container metadata endpoint v4
# https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-metadata-endpoint-v4-examples.html
TASK_METADATA=$(curl -s $ECS_CONTAINER_METADATA_URI_V4/task)
TASK_ARN=$(echo $TASK_METADATA | jq -r '.TaskARN')
TASK_ID=$(echo $TASK_ARN | awk -F'/' '{print $NF}')
Task_CPU=$(echo $TASK_METADATA | jq '.Limits.CPU')
Task_Memory=$(echo $TASK_METADATA | jq '.Limits.Memory')
START_TIME=$(echo $TASK_METADATA | jq -r '.Containers[0].StartedAt')
echo "TASK_ARN:: ${TASK_ARN}"
echo "TASK_ID:: ${TASK_ID}"

# Structured JSON log builder for CloudWatch Insights queries.
# Emits TASK_STARTED, TASK_COMPLETED, and TASK_FAILED events.
# Source of truth for event names: source/common/src/log-events.ts (LogEvent enum).
log_json() {
  local level="$1" logEvent="$2" message="$3"
  jq -nc \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" \
    --arg level "$level" \
    --arg logEvent "$logEvent" \
    --arg message "$message" \
    --arg testId "$TEST_ID" \
    --arg testRunId "$TEST_RUN_ID" \
    --arg region "$AWS_REGION" \
    --arg taskId "$TASK_ID" \
    '{timestamp:$ts,level:$level,logEvent:$logEvent,message:$message,testId:$testId,testRunId:$testRunId,region:$region,taskId:$taskId}'
}

# Helper to log failure message and exit
fatal_exit() {
  local message="$1" code="${2:-1}"
  log_json "ERROR" "TASK_FAILED" "$message"
  exit "$code"
}

# Uploads a single file to S3 if it exists on disk. Logs a warning and
# continues if the file is missing or the upload fails, so that one missing
# artifact does not block the remaining uploads.
upload_if_exists() {
  local src="$1" dst="$2"
  if [ -f "$src" ]; then
    if aws s3 cp "$src" "$dst" --region "$MAIN_STACK_REGION"; then
      echo "Uploaded: $src"
    else
      echo "WARN: Failed to upload $src (continuing)"
    fi
  else
    echo "WARN: File not available to upload $src (continuing)"
  fi
}

# Best-effort upload of whatever artifact files bzt has produced so far.
# Shared by both SIGTERM and ERR handlers so artifacts are preserved on any exit path.
upload_artifacts() {
  echo "Uploading results, bzt log, and JMeter log, out, and err files"

  local effective_test_type="$TEST_TYPE"
  if [ "$effective_test_type" == "simple" ]; then
    effective_test_type="jmeter"
  fi

  echo "Uploading available artifacts..."
  upload_if_exists "/tmp/artifacts/results.xml" "s3://$S3_BUCKET/results/${TEST_ID}/${PREFIX}/${UUID}-${AWS_REGION}.xml"
  upload_if_exists "/tmp/artifacts/bzt.log" "s3://$S3_BUCKET/results/${TEST_ID}/${PREFIX}/bzt-${UUID}-${AWS_REGION}.log"
  upload_if_exists "/tmp/artifacts/$LOG_FILE" "s3://$S3_BUCKET/results/${TEST_ID}/${PREFIX}/${effective_test_type}-${UUID}-${AWS_REGION}.log"
  upload_if_exists "/tmp/artifacts/$OUT_FILE" "s3://$S3_BUCKET/results/${TEST_ID}/${PREFIX}/${effective_test_type}-${UUID}-${AWS_REGION}.out"
  upload_if_exists "/tmp/artifacts/$ERR_FILE" "s3://$S3_BUCKET/results/${TEST_ID}/${PREFIX}/${effective_test_type}-${UUID}-${AWS_REGION}.err"
  upload_if_exists "/tmp/artifacts/kpi.${KPI_EXT}" "s3://$S3_BUCKET/results/${TEST_ID}/${PREFIX}/kpi-${UUID}-${AWS_REGION}.${KPI_EXT}"

  local include_result_tmp="${1:-false}"
  if [ "$include_result_tmp" == "true" ]; then
    upload_if_exists "result.tmp" "s3://$S3_BUCKET/results/${TEST_ID}/${PREFIX}/result-${UUID}-${AWS_REGION}.tmp"
  fi
}


# Enriches the bzt results.xml with ECS task metadata (TaskId, CPU, Memory,
# ECSDuration) and corrects the test duration if the calculated value is lower.
# Returns 1 if results.xml was not produced (e.g. bzt crashed early), 0 on success.
attach_result_metadata() {
  echo "Enriching results file with ECS task metadata..."
  if [ -f /tmp/artifacts/results.xml ]; then

    # Insert the Task ID at the same level as <FinalStatus>
    # Calculate ECS duration using metadata gathered at startup
    START_TIME_EPOCH=$(date -d "$START_TIME" +%s)
    CURRENT_TIME_EPOCH=$(date +%s)
    ECS_DURATION=$((CURRENT_TIME_EPOCH - START_TIME_EPOCH))


    sed -i.bak 's/<\/FinalStatus>/<TaskId>'"$TASK_ID"'<\/TaskId><\/FinalStatus>/' /tmp/artifacts/results.xml
    sed -i 's/<\/FinalStatus>/<TaskCPU>'"$Task_CPU"'<\/TaskCPU><\/FinalStatus>/' /tmp/artifacts/results.xml
    sed -i 's/<\/FinalStatus>/<TaskMemory>'"$Task_Memory"'<\/TaskMemory><\/FinalStatus>/' /tmp/artifacts/results.xml
    sed -i 's/<\/FinalStatus>/<ECSDuration>'"$ECS_DURATION"'<\/ECSDuration><\/FinalStatus>/' /tmp/artifacts/results.xml
    
    echo "Validating Test Duration"
    TEST_DURATION=$(grep -E '<TestDuration>[0-9]+.[0-9]+</TestDuration>' /tmp/artifacts/results.xml | sed -e 's/<TestDuration>//' | sed -e 's/<\/TestDuration>//')

    if (( $(echo "$TEST_DURATION > $CALCULATED_DURATION" | bc -l) )); then
      echo "Updating test duration: $CALCULATED_DURATION s"
      sed -i.bak.td 's/<TestDuration>[0-9]*\.[0-9]*<\/TestDuration>/<TestDuration>'"$CALCULATED_DURATION"'<\/TestDuration>/' /tmp/artifacts/results.xml
    fi
    return 0
  else
    echo "An error occurred while the test was running. bzt results.xml file not found."
    return 1
  fi
}

CLEANUP_DONE=0

# Top-level cleanup routine called from the main flow, sigterm_handler, and
# exit_handler. Enriches results.xml with ECS metadata, then uploads all
# artifacts to S3. Guarded by CLEANUP_DONE so it only runs once even when
# multiple exit paths trigger it. Returns the exit code from
# attach_result_metadata (0 = success, 1 = results.xml missing).
run_cleanup() {
  local include_result_tmp="${1:-false}"
  if [ "$CLEANUP_DONE" -eq 1 ]; then
    return
  fi
  CLEANUP_DONE=1
  attach_result_metadata
  local metadata_rc=$?
  upload_artifacts "$include_result_tmp"
  return $metadata_rc
}


sigterm_handler() {
  echo "container received SIGTERM."

  # Disable ERR trap inside handler to prevent recursive trapping on upload failures
  trap - ERR

  # Forward SIGTERM to the bzt pipeline process group so bzt can shut down
  # gracefully. Bash does not propagate signals to pipeline children
  # automatically, so without this bzt never sees the SIGTERM.
  if [ -n "$BZT_PID" ]; then
    echo "Forwarding SIGTERM to bzt pipeline (PID $BZT_PID)..."
    kill -TERM -$BZT_PID 2>/dev/null || kill -TERM $BZT_PID 2>/dev/null || true
    # Give bzt a few seconds to flush results before we upload
    wait $BZT_PID 2>/dev/null || true
  fi

  run_cleanup true
  fatal_exit "Sigterm handler exit" 143  # 128 + 15 (SIGTERM)
}

# Handler for any exit commands
# Uploads artifacts (best-effort) then exits with the original failing code.
exit_handler() {
  echo "container received EXIT."

  # Disable ERR trap inside handler to prevent recursive trapping on upload failures
  trap - ERR

  local exit_code=$1
  echo "Script exited with code $exit_code"
  run_cleanup true
  fatal_exit "Exit handler" $exit_code
}

trap 'sigterm_handler' SIGTERM
trap 'exit_handler $?' EXIT

echo "Download test scenario"
aws s3 cp s3://$S3_BUCKET/test-scenarios/$TEST_ID-$AWS_REGION.json test.json --region $MAIN_STACK_REGION --no-progress || {
  fatal_exit "Failed to download test scenario $TEST_ID-$AWS_REGION.json"
}

# Set the default log file values to jmeter
LOG_FILE="jmeter.log"
OUT_FILE="jmeter.out"
ERR_FILE="jmeter.err"
KPI_EXT="jtl"

# Setup JMeter framework if needed for test type (simple Taurus tests run via JMeter)
if [ "$TEST_TYPE" == "jmeter" ] || [ "$TEST_TYPE" == "simple" ]; then
  echo "Downloading JMeter bundle from S3..."
  DOWNLOAD_START=$(date +%s)
  aws s3 cp s3://"$S3_BUCKET"/frameworks/jmeter/jmeter-bundle.tgz ./ --region "$MAIN_STACK_REGION" --no-progress || {
    fatal_exit "Failed to download JMeter bundle from S3"
  }
  DOWNLOAD_END=$(date +%s)
  echo "TIMING: jmeter_bundle_download_seconds=$((DOWNLOAD_END - DOWNLOAD_START))"
  
  echo "Extracting JMeter bundle..."
  EXTRACT_START=$(date +%s)
  tar -xzf jmeter-bundle.tgz || {
    fatal_exit "Failed to extract JMeter bundle archive"
  }
  EXTRACT_END=$(date +%s)
  echo "TIMING: jmeter_bundle_extract_seconds=$((EXTRACT_END - EXTRACT_START))"
  
  cd jmeter-bundle || fatal_exit "Failed to enter jmeter-bundle directory"
  
  # Verify SHA512 checksum
  echo "Verifying SHA512 checksum..."
  sha512sum -c apache-jmeter-*.tgz.sha512 || {
    fatal_exit "JMeter SHA512 checksum verification failed"
  }
  
  # Extract JMeter
  echo "Extracting JMeter..."
  tar -xzf apache-jmeter-*.tgz || {
    fatal_exit "Failed to extract JMeter from bundle"
  }
  
  JMETER_VERSION=$(jq -r '.version' jmeter.json)
  export JMETER_HOME="$(pwd)/apache-jmeter-$JMETER_VERSION"
  
  # Install bundled plugins
  echo "Installing bundled plugins..."
  PLUGIN_START=$(date +%s)
  
  for plugin_zip in plugins/*.zip; do
    echo "  Installing $(basename "$plugin_zip")..."
    unzip -oq "$plugin_zip" -d "$JMETER_HOME"
  done
  PLUGIN_END=$(date +%s)
  echo "TIMING: jmeter_plugin_install_seconds=$((PLUGIN_END - PLUGIN_START))"
  
  cd ..
  
  echo "JMeter setup complete"
fi

# download JMeter jmx file or other test type files
if [ "$TEST_TYPE" != "simple" ]; then
  # setting the log file values to the test type
  LOG_FILE="${TEST_TYPE}.log"
  OUT_FILE="${TEST_TYPE}.out"
  ERR_FILE="${TEST_TYPE}.err"

  # set variables based on TEST_TYPE
  if [ "$TEST_TYPE" == "jmeter" ]; then
    EXT="jmx"
    TYPE_NAME="JMeter"
  elif [ "$TEST_TYPE" == "k6" ]; then
    # Read k6 version and download URL templates from k6.json
    K6_JSON="/frameworks/k6.json"
    K6_VERSION=$(jq -r '.version' "$K6_JSON")
    echo "K6_VERSION:: ${K6_VERSION}"

    # Detect architecture for platform-specific binary
    ARCH=$(uname -m)
    case "$ARCH" in
      x86_64)        K6_ARCH="amd64" ;;
      aarch64|arm64) K6_ARCH="arm64" ;;
      *)
        fatal_exit "Unsupported architecture: $ARCH"
        ;;
    esac

    # Resolve download URLs from k6.json templates, substituting {version} and {arch}
    K6_BINARY_URL=$(jq -r --arg v "$K6_VERSION" --arg a "$K6_ARCH" \
      '.download.binary | gsub("\\{version\\}"; $v) | gsub("\\{arch\\}"; $a)' "$K6_JSON")
    K6_CHECKSUMS_URL=$(jq -r --arg v "$K6_VERSION" \
      '.download.checksums | gsub("\\{version\\}"; $v)' "$K6_JSON")
    K6_ARCHIVE=$(basename "$K6_BINARY_URL")

    # Download k6 archive and checksums
    echo "Downloading k6 for $ARCH architecture..."
    curl -L --output "$HOME/$K6_ARCHIVE" "$K6_BINARY_URL" || {
      fatal_exit "Failed to download k6 archive"
    }
    
    curl -L --output "$HOME/k6-checksums.txt" "$K6_CHECKSUMS_URL" || {
      fatal_exit "Failed to download k6 checksums"
    }
    
    # Validate checksum
    echo "Validating checksum..."
    EXPECTED_CHECKSUM=$(grep $K6_ARCHIVE "$HOME/k6-checksums.txt" | awk '{print $1}')
    if [ -z "$EXPECTED_CHECKSUM" ]; then
      fatal_exit "Could not find expected checksum for $K6_ARCHIVE"
    fi
    
    ACTUAL_CHECKSUM=$(sha256sum "$HOME/$K6_ARCHIVE" | awk '{print $1}')
    if [ "$EXPECTED_CHECKSUM" != "$ACTUAL_CHECKSUM" ]; then
      echo "Expected: $EXPECTED_CHECKSUM"
      echo "Actual: $ACTUAL_CHECKSUM"
      fatal_exit "k6 checksum validation failed"
    fi
    echo "Checksum validation passed"
    
    # Extract and install k6 directly to /usr/bin
    echo "Installing k6..."
    tar -xzf "$HOME/$K6_ARCHIVE" --strip-components=1 -C $HOME || {
      fatal_exit "Failed to extract k6 archive"
    }
    
    # Verify installation
    if [ ! -x $HOME/k6 ]; then
      fatal_exit "k6 binary not executable after extraction"
    fi
    
    # Clean up downloaded files
    echo "Cleaning up temporary files..."
    rm -rf "$HOME/$K6_ARCHIVE"
    rm -rf "$HOME/k6-checksums.txt"
    
    # Add the k6 installation dir to the PATH
    # so that bzt can find it.
    export PATH=$PATH:$HOME
    
    echo "k6 installation succeeded"

    EXT="js"
    KPI_EXT="csv"
    TYPE_NAME="K6"
  elif [ "$TEST_TYPE" == "locust" ]; then
    EXT="py"
    TYPE_NAME="Locust"
  fi

  if [ "$FILE_TYPE" != "zip" ]; then
    # For k6, try .ts first, then .js if .ts doesn't exist (k6 v0.57+ supports TypeScript natively)
    if [ "$TEST_TYPE" == "k6" ]; then
      # Try .ts first (suppress expected 404 error)
      if aws s3 cp s3://$S3_BUCKET/public/test-scenarios/$TEST_TYPE/$TEST_ID.ts ./ \
         --no-progress --region $MAIN_STACK_REGION 2>/dev/null; then
        EXT="ts"
        echo "Downloaded k6 test script: $TEST_ID.ts"
        
      # Try .js as fallback
      elif aws s3 cp s3://$S3_BUCKET/public/test-scenarios/$TEST_TYPE/$TEST_ID.js ./ \
           --no-progress --region $MAIN_STACK_REGION 2>/dev/null; then
        EXT="js"
        echo "Downloaded k6 test script: $TEST_ID.js"
        
      # Both failed - show error
      else
        fatal_exit "No .ts or .js file found for k6 test $TEST_ID"
      fi
    else
      if ! aws s3 cp s3://$S3_BUCKET/public/test-scenarios/$TEST_TYPE/$TEST_ID.$EXT ./ \
           --no-progress --region $MAIN_STACK_REGION; then
        fatal_exit "Failed to download test file $TEST_ID.$EXT"
      fi
      echo "Downloaded test script: $TEST_ID.$EXT"
    fi
  else
    aws s3 cp s3://$S3_BUCKET/public/test-scenarios/$TEST_TYPE/$TEST_ID.zip ./ --no-progress --region $MAIN_STACK_REGION || {
      fatal_exit "Failed to download zip file $TEST_ID.zip"
    }
    
    # When unzipping, we want to make ensure unzipped content is in the current working directory instead of an unzipped subdirectory.
    # This is necessary for certain files, such as a "locust.conf" file that is assumed to be in the current working directory.
    TEMP_DIR=$(mktemp -d)
    unzip $TEST_ID.zip -d $TEMP_DIR
    echo "UNZIPPED to temp directory"
    ls -l $TEMP_DIR
    
    # Check if there's exactly one directory and no files at root level
    ROOT_DIRS=$(find $TEMP_DIR -mindepth 1 -maxdepth 1 -type d -not -name '.*' -not -name '_*')
    ROOT_FILES=$(find $TEMP_DIR -mindepth 1 -maxdepth 1 -type f -not -name '.*' -not -name '_*')
    
    # Only unwrap if there's exactly one directory and zero files at root
    if [ $(echo "$ROOT_DIRS" | wc -l) -eq 1 ] && [ -z "$ROOT_FILES" ]; then
      PARENT_FOLDER=$(echo "$ROOT_DIRS")
      echo "Single parent folder detected with no sibling files: $PARENT_FOLDER"
      echo "Unwrapping contents from parent folder"
      cp -r $PARENT_FOLDER/* ./
    else
      echo "Multiple items or files at root level detected, copying all contents from temp directory"
      cp -r $TEMP_DIR/* ./
    fi
    
    # Cleanup temp directory
    rm -rf $TEMP_DIR
    echo "Cleaned up temp directory"
    
    ls -l

    # Identify the correct test file
    if [ "$TEST_TYPE" == "k6" ]; then
      # For k6, look for .ts or .js files (k6 v0.57+ supports TypeScript natively)
      TEST_SCRIPT=$(find . -name "*.ts" | head -n 1)
      if [ -z "$TEST_SCRIPT" ]; then
        TEST_SCRIPT=$(find . -name "*.js" | head -n 1)
      fi
      if [ ! -z "$TEST_SCRIPT" ]; then
        # Update EXT based on the actual file found
        EXT="${TEST_SCRIPT##*.}"
      fi
    elif [ "$TEST_TYPE" != "locust" ]; then
      # Only looks for the first test script file.
      # Exclude jmeter-bundle directory to avoid finding demo files
      TEST_SCRIPT=$(find . -path "./jmeter-bundle" -prune -o -name "*.${EXT}" -not -path '*/.*' -not -path '*/_*' -print | head -n 1)
    else 
      # If zip and locust, make sure to pick locustfile.py
      TEST_SCRIPT=$(find . -name "locustfile.py" -not -path '*/.*' -not -path '*/_*' | head -n 1)
    fi
    echo $TEST_SCRIPT
    if [ -z "$TEST_SCRIPT" ]; then
      fatal_exit "No test script (.${EXT}) in zip file"
    fi

    # Update test.json to reference the test script extracted from the zip.
    # Prior to v4.0, zipped test scripts were stored with their framework's expected extension (e.g. JMeter zip would be ABCDE12345.jmx instead of ABCDE12345.zip).
    # test.json may reference $TEST_ID.$EXT (legacy to support .jmx) or $TEST_ID.zip (current).
    # The two sed replacements ensure either file name is correctly updated to the actual test script value.
    sed -i -e "s|$TEST_ID.$EXT|$TEST_SCRIPT|g" -e "s|$TEST_ID.zip|$TEST_SCRIPT|g" test.json

    # Look for plugins/ relative to the test script to avoid false matches
    USER_PLUGIN_DIR="$(dirname "$TEST_SCRIPT")/plugins"
    if [ ! -d "$USER_PLUGIN_DIR" ]; then
      echo "No user plugins directory found in upload"
    else
      echo "Processing user-uploaded plugins from $USER_PLUGIN_DIR"
      
      # For JMeter tests, use the bundled JMeter's ext directory
      if [ "$TEST_TYPE" == "jmeter" ] && [ -n "$JMETER_HOME" ]; then
        JMETER_EXT_PATH="$JMETER_HOME/lib/ext"
        
        # Load known bundled plugin names from jmeter.json in the bundle
        JMETER_JSON="jmeter-bundle/jmeter.json"
        if [ -f "$JMETER_JSON" ]; then
          KNOWN_PLUGINS=$(jq -r '.plugins | keys[]' "$JMETER_JSON")
          echo "Known bundled plugins: $KNOWN_PLUGINS"
        else
          echo "Warning: jmeter.json not found in bundle, cannot detect plugin version conflicts"
          KNOWN_PLUGINS=""
        fi
        
        # Process each user-uploaded JAR
        for user_jar in "$USER_PLUGIN_DIR"/*.jar; do
          [ -e "$user_jar" ] || continue  # Skip if no JARs found
          
          jar_basename=$(basename "$user_jar")
          is_override=false
          
          # Check if this JAR matches any known bundled plugin
          # Regex pattern ensures version follows plugin name: plugin-1.2.jar matches, plugin-extended-1.2.jar does not
          for plugin in $KNOWN_PLUGINS; do
            if [[ "$jar_basename" =~ ^${plugin}-[0-9]+\.[0-9]+ ]]; then
              echo "User overriding bundled plugin: $plugin (removing bundled versions)"
              # Remove all versions of this bundled plugin
              find "$JMETER_EXT_PATH" -name "${plugin}-*.jar" -delete
              is_override=true
              break
            fi
          done
          
          # Copy user's JAR (either override or new custom plugin)
          if [ "$is_override" = true ]; then
            echo "  Installing user override: $jar_basename"
          else
            echo "  Installing custom plugin: $jar_basename"
          fi
          cp -v "$user_jar" "$JMETER_EXT_PATH/"
        done
        
        # Log final plugin JAR files in ext directory
        echo "=========================================="
        echo "Final Plugin JAR files in JMeter ext directory:"
        echo "Path: $JMETER_EXT_PATH"
        if ls "$JMETER_EXT_PATH"/*.jar 1> /dev/null 2>&1; then
            ls -lh "$JMETER_EXT_PATH"/*.jar | awk '{print $9, "(" $5 ")"}'
        else
            echo "No plugin JAR files found in ext directory"
        fi
        echo "=========================================="
      fi
    fi
  fi
fi

# Create health marker — tells ECS health check this task is ready to
# receive the start signal (not that it HAS received it).
echo "READY" > /tmp/health_ready
echo "Waiting for S3 start signal..."

# Poll S3 for the region-specific start marker. The Start Command Lambda
# writes this marker after the Regional Sync confirms all regions are READY.
# AWS_REGION is set by ECS Fargate to the region where this task is running
# (e.g., us-west-2) and is used as the region segment in the S3 key path.
# The S3 API call goes to MAIN_STACK_REGION where the scenarios bucket lives.
while ! aws s3api head-object \
  --bucket "$S3_BUCKET" \
  --key "start-signal/$TEST_ID/$PREFIX/$AWS_REGION/start" \
  --region "$MAIN_STACK_REGION" > /dev/null 2>&1; do
  sleep 2
done
log_json "INFO" "TASK_STARTED" "Start signal received"

echo "Running test"

# Monitor err file for fatal errors and kill JMeter if detected (JMeter only)
if [ "$TEST_TYPE" == "jmeter" ]; then
  (
    while true; do
      sleep 5
      if [ -f /tmp/artifacts/$ERR_FILE ] && grep -qE "OutOfMemoryError|StackOverflowError|VirtualMachineError|Killed" /tmp/artifacts/$ERR_FILE 2>/dev/null; then
        echo "[FATAL] JVM/OS fatal error detected - stopping JMeter"
        pkill -f "ApacheJMeter.jar" 2>/dev/null || true
        break
      fi
    done
  ) &
  WATCHDOG_PID=$!
fi

# Define additional bzt options
BZT_EXTRA_OPTS=()

# Configure bzt to use bundled JMeter if JMETER_HOME is set
if [ -n "$JMETER_HOME" ]; then
  BZT_EXTRA_OPTS+=("-o" "modules.jmeter.path=$JMETER_HOME/bin/jmeter")
  echo "Using bundled JMeter at: $JMETER_HOME"
fi

# Run the bzt pipeline in a background process group so that:
# 1. `wait` is interruptible by SIGTERM (foreground pipelines block signal delivery)
# 2. We can capture the pipeline PID and forward SIGTERM to bzt in sigterm_handler
#
# We wrap the pipeline in a subshell with its own trap so that SIGTERM
# propagates to all pipeline children (bzt, tee, sed). The subshell
# becomes a process group leader, and `kill -- -$PID` reaches every member.
set -m  # Enable job control so the subshell gets its own process group
(
  stdbuf -i0 -o0 -e0 bzt test.json "${BZT_EXTRA_OPTS[@]}" -o modules.console.disable=true | stdbuf -i0 -o0 -e0 tee -a result.tmp | sed -u -e "s|^|$TEST_ID $LIVE_DATA_ENABLED |"
  echo "${PIPESTATUS[0]}" > /tmp/bzt_exit_code
) &
BZT_PID=$!
set +m
wait $BZT_PID 2>/dev/null
BZT_EXIT_CODE=$(cat /tmp/bzt_exit_code)
# Clear PID so sigterm_handler knows bzt already exited
BZT_PID=""

if [ -n "$WATCHDOG_PID" ]; then
  kill $WATCHDOG_PID 2>/dev/null || true
  grep -qE "OutOfMemoryError|StackOverflowError|VirtualMachineError|Killed" /tmp/artifacts/$ERR_FILE 2>/dev/null && FATAL_ERROR_DETECTED=1
fi


CALCULATED_DURATION=`cat result.tmp | grep -m1 "Test duration" | awk -F ' ' '{ print $5 }' | awk -F ':' '{ print ($1 * 3600) + ($2 * 60) + $3 }'`

# upload custom results to S3 if any
# every file goes under $TEST_ID/$PREFIX/$UUID to distinguish the result correctly
if [ "$TEST_TYPE" != "simple" ]; then
  if [ "$FILE_TYPE" != "zip" ]; then
    cat $TEST_ID.$EXT | grep filename > results.txt
  else
    cat $TEST_SCRIPT | grep filename > results.txt
  fi

  if [ -f results.txt ]; then
    sed -i -e 's/<stringProp name="filename">//g' results.txt
    sed -i -e 's/<\/stringProp>//g' results.txt
    sed -i -e 's/ //g' results.txt

    echo "Files to upload as results"
    cat results.txt
    
    files=(`cat results.txt`)
    extensions=()
    for f in "${files[@]}"; do
      ext="${f##*.}"
      if [[ ! " ${extensions[@]} " =~ " ${ext} " ]]; then
        extensions+=("$ext")
      fi
    done

    # Find all files in the current folder with the same extensions
    all_files=()
    for ext in "${extensions[@]}"; do
      for f in *."$ext"; do
        all_files+=("$f")
      done
    done

    for f in "${all_files[@]}"; do
      p="s3://$S3_BUCKET/results/$TEST_ID/${TYPE_NAME}_Result/$PREFIX/$UUID/$f"
      if [[ $f = /* ]]; then
        p="s3://$S3_BUCKET/results/$TEST_ID/${TYPE_NAME}_Result/$PREFIX/$UUID$f"
      fi

        echo "Uploading $p"
        aws s3 cp $f $p --region $MAIN_STACK_REGION
    done
    fi
fi

run_cleanup
if [ $? -ne 0 ]; then
  fatal_exit "No results.xml produced"
fi

# Exit with error code if fatal error was detected
if [ "$FATAL_ERROR_DETECTED" -eq 1 ]; then
  echo "[FATAL] Exiting with error code 137 due to JVM/OS fatal error"
  fatal_exit "JVM/OS fatal error" 137
fi

# If bzt failed, exit so ECS emits a task STOPPED event and the task
# failure handler can short-circuit the test via healthy threshold.
if [ "$BZT_EXIT_CODE" -ne 0 ]; then
  fatal_exit "bzt exited with code $BZT_EXIT_CODE" 2
fi

# Upload completion marker for service-based completion detection.
# The Task Status Checker Lambda polls this prefix to count completed tasks.
echo -n | aws s3 cp - s3://$S3_BUCKET/results/${TEST_ID}/${PREFIX}/completion/${AWS_REGION}/${TASK_ID} --region $MAIN_STACK_REGION

# Wait for SIGTERM instead of exiting (ECS service model).
# Tasks remain idle until the Task Canceler Lambda sets desiredCount=0,
# at which point ECS sends SIGTERM and the container exits cleanly.
log_json "INFO" "TASK_COMPLETED" "Test complete"
echo "Test complete. Waiting for ECS termination signal..."
trap 'echo "Received SIGTERM, shutting down"; exit 0' SIGTERM
sleep infinity &
wait $!
