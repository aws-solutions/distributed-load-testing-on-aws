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
}
