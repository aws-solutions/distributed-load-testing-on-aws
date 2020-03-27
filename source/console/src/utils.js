export function toFixed(value, digits) {
    return value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatTime(t) {
    if (t <= 0) {
        return '0';
    } else if (t < 1) {
        return toFixed(t * 1000, 2) + 'µs';
    } else if (t < 1000) {
        return toFixed(t, 2) + 'ms';
    } else if ( t < 60000) {
        return toFixed(t / 1000, 3) + 's';
    } else if (t < 3600000) {
        return toFixed(t / 60000, 3) + 'm';
    } else {
        return toFixed(t / 3600000, 3) + 'h';
    }
}

export function formatData(b) {
    if (b > 1073741824) {
        return toFixed(b / 1073741824, 2) + ' GB';
    } else if (b > 1048576) {
        return toFixed(b / 1048576, 2) + ' MB';
    } else if (b > 1024) {
        return toFixed(b / 1024, 2) + ' KB';
    } else {
        return toFixed(b, 0) + ' B';
    }
}

export function formatMetric(metric) {
    switch (metric.type) {
    case 'trend':
        if (metric.format === 'time') {
            return  `min=${formatTime(metric.min)}, ` +
                    `max=${formatTime(metric.max)}, ` +
                    `avg=${formatTime(metric.avg)}, ` +
                    `med=${formatTime(metric.med)}, ` +
                    `p90=${formatTime(metric.p90)}, ` +
                    `p95=${formatTime(metric.p95)}`
        } else {
            return  `min=${toFixed(metric.min, 2)}, ` +
                    `max=${toFixed(metric.max, 2)}, ` +
                    `avg=${toFixed(metric.avg, 2)}, ` +
                    `med=${toFixed(metric.med, 2)}, ` +
                    `p90=${toFixed(metric.p90, 2)}, ` +
                    `p95=${toFixed(metric.p95, 2)}`
        }
    case 'rate':
        return toFixed(metric.value * 100, 1) + '%';
    case 'counter':
        if (metric.format === 'data') {
            return formatData(metric.value);
        } else {
            return toFixed(metric.value, 3);
        }
    case 'gauge':
        return toFixed(metric.value, 3);
    default:
        return toFixed(metric.value, 3);
    }
}