import { sleep } from 'k6';

export class Utils {
    static parseResponseBody(resp) {
        let json = {};
        if (resp.body && (typeof resp.body === 'string' || resp.body instanceof String) && (resp.body[0] === '{' || resp.body[0] === '[')) {
            json = JSON.parse(resp.body);
        }
        if (resp.error) {
            if (!json.error)
                json.error = {};
            json.error.msg = resp.error;
        }
        if (resp.status < 200 || resp.status >= 300) {
            if (!json.error)
                json.error = {};
            json.error.status = resp.status;
            if (!json.error.msg)
                json.error.msg = 'HTTP status ' + resp.status;
        }
        if (resp.error_code) {
            if (!json.error)
                json.error = {};
            json.error.error_code = resp.error_code;
            if (resp.error_code == 1211 && !json.error.msg)
                json.error.msg = 'Timeout';
        }
        return json;
    }

    static getPhoneNumber(n) {
        const area = Math.trunc(n / 100);
        if (area > 999)
            throw new Error('Number too big (' + n + ')');
        const number = 100 + n % 100;
        return '+1' + ("00" + area).slice(-3) + '5550' + number;
    }

    static getUsername(phone) {
        return 'load_' + phone.substring(2, 5) + phone.substring(10);
    }

    static parseDuration(d) {
        if (d == null)
            return undefined;
        const str = d.toString();
        let duration = 0;
        const ms = str.match(/([.\d]+)ms/);
        const s = str.match(/([.\d]+)s/);
        const m = str.match(/([.\d]+)m($|[^s])/);
        const h = str.match(/([.\d]+)h/);
        if (ms) duration += parseInt(ms[1]);
        if (s) duration += parseInt(s[1] * 1000);
        if (m) duration += parseInt(m[1] * 60 * 1000);
        if (h) duration += parseInt(h[1] * 60 * 60 * 1000);
        return duration;
    }

    static delay(time, maxTime) {
        let sleepTime = 0;
        if (maxTime != null) {
            sleepTime = time;
            if (this.enableDelays)
                sleepTime += (maxTime - time) * Math.random();
        } else {
            if (!this.enableDelays)
                return;
            sleepTime = time * Math.random();
        }
        logger.trace('sleepTime=' + sleepTime);
        sleep(sleepTime);
    }
}
