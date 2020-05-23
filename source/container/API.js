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
    InternalError:              22,
	InvalidQueryParams:         23,
	AmountInvalid:              24,
	GameNotPlayable:            25,
	AdError:                    26,
	UserIneligible:             27,
	TransactionTimeout:         28,
	DocumentTimeout:            29,
	CommitTransactionRetriesExceeded: 30,
	TransactionRetriesExceeded: 31,
	DocumentRetriesExceeded:    32,
	OCCVersionMismatch:         33
    // NOTE: Keep this in sync with tallyup-server/src/shared/errors/ErrCode.ts!
};

export class API {
    constructor(idp, metrics, urlBase) {
        this.idp = idp;
        this.metrics = metrics;
        this.urlBase = urlBase;
        this.phone = '';
        this.accessToken = '';
        this.accessTokenExpiry = 0;
        this.refreshToken = '';
    }

    auth(phone) {   
        this.phone = phone;
        const signUpResp = this.idp.signUp(phone);
        if (signUpResp.error && signUpResp.error.status !== 400 && signUpResp.__type !== 'UsernameExistsException')
            return signUpResp;
        const initiateAuthResp = this.idp.initiateAuth(phone);
        if (initiateAuthResp.error)
            return initiateAuthResp;
        const respondResp = this.idp.respondToAuthChallenge(phone, initiateAuthResp.Session);
        if (respondResp && respondResp.AuthenticationResult) {
            this.accessToken = respondResp.AuthenticationResult.AccessToken;
            this.accessTokenExpiry = Date.now() + (respondResp.AuthenticationResult.ExpiresIn - 60) * 1000; // Start refreshing 1 minute before expiry
            this.refreshToken = respondResp.AuthenticationResult.RefreshToken;
        } else {
            this.accessToken = '';
            this.accessTokenExpiry = 0;
            this.refreshToken = null;
        }
        return respondResp;
    }

    refreshAuth() {
        if (!this.refreshToken || Date.now() < this.accessTokenExpiry)
            return;
        logger.warn('Refreshing accessToken: ' + this.phone);
        const refreshResp = this.idp.refreshAuth(this.phone, this.refreshToken);
        if (refreshResp && refreshResp.AuthenticationResult) {
            this.accessToken = refreshResp.AuthenticationResult.AccessToken;
            this.accessTokenExpiry = Date.now() + (refreshResp.AuthenticationResult.ExpiresIn - 60) * 1000; // Start refreshing 1 minute before expiry
        } else {
            this.accessToken = null;
            this.accessTokenExpiry = 0;
        }
        return refreshResp;
    }

    get(urlPath) {
        const refreshResp = this.refreshAuth();
        if (refreshResp && refreshResp.error)
            return refreshResp;
        const resp = http.get(
            this.urlBase + urlPath,
            {
                headers: {
                    'Authorization': 'Bearer ' + this.accessToken
                }
            }
        );
        logger.trace('GET ' + urlPath + ' ' + resp.status + ': ' + resp.body);
        const json = Utils.parseResponseBody(resp);
        if (resp.status < 200 || resp.status >= 300)
            this.metrics.apiErrorCount.add(1);
        else if (resp.error_code == 1211)
            this.metrics.timeoutCount.add(1);
        else if (resp.error_code)
            this.metrics.networkErrorCount.add(1);
        return json;
    }

    post(urlPath, body) {
        const refreshResp = this.refreshAuth();
        if (refreshResp && refreshResp.error)
            return refreshResp;
        let tries = 3;
        let json;
        while (tries) {
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
            json = Utils.parseResponseBody(resp);
            if (resp.status < 200 || resp.status >= 300)
                // It's expected for session_start to return UserNotFound error to denote user isn't registered
                if (urlPath !== 'users/session_start' || !json || !json.error || json.error.code != ErrCode.UserNotFound)
                    this.metrics.apiErrorCount.add(1);
            else if (resp.error_code == 1211)
                this.metrics.timeoutCount.add(1);
            else if (resp.error_code)
                this.metrics.networkErrorCount.add(1);
            if (!resp.status || resp.status < 500)
                break;
            -- tries;
            Utils.delay(1, 5);
            if (tries > 0)
                logger.warn('POST ' + urlPath + ' retrying after ' + JSON.stringify(json));
        }
        return json;
    }
}
