# Front-end Overview

This directory contains sources for the DLT front-end console. This front-end consists of the following functional components:

- **React**, for dynamic manipulation of front-end content, structure, and styling
- **Cloudscape**, for AWS styling
- **Redux**, for data fetching and caching
- **Amplify**, for authenticating and authorizing requests using Cognito and API Gateway
- **Vite**, for locally running a dev server with hot reloading
- **MockServer**, for end-to-end testing with a simulated REST API back-end.

## Distribution

The front-end is packaged and deployed as follows:

1. The build script (`build-s3-dist.sh`) runs `npm run build` in `source/webui/`, creating a `source/webui/dist/` folder with the compiled front-end assets.

2. CDK bundles the front-end assets in `source/webui/dist` using the Console construct in `source/infrastructure/lib/front-end/console.ts`.

3. The `build-s3-dist.sh` script creates zip files for all CDK assets, including the front-end assets, and copies them to `deployment/regional-s3-assets/`.

4. Front-end files are deployed directly to the S3 bucket created by the `CloudFrontToS3` construct.

5. The custom resource in `source/infrastructure/lib/front-end/webUIConfigConstruct.ts` generates `aws-exports.json` with values for the deployed Cognito and API Gateway resources and saves it to the S3 bucket hosting the front-end.

## Testing

Use these commands to run the front-end locally.

```bash
cd source/webui/
npm install
npm run test
# Update public/aws-exports.json with bindings to a deployed stack
npm run dev
```

