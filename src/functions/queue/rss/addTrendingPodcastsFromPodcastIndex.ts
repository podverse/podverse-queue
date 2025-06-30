import { logger } from 'podverse-helpers';
import { podcastIndexService } from '@queue/factories/podcastIndex';
import { QueueName, RabbitMQService } from '@queue/services/rabbitmq';

type AddTrendingPodcastsOptions = {
  queueName: QueueName;
  maxFeeds?: number;
};

export const queueRSSAddTrendingPodcastsFromPodcastIndex = async (
  options: AddTrendingPodcastsOptions
): Promise<void> => {
  const { queueName, maxFeeds = 1000 } = options;

  try {
    const { feeds } = await podcastIndexService.trendingGetPodcasts(maxFeeds);

    const rabbitMQService = new RabbitMQService();
    await rabbitMQService.initialize();

    for (const feed of feeds) {
      const message = {
        url: feed.url,
        podcast_index_id: feed.id
      };
      
      await rabbitMQService.sendMessage(queueName, message);
    }
  } catch (error) {
    logger.error('[queueRSSAddTrendingPodcastsFromPodcastIndex] Error adding trending podcasts:', error);
    throw error;
  }
};