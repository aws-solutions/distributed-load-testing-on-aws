import { config } from './Config.js';
import { Logger } from './Logger.js';
import { Utils } from './Utils.js';
import { Cognito } from './Cognito.js';
import { API } from './API.js';
import { Client } from './Client.js';
import { Counter, Trend, Rate } from 'k6/metrics';
import { sleep } from 'k6';
import http from 'k6/http';

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
    noPennyCount: new Counter('no_pennies'),
    networkErrorCount: new Counter('network_errors'),
    apiErrorCount: new Counter('api_errors'),
    timeoutCount: new Counter('timeouts')
};

const startTime = Date.now();

export default function() {
    const testDuration = options.stages.map(s => Utils.parseDuration(s.duration)).reduce((t, d) => t + d);
    const rampDownDuration = Utils.parseDuration(options.stages[options.stages.length - 2].duration);
    const cleanUpDuration = Utils.parseDuration(options.stages[options.stages.length - 1].duration);
    const startRampDownElapsed = testDuration - cleanUpDuration - rampDownDuration;
    // Burn our first VU as a heartbeat monitor to send logs to CloudWatch every 10
    // seconds, along with a metric that can be graphed on a dashboard
    if (config.heartbeat && __VU == 1) {
        if (testDuration) {
            const url = config.stack === 'local' ? 'http://localhost:8080/health' : `https://${config.stack}-api.tallyup.com/health`;
            let succ = 0;
            let fail = 0;
            const start = Date.now();
            let elapsed = 0;
            while (elapsed < testDuration) {
                const resp = http.get(url, { timeout: 10000 });
                if (resp.status == 200)
                    ++ succ;
                else
                    ++ fail;
                console.log(`${succ} succ ${fail} fail ${resp.timings.duration / 1000} avg rt`);
                sleep(10);
                elapsed = Date.now() - start;
            }
            return;
        }
    }
    metrics.sessionCount.add(1);
    let start = Date.now();
    const numberBase = (__ENV.TASK_INDEX || 0) * options.vusMax;
    logger.debug('Base number: ' + numberBase);
    const phone = Utils.getPhoneNumber(numberBase + __VU - 1);
    logger.info('Task: ' + (__ENV.TASK_INDEX || 0) + ', VU: ' + __VU + ', phone: ' + phone);

    const idp = new Cognito(config.clientStackData[config.stack].clientId);
    const api = new API(idp, metrics, config.clientStackData[config.stack].urlBase);
    const client = new Client(api, metrics, config.enableDelays);

    client.session(phone, startTime, testDuration, startRampDownElapsed, rampDownDuration, options.vusMax);
    metrics.sessionLength.add(Date.now() - start);
}
