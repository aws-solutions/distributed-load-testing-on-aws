# Summary of broken scheduled tests due to DLT v3 to v4 migration

## Background

When DLT v3 users update their stack to v4, the tests scheduled in v3 stop running in v4.

This CR discusses the different scenarios setup tests and implements a fix to account for
each of those scenarios.

### Root cause

The scheduling mechanism itself is sound and working as expected.
The schedueld tests *are* actually running (triggered by the respective EventBridge rule),
but the issue really comes from the request body used for `POST /scenario` API.

DLT v3 set in the previous version of DLT no longer matches with the payload DLT v4 expects.

So from the UI, it appears the tests never ran, but in the backend, they actually did run
but never got passed the API validation step and failed silently.

#### Where are the test configurations stored?

The scheduled tests configurations are stored in both DynamoDB and EventBridge rules.

**DynamoDB**

Test data stored in DynamoDB is used when executing a scheduled test manually from the
test details page in the WebUI.
The payload does not include scheduling related information, therefore request data
mismatch relating to `recurrence`, `cronValue`, `cronExpiryDate` can be neglected.

However, it does include the following invalid fields:

1. Object types for Request body instead of json-string
2. `filetype` can be set to empty-string on simple endpoint test

Only tests of type `"simple endpoint"` match the above criteria which make the solution
simpler for test configs stored in DynamoDB

**EventBridge**

Test data stored in EventBridge is used when tests are executed on a schedule.
The EventBridge target is the API lambda function, and it makes a `POST /scenario`
request with a copy of the request body which is stored in EventBridge.

In this case, every tests are affected by the scheduling fields mismatch:
`cronValue`, `cronExpiryDate`, `recurrence`
as well as `filetype` and `request-body` related mismatch.

### Deep dive of Request body mismatch

1. `$.testScenario.scenarios.<test name>.requests[<index>].body`
    
    DLT v3, this `body` is passed around as a JS object.

    DLT v4 enforces this field to be a `string`.

2. `$.fileType`

    DLT v3 uses empty-string when scheduling Simple endpoint tests.

    DLT v4 expects this optional field to be one of `"none"`, `"script"`, `"zip"`
    when present.

3. `cronValue` and `cronExpiryDate`

    DLT v3 sends these field as empty string when scheduled tests are created as `Recurring`

    DLT v4 dropped support for `Recurring` scheduled tests and only supports `Cron` tests
    and requires `cronValue` to be have proper linux cron format
    and `cronExpiryDate` to be in `YYYY-mm-dd` format. It will reject
    requests where these fields are set to empty-string

4. `recurrence` 

    DLT v3 sends this field as empty-string when scheduling tests with `Cron` option

    DLT v4 expects this optional to be one of `"daily"`, `"weekly"`, `"biweekly"`, `"monthly"` 
    when present. It also hard-codes this field as `"daily"` when scheduling tests, and the API
    validation rejects requests where this field is empty-string