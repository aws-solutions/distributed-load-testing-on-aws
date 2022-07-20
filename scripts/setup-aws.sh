#!/bin/bash

mkdir -p ~/.aws

if [ "$ALP_AWS_ACCESS_ID" == "" ]; then
    echo "You have not configured your aws credentials. Please configure them now."
    printf "AWS access id: " && read ALP_AWS_ACCESS_ID
    printf "AWS secret key: " && read ALP_AWS_SECRET_KEY
    printf "AWS region [us-east-1]: " && read ALP_AWS_REGION
    if [ "$ALP_AWS_ACCESS_ID" = "" ] || [ "$ALP_AWS_SECRET_KEY" = "" ]; then
        echo "Invalid keys. Skipping setup"
        exit 0
    fi
    if [ "$ALP_AWS_REGION" = "" ]; then
        ALP_AWS_REGION=us-east-1
    fi
    gp env ALP_AWS_ACCESS_ID="$ALP_AWS_ACCESS_ID"
    gp env ALP_AWS_SECRET_KEY="$ALP_AWS_SECRET_KEY"
    gp env ALP_AWS_REGION="$ALP_AWS_REGION"
fi

aws configure set aws_access_key_id "$ALP_AWS_ACCESS_ID"
aws configure set aws_secret_access_key "$ALP_AWS_SECRET_KEY"
aws configure set region "$ALP_AWS_REGION"
aws configure set output json