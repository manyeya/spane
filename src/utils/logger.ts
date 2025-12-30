import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: !isProduction
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
            },
        }
        : undefined,
    serializers: {
        err: pino.stdSerializers.err,
        error: pino.stdSerializers.err,
    },
    base: isProduction ? undefined : { pid: process.pid },
});

// Helper type for logger context
export type LoggerContext = Record<string, any>;
