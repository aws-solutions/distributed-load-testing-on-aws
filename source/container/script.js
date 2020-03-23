import { config } from './Config.js';
import { Logger } from './Logger.js';
import { Utils } from './Utils.js';
import { Cognito } from './Cognito.js';
import { API } from './API.js';
import { Client } from './Client.js';
import { Counter, Trend, Rate } from 'k6/metrics';

// NOTE: This will later be populated with consolidated options, including those
// derived from here, config.json, env vars, and any command line args
export let options = config;

const logger = new Logger('script');

const metrics = {
    sessionCount: new Counter('sessions'),
    sessionLength: new Trend('session_duration', true),
    matchmakingDelay: new Trend('matching_delay', true),
    gameCount: new Counter('games'),
    gameLength: new Trend('game_duration', true),
    roundDelay: new Trend('round_delay', true),
    botsPercentage: new Rate('bots_percent'),
    pennyAwardedCount: new Counter('pennies'),
    noPennyCount: new Counter('no_pennies')
};

export default function() {
    metrics.sessionCount.add(1);
    let start = Date.now();
    logger.info('TASK_INDEX: ' + __ENV.TASK_INDEX || 0);
    const numberBase = (__ENV.TASK_INDEX || 0) * options.vusMax;
    logger.debug('Base number: ' + numberBase);
    const phone = Utils.getPhoneNumber(numberBase + __VU - 1);
    logger.info('Phone: ' + phone);

    const idp = new Cognito(config.clientStackData[config.stack].clientId);
    const api = new API(idp, config.clientStackData[config.stack].urlBase);
    const client = new Client(api, metrics, config.enableDelays);

    client.session(phone);
    metrics.sessionLength.add(Date.now() - start);
}
