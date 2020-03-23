import { config } from './Config.js';

export const LogLevel = {
    Critical: 0,
    Error: 1,
    Warn: 2,
    Info: 3,
    Debug: 4,
    Trace: 5
};

export class Logger {
    constructor(name, logLevel) {
        this.name = name;
        let level;
        if (logLevel != null) {
            level = logLevel;
        } else {
            if (config && config.logLevels) {
                level = config.logLevels[name];
                if (level == null)
                    level = config.logLevels['*'];
            }
            if (level == null)
                level = 'Info';
        }
        if (Number.isInteger(level))
            this.logLevel = level;
        else if (typeof level === 'string' || level instanceof String)
            this.logLevel = LogLevel[level];
        else
            throw new Error(`logLevel must be a string or integer`);
    }

    log(level, message) {
        if (level <= this.logLevel) {
            switch (level) {
                case LogLevel.Trace:
                case LogLevel.Debug:
                case LogLevel.Info:
                    console.log(message);
                    break;
                case LogLevel.Warn:
                    console.warn(message);
                    break;
                default:
                    console.error(message);
                    break;
            }
        }
    }

    critical(message) {
        this.log(LogLevel.Critical, message);
    }

    error(message) {
        this.log(LogLevel.Error, message);
    }

    warn(message) {
        this.log(LogLevel.Warn, message);
    }

    info(message) {
        this.log(LogLevel.Info, message);
    }

    debug(message) {
        this.log(LogLevel.Debug, message);
    }

    trace(message) {
        this.log(LogLevel.Trace, message);
    }
}
