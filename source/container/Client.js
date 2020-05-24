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
        if (sessionResp.error && sessionResp.error.code === ErrCode.UserNotFound) {
            const registerResp = this.api.post('users/register', { inviteCode: '0PENUP' });
            if (registerResp.error)
                return registerResp;
            sessionResp = this.api.get('users');
        }
        if (sessionResp.data && sessionResp.data.inviteData && sessionResp.data.inviteData.status !== 'playing') {
            const activateResp = this.api.post('users/activate', { username: Utils.getUsername(phone) });
            if (activateResp.error)
                return activateResp;
            sessionResp = this.api.get('users');
        }
        this.user = sessionResp.data;
        return sessionResp;
    }

    getUser() {
        const resp = this.api.get('users');
        this.user = resp.data;
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
            const charityPerc = 10 + round(90 * Math.random());
            this.delay(30);
            const finishResp = this.api.post('users/cashout_finish', { percentage: charityPerc, payee: this.user.phone });
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

    requestLevel(level) {
        let resp = this.api.post('games/request_level', { game_level: level, only_bots: false });
        let status;
        while (status !== 'playing') {
            this.delay(2, 2.5);
            this.getUser();
            status = this.user && this.user.play && this.user.play.status;
        }
    }

    randomInRange(min, max) {
        return min + (max - min) * Math.random();
    }

    playLevel(level) {
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
        this.requestLevel(level);

        const gameId = this.user.play.game;
        const type = this.user.play.game_type;
        this.metrics.gameCount.add(1, { game: type, level: level });
        logger.trace('type=' + type);

//        this.delay(10);
        let resp = this.api.post(`games/${gameId}/event`, { event: { type: 'finishedLoading' } });

        let first = true;
        while (!resp || !resp.data || !resp.data.data) {
            if (!first) this.delay(2, 2.5);
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
                if (!first) this.delay(2, 2.5);
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
            return this.playLevel(level);
        }
        return null;
    }

    playMaximumLevel() {
        logger.info('Play maximum level...');
        if (this.user) {
            const level = Math.max(this.user.account ? this.maxLevel(this.user.account) : 1, 1);
            return this.playLevel(level);
        }
        return null;
    }

    backoff(maxTime) {
        const sleepTime = maxTime * Math.random();
        logger.warn('Backing off VU: ' + __VU + ', ' + sleepTime + ' seconds');
        this.delay(sleepTime, sleepTime);
    }

    session(phone, startTime, testDuration, startRampDownElapsed, rampDownDuration, vusMax) {
        logger.debug('startTime=' + startTime + ', startRampDownElapsed=' + startRampDownElapsed + ', rampDownDuration=' + rampDownDuration + ', vusMax=' + vusMax);
        this.delay(120);
        const resp = this.sessionStart(phone);
        if (resp.error) {
            logger.error('Error at start of session: ' + JSON.stringify(resp));
            if (resp.error.status === 500 || resp.error.status === 503 || (resp.error.status === 400 && resp.__type === 'TooManyRequestsException')) {
                this.backoff(60);
            } else {
                // Non-retryable error - kill VU by sleeping until end of test
                logger.warn('Stopping VU: ' + __VU);
                const t = (testDuration - (Date.now() - startTime)) / 1000 + 10;
                this.delay(t, t);
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
        this.api.get('users');
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
                    // Kill VU by sleeping until end of test
                    logger.info('Ramping down VU: ' + __VU + ', vusFrac=' + vusFrac + ', elapsed=' + elapsed);
                    const t = (testDuration - (Date.now() - startTime)) / 1000 + 10;
                    this.delay(t, t);
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
            } else if (actionPercentage <= config.percentages.cashOut && this.user && this.user.account > 1000) {
                // Attempt to cashout
                this.cashOut();
            } else if (actionPercentage <= config.percentages.playRandom) {
                // Play a random level
                let resp = this.playRandomLevel();
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
            this.delay(60);
            this.getUser();
            this.delay(2);
        }
    }
}
