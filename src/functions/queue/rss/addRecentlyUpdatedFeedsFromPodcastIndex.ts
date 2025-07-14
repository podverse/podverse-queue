import { FeedService } from 'podverse-orm';
import { QueueName, RabbitMQService } from "@queue/services/rabbitmq";
import { PodcastIndexService } from 'podverse-external-services';

type QueueRSSAddAllRecentlyUpdatedFeedsOptions = {
  queueName: QueueName;
  sinceRange: number;
}

export const queueRSSAddRecentlyUpdatedFeedsFromPodcastIndex = async (
  rabbitMQService: RabbitMQService,
  podcastIndexService: PodcastIndexService,
  options: QueueRSSAddAllRecentlyUpdatedFeedsOptions
) => {
  const sinceRange = options.sinceRange;
  const recentlyUpdatedFeeds = await podcastIndexService.recentGetData(sinceRange);
  
  await rabbitMQService.initialize();

  for (const feed of recentlyUpdatedFeeds) {
    const feedService = new FeedService();
    const dbFeed = await feedService.getByPodcastIndexId({ podcast_index_id: feed.feedId });
    const shouldAddToQueue = !!dbFeed;

    if (shouldAddToQueue) {
      const message = {
        url: feed.feedUrl,
        podcast_index_id: feed.feedId
      };
  
      await rabbitMQService.sendMessage(options.queueName, message);
    }
  }
};
