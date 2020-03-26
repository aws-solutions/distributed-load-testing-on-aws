export function formatTime(t) {
    if (t <= 0) {
        return '0s';
    } else if (t < 1) {
        return (t * 1000).toFixed(2) + 'µs';
    } else if (t < 1000) {
        return t.toFixed(2) + 'ms';
    } else if ( t < 60000) {
        return (t / 1000).toFixed(3) + 's';
    } else if (t < 3600000) {
        return (t / 60000).toFixed(3) + 'm';
    } else {
        return (t / 3600000).toFixed(3) + 'h';
    }
}

export function formatMetric(metric) {
    switch (metric.type) {
    case 'trend':
        if (metric.isTime) {
            return  `min=${formatTime(metric.min)}, ` +
                    `max=${formatTime(metric.max)}, ` +
                    `avg=${formatTime(metric.avg)}, ` +
                    `med=${formatTime(metric.med)}, ` +
                    `p90=${formatTime(metric.p90)}, ` +
                    `p95=${formatTime(metric.p95)}`
        } else {
            return  `min=${metric.min.toFixed(2)}, ` +
                    `max=${metric.max.toFixed(2)}, ` +
                    `avg=${metric.avg.toFixed(2)}, ` +
                    `med=${metric.med.toFixed(2)}, ` +
                    `p90=${metric.p90.toFixed(2)}, ` +
                    `p95=${metric.p95.toFixed(2)}`
        }
    case 'rate':
        return (metric.value * 100).toFixed(0) + '%';
    case 'counter':
    case 'gauge':
    default:
        return metric.value.toFixed(2);
    }
}