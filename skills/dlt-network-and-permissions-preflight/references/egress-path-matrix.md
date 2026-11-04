# DLT egress-path matrix

This reference lists every network destination a Distributed Load Testing on AWS (DLT) load-generator task must reach, by framework and by deploy mode, with the signal each blocked path produces. Use it with Check 4 of the parent skill.

Source of truth:

- Load-generator VPC (public subnets, internet gateway, no NAT): `source/infrastructure/lib/testing-resources/vpc.ts`
- Security-group egress rule and `EgressCidr` parameter: `source/infrastructure/lib/testing-resources/ecs.ts` and `common-resources/parameter-spec.ts`
- Container build and runtime fetches: `deployment/ecr/distributed-load-testing-on-aws-load-tester*` (the Standard mode image and the three Native images) and `source/load-tester/src` (the Native runners)
- Live data path: `source/infrastructure/lib/testing-resources/real-time-data.ts`
- ALB console VPC endpoints (a separate VPC, not the load generators): `source/infrastructure/lib/front-end/console-alb-ecs.ts`

## Destinations by Framework

Every task, regardless of framework or traffic shape, needs the ECR, scenarios S3, and CloudWatch Logs paths and the path to your target. Two frameworks always add a runtime download, and Locust adds one when the bundle declares packages. The rows below hold in both Standard and Native mode unless a row says otherwise.

| Destination | JMeter | k6 | Locust | What it is |
| --- | --- | --- | --- | --- |
| Amazon ECR | Yes | Yes | Yes | Pull the load-tester image at task start: anonymously from the ECR Public Gallery by default, or with the task execution role from a private repository named in an image URI parameter |
| Scenarios S3 bucket | Yes | Yes | Yes | Download the uploaded test bundle; upload results (task role). Bucket lives in the hub Region, so spoke tasks read it cross-region |
| CloudWatch Logs | Yes | Yes | Yes | Ship container stdout and stderr via the awslogs log driver |
| GitHub releases | No | Yes | No | k6 downloads its binary and checksum at runtime from `github.com/grafana/k6/releases/...`; the image omits the binary on purpose |
| Scenarios S3 bucket (JMeter bundle) | Yes | No | No | The pinned `jmeter-bundle.tgz` is copied into the scenarios bucket at deploy time and installed into the task at start; the image omits JMeter itself. Simple HTTP Endpoint tests run through JMeter in Standard mode, so they need it too |
| Grafana's k6 extension build service | No | If the script imports a `k6/x/...` extension | No | k6 1.5.0 resolves an Official or Community extension by downloading a custom k6 build at task start, in both modes. Grafana does not document the host, so allow general HTTPS egress, or keep `k6/x/...` imports out of the script. Without the path, k6 fails at load with `unknown dependency ... failed to provision a k6 binary` |
| PyPI (`pypi.org`, `files.pythonhosted.org`) | No | No | If the bundle has a `requirements.txt` and no `packages/` | DLT v4.3.0 and later pip-install a top-level `requirements.txt` at task start in both modes. A `packages/` directory of wheels makes the install offline and removes this destination |
| Your target endpoint | Yes | Yes | Yes | The system under test. Public over the internet gateway, or private over peering, Transit Gateway, or PrivateLink |

Live data needs no destination of its own. Tasks print their per-second metrics to stdout, which travels with the rest of the task output to CloudWatch Logs. A subscription filter on the task log group invokes the solution's real-time data publisher Lambda, and that Lambda, not the task, publishes to AWS IoT Core for the console. Reaching CloudWatch Logs is therefore all that live data needs from a task.

Notes:

- Locust is installed into its image at build time, so it has no runtime binary download. Its only optional download is the `requirements.txt` install. In Native mode that install is stopped after 180 seconds, so a slow PyPI path fails the task even when it would eventually succeed. Either way it still needs the scenarios bucket and the shared paths.
- The k6 binary fetch reaches GitHub and its asset CDN (release assets redirect to a `githubusercontent.com` or a codeload host). Allowlisting only `github.com` and not its asset host makes the k6 setup fail.

## Paths by Deploy Mode

The deploy mode that matters for egress is how the **testing VPC** is configured, not how the web console is served.

### Default: DLT Creates the VPC

- VPC `192.168.0.0/16` with two public `/20` subnets, an internet gateway, and a `0.0.0.0/0` route to it. No NAT gateway. Tasks get public IPs (`assignPublicIp: ENABLED`) and reach the internet directly.
- All internet destinations (ECR public image, GitHub, PyPI, S3, CloudWatch Logs, a public target) work out of the box.
- Egress is still gated by the security-group rule whose CIDR is the `EgressCidr` parameter, default `0.0.0.0/0`. Narrowing it can cut off any destination above.

### Bring Your Own VPC (`ExistingVPCId`, `ExistingSubnetA`, `ExistingSubnetB`)

- DLT uses your VPC and two subnets and does not create routing for you. Reachability is whatever your subnets already provide.
- If the subnets are private with no NAT gateway and no VPC endpoints, tasks cannot pull the ECR image or reach S3, GitHub, or CloudWatch Logs. The run then hangs in provisioning. Add a NAT gateway. VPC endpoints alone do not serve the default load-tester images, because those come from the ECR Public Gallery. To run without a NAT, copy the images into a private ECR repository in the hub Region, point the four image URI parameters at the copies, and add VPC endpoints for ECR (`ecr.api` and `ecr.dkr`), the S3 gateway endpoint (ECR layers live in S3), and CloudWatch Logs. Spoke Regions run the hub's image URI and read the hub's scenarios bucket, and endpoints serve only their own Region, so a spoke VPC with no NAT cannot reach either. Neither GitHub nor PyPI has a VPC endpoint, so a k6 binary fetch and a Locust `requirements.txt` install still need a NAT or another egress path. For Locust you can avoid the dependency by vendoring wheels in `packages/`.
- A private target is reached only if your subnets have the peering, Transit Gateway, or PrivateLink route to it, and `EgressCidr` allows it.

### Console Deploy Mode Does Not Change Load-Generator Egress

The web console can be served through CloudFront (default), an Application Load Balancer (ALB mode), or headless. In ALB mode the solution creates a separate `WebConsoleVpc` with `natGateways: 0`. That VPC has interface and gateway endpoints for ECR, ECR Docker, S3, and CloudWatch Logs, so the private web console container runs without a NAT. It hosts the console, not the load generators. The load-generator tasks always run in the testing VPC described above. Choosing the ALB console does not make the load generators run privately and does not add endpoints to their subnets. If you need private load generators, configure the testing VPC yourself through the existing-VPC parameters.

## Detection Signals by Blocked Path

| Blocked path | Symptom | Where to read it |
| --- | --- | --- |
| ECR image pull | Stuck `provisioning`; task never healthy | ECS task stopped reason, for example `CannotPullContainerError` |
| Scenarios S3 (bundle) | Setup fails; no test bundle | task CloudWatch log stream |
| GitHub (k6 binary) | k6 setup fails before any request | task CloudWatch log stream (download or checksum error) |
| Grafana k6 build service (extension imports) | k6 fails at load; a Standard task fails, and a Native run fails with `No requests were recorded` | task CloudWatch log stream: `unknown dependency ... failed to provision a k6 binary` |
| Scenarios S3 (JMeter bundle) | JMeter install fails at start | task CloudWatch log stream |
| PyPI (Locust `requirements.txt`) | Locust setup fails before any request; the run usually ends as a stabilization failure | task CloudWatch log stream: `Failed to install custom Python dependencies` (Native) or `Failed to install custom dependencies from requirements.txt` (Standard), with pip's own error |
| CloudWatch Logs | No task logs and no live data, which also hides other failures | absence of streams under the `load-testing/` prefix |
| Target endpoint | Fails with `No requests were recorded` on v4.3.0 and later (completes with zero requests on earlier versions), or errors climb; connection timeouts | task CloudWatch log stream; results (see `dlt-results-analysis`) |
| Everything (over-narrow `EgressCidr`) | Multiple of the above at once | ECS service events plus task logs |

For the log group name, task stream naming, and how to open ECS service events, see the `dlt-diagnose-run` skill.
