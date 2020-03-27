export class Utils {
    static parseResponseBody(resp) {
        if (resp.body[0] == '{') {
            return JSON.parse(resp.body);
        } else {
            if (resp.status < 200 || resp.status >= 300) {
                return { error: { msg: `HTTP status: ${resp.status}`} };
            } else
                return {};
        }
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
}
