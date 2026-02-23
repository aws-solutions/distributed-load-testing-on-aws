include .env

# Export AWS region variables
export AWS_DEFAULT_REGION=$(TARGET_REGION)
export AWS_REGION=$(TARGET_REGION)

install-deps:
	@echo "Installing dependencies"
	cd source && npm run install:all

build-web-app:
	@echo "Building web app"
	cd source/webui && npm ci && npm run build

deploy-stack:
	@echo "Deploying DLT stack locally"
	cd source/infrastructure &&	npx cdk deploy $(MAIN_STACK_NAME) \
		--context buildFromSource=true \
		--parameters AdminName=$(ADMIN_NAME) \
		--parameters AdminEmail=$(ADMIN_EMAIL) \
		--parameters DeployMCPServer="Yes" \
		--require-approval never

diff-stack:
	@echo "Showing differences for DLT stack"
	cd source/infrastructure &&	npx cdk diff $(MAIN_STACK_NAME) \
		--context buildFromSource=true \
		--parameters AdminName=$(ADMIN_NAME) \
		--parameters AdminEmail=$(ADMIN_EMAIL) \
		--parameters DeployMCPServer="Yes"

create-changeset:
	@echo "Creating changeset for DLT stack"
	cd source/infrastructure &&	npx cdk deploy $(MAIN_STACK_NAME) \
		--context buildFromSource=true \
		--parameters AdminName=$(ADMIN_NAME) \
		--parameters AdminEmail=$(ADMIN_EMAIL) \
		--parameters DeployMCPServer="Yes" \
		--no-execute

run-web-app:
	@echo "Running web app"
	aws s3 cp s3://$(DLT_CONSOLE_BUCKET)/aws-exports.json source/webui/public/aws-exports.json
	cd source/webui && npm run dev

bootstrap-region:
	@if [ -z "$(REGION)" ]; then \
		echo "Error: REGION is not set. Please specify the region to bootstrap."; \
		echo "Example: make bootstrap-region REGION=us-west-2"; \
		exit 1; \
	fi
	@echo "Bootstrapping CDK in region $(REGION)"
	cd source/infrastructure && \
	AWS_DEFAULT_REGION=$(REGION) AWS_REGION=$(REGION) \
	npx cdk bootstrap --region $(REGION)

deploy-regional-stack:
	@if [ -z "$(REGION)" ]; then \
		echo "Error: REGION is not set. Please specify the region for regional stack deployment."; \
		echo "Example: make deploy-regional-stack REGION=us-west-2"; \
		exit 1; \
	fi
	@echo "Deploying regional DLT stack to $(REGION) from source"
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
