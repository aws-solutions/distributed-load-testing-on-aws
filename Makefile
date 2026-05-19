-include .env

# Fail-fast check for .env file existence
ifeq (,$(wildcard .env))
$(error .env file not found. Please copy .env.example to .env and configure it)
endif

# Export AWS region variables
export AWS_DEFAULT_REGION=$(TARGET_REGION)
export AWS_REGION=$(TARGET_REGION)

# Suppress command echoing
.SILENT:

# Declare all targets as phony (targets execute commands instead of making files)
.PHONY: help dev install-deps test web-assets jmeter-assets \
	deploy diff changeset regional-deploy \
	_ensure-bootstrap-region _docker-pre-build _regional-deploy-single bundle-cli

# Display available commands and usage information
help:
	echo "Available commands:"
	echo "  make help                            - Show this help message"
	echo "  make install-deps                    - Install all project dependencies"
	echo "  make dev                             - Run web UI locally (requires deployed stack)"
	echo "  make deploy                          - Deploy DLT main stack (set MAIN_STACK_NAME in .env)"
	echo "  make diff                            - Preview stack changes before deployment"
	echo "  make changeset                       - Create CloudFormation changeset for review"
	echo "  make regional-deploy                 - Deploy regional stacks (all REGIONAL_STACKS regions)"
	echo "  make regional-deploy REGION=<region> - Deploy regional stack to a single region"
	echo "  make test                             - Run all unit tests, linting, and formatting checks"
	echo "  make bundle-cli                      - Bundle DLT CLI into a single portable file"

# Install npm dependencies for all workspace packages
install-deps:
	if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then \
		echo "Installing workspace dependencies..."; \
		npm ci && touch node_modules; \
	else \
		echo "Workspace dependencies up to date, skipping install"; \
	fi
	@echo "Installing legacy dependencies"
	cd source && npm run install:all

# Run all unit tests, linting, formatting, and version checks (same as CI)
test:
	cd deployment && bash run-unit-tests.sh --skip-install

# Build web assets to be uploaded during stack deployment
web-assets:
	# Check if node_modules needs update (package-lock.json changed)
	if [ ! -d source/webui/node_modules ] || [ source/webui/package-lock.json -nt source/webui/node_modules ]; then \
		echo "Installing WebUI dependencies..."; \
		cd source/webui && npm ci && touch node_modules; \
	fi
	# Check if build is needed (src files changed)
	if [ ! -d source/webui/dist ] || [ -n "$$(find source/webui/src -newer source/webui/dist -type f 2>/dev/null | head -1)" ]; then \
		echo "Building WebUI..."; \
		cd source/webui && npm run build; \
	else \
		echo "WebUI assets up to date, skipping build"; \
	fi

# Build JMeter assets to be uploaded during stack deployment
jmeter-assets:
	if [ ! -f deployment/jmeter-assets/jmeter-bundle.tgz ] || [ jmeter.json -nt deployment/jmeter-assets/jmeter-bundle.tgz ]; then \
		echo "Preparing JMeter bundle..."; \
		./scripts/download-jmeter-bundle.sh deployment/jmeter-assets; \
	else \
		echo "JMeter bundle up to date, skipping download"; \
	fi

# Deploy main DLT stack to TARGET_REGION with required parameters from .env
# Set MAIN_STACK_NAME in .env to choose deployment mode (standard, ALB+ECS, or headless)
# ALB+ECS stack requires ConsoleDomainName and ACMCertificateArn (CDK will fail if missing)
deploy: jmeter-assets web-assets _docker-pre-build
	echo "Deploying DLT stack: $(MAIN_STACK_NAME)"
	cd source/infrastructure && npx cdk deploy $(MAIN_STACK_NAME) \
		--context buildFromSource=true \
		--parameters AdminName=$(ADMIN_NAME) \
		--parameters AdminEmail=$(ADMIN_EMAIL) \
		--parameters DeployMCPServer="Yes" \
		--require-approval never

# Show CloudFormation diff between current and proposed stack state
diff: _docker-pre-build
	echo "Showing differences for DLT stack"
	cd source/infrastructure && npx cdk diff $(MAIN_STACK_NAME) \
		--context buildFromSource=true \
		--parameters AdminName=$(ADMIN_NAME) \
		--parameters AdminEmail=$(ADMIN_EMAIL) \
		--parameters DeployMCPServer="Yes"

# Create CloudFormation changeset without executing deployment
changeset: jmeter-assets web-assets _docker-pre-build
	echo "Creating changeset for DLT stack"
	cd source/infrastructure && npx cdk deploy $(MAIN_STACK_NAME) \
		--context buildFromSource=true \
		--parameters AdminName=$(ADMIN_NAME) \
		--parameters AdminEmail=$(ADMIN_EMAIL) \
		--parameters DeployMCPServer="Yes" \
		--require-approval never \
		--no-execute

# Run web UI development server locally (fetches config from deployed stack)
dev:
	echo "Running web app"
	aws s3 cp s3://$$(aws cloudformation describe-stacks --stack-name $(MAIN_STACK_NAME) --query 'Stacks[0].Outputs[?OutputKey==`ConsoleResourceBucket`].OutputValue' --output text)/aws-exports.json source/webui/public/aws-exports.json
	cd source/webui && npm run dev

# Internal: Check if region is bootstrapped, bootstrap if needed
_ensure-bootstrap-region:
	if ! AWS_DEFAULT_REGION=$(REGION) AWS_REGION=$(REGION) aws cloudformation describe-stacks --stack-name CDKToolkit --region $(REGION) >/dev/null 2>&1; then \
		echo "CDK not bootstrapped in $(REGION), bootstrapping..."; \
		cd source/infrastructure && \
		AWS_DEFAULT_REGION=$(REGION) AWS_REGION=$(REGION) \
		npx cdk bootstrap --region $(REGION); \
	fi

# Internal: Run pre-build scripts for all container images
_docker-pre-build:
	for image_dir in deployment/ecr/*/; do \
		if [ -f "$$image_dir/pre-build.sh" ]; then \
			echo "Pre-build: $$(basename $$image_dir)"; \
			(cd "$$image_dir" && bash pre-build.sh); \
		fi; \
	done

# Deploy regional stack(s). Supports two modes:
#   make regional-deploy                  — deploys to all regions in REGIONAL_STACKS
#   make regional-deploy REGION=us-west-2 — deploys to a single region
regional-deploy:
	if [ -n "$(REGION)" ]; then \
		$(MAKE) _regional-deploy-single REGION=$(REGION); \
	elif [ -n "$(REGIONAL_STACKS)" ]; then \
		for region in $(REGIONAL_STACKS); do \
			echo "=== Deploying regional stack to $$region ==="; \
			$(MAKE) _regional-deploy-single REGION=$$region; \
		done; \
	else \
		echo "Error: No regions specified."; \
		echo "Set REGIONAL_STACKS in .env or pass REGION=<region>"; \
		echo "Example: make regional-deploy REGION=us-west-2"; \
		exit 1; \
	fi

# Internal: Deploy a single regional stack (called by regional-deploy)
_regional-deploy-single: _ensure-bootstrap-region _docker-pre-build
	if [ -z "$(REGION)" ]; then \
		echo "Error: REGION is not set."; \
		exit 1; \
	fi
	cd source/infrastructure && \
	AWS_DEFAULT_REGION=$(REGION) AWS_REGION=$(REGION) \
	npx cdk deploy $(REGIONAL_STACK_NAME) \
		--context buildFromSource=true \
		--context mainRegion=$(TARGET_REGION) \
		--context scenariosBucket=$$(aws cloudformation describe-stacks --stack-name $(MAIN_STACK_NAME) --query 'Stacks[0].Outputs[?OutputKey==`ScenariosBucket`].OutputValue' --output text) \
		--context scenariosTable=$$(aws cloudformation describe-stacks --stack-name $(MAIN_STACK_NAME) --query 'Stacks[0].Outputs[?OutputKey==`ScenariosTable`].OutputValue' --output text) \
		--context lambdaTaskRoleArn=$$(aws cloudformation describe-stacks --stack-name $(MAIN_STACK_NAME) --query 'Stacks[0].Outputs[?OutputKey==`LambdaTaskRoleArn`].OutputValue' --output text) \
		--region $(REGION) \
		--require-approval never

# Bundle the DLT CLI into a single portable file (requires: npm ci)
bundle-cli:
	npm run bundle -w source/cli
	@echo "Bundle ready: source/cli/dist/dlt-cli.mjs"
