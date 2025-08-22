export const app = {
    isProduction: process.env.NODE_ENV === 'production',
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0',
    cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    },
}

export default app;