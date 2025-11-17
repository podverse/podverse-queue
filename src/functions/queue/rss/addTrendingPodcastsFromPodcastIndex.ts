import { PodcastIndexService } from 'podverse-external-services';
import { QueueName, ActiveMQArtemisService } from '@queue/services/activeMQArtemis';
import { MQFeedMessage } from '@queue/types/mq';

type AddTrendingPodcastsOptions = {
  queueName: QueueName;
  maxFeeds?: number;
};

export const queueRSSAddTrendingPodcastsFromPodcastIndex = async (
  activeMQArtemisService: ActiveMQArtemisService,
  podcastIndexService: PodcastIndexService,
  options: AddTrendingPodcastsOptions
): Promise<void> => {
  const { queueName, maxFeeds = 1000 } = options;

  try {
    const { feeds } = await podcastIndexService.trendingGetPodcasts(maxFeeds);

    await activeMQArtemisService.initialize();

    for (const feed of feeds) {
      const message: MQFeedMessage = {
        url: feed.url,
        podcast_index_id: feed.id
      };
      
      await activeMQArtemisService.sendMessage(queueName, message);
    }
  } catch (error) {
    console.error('[queueRSSAddTrendingPodcastsFromPodcastIndex] Error adding trending podcasts:', error);
    throw error;
  }
};