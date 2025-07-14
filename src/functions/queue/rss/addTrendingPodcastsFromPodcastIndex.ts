import { PodcastIndexService } from 'podverse-external-services';
import { QueueName, RabbitMQService } from '@queue/services/rabbitmq';

type AddTrendingPodcastsOptions = {
  queueName: QueueName;
  maxFeeds?: number;
};

export const queueRSSAddTrendingPodcastsFromPodcastIndex = async (
  rabbitMQService: RabbitMQService,
  podcastIndexService: PodcastIndexService,
  options: AddTrendingPodcastsOptions
): Promise<void> => {
  const { queueName, maxFeeds = 1000 } = options;

  try {
    const { feeds } = await podcastIndexService.trendingGetPodcasts(maxFeeds);

    await rabbitMQService.initialize();

    for (const feed of feeds) {
      const message = {
        url: feed.url,
        podcast_index_id: feed.id
      };
      
      await rabbitMQService.sendMessage(queueName, message);
    }
  } catch (error) {
    console.error('[queueRSSAddTrendingPodcastsFromPodcastIndex] Error adding trending podcasts:', error);
    throw error;
  }
};