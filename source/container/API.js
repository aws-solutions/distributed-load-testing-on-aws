import http from 'k6/http';
import { Logger } from './Logger.js';
import { Utils } from './Utils.js';

const logger = new Logger('API');

export const ErrCode = {
	None:                       0,
	PhoneNumberInvalid:         1,
	UsernameInvalid:            2,
	UsernameInUse:              3,
	UpdateFailure:              4,
	UserNotFound:               5,
	PercentageInvalid:          6,
	AccountInsufficient:        7,
	CognitoError:               8,
	PhoneNumberUnconfirmed:     9,
	AlreadyRegistered:          10,
	InviteCodeInvalid:          11,
	AlreadyPlaying:             12,
	NotAdmitted:                13,
	NotPlaying:                 14,
	AdmissionExpired:           15,
	NotQueued:                  16,
	AuthError:                  17,
	CashOutInvalidState:        18,
	IncompatibleClientVersion:  19,
	IncompatibleServerVersion:  20,
	PayeeInvalid:               21,
    InternalError:              22
};

export class API {
    constructor(idp, urlBase) {
        this.idp = idp;
        this.urlBase = urlBase;
        this.accessToken = '';
    }

    auth(phone) {
        const respSignup = this.idp.signUp(phone);
        const respInitiate = this.idp.initiateAuth(phone);
        const respResponse = this.idp.respondToAuthChallenge(phone, respInitiate.Session);
        this.accessToken = respResponse.AuthenticationResult.AccessToken;
    }

    get(urlPath) {
        const resp = http.get(
            this.urlBase + urlPath,
            {
                headers: {
                    'Authorization': 'Bearer ' + this.accessToken
                }
            }
        );
        logger.trace('GET ' + urlPath + ' ' + resp.status + ': ' + resp.body);
        return Utils.parseResponseBody(resp);
    }

    post(urlPath, body) {
        const resp = http.post(
            this.urlBase + urlPath,
            JSON.stringify(body),
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + this.accessToken
                }
            }
        );
        logger.trace('POST ' + urlPath + ' ' + resp.status + ': ' + resp.body);
        return Utils.parseResponseBody(resp);
    }
}
