# Set a uuid for the results json file name in S3
UUID=$(cat /proc/sys/kernel/random/uuid)

echo "S3_BUCKET: ${S3_BUCKET}"
echo "TEST_ID: ${TEST_ID}"
echo "TASK_INDEX: ${TASK_INDEX}"
echo "UUID: ${UUID}"

echo "Downloading test scenario"
aws s3 cp s3://$S3_BUCKET/test-scenarios/$TEST_ID.json /k6-tests/config.json

echo "Running test"
k6 run --out json=/k6-tests/out.json --quiet --no-summary --logformat raw /k6-tests/script.js

t=$(python -c "import random;print(random.randint(1, 30))")
echo "sleep for: $t seconds."
sleep $t

echo "Uploading results"
aws s3 cp /k6-tests/out.json s3://$S3_BUCKET/results/${TEST_ID}/${UUID}.json
