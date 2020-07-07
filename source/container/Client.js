import { config } from './Config.js';
import { Logger } from './Logger.js';
import { Utils } from './Utils.js';
import { ErrCode } from './API.js';

const logger = new Logger('Client');

export class Client {
    constructor(api, metrics, enableDelays = true) {
        this.api = api;
        this.metrics = metrics;
        this.enableDelays = enableDelays;
        this.user = null;
    }

    delay(time, maxTime) {
        Utils.delay(time, maxTime);
    }

    sessionStart(phone) {
        const startupResp = this.api.get('config/startup');
        if (startupResp.error)
            return startupResp;
        const authResp = this.api.auth(phone);
        if (authResp.error)
            return authResp;
        this.user = null;
        let sessionResp = this.api.post('users/session_start', {});
        this.user = sessionResp.data;
        if (sessionResp.error && sessionResp.error.code === ErrCode.UserNotFound) {
            const registerResp = this.api.post('users/register', { inviteCode: '0PENUP' });
            if (registerResp.error)
                return registerResp;
            sessionResp = this.getUser();
        }
        if (sessionResp.data && sessionResp.data.inviteData && sessionResp.data.inviteData.status !== 'playing') {
            const activateResp = this.api.post('users/activate', { username: Utils.getUsername(phone) });
            if (activateResp.error)
                return activateResp;
            sessionResp = this.getUser();
        }
        return sessionResp;
    }

    getUser() {
        const resp = this.api.get('users');
        this.user = resp.data;
        return resp;
    }

    getLeaderboard() {
        logger.info('Get leaderboard...');
        this.api.get('users/highest');
    }

    cashOut() {
        logger.info('Cash out...');
        if (!this.user) {
            logger.error('No user for cashout!');
            return null;
        }
        const startResp = this.api.post('users/cashout_start', {});
        if (startResp.data && startResp.data.isAllowed) {
            const availableBalance = this.user.account;
            const charityPercent = 10 + Math.round(90 * Math.random());
            const charityAmount = Math.round(availableBalance * (charityPercent / 100));
            const friendPercent = 10;
            const inviterAmount = startResp.hasInviter ? Math.round((availableBalance - charityAmount) * (friendPercent / 100)) : 0;
            const playerAmount = availableBalance - charityAmount - inviterAmount;
            this.delay(30);
            const finishResp = this.api.post('users/cashout_finish', {
                charityPercent: charityPercent,
                desiredCharityAmount: charityAmount,
                desiredInviterAmount: inviterAmount,
                desiredPlayerAmount: playerAmount,
                payee: 'fake@tallyup.com'   // Our fake phone numbers don't validate on the server: this.user.phone
            });
        }
    }

    watchAd() {
        const startResp = this.api.post('ad/watch_ad', {});
        if (startResp.error)
            return startResp;
        logger.debug('Watching ad...');
        this.delay(30, 35);
        const finishResp = this.api.post('ad/finish_ad', {});
        return finishResp;
    }

    pollingDelay() {
        this.delay(1, 1.25);
    }

    requestLevel(levels) {
        const resp = this.api.post('games/request_level', { game_level: levels, only_bots: false });
        let status;
        const start = Date.now();
        while (status !== 'playing') {
            this.pollingDelay();
            if ((Date.now() - start) > 180000) {
                const resp = this.api.post('games/cancel_request_level', {});
                if (!resp.error || resp.error.msg !== 'User is already matched.') {
                    this.pollingDelay();
                    this.getUser();
                    return;
                }
            }
            this.getUser();
            status = this.user && this.user.play && this.user.play.status;
        }
    }

    randomInRange(min, max) {
        return min + (max - min) * Math.random();
    }

    playLevel(levels) {
        logger.info('Play level ' + level + '...');
        if (!this.user) {
            logger.error('No user!');
            return null;
        }

        if (this.user.account < 1) {
            if (this.user.pennies_remaining === 0) {
                this.metrics.noPennyCount.add(1);
                return null;
            }
            const resp = this.watchAd();
            if (!resp || resp.error) {
                if (resp)
                    logger.error(resp.error.msg);
                this.delay(600);
                return resp;
            }
            this.metrics.pennyAwardedCount.add(1);
        }

        let matchmakingStart = Date.now();
        this.requestLevel(levels);
        if (!this.user.play || this.user.play.status !== 'playing' || !this.user.play.game) {
            return null;
        }

        const gameId = this.user.play.game;
        const type = this.user.play.game_type;
        this.metrics.gameCount.add(1, { game: type, level: level });
        logger.trace('type=' + type);

//        this.delay(10);
        let resp = this.api.post(`games/${gameId}/event`, { event: { type: 'finishedLoading' } });

        let first = true;
        while (!resp || !resp.data || !resp.data.data) {
            if (!first)
                this.pollingDelay();
            first = false;
            resp = this.api.get(`games/${gameId}`);
        }

        this.metrics.matchmakingDelay.add(Date.now() - matchmakingStart, { game: type, level: level });
//        let isBot = resp.data.data.opponent_info.isBot; // TODO: This isn't exposed by our server! Expose it for non-prod stacks?
        let isBot = resp.data.data.opponent_info.username.includes('bot');  // TODO: This assumes bots are called "botN" or similar
        this.metrics.botsPercentage.add(isBot ? 1 : 0, { game: type, level: level });

        const opponent = resp.data.data.opponent_info.username;
        logger.debug('Opponent: ' + opponent);

        let gameStart = Date.now();
        let n = 1;
        let win_status;
        while (!win_status) {
            let round_number = n;
            let value;
            if (type === 'ShootingGalleryGame') {
                let available_water = resp.data.data.player_info.water;
                logger.debug('available_water=' + available_water);
                value = Math.round(this.randomInRange(0, available_water));
                logger.debug('value=' + value);
            } else if (type === 'CrystalCaveGame') {
                let num_lanes = resp.data.data.game_config.lanes.length;
                let available_buttons = [];
                for (let i = 1; i <= num_lanes; i++) {
                    available_buttons.push(i);
                }
                logger.debug('available_buttons=' + available_buttons);
                let button_index = Math.round(this.randomInRange(0, available_buttons.length - 1));
                logger.debug('button_index=' + button_index);
                value = available_buttons[button_index];
                logger.debug('value=' + value);
            } else {
                let available_buttons = resp.data.data.player_info.available_buttons;
                logger.debug('available_buttons=' + available_buttons);
                let button_index = Math.round(this.randomInRange(0, available_buttons.length - 1));
                logger.debug('button_index=' + button_index);
                value = available_buttons[button_index];
                logger.debug('value=' + value);
            }
            resp = this.api.post(`games/${gameId}/event`, { event: { type: 'beginRoundTimer', data: { round: round_number } } });
            resp = this.api.post(`games/${gameId}/answer`, { answer: { round: round_number, data: value } });
            let roundStart = Date.now();
            let first = true;
            while (round_number === n && !win_status) {
                if (!first)
                    this.pollingDelay();
                first = false;
                resp = this.api.get(`games/${gameId}`);
                if (resp && resp.data && resp.data.data) {
                    round_number = resp.data.data.game_config.round_number;
                    win_status = resp.data.data.game_config.win_status;
                }
            }
            this.metrics.roundDelay.add(Date.now() - roundStart, { game: type, level: level/*, round: n*/ });
            ++ n;
        }
        this.metrics.gameLength.add(Date.now() - gameStart, { game: type, level: level });
        logger.debug(win_status);
        return resp;
    }

    maxLevel(value) {
        if (value === 0) return value;
        return Math.floor(Math.log10(value) / Math.log10(2) + 1);
    };

    playRandomLevel() {
        logger.info('Play random level...');
        if (this.user) {
            const level = Math.max(this.user.account ? Math.round(this.maxLevel(this.user.account) * Math.random()) : 1, 1);
            return this.playLevel([level]);
        }
        return null;
    }

    playMaximumLevel() {
        logger.info('Play maximum level...');
        if (this.user) {
            const level = Math.max(this.user.account ? this.maxLevel(this.user.account) : 1, 1);
            return this.playLevel([level]);
        }
        return null;
    }

    playRandomLevels() {
        logger.info('Play a few random levels');
        const uniqueLevels = [];
        const choosenLevels = [];
        if (this.user) {
            // Make a grab bag of unique levels
            const maxLevel = Math.max(this.user.account ? this.maxLevel(this.user.account) : 1, 1);
            for (let i = maxLevel; i >= 1; i--) {
                uniqueLevels.push(i);
            }

            // Choose a couple of levels for the user.
            const elementsToChoose = Math.min(uniqueLevels.length, 5);
            for (let i = 0; i < elementsToChoose; i++) {
                const randomIndex = Math.floor(Math.random() * uniqueLevels.length);
                const randomElement = uniqueLevels[randomIndex];
                choosenLevels.push(randomElement);
                uniqueLevels.splice(randomIndex, 1);
            }

            return this.playLevel(choosenLevels);
        }
        return null;
    }

    returnToTower() {
        this.delay(60);
        let resp = this.api.get('config/startup');
        if (resp.error)
            return resp;
        resp = this.api.get('config/towerdata');
        if (resp.error)
            return resp;
        resp = this.getUser();
        if (resp.error)
            return resp;
        resp = this.api.get('config/charitydata');
        return resp;
    }

    backoff(maxTime) {
        const sleepTime = maxTime * Math.random();
        logger.warn('Backing off VU: ' + __VU + ', ' + sleepTime + ' seconds');
        this.delay(sleepTime, sleepTime);
    }

    killVU(testDuration, startTime) {
        // Kill VU by sleeping past end of test
        const t = (testDuration - (Date.now() - startTime)) / 1000 * 2;
        this.delay(t, t);
    }

    session(phone, startTime, testDuration, startRampDownElapsed, rampDownDuration, vusMax) {
        logger.debug('startTime=' + startTime + ', startRampDownElapsed=' + startRampDownElapsed + ', rampDownDuration=' + rampDownDuration + ', vusMax=' + vusMax);
        this.delay(120);
        const resp = this.sessionStart(phone);
        if (resp.error) {
            logger.error('Error at start of session: ' + JSON.stringify(resp));
            if (resp.error.status === 400 && resp.__type === 'TooManyRequestsException') {
                this.metrics.cognitoThrottleCount.add(1);   // This might abort entire test if it exceeds threshold
                this.backoff(600);
            } else if (resp.error.status >= 500) {
                this.backoff(60);
            } else {
                // Non-retryable error - kill VU
                logger.warn('Stopping VU: ' + __VU);
                this.killVU(testDuration, startTime);
            }
            return;
        }
        if (!this.user) {
            logger.error('No user at start of session!');
            this.backoff(60);
            return;
        }
        if (!this.user.pennies_remaining) {
            logger.error('No pennies remaining at start of session!');
            this.backoff(600);  // Up to 10 minutes
            return;
        }
        this.api.get('config/towerdata');
        this.getUser();
        this.api.get('config/charitydata');
        while (true) {
            const now = Date.now();
            const elapsed = now - startTime;
            logger.trace('elapsedTime=' + elapsed);
            // If we're past the start of ramp-down, see if this VU should stop playing now
            if (elapsed > startRampDownElapsed) {
                const rampDownElapsed = elapsed - startRampDownElapsed;
                let vusFrac = 1 - rampDownElapsed / rampDownDuration;
                if (vusFrac < 0) vusFrac = 0;
                logger.trace('vusFrac=' + vusFrac + ', rampDownElapsed=' + rampDownElapsed);
                if (__VU > vusFrac * vusMax) {
                    logger.info('Ramping down VU: ' + __VU + ', vusFrac=' + vusFrac + ', elapsed=' + elapsed);
                    this.killVU(testDuration, startTime);
                    return;
                }
            }
            // Take some random action to simulate a user
            let actionPercentage = Math.round(100 * Math.random());
            logger.debug('task=' + actionPercentage);
            if (actionPercentage <= config.percentages.exit) {
                // Stop playing for a while
                logger.info('Ending session...');
                this.delay(120);
                return;
            } else if (actionPercentage <= config.percentages.leaderboard) {
                // Get the leaderboard
                this.getLeaderboard();
            } else if (actionPercentage <= config.percentages.cashOut && this.user && this.user.account >= 1000) {
                // Attempt to cashout
                this.cashOut();
            } else if (actionPercentage <= config.percentages.playRandom) {
                // Play a random level
                let resp = this.playRandomLevels();
                if (!resp || resp.error) {
                    logger.info('Ending session...');
                    this.delay(this.user.pennies_remaining === 0 ? 600 : 120);
                    return;
                }
            } else {
                // Play the highest level allowed
                let resp = this.playMaximumLevel();
                if (!resp || resp.error) {
                    logger.info('Ending session...');
                    this.delay(this.user.pennies_remaining === 0 ? 600 : 120);
                    return;
                }
            }
            this.returnToTower();
            this.delay(2, 2.5);
        }
    }
}
