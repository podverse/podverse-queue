export const config = {
  userAgent: process.env.USER_AGENT,
  rabbitmq: {
    host: process.env.RABBITMQ_HOST,
    port: process.env.RABBITMQ_PORT,
    username: process.env.RABBITMQ_USERNAME,
    password: process.env.RABBITMQ_PASSWORD,
    vhost: process.env.RABBITMQ_VHOST
  },
  podcastIndex: {
    authKey: process.env.PODCAST_INDEX_AUTH_KEY,
    baseUrl: process.env.PODCAST_INDEX_BASE_URL,
    secretKey: process.env.PODCAST_INDEX_SECRET_KEY
  }
};
