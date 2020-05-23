import http from 'k6/http';
import { Logger } from './Logger.js';
import { Utils } from './Utils.js';

let logger = new Logger('Cognito');

export class Cognito {
    constructor(clientId) {
        this.clientId = clientId;
    }

    signUp(phone) {
        const resp = http.post(
            'https://cognito-idp.us-west-2.amazonaws.com/',
            JSON.stringify({ ClientId: this.clientId, Username: phone, Password: 'Password1!', UserAttributes: [{ Name: 'phone_number', Value: phone }] }),
            {
                headers: {
                    'Content-Type': 'application/x-amz-json-1.1',
                    'x-amz-api-version': '2016-04-18',
                    'x-amz-target': 'AWSCognitoIdentityProviderService.SignUp'
                }
            }
        );
        logger.trace('POST https://cognito-idp.us-west-2.amazonaws.com/ (SignUp) ' + resp.status + ': ' + resp.body);
        return Utils.parseResponseBody(resp);
    }

    initiateAuth(phone) {
        const resp = http.post(
            'https://cognito-idp.us-west-2.amazonaws.com/',
            JSON.stringify({ ClientId: this.clientId, AuthFlow: "CUSTOM_AUTH", AuthParameters: { USERNAME: phone } }),
            {
                headers: {
                    'Content-Type': 'application/x-amz-json-1.1',
                    'x-amz-api-version': '2016-04-18',
                    'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth'
                }
            }
        );
        logger.trace('POST https://cognito-idp.us-west-2.amazonaws.com/ (InitiateAuth) ' + resp.status + ': ' + resp.body);
        return Utils.parseResponseBody(resp);
    }

    respondToAuthChallenge(phone, session) {
        const resp = http.post(
            'https://cognito-idp.us-west-2.amazonaws.com/',
            JSON.stringify({ ClientId: this.clientId, Session: session, ChallengeName: 'CUSTOM_CHALLENGE', ChallengeResponses: { USERNAME: phone, ANSWER: '123456' } }),
            {
                headers: {
                    'Content-Type': 'application/x-amz-json-1.1',
                    'x-amz-api-version': '2016-04-18',
                    'x-amz-target': 'AWSCognitoIdentityProviderService.RespondToAuthChallenge'
                }
            }
        );
        logger.trace('POST https://cognito-idp.us-west-2.amazonaws.com/ (RespondToAuthChallenge) ' + resp.status + ': ' + resp.body);
        return Utils.parseResponseBody(resp);
    }

    refreshAuth(phone, refreshToken) {
        const resp = http.post(
            'https://cognito-idp.us-west-2.amazonaws.com/',
            JSON.stringify({ ClientId: this.clientId, AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { USERNAME: phone, REFRESH_TOKEN: refreshToken } }),
            {
                headers: {
                    'Content-Type': 'application/x-amz-json-1.1',
                    'x-amz-api-version': '2016-04-18',
                    'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth'
                }
            }
        );
        logger.trace('POST https://cognito-idp.us-west-2.amazonaws.com/ (InitiateAuth) ' + resp.status + ': ' + resp.body);
        return Utils.parseResponseBody(resp);
    }
}
